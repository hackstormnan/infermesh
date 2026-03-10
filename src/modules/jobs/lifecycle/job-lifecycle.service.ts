/**
 * modules/jobs/lifecycle/job-lifecycle.service.ts
 *
 * Authoritative service for all job status transitions.
 *
 * Every mutation to a job's lifecycle status must go through this service.
 * It enforces three invariants on every write:
 *   1. The job exists (NotFoundError if not)
 *   2. The transition is allowed (InvalidTransitionError if not)
 *   3. A JobTransitionRecord is appended to the in-process history log
 *
 * ─── Named transition methods ────────────────────────────────────────────────
 *   moveToRouting  — Queued    → Routing
 *   assignJob      — Routing   → Assigned  (or Retrying → Assigned on retry)
 *   startJob       — Assigned  → Running   (stamps startedAt)
 *   completeJob    — Running   → Succeeded (stamps completedAt)
 *   failJob        — Running   → Failed    (stamps completedAt + failure details)
 *                    Routing   → Failed    (routing failure before assignment)
 *   cancelJob      — any non-terminal → Cancelled (stamps completedAt)
 *   retryJob       — Failed    → Retrying  (caller must then call assignJob)
 *
 * ─── History ─────────────────────────────────────────────────────────────────
 *   getHistory(jobId) returns a copy of all recorded transitions for a job.
 *   History is stored in-process (lost on restart). A durable audit log can
 *   be added by injecting an IJobHistoryRepository in a future ticket.
 *
 * ─── Future extensions ───────────────────────────────────────────────────────
 *   - Emit domain events (job.transitioned) for downstream consumers
 *   - Persist history via IJobHistoryRepository
 *   - Add retry policy evaluation inside retryJob (check maxAttempts)
 *   - Integrate timeout detection for jobs stuck in Running
 */

import type { RequestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import type { Job, JobTransitionRecord } from "../../../shared/contracts/job";
import { JobStatus } from "../../../shared/contracts/job";
import type { DecisionId, JobId, ModelId, WorkerId } from "../../../shared/primitives";
import type { JobAssignmentUpdate, JobFailureUpdate, IJobRepository } from "../repository/IJobRepository";
import type { JobDto } from "../service/jobs.service";
import { canTransition, InvalidTransitionError } from "./transitions";

// ─── Shared input types ───────────────────────────────────────────────────────

/**
 * Optional metadata attached to any transition.
 * Captured in the transition history record.
 */
export interface TransitionMeta {
  /** System component that triggered the transition (e.g. "api", "routing_engine") */
  source?: string;
  /** Human-readable reason or context note */
  reason?: string;
}

/**
 * Failure details supplied to failJob().
 */
export interface FailureInfo {
  /** Short structured code, e.g. "WORKER_TIMEOUT", "OOM", "MODEL_ERROR" */
  code?: string;
  /** Human-readable explanation from the worker or routing engine */
  reason?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const DEFAULT_SOURCE = "system";

export class JobLifecycleService {
  /**
   * In-process transition history.
   * Key = jobId (string). Value = ordered list of recorded transitions.
   *
   * Replace with an injected IJobHistoryRepository when durable history is needed.
   */
  private readonly history = new Map<string, JobTransitionRecord[]>();

  constructor(private readonly repo: IJobRepository) {}

  // ─── Transition methods ───────────────────────────────────────────────────

  /**
   * Queued → Routing
   * Called when the routing engine begins evaluating candidates.
   */
  async moveToRouting(
    ctx: RequestContext,
    jobId: string,
    meta?: TransitionMeta,
  ): Promise<JobDto> {
    return this.applyStatusTransition(ctx, jobId, JobStatus.Routing, meta);
  }

  /**
   * Routing → Assigned  (first attempt)
   * Retrying → Assigned (retry attempt)
   *
   * Stamps modelId, workerId, and routingDecisionId onto the job.
   */
  async assignJob(
    ctx: RequestContext,
    jobId: string,
    modelId: string,
    workerId: string,
    routingDecisionId: string,
    meta?: TransitionMeta,
  ): Promise<JobDto> {
    const job = await this.findAndGuard(jobId, JobStatus.Assigned);

    const update: JobAssignmentUpdate = {
      status: JobStatus.Assigned,
      modelId: modelId as ModelId,
      workerId: workerId as WorkerId,
      routingDecisionId: routingDecisionId as DecisionId,
      assignedAt: Date.now(),
    };

    const updated = await this.repo.updateAssignment(jobId as JobId, update);
    if (!updated) throw new NotFoundError(`Job ${jobId}`);

    this.appendHistory(updated, job.status, JobStatus.Assigned, meta, {
      modelId: modelId as ModelId,
      workerId: workerId as WorkerId,
      routingDecisionId: routingDecisionId as DecisionId,
    });

    ctx.log.info({ jobId, modelId, workerId, routingDecisionId }, "Job assigned to worker");

    return updated;
  }

  /**
   * Assigned → Running
   * Called when the selected worker acknowledges and begins execution.
   * Stamps startedAt.
   */
  async startJob(
    ctx: RequestContext,
    jobId: string,
    meta?: TransitionMeta,
  ): Promise<JobDto> {
    return this.applyStatusTransition(ctx, jobId, JobStatus.Running, meta, {
      startedAt: Date.now(),
    });
  }

  /**
   * Running → Succeeded
   * Called when the worker reports successful completion.
   * Stamps completedAt.
   */
  async completeJob(
    ctx: RequestContext,
    jobId: string,
    meta?: TransitionMeta,
  ): Promise<JobDto> {
    return this.applyStatusTransition(ctx, jobId, JobStatus.Succeeded, meta, {
      completedAt: Date.now(),
    });
  }

  /**
   * Running → Failed  (execution failure)
   * Routing → Failed  (routing failure before a worker was assigned)
   *
   * Records failure details and stamps completedAt.
   * Caller may subsequently call retryJob() if attempts < maxAttempts.
   */
  async failJob(
    ctx: RequestContext,
    jobId: string,
    failure: FailureInfo,
    meta?: TransitionMeta,
  ): Promise<JobDto> {
    const job = await this.findAndGuard(jobId, JobStatus.Failed);

    const update: JobFailureUpdate = {
      status: JobStatus.Failed,
      failureCode: failure.code,
      lastFailureReason: failure.reason,
      completedAt: Date.now(),
    };

    const updated = await this.repo.recordFailure(jobId as JobId, update);
    if (!updated) throw new NotFoundError(`Job ${jobId}`);

    this.appendHistory(updated, job.status, JobStatus.Failed, meta);

    ctx.log.warn(
      { jobId, failureCode: failure.code, reason: failure.reason },
      "Job failed",
    );

    return updated;
  }

  /**
   * Any non-terminal state → Cancelled
   * Stamps completedAt. Valid from: Queued, Routing, Assigned, Running,
   * Failed, Retrying.
   */
  async cancelJob(
    ctx: RequestContext,
    jobId: string,
    meta?: TransitionMeta,
  ): Promise<JobDto> {
    return this.applyStatusTransition(ctx, jobId, JobStatus.Cancelled, meta, {
      completedAt: Date.now(),
    });
  }

  /**
   * Failed → Retrying
   * Marks the job as waiting for the next retry attempt.
   * The caller must subsequently call assignJob() to re-enter the assignment step.
   */
  async retryJob(
    ctx: RequestContext,
    jobId: string,
    meta?: TransitionMeta,
  ): Promise<JobDto> {
    return this.applyStatusTransition(ctx, jobId, JobStatus.Retrying, meta);
  }

  // ─── History ──────────────────────────────────────────────────────────────

  /**
   * Returns an ordered copy of all transition records for the given job.
   * Returns an empty array if the job has no recorded transitions (e.g. not yet
   * touched by the lifecycle service, or the service was restarted).
   */
  getHistory(jobId: string): JobTransitionRecord[] {
    return [...(this.history.get(jobId) ?? [])];
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Fetches the job and validates that `from → to` is a legal transition.
   * Throws NotFoundError or InvalidTransitionError on failure.
   */
  private async findAndGuard(jobId: string, to: JobStatus): Promise<Job> {
    const job = await this.repo.findById(jobId as JobId);
    if (!job) throw new NotFoundError(`Job ${jobId}`);

    if (!canTransition(job.status, to)) {
      throw new InvalidTransitionError(job.status, to);
    }

    return job;
  }

  /**
   * Validates, persists a simple status change, records history, and logs.
   * Used by all transition methods that don't need `updateAssignment`.
   */
  private async applyStatusTransition(
    ctx: RequestContext,
    jobId: string,
    to: JobStatus,
    meta?: TransitionMeta,
    timestamps: { startedAt?: number; completedAt?: number } = {},
  ): Promise<JobDto> {
    const job = await this.findAndGuard(jobId, to);
    const from = job.status;

    const updated = await this.repo.updateStatus(jobId as JobId, {
      status: to,
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
    });
    if (!updated) throw new NotFoundError(`Job ${jobId}`);

    this.appendHistory(updated, from, to, meta);

    ctx.log.debug({ jobId, from, to }, "Job status transitioned");

    return updated;
  }

  /**
   * Appends a JobTransitionRecord to the in-process history store.
   * The record captures the full context at the moment of the transition.
   */
  private appendHistory(
    job: Job,
    from: JobStatus,
    to: JobStatus,
    meta?: TransitionMeta,
    assignment?: {
      modelId?: ModelId;
      workerId?: WorkerId;
      routingDecisionId?: DecisionId;
    },
  ): void {
    const record: JobTransitionRecord = {
      fromStatus: from,
      toStatus: to,
      changedAt: Date.now(),
      source: meta?.source ?? DEFAULT_SOURCE,
      reason: meta?.reason,
      workerId: assignment?.workerId ?? job.workerId,
      modelId: assignment?.modelId ?? job.modelId,
      routingDecisionId: assignment?.routingDecisionId ?? job.routingDecisionId,
      attempt: job.attempts,
    };

    const existing = this.history.get(job.id) ?? [];
    this.history.set(job.id, [...existing, record]);
  }
}
