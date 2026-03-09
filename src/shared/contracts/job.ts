/**
 * shared/contracts/job.ts
 *
 * Contracts for the **Job** concept — the internal unit of work that bridges
 * an InferenceRequest to a specific Worker and Model assignment.
 *
 * A Job is an implementation detail of the routing and execution layer.
 * Callers interact with InferenceRequests; Jobs are created and managed
 * internally by the routing and worker modules.
 *
 * Lifecycle:
 *   Pending → Assigned → Running → Completed
 *                                ↘ Failed → Retrying → Assigned (retry loop)
 *                      → Cancelled
 */

import type { BaseEntity, JobId, ModelId, RequestId, WorkerId } from "../primitives";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum JobStatus {
  /** Created by the router; no worker has been assigned yet */
  Pending = "pending",
  /** A worker has been selected and notified */
  Assigned = "assigned",
  /** Worker has acknowledged and is executing */
  Running = "running",
  /** Successfully completed by the worker */
  Completed = "completed",
  /** Failed; eligible for retry if attempts remain */
  Failed = "failed",
  /** Waiting before the next retry attempt */
  Retrying = "retrying",
  /** Cancelled externally before completion */
  Cancelled = "cancelled",
}

export enum JobPriority {
  Low = 0,
  Normal = 1,
  High = 2,
  Critical = 3,
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * Job — the internal execution unit created by the routing engine.
 * One Job is created per InferenceRequest dispatch attempt.
 * On failure, a new Job may be created for a retry (linked by requestId).
 */
export interface Job extends BaseEntity {
  readonly id: JobId;
  readonly requestId: RequestId;
  readonly modelId: ModelId;
  readonly workerId: WorkerId;
  status: JobStatus;
  priority: JobPriority;
  /** Number of execution attempts made so far (1-indexed; 1 = first attempt) */
  attempts: number;
  /** Maximum number of attempts allowed before permanent failure */
  maxAttempts: number;
  /** Unix epoch ms of when the job was dispatched to the worker */
  dispatchedAt?: number;
  /** Unix epoch ms of when the worker acknowledged the job */
  acknowledgedAt?: number;
  /** Unix epoch ms of when the job reached a terminal state */
  finishedAt?: number;
  /** Reason for the most recent failure (overwritten on each retry) */
  lastFailureReason?: string;
}

// ─── Internal event payloads ──────────────────────────────────────────────────

/**
 * Emitted when the routing engine creates a job for a request.
 * Consumed by the worker module to begin execution.
 */
export interface JobDispatchedEvent {
  type: "job.dispatched";
  jobId: JobId;
  requestId: RequestId;
  modelId: ModelId;
  workerId: WorkerId;
  priority: JobPriority;
  timestamp: number;
}

/**
 * Emitted by a worker when it finishes a job (success or failure).
 * Consumed by the requests module to advance the request status.
 */
export interface JobCompletedEvent {
  type: "job.completed";
  jobId: JobId;
  requestId: RequestId;
  status: JobStatus.Completed | JobStatus.Failed | JobStatus.Cancelled;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  failureReason?: string;
  timestamp: number;
}

export type JobEvent = JobDispatchedEvent | JobCompletedEvent;
