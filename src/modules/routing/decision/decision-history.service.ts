/**
 * modules/routing/decision/decision-history.service.ts
 *
 * Service for the routing decision history layer.
 *
 * Produces explanation-rich DecisionDetailDto objects by merging the core
 * RoutingDecision entity with the full evaluation record (all candidate scores,
 * disqualification reasons, fallback metadata) stored by the evaluation store.
 *
 * ─── Design principles ────────────────────────────────────────────────────────
 *
 * - Stateless: no mutation, no lifecycle side effects
 * - Thin service: delegates persistence to RoutingService and the eval store
 * - Graceful degradation: decisions without a stored evaluation are still
 *   returned — modelEvaluation / workerEvaluation will simply be absent
 * - Reusable: suitable for live API responses and simulation reporting
 *
 * ─── Public API ───────────────────────────────────────────────────────────────
 *
 *   getDecisionDetail(ctx, id)         → DecisionDetailDto | throws NotFoundError
 *   listDecisionDetails(ctx, query)    → PaginatedResponse<DecisionDetailDto>
 */

import type { RequestContext } from "../../../core/context";
import type { PaginatedResponse } from "../../../shared/primitives";
import type { RoutingDecision } from "../../../shared/contracts/routing";
import type { ModelScoreResult, WorkerScoreResult } from "../evaluation/evaluation.contract";
import type { RoutingService } from "../service/routing.service";
import type { ListDecisionsQuery } from "../queries";
import type {
  CandidateEvaluationSection,
  CandidateScoreSummary,
  DecisionDetailDto,
  IDecisionEvaluationStore,
  RoutingDecisionEvaluation,
} from "./decision-history.contract";
import type { DecisionId } from "../../../shared/primitives";

// ─── Service ──────────────────────────────────────────────────────────────────

export class DecisionHistoryService {
  constructor(
    private readonly routingService: RoutingService,
    private readonly evaluationStore: IDecisionEvaluationStore,
  ) {}

  /**
   * Fetch a single decision by ID as an explanation-rich DTO.
   *
   * @throws {NotFoundError} — decision does not exist
   */
  async getDecisionDetail(ctx: RequestContext, id: string): Promise<DecisionDetailDto> {
    const decision = await this.routingService.getDecision(ctx, id);
    const evaluation = await this.evaluationStore.findByDecisionId(decision.id as DecisionId);
    return buildDecisionDetailDto(decision, evaluation);
  }

  /**
   * Paginated list of decisions as explanation-rich DTOs.
   * Accepts the same filters as GET /routing/decisions (ListDecisionsQuery).
   */
  async listDecisionDetails(
    ctx: RequestContext,
    query: ListDecisionsQuery,
  ): Promise<PaginatedResponse<DecisionDetailDto>> {
    const result = await this.routingService.listDecisions(ctx, query);

    const items = await Promise.all(
      result.items.map(async (d) => {
        const evaluation = await this.evaluationStore.findByDecisionId(d.id as DecisionId);
        return buildDecisionDetailDto(d, evaluation);
      }),
    );

    return { ...result, items };
  }
}

// ─── DTO builder ──────────────────────────────────────────────────────────────

/**
 * Pure function: merges a RoutingDecision with an optional evaluation record
 * into a DecisionDetailDto.
 *
 * Exported for direct use in tests without requiring a full service instance.
 */
export function buildDecisionDetailDto(
  decision: RoutingDecision,
  evaluation: RoutingDecisionEvaluation | null,
): DecisionDetailDto {
  return {
    id: decision.id,
    requestId: decision.requestId,
    jobId: decision.jobId,
    policyId: decision.policyId,
    decisionSource: decision.decisionSource,

    outcome: decision.outcome,
    selectedModelId: decision.selectedModelId,
    selectedWorkerId: decision.selectedWorkerId,
    strategy: decision.strategy,

    decidedAt: decision.decidedAt,
    evaluationMs: decision.evaluationMs,

    reason: decision.reason,

    usedFallback: decision.usedFallback,
    fallbackReason: decision.fallbackReason,

    modelEvaluation: evaluation
      ? buildModelEvaluationSection(evaluation.modelScores, decision.selectedModelId)
      : undefined,

    workerEvaluation: evaluation
      ? buildWorkerEvaluationSection(evaluation.workerScores, decision.selectedWorkerId)
      : undefined,

    candidates: decision.candidates,

    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildModelEvaluationSection(
  scores: ModelScoreResult[],
  selectedModelId: string | undefined,
): CandidateEvaluationSection {
  const all = scores.map(toModelScoreSummary);
  const eligible = all.filter((s) => s.eligible);
  const disqualified = all.filter((s) => !s.eligible);

  const winner = selectedModelId
    ? (eligible.find((s) => s.candidateId === selectedModelId) ?? null)
    : null;

  const runners = eligible.filter((s) => s.candidateId !== selectedModelId);

  return {
    totalCandidates: scores.length,
    eligibleCount: eligible.length,
    winner,
    runners,
    disqualified,
  };
}

function buildWorkerEvaluationSection(
  scores: WorkerScoreResult[],
  selectedWorkerId: string | undefined,
): CandidateEvaluationSection {
  const all = scores.map(toWorkerScoreSummary);
  const eligible = all.filter((s) => s.eligible);
  const disqualified = all.filter((s) => !s.eligible);

  const winner = selectedWorkerId
    ? (eligible.find((s) => s.candidateId === selectedWorkerId) ?? null)
    : null;

  const runners = eligible.filter((s) => s.candidateId !== selectedWorkerId);

  return {
    totalCandidates: scores.length,
    eligibleCount: eligible.length,
    winner,
    runners,
    disqualified,
  };
}

// ─── Score mappers ────────────────────────────────────────────────────────────

function toModelScoreSummary(r: ModelScoreResult): CandidateScoreSummary {
  return {
    candidateId: r.candidateId,
    eligible: r.eligible,
    totalScore: r.totalScore,
    explanation: r.explanation,
    disqualificationReasons: r.disqualificationReasons,
    dimensionScores: {
      quality: r.scores.quality,
      cost: r.scores.cost,
      latency: r.scores.latency,
      capabilityFit: r.scores.capabilityFit,
      contextWindowSufficiency: r.scores.contextWindowSufficiency,
    },
  };
}

function toWorkerScoreSummary(r: WorkerScoreResult): CandidateScoreSummary {
  return {
    candidateId: r.candidateId,
    eligible: r.eligible,
    totalScore: r.totalScore,
    explanation: r.explanation,
    disqualificationReasons: r.disqualificationReasons,
    dimensionScores: {
      load: r.scores.load,
      queueDepth: r.scores.queueDepth,
      throughput: r.scores.throughput,
      latency: r.scores.latency,
      healthFitness: r.scores.healthFitness,
      regionFit: r.scores.regionFit,
      heartbeatFreshness: r.scores.heartbeatFreshness,
    },
  };
}
