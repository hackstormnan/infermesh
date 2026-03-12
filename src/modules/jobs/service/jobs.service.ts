/**
 * modules/jobs/service/jobs.service.ts
 *
 * Service layer for the jobs module.
 *
 * Route handlers and other modules call this service — they never access the
 * repository directly.  The service owns:
 *   - ID generation and entity construction (createJob)
 *   - NotFoundError guards on all write operations
 *   - Structured logging via RequestContext
 *   - toDto() — maps the internal Job entity to the public JobDto
 *
 * ─── Read operations ──────────────────────────────────────────────────────────
 *   getById   — fetch a single job by UUID
 *   list      — paginated, filtered job catalog
 *
 * ─── Write operations (called by the routing/execution layer) ─────────────────
 *   createJob          — persist a new Queued job
 *   updateStatus       — simple lifecycle transitions
 *   assignJob          — stamp routing decision + model/worker onto the job
 *   recordFailure      — record a failure attempt (Failed or Retrying)
 *   incrementRetryCount — begin a retry attempt (→ Running)
 *
 * ─── Future work ──────────────────────────────────────────────────────────────
 *   When the routing engine is wired (future routing ticket), it will call
 *   createJob() then assignJob() as part of the evaluate() flow.
 *   A retry processor will call recordFailure() + incrementRetryCount().
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import type { Job } from "../../../shared/contracts/job";
import {
  JobPriority,
  JobSourceType,
  JobStatus,
} from "../../../shared/contracts/job";
import type {
  DecisionId,
  JobId,
  ModelId,
  PaginatedResponse,
  RequestId,
  WorkerId,
} from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { ListJobsQuery } from "../queries";
import type {
  IJobRepository,
  JobAssignmentUpdate,
  JobFailureUpdate,
  JobStatusUpdate,
} from "../repository/IJobRepository";

// ─── Public DTO ────────────────────────────────────────────────────────────────

/**
 * Public-facing job shape.
 * Identical to the internal entity — all job fields are safe to expose via the
 * read API.  A dedicated DTO would omit internal-only fields if they existed.
 */
export type JobDto = Job;

// ─── Create DTO ────────────────────────────────────────────────────────────────

export interface CreateJobDto {
  requestId: string;
  sourceType?: JobSourceType;
  priority?: JobPriority;
  maxAttempts?: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class JobsService {
  constructor(private readonly repo: IJobRepository) {}

  // ─── Read operations ─────────────────────────────────────────────────────────

  async getById(ctx: RequestContext, id: string): Promise<JobDto> {
    ctx.log.debug({ jobId: id }, "Fetching job by ID");

    const job = await this.repo.findById(id as JobId);
    if (!job) {
      throw new NotFoundError(`Job ${id}`);
    }
    return this.toDto(job);
  }

  async list(ctx: RequestContext, query: ListJobsQuery): Promise<PaginatedResponse<JobDto>> {
    ctx.log.debug({ query }, "Listing jobs");
    const result = await this.repo.list(query);
    return { ...result, items: result.items.map(this.toDto) };
  }

  // ─── Write operations ─────────────────────────────────────────────────────────

  /**
   * Create and persist a new job in Queued status.
   * Called by the routing engine as the first step of request dispatch.
   */
  async createJob(ctx: RequestContext, dto: CreateJobDto): Promise<JobDto> {
    const now = toIsoTimestamp();
    const job: Job = {
      id: randomUUID() as JobId,
      requestId: dto.requestId as RequestId,
      sourceType: dto.sourceType ?? JobSourceType.Live,
      status: JobStatus.Queued,
      priority: dto.priority ?? JobPriority.Normal,
      attempts: 1,
      maxAttempts: dto.maxAttempts ?? 3,
      queuedAt: Date.now(),
      createdAt: now,
      updatedAt: now,
    };

    ctx.log.info(
      { jobId: job.id, requestId: job.requestId, priority: job.priority },
      "Creating job",
    );

    return this.toDto(await this.repo.create(job));
  }

  /**
   * Apply a simple status transition (e.g. Queued → Routing, Running → Succeeded).
   */
  async updateStatus(
    ctx: RequestContext,
    id: string,
    update: JobStatusUpdate,
  ): Promise<JobDto> {
    ctx.log.info({ jobId: id, status: update.status }, "Updating job status");

    const updated = await this.repo.updateStatus(id as JobId, update);
    if (!updated) {
      throw new NotFoundError(`Job ${id}`);
    }
    return this.toDto(updated);
  }

  /**
   * Stamp the routing engine's model + worker selection onto the job.
   * Transitions: Routing → Assigned.
   */
  async assignJob(
    ctx: RequestContext,
    id: string,
    modelId: string,
    workerId: string,
    routingDecisionId: string,
  ): Promise<JobDto> {
    ctx.log.info(
      { jobId: id, modelId, workerId, routingDecisionId },
      "Assigning job",
    );

    const update: JobAssignmentUpdate = {
      status: JobStatus.Assigned,
      modelId: modelId as ModelId,
      workerId: workerId as WorkerId,
      routingDecisionId: routingDecisionId as DecisionId,
      assignedAt: Date.now(),
    };

    const updated = await this.repo.updateAssignment(id as JobId, update);
    if (!updated) {
      throw new NotFoundError(`Job ${id}`);
    }
    return this.toDto(updated);
  }

  /**
   * Record a failed execution attempt.
   * The caller decides whether to mark the job Failed (terminal) or Retrying.
   */
  async recordFailure(
    ctx: RequestContext,
    id: string,
    update: JobFailureUpdate,
  ): Promise<JobDto> {
    ctx.log.warn(
      { jobId: id, status: update.status, failureCode: update.failureCode },
      "Recording job failure",
    );

    const updated = await this.repo.recordFailure(id as JobId, update);
    if (!updated) {
      throw new NotFoundError(`Job ${id}`);
    }
    return this.toDto(updated);
  }

  /**
   * Increment the retry counter and mark the job Running for the new attempt.
   * Called when the retry processor begins re-executing the job.
   */
  async incrementRetryCount(ctx: RequestContext, id: string): Promise<JobDto> {
    ctx.log.info({ jobId: id }, "Starting job retry attempt");

    const updated = await this.repo.incrementRetryCount(id as JobId, Date.now());
    if (!updated) {
      throw new NotFoundError(`Job ${id}`);
    }
    return this.toDto(updated);
  }

  // ─── Mapper ──────────────────────────────────────────────────────────────────

  private toDto(job: Job): JobDto {
    return job;
  }
}
