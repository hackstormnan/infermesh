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
 *   Queued → Routing → Assigned → Running → Succeeded
 *                                          ↘ Failed → Retrying → Assigned (retry loop)
 *                              → Cancelled (at any pre-terminal state)
 */

import type {
  BaseEntity,
  DecisionId,
  JobId,
  ModelId,
  RequestId,
  WorkerId,
} from "../primitives";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum JobStatus {
  /** Entered the queue; awaiting routing engine selection */
  Queued = "queued",
  /** Routing engine is selecting model + worker */
  Routing = "routing",
  /** Model and worker selected; notified and waiting for acknowledgement */
  Assigned = "assigned",
  /** Worker has acknowledged and is executing the inference */
  Running = "running",
  /** Inference completed successfully */
  Succeeded = "succeeded",
  /** Inference failed; may be eligible for retry */
  Failed = "failed",
  /** Waiting before the next retry attempt */
  Retrying = "retrying",
  /** Cancelled externally before reaching a terminal state */
  Cancelled = "cancelled",
}

export enum JobPriority {
  Low = 0,
  Normal = 1,
  High = 2,
  Critical = 3,
}

/**
 * Whether the job originates from live API traffic or an internal simulation run.
 * Mirrors DecisionSource from the routing module but is declared independently
 * to avoid a cross-contract dependency.
 */
export enum JobSourceType {
  Live = "live",
  Simulation = "simulation",
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * Job — the internal execution unit created by the routing engine.
 * One Job is created per dispatch attempt of an InferenceRequest.
 * On failure, a new Job may be created for a retry (linked by requestId).
 *
 * Fields marked optional are populated progressively as the job advances
 * through its lifecycle; they are undefined while the job is in earlier states.
 */
export interface Job extends BaseEntity {
  readonly id: JobId;
  readonly requestId: RequestId;
  /** Whether this job originates from live traffic or a simulation run */
  readonly sourceType: JobSourceType;

  // ── Routing assignments (populated after Routing → Assigned transition) ──────
  /** Model selected by the routing engine; undefined in Queued/Routing states */
  readonly modelId?: ModelId;
  /** Worker selected by the routing engine; undefined in Queued/Routing states */
  readonly workerId?: WorkerId;
  /** References the RoutingDecision record that produced this assignment */
  readonly routingDecisionId?: DecisionId;

  // ── Lifecycle state ──────────────────────────────────────────────────────────
  status: JobStatus;
  priority: JobPriority;
  /** 1-indexed execution attempt counter; incremented on each retry */
  attempts: number;
  /** Maximum execution attempts allowed before permanent failure */
  maxAttempts: number;

  // ── Failure details (overwritten on each failed attempt) ─────────────────────
  /** Short structured failure code, e.g. "WORKER_TIMEOUT", "OOM" */
  failureCode?: string;
  /** Human-readable failure message from the most recent failed attempt */
  lastFailureReason?: string;

  // ── Lifecycle timestamps (Unix epoch ms) ─────────────────────────────────────
  /** When the job entered the queue */
  readonly queuedAt: number;
  /** When the routing engine completed assignment */
  assignedAt?: number;
  /** When the worker began executing the inference */
  startedAt?: number;
  /** When the job reached a terminal state (Succeeded, Failed, or Cancelled) */
  completedAt?: number;
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
  status: JobStatus.Succeeded | JobStatus.Failed | JobStatus.Cancelled;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  failureReason?: string;
  timestamp: number;
}

export type JobEvent = JobDispatchedEvent | JobCompletedEvent;
