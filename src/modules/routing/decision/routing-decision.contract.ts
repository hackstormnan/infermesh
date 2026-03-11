/**
 * modules/routing/decision/routing-decision.contract.ts
 *
 * Input/output contracts for the routing decision service.
 *
 * The routing decision layer sits between candidate evaluation (T15) and
 * job execution. It resolves the active policy, scores candidates, selects
 * the best eligible (model, worker) pair, and records a structured decision.
 *
 * ─── Flow summary ────────────────────────────────────────────────────────────
 *
 *   DecideRouteInput
 *       │
 *       ▼
 *   RoutingDecisionService.decideRoute()
 *       │
 *       ├── resolvePolicy()       → RoutingPolicy
 *       ├── evaluateModels()      → ModelScoreResult[]
 *       ├── selectBestModel()     → ModelScoreResult (best eligible)
 *       ├── evaluateWorkers()     → WorkerScoreResult[]
 *       ├── selectBestWorker()    → WorkerScoreResult (best eligible)
 *       └── buildDecision()      → RoutingDecision (persisted)
 *           │
 *           ▼
 *       DecideRouteResult
 *
 * ─── Error hierarchy ─────────────────────────────────────────────────────────
 *   NoActivePolicyError   (503) — no active policy, can't start routing
 *   NoEligibleModelError  (422) — no model passes hard constraints
 *   NoEligibleWorkerError (422) — no worker passes hard constraints
 *   NotFoundError         (404) — policyOverride name/ID not found
 */

import type { DecisionSource, RoutingDecision } from "../../../shared/contracts/routing";
import { ServiceUnavailableError, ValidationError } from "../../../core/errors";
import type { ModelRegistryFilter } from "../../models/registry/model-registry.contract";
import type { WorkerAssignmentFilter } from "../../workers/registry/worker-registry.contract";
import type {
  ModelEvaluationProfile,
  ModelScoreResult,
  ModelScoringWeights,
  WorkerEvaluationProfile,
  WorkerScoreResult,
  WorkerScoringWeights,
} from "../evaluation/evaluation.contract";

// ─── Input ────────────────────────────────────────────────────────────────────

export interface DecideRouteInput {
  /** ID of the InferenceRequest being routed */
  requestId: string;
  /** Optional job ID — included in the decision record for traceability */
  jobId?: string;
  /** Defaults to DecisionSource.Live */
  decisionSource?: DecisionSource;
  /**
   * Policy name (or UUID) to use instead of the highest-priority active policy.
   * Useful for simulation runs and A/B testing.
   */
  policyOverride?: string;
  /** Narrows the model candidate pool at query time */
  modelFilter?: ModelRegistryFilter;
  /**
   * Narrows the worker candidate pool.
   * Note: `requiredModelId` is automatically set from the winning model —
   * callers should not set it here.
   */
  workerFilter?: Omit<WorkerAssignmentFilter, "requiredModelId">;
  /** Scoring profile describing the request (tokens, required capabilities, etc.) */
  modelProfile?: ModelEvaluationProfile;
  /** Scoring profile describing placement preferences (region, staleness threshold) */
  workerProfile?: WorkerEvaluationProfile;
  /** Per-dimension scoring weights for model evaluation */
  modelWeights?: ModelScoringWeights;
  /** Per-dimension scoring weights for worker evaluation */
  workerWeights?: WorkerScoringWeights;
}

// ─── Output ───────────────────────────────────────────────────────────────────

/** Summary of the winning model selection */
export interface ModelSelectionSummary {
  selectedModelId: string;
  totalCandidates: number;
  eligibleCount: number;
  topScore: number;
  /** Explanation fragments from the winning candidate's evaluation */
  explanation: string[];
}

/** Summary of the winning worker selection */
export interface WorkerSelectionSummary {
  selectedWorkerId: string;
  totalCandidates: number;
  eligibleCount: number;
  topScore: number;
  /** Explanation fragments from the winning candidate's evaluation */
  explanation: string[];
}

export interface DecideRouteResult {
  /** The persisted, immutable routing decision record */
  decision: RoutingDecision;
  /** Full per-model evaluation detail (eligible first, totalScore desc) */
  modelScores: ModelScoreResult[];
  /** Full per-worker evaluation detail (eligible first, totalScore desc) */
  workerScores: WorkerScoreResult[];
  /** Summary of the winning model selection */
  modelSummary: ModelSelectionSummary;
  /** Summary of the winning worker selection */
  workerSummary: WorkerSelectionSummary;
  /** Total wall-clock time of the routing evaluation in milliseconds */
  evaluationMs: number;
}

// ─── Domain errors ────────────────────────────────────────────────────────────

/**
 * Thrown when no active routing policy is found and no override is provided.
 * HTTP 503 — the routing system cannot function without an active policy.
 */
export class NoActivePolicyError extends ServiceUnavailableError {
  constructor() {
    super(
      "No active routing policy found — activate a policy before routing requests",
    );
    this.name = "NoActivePolicyError";
  }
}

/**
 * Thrown when the model registry returns no candidates or all are disqualified.
 * HTTP 422 — the request profile or filter constraints are too restrictive.
 */
export class NoEligibleModelError extends ValidationError {
  constructor(message: string, details?: unknown) {
    super(message, details);
    this.name = "NoEligibleModelError";
  }
}

/**
 * Thrown when the worker registry returns no candidates or all are disqualified.
 * HTTP 422 — no worker is available or capable of running the selected model.
 */
export class NoEligibleWorkerError extends ValidationError {
  constructor(message: string, details?: unknown) {
    super(message, details);
    this.name = "NoEligibleWorkerError";
  }
}
