/**
 * modules/routing/evaluation/candidate-evaluator.service.ts
 *
 * Orchestrates model and worker candidate evaluation.
 *
 * CandidateEvaluatorService is a stateless service that delegates scoring to
 * ModelEvaluator and WorkerEvaluator. It is designed to be:
 *
 *   - Reusable    — called from both the live routing path and simulation runs
 *   - Stateless   — no repository dependency; works entirely on in-memory data
 *   - Composable  — callers can call evaluateModels() and evaluateWorkers()
 *                   independently (e.g. evaluate models first, filter, then workers)
 *
 * ─── Typical usage ───────────────────────────────────────────────────────────
 *
 *   // 1. Fetch candidates from registry services
 *   const models = await modelRegistryService.findEligible(ctx, filter);
 *   const workers = await workerRegistryService.findEligible(ctx, filter);
 *
 *   // 2. Score them
 *   const modelScores = candidateEvaluatorService.evaluateModels(ctx, models, modelProfile);
 *   const workerScores = candidateEvaluatorService.evaluateWorkers(ctx, workers, workerProfile);
 *
 *   // 3. Pick the top-eligible pair (routing decision — Ticket 16+)
 *   const topModel = modelScores.find(r => r.eligible);
 *   const topWorker = workerScores.find(r => r.eligible);
 */

import type { RequestContext } from "../../../core/context";
import type { ModelCandidate } from "../../models/registry/model-registry.contract";
import type { WorkerCandidate } from "../../workers/registry/worker-registry.contract";
import {
  DEFAULT_MODEL_SCORING_WEIGHTS,
  DEFAULT_WORKER_SCORING_WEIGHTS,
} from "./evaluation.contract";
import type {
  ModelEvaluationProfile,
  ModelScoreResult,
  ModelScoringWeights,
  WorkerEvaluationProfile,
  WorkerScoreResult,
  WorkerScoringWeights,
} from "./evaluation.contract";
import { ModelEvaluator } from "./model-evaluator";
import { WorkerEvaluator } from "./worker-evaluator";

export class CandidateEvaluatorService {
  private readonly modelEvaluator = new ModelEvaluator();
  private readonly workerEvaluator = new WorkerEvaluator();

  /**
   * Score a batch of model candidates.
   *
   * @param ctx        - Request context
   * @param candidates - Model candidates (typically from ModelRegistryService.findEligible)
   * @param profile    - Lightweight description of the request
   * @param weights    - Per-dimension scoring weights; defaults to DEFAULT_MODEL_SCORING_WEIGHTS
   * @returns Sorted ModelScoreResult[]: eligible first, totalScore desc, candidateId asc
   */
  evaluateModels(
    ctx: RequestContext,
    candidates: ModelCandidate[],
    profile: ModelEvaluationProfile,
    weights: ModelScoringWeights = DEFAULT_MODEL_SCORING_WEIGHTS,
  ): ModelScoreResult[] {
    return this.modelEvaluator.evaluate(ctx, candidates, profile, weights);
  }

  /**
   * Score a batch of worker candidates.
   *
   * @param ctx        - Request context
   * @param candidates - Worker candidates (typically from WorkerRegistryService.findEligible)
   * @param profile    - Assignment context with region preference and staleness threshold
   * @param weights    - Per-dimension scoring weights; defaults to DEFAULT_WORKER_SCORING_WEIGHTS
   * @returns Sorted WorkerScoreResult[]: eligible first, totalScore desc, candidateId asc
   */
  evaluateWorkers(
    ctx: RequestContext,
    candidates: WorkerCandidate[],
    profile: WorkerEvaluationProfile,
    weights: WorkerScoringWeights = DEFAULT_WORKER_SCORING_WEIGHTS,
  ): WorkerScoreResult[] {
    return this.workerEvaluator.evaluate(ctx, candidates, profile, weights);
  }
}
