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
 *       ├── jobsService.getById()          → validate Queued state
 *       ├── jobLifecycle.moveToRouting()   → Queued → Routing
 *       ├── routingDecision.decideRoute()  → DecideRouteResult
 *       │       (on failure → failJob()   → Routing → Failed, re-throw)
 *       ├── jobLifecycle.assignJob()       → Routing → Assigned
 *       │
 *       └── RouteJobResult
 *
 * ─── Failure behavior ─────────────────────────────────────────────────────────
 *   If routingDecision.decideRoute() throws (NoEligibleModel, NoEligibleWorker,
 *   NoActivePolicy), the job is moved to Failed and the error is re-thrown.
 *   The job does NOT remain in Routing or revert to Queued — Failed is explicit
 *   and inspectable. Retries are handled via jobLifecycle.retryJob() by the
 *   caller if desired.
 *
 * ─── Error classes ────────────────────────────────────────────────────────────
 *   JobNotRoutableError (409) — job is not in Queued state
 */

import type { DecisionSource, RoutingDecision } from "../../../shared/contracts/routing";
import { ConflictError } from "../../../core/errors";
import type { JobDto } from "../service/jobs.service";
import type {
  ModelSelectionSummary,
  WorkerSelectionSummary,
} from "../../routing/decision/routing-decision.contract";

// ─── Input ────────────────────────────────────────────────────────────────────

export interface RouteJobInput {
  /** ID of the job to route — must currently be in Queued status */
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

export interface RouteJobResult {
  /** The updated job, now in Assigned status with model/worker/decision stamped */
  job: JobDto;
  /** The persisted routing decision record */
  decision: RoutingDecision;
  /** Summary of how the model was selected */
  modelSummary: ModelSelectionSummary;
  /** Summary of how the worker was selected */
  workerSummary: WorkerSelectionSummary;
  /** Total wall-clock time of the routing evaluation in milliseconds */
  evaluationMs: number;
}

// ─── Domain error ─────────────────────────────────────────────────────────────

/**
 * Thrown when routing is requested for a job that is not in Queued status.
 * HTTP 409 — state conflict; only Queued jobs can be routed.
 */
export class JobNotRoutableError extends ConflictError {
  constructor(jobId: string, currentStatus: string) {
    super(
      `Job "${jobId}" cannot be routed — current status is "${currentStatus}" (expected Queued)`,
      { jobId, currentStatus },
    );
    this.name = "JobNotRoutableError";
  }
}
