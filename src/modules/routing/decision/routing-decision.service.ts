/**
 * modules/routing/decision/routing-decision.service.ts
 *
 * The routing decision engine. Resolves the active policy, evaluates model and
 * worker candidates, selects the best eligible pair, and records an immutable
 * RoutingDecision.
 *
 * ─── Call flow ───────────────────────────────────────────────────────────────
 *
 *  1. resolvePolicy()        — highest-priority Active policy (or named override)
 *  2. modelRegistry.findEligible() — raw model candidates matching the filter
 *  3. evaluator.evaluateModels()   — score + rank candidates
 *  4. select first eligible model  — deterministic (eligible first, score desc, id asc)
 *  5. workerRegistry.findEligible() — raw worker candidates scoped to chosen model
 *  6. evaluator.evaluateWorkers()   — score + rank candidates
 *  7. select first eligible worker  — same determinism guarantee
 *  8. buildDecision()        — assemble the RoutingDecision entity
 *  9. decisionRepo.save()    — persist immutable record
 * 10. return DecideRouteResult — decision + full score detail for callers
 *
 * ─── Reusability ─────────────────────────────────────────────────────────────
 *
 * The service is stateless and accepts a `decisionSource` flag so it is usable
 * from both the live routing path and simulation/offline replay without any
 * branching in the implementation.
 *
 * ─── Error handling ──────────────────────────────────────────────────────────
 *
 *   NoActivePolicyError   (503) — no active policy, cannot start evaluation
 *   NotFoundError         (404) — policyOverride name/ID not found
 *   NoEligibleModelError  (422) — no model passes hard constraints
 *   NoEligibleWorkerError (422) — no worker passes hard constraints
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import type { ModelRegistryService } from "../../models/registry/model-registry.service";
import type { WorkerRegistryService } from "../../workers/registry/worker-registry.service";
import type { WorkerAssignmentFilter } from "../../workers/registry/worker-registry.contract";
import type {
  RoutingDecision,
  RoutingPolicy,
} from "../../../shared/contracts/routing";
import {
  DecisionSource,
  RoutingOutcome,
  RoutingPolicyStatus,
} from "../../../shared/contracts/routing";
import type {
  DecisionId,
  JobId,
  ModelId,
  RequestId,
  PolicyId,
  WorkerId,
} from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { IDecisionRepository } from "../repository/IDecisionRepository";
import type { IPolicyRepository } from "../repository/IPolicyRepository";
import type { CandidateEvaluatorService } from "../evaluation/candidate-evaluator.service";
import {
  DEFAULT_MODEL_SCORING_WEIGHTS,
  DEFAULT_WORKER_SCORING_WEIGHTS,
} from "../evaluation/evaluation.contract";
import type {
  ModelScoreResult,
  WorkerScoreResult,
} from "../evaluation/evaluation.contract";
import type {
  DecideRouteInput,
  DecideRouteResult,
  ModelSelectionSummary,
  WorkerSelectionSummary,
} from "./routing-decision.contract";
import {
  NoActivePolicyError,
  NoEligibleModelError,
  NoEligibleWorkerError,
} from "./routing-decision.contract";

// ─── Service ──────────────────────────────────────────────────────────────────

export class RoutingDecisionService {
  constructor(
    private readonly policyRepo: IPolicyRepository,
    private readonly decisionRepo: IDecisionRepository,
    private readonly modelRegistry: ModelRegistryService,
    private readonly workerRegistry: WorkerRegistryService,
    private readonly evaluator: CandidateEvaluatorService,
  ) {}

  /**
   * Resolve the active routing policy, evaluate all eligible candidates,
   * select the best (model, worker) pair, and persist the routing decision.
   *
   * @throws {NoActivePolicyError}   — no active policy and no override given
   * @throws {NotFoundError}         — policyOverride name/ID does not exist
   * @throws {NoEligibleModelError}  — registry returned no models or all disqualified
   * @throws {NoEligibleWorkerError} — registry returned no workers or all disqualified
   */
  async decideRoute(
    ctx: RequestContext,
    input: DecideRouteInput,
  ): Promise<DecideRouteResult> {
    const start = Date.now();
    ctx.log.info(
      {
        requestId: input.requestId,
        jobId: input.jobId,
        decisionSource: input.decisionSource ?? DecisionSource.Live,
        policyOverride: input.policyOverride,
      },
      "Starting routing decision",
    );

    // ── 1. Resolve routing policy ──────────────────────────────────────────────
    const policy = await this.resolvePolicy(ctx, input.policyOverride);
    ctx.log.debug(
      { policyId: policy.id, policyName: policy.name, strategy: policy.strategy },
      "Resolved routing policy",
    );

    // ── 2. Find + evaluate model candidates ───────────────────────────────────
    const modelFilter = input.modelFilter ?? {};
    const modelCandidates = await this.modelRegistry.findEligible(ctx, modelFilter);
    ctx.log.debug({ count: modelCandidates.length }, "Fetched model candidates");

    if (modelCandidates.length === 0) {
      throw new NoEligibleModelError(
        "No model candidates found in the registry matching the given filter",
        { modelFilter },
      );
    }

    const modelProfile = input.modelProfile ?? {};
    const modelWeights = input.modelWeights ?? DEFAULT_MODEL_SCORING_WEIGHTS;
    const modelScores = this.evaluator.evaluateModels(
      ctx,
      modelCandidates,
      modelProfile,
      modelWeights,
    );

    const bestModel = modelScores.find((r) => r.eligible);
    if (!bestModel) {
      throw new NoEligibleModelError(
        "All model candidates were disqualified by hard constraints",
        {
          totalCandidates: modelCandidates.length,
          disqualifications: modelScores
            .filter((r) => !r.eligible)
            .map((r) => ({ id: r.candidateId, reasons: r.disqualificationReasons })),
        },
      );
    }
    ctx.log.debug(
      { modelId: bestModel.candidateId, score: bestModel.totalScore },
      "Selected model candidate",
    );

    // ── 3. Find + evaluate worker candidates (scoped to selected model) ────────
    const workerFilter: WorkerAssignmentFilter = {
      ...input.workerFilter,
      requiredModelId: bestModel.candidateId,
    };
    const workerCandidates = await this.workerRegistry.findEligible(ctx, workerFilter);
    ctx.log.debug({ count: workerCandidates.length }, "Fetched worker candidates");

    if (workerCandidates.length === 0) {
      throw new NoEligibleWorkerError(
        "No worker candidates found supporting the selected model",
        { selectedModelId: bestModel.candidateId, workerFilter },
      );
    }

    const workerProfile = input.workerProfile ?? {};
    const workerWeights = input.workerWeights ?? DEFAULT_WORKER_SCORING_WEIGHTS;
    const workerScores = this.evaluator.evaluateWorkers(
      ctx,
      workerCandidates,
      workerProfile,
      workerWeights,
    );

    const bestWorker = workerScores.find((r) => r.eligible);
    if (!bestWorker) {
      throw new NoEligibleWorkerError(
        "All worker candidates were disqualified by hard constraints",
        {
          selectedModelId: bestModel.candidateId,
          totalCandidates: workerCandidates.length,
          disqualifications: workerScores
            .filter((r) => !r.eligible)
            .map((r) => ({ id: r.candidateId, reasons: r.disqualificationReasons })),
        },
      );
    }
    ctx.log.debug(
      { workerId: bestWorker.candidateId, score: bestWorker.totalScore },
      "Selected worker candidate",
    );

    // ── 4. Build + persist decision ────────────────────────────────────────────
    const evaluationMs = Date.now() - start;
    const decision = this.buildDecision(input, policy, bestModel, bestWorker, evaluationMs);
    const saved = await this.decisionRepo.save(decision);

    ctx.log.info(
      {
        decisionId: saved.id,
        requestId: saved.requestId,
        selectedModelId: saved.selectedModelId,
        selectedWorkerId: saved.selectedWorkerId,
        evaluationMs,
      },
      "Routing decision recorded",
    );

    return {
      decision: saved,
      modelScores,
      workerScores,
      modelSummary: buildModelSummary(bestModel, modelScores),
      workerSummary: buildWorkerSummary(bestWorker, workerScores),
      evaluationMs,
    };
  }

  // ─── Policy resolution ───────────────────────────────────────────────────────

  /**
   * Resolve which routing policy governs this decision.
   *
   * With an override: look up by name first (human-readable), then by UUID.
   * Without an override: return the highest-priority Active policy.
   * IPolicyRepository.list() sorts by priority desc, so items[0] is the winner.
   */
  private async resolvePolicy(
    _ctx: RequestContext,
    policyOverride?: string,
  ): Promise<RoutingPolicy> {
    if (policyOverride !== undefined) {
      const byName = await this.policyRepo.findByName(policyOverride);
      if (byName) return byName;

      const byId = await this.policyRepo.findById(policyOverride as PolicyId);
      if (byId) return byId;

      throw new NotFoundError(`Routing policy "${policyOverride}"`);
    }

    const { items } = await this.policyRepo.list({
      status: RoutingPolicyStatus.Active,
      page: 1,
      limit: 1,
    });

    if (items.length === 0) {
      throw new NoActivePolicyError();
    }

    return items[0];
  }

  // ─── Decision assembly ───────────────────────────────────────────────────────

  private buildDecision(
    input: DecideRouteInput,
    policy: RoutingPolicy,
    bestModel: ModelScoreResult,
    bestWorker: WorkerScoreResult,
    evaluationMs: number,
  ): RoutingDecision {
    const now = toIsoTimestamp();
    const reason = buildDecisionReason(bestModel, bestWorker);

    return {
      id: randomUUID() as DecisionId,
      requestId: input.requestId as RequestId,
      jobId: input.jobId as JobId | undefined,
      policyId: policy.id,
      outcome: RoutingOutcome.Routed,
      selectedModelId: bestModel.candidateId as unknown as ModelId,
      selectedWorkerId: bestWorker.candidateId as unknown as WorkerId,
      strategy: policy.strategy,
      usedFallback: input.usedFallback ?? false,
      fallbackReason: input.fallbackReason,
      candidates: [
        {
          modelId: bestModel.candidateId as unknown as ModelId,
          workerId: bestWorker.candidateId as unknown as WorkerId,
          excluded: false,
          scoreBreakdown: {
            quality: bestModel.scores.quality,
            cost: bestModel.scores.cost,
            latency: (bestModel.scores.latency + bestWorker.scores.latency) / 2,
            load: bestWorker.scores.load,
            total: (bestModel.totalScore + bestWorker.totalScore) / 2,
            rationale: reason,
          },
        },
      ],
      reason,
      decisionSource: input.decisionSource ?? DecisionSource.Live,
      decidedAt: Date.now(),
      evaluationMs,
      createdAt: now,
      updatedAt: now,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDecisionReason(
  bestModel: ModelScoreResult,
  bestWorker: WorkerScoreResult,
): string {
  const modelLines = [
    `Model ${bestModel.candidateId} (score: ${bestModel.totalScore.toFixed(3)})`,
    ...bestModel.explanation.slice(0, 3),
  ];
  const workerLines = [
    `Worker ${bestWorker.candidateId} (score: ${bestWorker.totalScore.toFixed(3)})`,
    ...bestWorker.explanation.slice(0, 3),
  ];
  return [...modelLines, ...workerLines].join("; ");
}

function buildModelSummary(
  bestModel: ModelScoreResult,
  allScores: ModelScoreResult[],
): ModelSelectionSummary {
  return {
    selectedModelId: bestModel.candidateId,
    totalCandidates: allScores.length,
    eligibleCount: allScores.filter((r) => r.eligible).length,
    topScore: bestModel.totalScore,
    explanation: bestModel.explanation,
  };
}

function buildWorkerSummary(
  bestWorker: WorkerScoreResult,
  allScores: WorkerScoreResult[],
): WorkerSelectionSummary {
  return {
    selectedWorkerId: bestWorker.candidateId,
    totalCandidates: allScores.length,
    eligibleCount: allScores.filter((r) => r.eligible).length,
    topScore: bestWorker.totalScore,
    explanation: bestWorker.explanation,
  };
}
