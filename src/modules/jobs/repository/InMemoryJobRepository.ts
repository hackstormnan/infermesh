/**
 * modules/jobs/repository/InMemoryJobRepository.ts
 *
 * In-memory implementation of IJobRepository for local development and testing.
 *
 * Indexes:
 *   byId        — Map<JobId, Job>         — primary; O(1) findById
 *   byRequestId — Map<RequestId, JobId[]> — secondary; O(k) filtering on requestId
 *
 * Sort order for list(): queuedAt descending (newest queued first), which is
 * natural for an audit log. A real queue backend would sort by priority desc
 * then queuedAt asc (FIFO within priority class).
 *
 * All write methods return the updated Job so the service can return it
 * to callers without an extra findById round-trip.
 *
 * State is lost on restart. Not suitable for production deployments.
 */

import type { Job } from "../../../shared/contracts/job";
import { JobStatus } from "../../../shared/contracts/job";
import type { JobId, PaginatedResponse } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { ListJobsQuery } from "../queries";
import type {
  IJobRepository,
  JobAssignmentUpdate,
  JobFailureUpdate,
  JobStatusUpdate,
} from "./IJobRepository";

export class InMemoryJobRepository implements IJobRepository {
  private readonly byId = new Map<string, Job>();
  private readonly byRequestId = new Map<string, string[]>();

  // ─── Write operations ──────────────────────────────────────────────────────

  async create(job: Job): Promise<Job> {
    this.byId.set(job.id, job);
    const existing = this.byRequestId.get(job.requestId) ?? [];
    this.byRequestId.set(job.requestId, [...existing, job.id]);
    return job;
  }

  async updateStatus(id: JobId, update: JobStatusUpdate): Promise<Job | null> {
    const job = this.byId.get(id);
    if (!job) return null;

    const updated: Job = {
      ...job,
      status: update.status,
      completedAt: update.completedAt ?? job.completedAt,
      updatedAt: toIsoTimestamp(),
    };
    this.byId.set(id, updated);
    return updated;
  }

  async updateAssignment(id: JobId, update: JobAssignmentUpdate): Promise<Job | null> {
    const job = this.byId.get(id);
    if (!job) return null;

    const updated: Job = {
      ...job,
      status: JobStatus.Assigned,
      modelId: update.modelId,
      workerId: update.workerId,
      routingDecisionId: update.routingDecisionId,
      assignedAt: update.assignedAt,
      updatedAt: toIsoTimestamp(),
    };
    this.byId.set(id, updated);
    return updated;
  }

  async recordFailure(id: JobId, update: JobFailureUpdate): Promise<Job | null> {
    const job = this.byId.get(id);
    if (!job) return null;

    const updated: Job = {
      ...job,
      status: update.status,
      failureCode: update.failureCode ?? job.failureCode,
      lastFailureReason: update.lastFailureReason ?? job.lastFailureReason,
      completedAt: update.completedAt ?? job.completedAt,
      updatedAt: toIsoTimestamp(),
    };
    this.byId.set(id, updated);
    return updated;
  }

  async incrementRetryCount(id: JobId, startedAt: number): Promise<Job | null> {
    const job = this.byId.get(id);
    if (!job) return null;

    const updated: Job = {
      ...job,
      status: JobStatus.Running,
      attempts: job.attempts + 1,
      startedAt,
      updatedAt: toIsoTimestamp(),
    };
    this.byId.set(id, updated);
    return updated;
  }

  // ─── Read operations ───────────────────────────────────────────────────────

  async findById(id: JobId): Promise<Job | null> {
    return this.byId.get(id) ?? null;
  }

  async list(query: ListJobsQuery): Promise<PaginatedResponse<Job>> {
    let items: Job[];

    // Use the requestId index when it's the only active filter — avoids full scan
    if (query.requestId !== undefined && !this.hasOtherFilters(query)) {
      const ids = this.byRequestId.get(query.requestId) ?? [];
      items = ids.map((id) => this.byId.get(id)!).filter(Boolean);
    } else {
      items = Array.from(this.byId.values());
    }

    // ── Filters ──────────────────────────────────────────────────────────────

    if (query.requestId !== undefined) {
      items = items.filter((j) => j.requestId === query.requestId);
    }

    if (query.jobId !== undefined) {
      items = items.filter((j) => j.id.startsWith(query.jobId!));
    }

    if (query.status !== undefined) {
      items = items.filter((j) => j.status === query.status);
    }

    if (query.workerId !== undefined) {
      items = items.filter((j) => j.workerId === query.workerId);
    }

    if (query.modelId !== undefined) {
      items = items.filter((j) => j.modelId === query.modelId);
    }

    // ── Sort: newest queued first ─────────────────────────────────────────────

    items.sort((a, b) => b.queuedAt - a.queuedAt);

    // ── Pagination ────────────────────────────────────────────────────────────

    const total = items.length;
    const { page, limit } = query;
    const offset = (page - 1) * limit;
    const slice = items.slice(offset, offset + limit);

    return { items: slice, total, page, limit, hasMore: offset + slice.length < total };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** True when any filter beyond requestId is active — prevents index short-circuit */
  private hasOtherFilters(query: ListJobsQuery): boolean {
    return (
      query.jobId !== undefined ||
      query.status !== undefined ||
      query.workerId !== undefined ||
      query.modelId !== undefined
    );
  }
}
