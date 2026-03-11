/**
 * modules/jobs/orchestration/job-routing.contract.ts
 *
 * Input/output contracts for the job routing orchestrator.
 *
 * ─── Flow summary ─────────────────────────────────────────────────────────────
 *
 *   RouteJobInput
 *       │
 *       ▼
 *   JobRoutingService.routeJob()
 *       │
 *       ├── jobsService.getById()              → validate Queued | Retrying state
 *       ├── jobLifecycle.moveToRouting()        → Queued → Routing  (first attempt)
 *       ├── recoveryService.attemptWithRecovery() → RecoveryOutcome
 *       │       ├── Primary routing attempt
 *       │       └── Fallback attempt (NoEligibleWorker only — strips workerProfile)
 *       │
 *       ├── On success:
 *       │     jobLifecycle.assignJob()          → Routing | Retrying → Assigned
 *       │     return AssignedJobOutcome
 *       │
 *       ├── On retryable failure (attempts < maxAttempts):
 *       │     jobLifecycle.failJob()            → Routing | Retrying → Failed
 *       │     jobLifecycle.retryJob()           → Failed → Retrying
 *       │     jobsService.incrementRetryCount() → bump attempt counter
 *       │     return RetryingJobOutcome
 *       │
 *       └── On terminal failure (exhausted or non-retryable):
 *             jobLifecycle.failJob()            → Routing | Retrying → Failed
 *             throw (original routing error)
 *
 * ─── Failure behavior ─────────────────────────────────────────────────────────
 *   On retry-eligible failure with attempts remaining:
 *     → Job moves to Retrying. Caller receives RetryingJobOutcome.
 *     → Next call to routeJob() on the same job will proceed from Retrying state.
 *
 *   On terminal failure (policy errors, exhausted retries):
 *     → Job moves to Failed. Original routing error is re-thrown.
 *
 * ─── Error classes ────────────────────────────────────────────────────────────
 *   JobNotRoutableError (409) — job is not in Queued or Retrying status
 */

import type { DecisionSource, RoutingDecision } from "../../../shared/contracts/routing";
import { ConflictError } from "../../../core/errors";
import type { JobDto } from "../service/jobs.service";
import type {
  ModelSelectionSummary,
  WorkerSelectionSummary,
} from "../../routing/decision/routing-decision.contract";
import type { RoutingRecoveryInfo } from "./recovery/routing-recovery.contract";

// ─── Input ────────────────────────────────────────────────────────────────────

export interface RouteJobInput {
  /** ID of the job to route — must be in Queued or Retrying status */
  jobId: string;
  /** Defaults to DecisionSource.Live */
  decisionSource?: DecisionSource;
  /**
   * Policy name or UUID override. If omitted the highest-priority active
   * policy is used (standard live routing path).
   */
  policyOverride?: string;
}

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Returned when routing succeeded and the job is now Assigned.
 * `recovery` is present only when a fallback routing attempt was made.
 */
export interface AssignedJobOutcome {
  readonly outcome: "assigned";
  readonly job: JobDto;
  readonly decision: RoutingDecision;
  readonly modelSummary: ModelSelectionSummary;
  readonly workerSummary: WorkerSelectionSummary;
  readonly evaluationMs: number;
  /** Present when a fallback routing attempt was needed to reach assignment */
  readonly recovery?: RoutingRecoveryInfo;
}

/**
 * Returned when routing failed for a retryable reason and the job has been
 * moved to Retrying status for a future attempt.
 *
 * The caller should return 202 Accepted and surface the retry metadata
 * so operators can track retry cycles.
 */
export interface RetryingJobOutcome {
  readonly outcome: "retrying";
  /** The updated job, now in Retrying status */
  readonly job: JobDto;
  /** The attempt number that will run on the next routeJob() call */
  readonly nextAttemptNumber: number;
  /** Human-readable reason the current attempt failed */
  readonly retryReason: string;
  /** Full recovery audit trail */
  readonly recovery: RoutingRecoveryInfo;
}

/** Discriminated union of all possible outcomes from routeJob() */
export type RouteJobResult = AssignedJobOutcome | RetryingJobOutcome;

// ─── Domain error ─────────────────────────────────────────────────────────────

/**
 * Thrown when routing is requested for a job that is not in Queued or Retrying
 * status.
 * HTTP 409 — state conflict; only Queued and Retrying jobs can be routed.
 */
export class JobNotRoutableError extends ConflictError {
  constructor(jobId: string, currentStatus: string) {
    super(
      `Job "${jobId}" cannot be routed — current status is "${currentStatus}" (expected Queued or Retrying)`,
      { jobId, currentStatus },
    );
    this.name = "JobNotRoutableError";
  }
}
