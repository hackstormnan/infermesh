/**
 * modules/jobs/repository/IJobRepository.ts
 *
 * Port interface for the job store.
 *
 * Separates the operations into three categories:
 *   - Reads  — getById, list
 *   - Writes — create, updateStatus, updateAssignment, recordFailure, incrementRetryCount
 *
 * Update methods return null when the job ID is not found, allowing the service
 * to throw a typed NotFoundError without coupling the repository to the error layer.
 *
 * Implementations:
 *   InMemoryJobRepository — Map-backed; for local dev and tests
 *   Future: PostgresJobRepository — persistent; supports high-volume queues
 */

import type { Job, JobStatus } from "../../../shared/contracts/job";
import type {
  DecisionId,
  JobId,
  ModelId,
  PaginatedResponse,
  WorkerId,
} from "../../../shared/primitives";
import type { ListJobsQuery } from "../queries";

// ─── Granular update payloads ──────────────────────────────────────────────────

/**
 * Minimal status-only transition. Used for simple lifecycle advances
 * (e.g. Queued → Routing, Running → Succeeded, Running → Cancelled).
 */
export type JobStatusUpdate = {
  readonly status: JobStatus;
  /** Set when the job reaches a terminal state */
  readonly completedAt?: number;
};

/**
 * Applied when the routing engine completes model + worker selection.
 * Transitions the job from Routing → Assigned.
 */
export type JobAssignmentUpdate = {
  readonly status: JobStatus.Assigned;
  readonly modelId: ModelId;
  readonly workerId: WorkerId;
  readonly routingDecisionId: DecisionId;
  readonly assignedAt: number;
};

/**
 * Applied when a worker reports a failure (terminal or retryable).
 * The service decides whether to set status Failed or Retrying.
 */
export type JobFailureUpdate = {
  readonly status: JobStatus.Failed | JobStatus.Retrying;
  readonly failureCode?: string;
  readonly lastFailureReason?: string;
  /** Populated when status is Failed (terminal); undefined when Retrying */
  readonly completedAt?: number;
};

// ─── Repository interface ──────────────────────────────────────────────────────

export interface IJobRepository {
  /** Persist a newly created job */
  create(job: Job): Promise<Job>;

  /** Fetch a job by its ID; returns null if not found */
  findById(id: JobId): Promise<Job | null>;

  /** Paginated, filtered list — newest queued first */
  list(query: ListJobsQuery): Promise<PaginatedResponse<Job>>;

  /**
   * Apply a simple status transition.
   * Returns null if the job does not exist.
   */
  updateStatus(id: JobId, update: JobStatusUpdate): Promise<Job | null>;

  /**
   * Stamp the routing assignment onto the job (Routing → Assigned).
   * Returns null if the job does not exist.
   */
  updateAssignment(id: JobId, update: JobAssignmentUpdate): Promise<Job | null>;

  /**
   * Record a failure attempt (Running → Failed or Running → Retrying).
   * Returns null if the job does not exist.
   */
  recordFailure(id: JobId, update: JobFailureUpdate): Promise<Job | null>;

  /**
   * Increment the attempts counter and set startedAt for the new attempt.
   * Called when a retry begins execution (Retrying → Running).
   * Returns null if the job does not exist.
   */
  incrementRetryCount(id: JobId, startedAt: number): Promise<Job | null>;
}
