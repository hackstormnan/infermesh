/**
 * modules/jobs/orchestration/job-routing.service.ts
 *
 * Orchestrates the full routing lifecycle for a single queued or retrying job.
 *
 * This service is the integration point between the job lifecycle (T9/T11),
 * the routing recovery layer (T18), and the routing decision engine (T16).
 * It does not implement routing or fallback logic — it sequences existing
 * services and decides lifecycle transitions based on recovery outcomes.
 *
 * ─── Call flow ────────────────────────────────────────────────────────────────
 *
 *  1. jobsService.getById()              — load job; guard Queued | Retrying state
 *  2. jobLifecycle.moveToRouting()       — Queued → Routing  (skipped for Retrying)
 *  3. recoveryService.attemptWithRecovery()
 *        ├── primary: decideRoute()
 *        └── fallback (NoEligibleWorker): decideRoute() with workerProfile={}
 *
 *  On RecoveryOutcome.succeeded:
 *  4a. jobLifecycle.assignJob()          — Routing|Retrying → Assigned
 *  5a. return AssignedJobOutcome
 *
 *  On RecoveryOutcome.failed + retryable + attempts < maxAttempts:
 *  4b. jobLifecycle.failJob()            — Routing|Retrying → Failed
 *  5b. jobLifecycle.retryJob()           — Failed → Retrying
 *  6b. jobsService.incrementRetryCount() — bump attempt counter
 *  7b. return RetryingJobOutcome         — caller returns 202 Accepted
 *
 *  On RecoveryOutcome.failed + terminal:
 *  4c. jobLifecycle.failJob()            — Routing|Retrying → Failed
 *  5c. throw original routing error
 *
 * ─── State machine invariants ─────────────────────────────────────────────────
 *
 *   Queued   → Routing → Assigned              (success, first attempt)
 *   Queued   → Routing → Failed → Retrying     (retryable failure, first attempt)
 *   Retrying →          → Assigned             (success on retry)
 *   Retrying →          → Failed               (terminal failure on retry)
 *
 * ─── Error handling ───────────────────────────────────────────────────────────
 *
 *   JobNotRoutableError  (409) — job not in Queued or Retrying status
 *   NotFoundError        (404) — jobId does not exist
 *   NoActivePolicyError  (503) — no routing policy active (terminal)
 *   NotFoundError        (404) — policyOverride name/ID does not exist (terminal)
 *   NoEligibleModelError (422) — no model passes constraints (retryable)
 *   NoEligibleWorkerError(422) — no worker available (retryable, fallback first)
 */

import type { RequestContext } from "../../../core/context";
import { JobStatus } from "../../../shared/contracts/job";
import { DecisionSource } from "../../../shared/contracts/routing";
import type { JobsService } from "../service/jobs.service";
import type { JobLifecycleService } from "../lifecycle/job-lifecycle.service";
import type { RoutingRecoveryService } from "./recovery/routing-recovery.service";
import { RoutingFailureClass } from "./recovery/routing-recovery.contract";
import type {
  AssignedJobOutcome,
  RetryingJobOutcome,
  RouteJobInput,
  RouteJobResult,
} from "./job-routing.contract";
import { JobNotRoutableError } from "./job-routing.contract";

// ─── Service ──────────────────────────────────────────────────────────────────

export class JobRoutingService {
  constructor(
    private readonly jobsService: JobsService,
    private readonly jobLifecycle: JobLifecycleService,
    private readonly recoveryService: RoutingRecoveryService,
  ) {}

  /**
   * Route a queued or retrying job to the best available (model, worker) pair.
   *
   * Returns `AssignedJobOutcome` on success (possibly via fallback) or
   * `RetryingJobOutcome` when the job has been scheduled for a retry.
   * Throws the original routing error when recovery is exhausted or
   * the failure is non-retryable.
   *
   * @throws {JobNotRoutableError}    — job is not in Queued or Retrying status
   * @throws {NotFoundError}          — jobId or policyOverride does not exist
   * @throws {NoActivePolicyError}    — no active routing policy found (terminal)
   * @throws {NoEligibleModelError}   — no eligible model available (after retry exhaustion)
   * @throws {NoEligibleWorkerError}  — no eligible worker available (after retry exhaustion)
   */
  async routeJob(ctx: RequestContext, input: RouteJobInput): Promise<RouteJobResult> {
    // ── 1. Load job and validate state ────────────────────────────────────────
    const job = await this.jobsService.getById(ctx, input.jobId);
    const isRetryAttempt = job.status === JobStatus.Retrying;

    if (job.status !== JobStatus.Queued && job.status !== JobStatus.Retrying) {
      throw new JobNotRoutableError(job.id, job.status);
    }

    ctx.log.info(
      { jobId: job.id, requestId: job.requestId, attempt: job.attempts, isRetryAttempt },
      "Beginning job routing",
    );

    // ── 2. Transition to Routing (first attempts only) ────────────────────────
    // Retrying jobs skip this — Retrying → Assigned is valid without going
    // through Routing again.
    if (!isRetryAttempt) {
      await this.jobLifecycle.moveToRouting(ctx, job.id, {
        source: "job_routing_service",
      });
    }

    // ── 3. Attempt routing with recovery (primary + optional fallback) ────────
    const recovery = await this.recoveryService.attemptWithRecovery(ctx, {
      requestId: job.requestId,
      jobId: job.id,
      decisionSource: input.decisionSource ?? DecisionSource.Live,
      policyOverride: input.policyOverride,
    });

    // ── 4a. Success path — assign the job ─────────────────────────────────────
    if (recovery.status === "succeeded") {
      const { selectedModelId, selectedWorkerId } = recovery.result.decision;
      if (!selectedModelId || !selectedWorkerId) {
        throw new Error("Routing decision returned without model or worker selection");
      }

      const assigned = await this.jobLifecycle.assignJob(
        ctx,
        job.id,
        selectedModelId,
        selectedWorkerId,
        recovery.result.decision.id,
        { source: "job_routing_service" },
      );

      ctx.log.info(
        {
          jobId: job.id,
          selectedModelId,
          selectedWorkerId,
          decisionId: recovery.result.decision.id,
          usedFallback: recovery.info?.usedFallback ?? false,
          evaluationMs: recovery.result.evaluationMs,
        },
        "Job successfully routed and assigned",
      );

      return {
        outcome: "assigned",
        job: assigned,
        decision: recovery.result.decision,
        modelSummary: recovery.result.modelSummary,
        workerSummary: recovery.result.workerSummary,
        evaluationMs: recovery.result.evaluationMs,
        recovery: recovery.info,
      } satisfies AssignedJobOutcome;
    }

    // ── 4b/4c. Failure path — decide: retry or terminal ──────────────────────
    const { info, error, retryEligible } = recovery;
    const canScheduleRetry = retryEligible && job.attempts < job.maxAttempts;

    ctx.log.warn(
      {
        jobId: job.id,
        failureClass: info.primaryFailureClass,
        usedFallback: info.usedFallback,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        canScheduleRetry,
      },
      "Routing recovery failed — determining terminal vs retry outcome",
    );

    // Always move to Failed first (valid from both Routing and Retrying states)
    await this.jobLifecycle.failJob(
      ctx,
      job.id,
      {
        code: toFailureCode(info.primaryFailureClass),
        reason: info.primaryFailureReason,
      },
      { source: "job_routing_service" },
    );

    if (canScheduleRetry) {
      // ── 4b. Schedule retry ─────────────────────────────────────────────────
      await this.jobLifecycle.retryJob(ctx, job.id, {
        source: "job_routing_service",
        reason: info.primaryFailureReason,
      });

      // Increment attempt counter and use the updated snapshot as the returned
      // job so that outcome.job.attempts is consistent with nextAttemptNumber.
      const jobWithCount = await this.jobsService.incrementRetryCount(ctx, job.id);

      ctx.log.info(
        { jobId: job.id, nextAttempt: job.attempts + 1, maxAttempts: job.maxAttempts },
        "Routing retry scheduled",
      );

      return {
        outcome: "retrying",
        job: jobWithCount,
        nextAttemptNumber: job.attempts + 1,
        retryReason: info.primaryFailureReason,
        recovery: info,
      } satisfies RetryingJobOutcome;
    }

    // ── 4c. Terminal failure ───────────────────────────────────────────────────
    ctx.log.error(
      { jobId: job.id, failureClass: info.primaryFailureClass, attempt: job.attempts },
      "Routing recovery exhausted — job marked Failed",
    );

    throw error;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFailureCode(fc: RoutingFailureClass): string {
  switch (fc) {
    case RoutingFailureClass.NoEligibleModel:    return "NO_ELIGIBLE_MODEL";
    case RoutingFailureClass.NoEligibleWorker:   return "NO_ELIGIBLE_WORKER";
    case RoutingFailureClass.PolicyBlocked:      return "NO_ACTIVE_POLICY";
    case RoutingFailureClass.PolicyNotFound:     return "POLICY_NOT_FOUND";
    case RoutingFailureClass.AssignmentConflict: return "ASSIGNMENT_CONFLICT";
    case RoutingFailureClass.TemporaryCapacity:  return "TEMPORARY_CAPACITY";
    default:                                     return "ROUTING_FAILED";
  }
}
