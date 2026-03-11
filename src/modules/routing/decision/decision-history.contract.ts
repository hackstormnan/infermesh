/**
 * modules/routing/decision/decision-history.contract.ts
 *
 * Contracts for the routing decision history layer (T19).
 *
 * This module separates observability-specific types from the core routing
 * domain so the RoutingDecision entity and shared contracts remain stable.
 *
 * ─── What is stored ───────────────────────────────────────────────────────────
 *
 *  RoutingDecision (shared contract)
 *    └── persisted by IDecisionRepository (core entity, winner + metadata)
 *
 *  RoutingDecisionEvaluation (this module)
 *    └── persisted by IDecisionEvaluationStore alongside every decision
 *        Contains full ModelScoreResult[] + WorkerScoreResult[] for all
 *        evaluated candidates — not just the winner.
 *
 * ─── What is exposed ──────────────────────────────────────────────────────────
 *
 *  DecisionDetailDto
 *    └── returned by GET /routing/decisions/:id and GET /routing/decisions
 *        Merges the core RoutingDecision with full evaluation detail when
 *        available, presenting a structured, explanation-friendly view.
 *
 * ─── Graceful degradation ─────────────────────────────────────────────────────
 *
 *  modelEvaluation and workerEvaluation are optional on DecisionDetailDto.
 *  Decisions recorded before T19 (or without an evaluation store) will still
 *  be returned — just without the per-candidate breakdown.
 */

import type {
  DecisionSource,
  RoutingCandidate,
  RoutingOutcome,
  RoutingStrategy,
} from "../../../shared/contracts/routing";
import type { DecisionId } from "../../../shared/primitives";
import type { ModelScoreResult, WorkerScoreResult } from "../evaluation/evaluation.contract";

// ─── Evaluation storage ───────────────────────────────────────────────────────

/**
 * Full evaluation record persisted alongside a RoutingDecision.
 *
 * Contains the complete set of model and worker score results produced during
 * decideRoute(). These are stored separately from the core RoutingDecision
 * entity to avoid changing the shared contract and to keep the decision entity
 * focused on the placement outcome rather than evaluation internals.
 */
export interface RoutingDecisionEvaluation {
  readonly decisionId: DecisionId;
  /** Complete scoring results for every model candidate evaluated */
  readonly modelScores: ModelScoreResult[];
  /** Complete scoring results for every worker candidate evaluated */
  readonly workerScores: WorkerScoreResult[];
  /** Unix epoch ms when this evaluation record was saved */
  readonly savedAt: number;
}

// ─── Evaluation store interface ───────────────────────────────────────────────

/**
 * Port for the evaluation store.
 * In-process only for now; a future ticket can replace with durable persistence.
 */
export interface IDecisionEvaluationStore {
  save(evaluation: RoutingDecisionEvaluation): Promise<void>;
  findByDecisionId(id: DecisionId): Promise<RoutingDecisionEvaluation | null>;
}

// ─── DTO types ────────────────────────────────────────────────────────────────

/**
 * Concise score view for one model or worker candidate.
 * Extracted from ModelScoreResult / WorkerScoreResult for the DTO layer.
 */
export interface CandidateScoreSummary {
  readonly candidateId: string;
  readonly eligible: boolean;
  readonly totalScore: number;
  /** Human-readable explanation fragments, one per scored dimension */
  readonly explanation: string[];
  /** Human-readable reasons why this candidate was disqualified, if applicable */
  readonly disqualificationReasons: string[];
  /** Normalised [0, 1] score per dimension (dimension name → score) */
  readonly dimensionScores: Record<string, number>;
}

/**
 * Full breakdown of the candidates evaluated on one side (model or worker).
 *
 * `winner`     — the selected candidate (null if none was eligible)
 * `runners`    — eligible candidates that were not selected (score ordered)
 * `disqualified` — candidates excluded by hard constraints, with reasons
 */
export interface CandidateEvaluationSection {
  readonly totalCandidates: number;
  readonly eligibleCount: number;
  readonly winner: CandidateScoreSummary | null;
  readonly runners: CandidateScoreSummary[];
  readonly disqualified: CandidateScoreSummary[];
}

/**
 * Explanation-rich routing decision DTO.
 *
 * Returned by:
 *   GET /api/v1/routing/decisions/:id   — full detail
 *   GET /api/v1/routing/decisions       — list (with same structure)
 *
 * Designed for operator dashboards, debugging panels, and simulation reports.
 * All fields are safe to expose via the read API.
 *
 * `modelEvaluation` and `workerEvaluation` are present when the decision was
 * made with T19 wiring active. Absent for decisions made before T19 or in
 * contexts where evaluation storage was not configured.
 */
export interface DecisionDetailDto {
  // ── Identity ───────────────────────────────────────────────────────────────
  readonly id: string;
  readonly requestId: string;
  readonly jobId?: string;
  readonly policyId: string;
  readonly decisionSource: DecisionSource;

  // ── Outcome ────────────────────────────────────────────────────────────────
  readonly outcome: RoutingOutcome;
  readonly selectedModelId?: string;
  readonly selectedWorkerId?: string;
  readonly strategy: RoutingStrategy;

  // ── Timing ─────────────────────────────────────────────────────────────────
  readonly decidedAt: number;
  readonly evaluationMs: number;

  // ── Explanation ────────────────────────────────────────────────────────────
  /** Human-readable narrative of why the selected pair was chosen */
  readonly reason: string;

  // ── Fallback / recovery context ────────────────────────────────────────────
  readonly usedFallback: boolean;
  /** Human-readable explanation of why fallback routing was triggered */
  readonly fallbackReason?: string;

  // ── Per-candidate evaluation breakdown (present when evaluation was stored) ─
  readonly modelEvaluation?: CandidateEvaluationSection;
  readonly workerEvaluation?: CandidateEvaluationSection;

  // ── Legacy candidate pairs from core entity (winner pair only pre-T19) ──────
  readonly candidates: RoutingCandidate[];

  // ── Timestamps ─────────────────────────────────────────────────────────────
  readonly createdAt: string;
  readonly updatedAt: string;
}
