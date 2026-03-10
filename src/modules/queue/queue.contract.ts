/**
 * modules/queue/queue.contract.ts
 *
 * Transport-neutral contracts for the InferMesh job queue.
 *
 * These types define the message envelope that flows through any queue
 * backend. The same shape works with:
 *   - InMemoryJobQueue  (current, local dev)
 *   - BullMQ / Redis    (future, persistent + retryable)
 *   - AWS SQS           (future, cloud-native)
 *   - RabbitMQ / AMQP   (future, broker-based)
 *
 * Swapping the backend requires only a new IJobQueue adapter — this contract
 * and the QueueService remain unchanged.
 */

import type { JobId, RequestId } from "../../shared/primitives";
import type { JobPriority, JobSourceType, JobStatus } from "../../shared/contracts/job";

// ─── Queue message status ─────────────────────────────────────────────────────

/**
 * Lifecycle status of the queue message itself.
 * Distinct from JobStatus — a message can be Pending while the job is Queued.
 */
export enum QueueMessageStatus {
  /** Waiting in the queue to be dequeued by a processor */
  Pending    = "pending",
  /** Currently being consumed by a routing/worker processor */
  Processing = "processing",
  /** Successfully acknowledged by the processor */
  Done       = "done",
  /** Exceeded all retry attempts — moved to dead-letter */
  Dead       = "dead",
}

// ─── Queue message envelope ───────────────────────────────────────────────────

/**
 * QueueMessage — the envelope wrapping a Job when it enters the queue.
 *
 * Contains enough data for the dequeue processor to start routing without
 * an extra round-trip to the job repository:
 *   - Identity: id, jobId, requestId
 *   - Scheduling: priority, sourceType, attempt, enqueuedAt, scheduledAt
 *   - State mirror: jobStatus (job status at enqueue time)
 *   - Extensibility: metadata (routing hints, caller context)
 *
 * The queue message ID is separate from jobId so the same job can be
 * re-enqueued on retry with a fresh message ID while preserving jobId
 * continuity in the history log.
 */
export interface QueueMessage {
  /** Unique ID for this queue message (UUID, not the same as jobId) */
  id: string;
  /** ID of the linked Job record */
  jobId: JobId;
  /** ID of the originating InferenceRequest */
  requestId: RequestId;
  /** Current lifecycle status of the queue message */
  status: QueueMessageStatus;
  /** Job lifecycle status mirrored at the time of enqueueing */
  jobStatus: JobStatus;
  /**
   * Scheduling priority. Higher values are dequeued first.
   * Mirrors JobPriority: Low=0, Normal=1, High=2, Critical=3.
   */
  priority: JobPriority;
  /** Whether this job originates from live API traffic or a simulation run */
  sourceType: JobSourceType;
  /** Execution attempt number (1-indexed; increments on retry re-enqueue) */
  attempt: number;
  /** Unix epoch ms when the message was placed in the queue */
  enqueuedAt: number;
  /**
   * Earliest Unix epoch ms at which the message may be dequeued.
   * Undefined means "as soon as possible". Reserved for future delayed
   * scheduling (e.g. exponential back-off retry windows).
   */
  scheduledAt?: number;
  /**
   * Arbitrary routing / orchestration hints forwarded from the caller.
   * The routing engine may read these when selecting a model + worker.
   * Not validated or acted on by the queue layer itself.
   */
  metadata?: Record<string, unknown>;
}

// ─── Enqueue payload ──────────────────────────────────────────────────────────

/**
 * Input to IJobQueue.enqueue().
 * The adapter assigns `id`, `enqueuedAt`, and `status` — callers supply the rest.
 */
export type EnqueuePayload = Omit<QueueMessage, "id" | "enqueuedAt" | "status">;
