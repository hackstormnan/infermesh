/**
 * modules/routing/evaluation/model-evaluator.ts
 *
 * Scores a batch of ModelCandidates given an evaluation profile and a set of
 * per-dimension weights. Returns one ModelScoreResult per input candidate,
 * sorted: eligible candidates first, then by totalScore descending, then by
 * candidateId ascending for determinism.
 *
 * ─── Scoring dimensions ──────────────────────────────────────────────────────
 *
 *  quality             — static map from QualityTier (Frontier=1.0, Standard=0.5, Economy=0.0)
 *  cost                — min-max inverted: lowest estimated cost scores 1.0
 *  latency             — min-max inverted: lowest median TTFT scores 1.0
 *  capabilityFit       — fraction of required capabilities matched
 *  contextWindowSuff.  — binary 1.0/0.0; used in explanation only (hard gate via disqualify)
 *
 * ─── Hard disqualification rules ─────────────────────────────────────────────
 *
 *  1. Model does not satisfy all requiredCapabilities → disqualified
 *  2. Model context window < profile.minContextWindow → disqualified
 *
 * ─── Normalisation ───────────────────────────────────────────────────────────
 *
 *  cost and latency use inverted min-max across the candidate batch.
 *  When only one candidate is present (or all values are identical) the
 *  normalised score is 1.0 (best possible) to avoid penalising the sole option.
 *  Candidates with no cost estimate (estimatedCostUsd is undefined) are treated
 *  as having the batch median for normalisation — neutral, not penalised.
 */

import type { RequestContext } from "../../../core/context";
import { QualityTier } from "../../../shared/contracts/model";
import type { ModelCandidate } from "../../models/registry/model-registry.contract";
import type {
  ModelDimensionScores,
  ModelEvaluationProfile,
  ModelRawDimensions,
  ModelScoreResult,
  ModelScoringWeights,
} from "./evaluation.contract";

// ─── Constants ────────────────────────────────────────────────────────────────

const QUALITY_TIER_SCORE: Record<QualityTier, number> = {
  [QualityTier.Frontier]: 1.0,
  [QualityTier.Standard]: 0.5,
  [QualityTier.Economy]: 0.0,
};

// ─── Evaluator ────────────────────────────────────────────────────────────────

export class ModelEvaluator {
  /**
   * Score all candidates in the provided batch.
   *
   * @param _ctx    - Request context (used for structured logging in future)
   * @param candidates - Model candidates from the model registry service
   * @param profile    - Lightweight description of the request under evaluation
   * @param weights    - Per-dimension scoring coefficients
   * @returns Sorted array of ModelScoreResult (eligible first, score desc, id asc)
   */
  evaluate(
    _ctx: RequestContext,
    candidates: ModelCandidate[],
    profile: ModelEvaluationProfile,
    weights: ModelScoringWeights,
  ): ModelScoreResult[] {
    if (candidates.length === 0) return [];

    // ── Pass 1: compute raw values + build normalisation vectors ──────────────
    const raws = candidates.map((c) => this.computeRaw(c, profile));
    const costs = raws.map((r) => r.estimatedCostUsd);
    const ttfts = raws.map((r) => r.ttftMs);

    // ── Pass 2: evaluate each candidate ───────────────────────────────────────
    const results: ModelScoreResult[] = candidates.map((candidate, idx) => {
      const raw = raws[idx];
      const disqualificationReasons: string[] = [];

      // ── Hard constraint: required capabilities ─────────────────────────────
      if (
        profile.requiredCapabilities &&
        profile.requiredCapabilities.length > 0 &&
        raw.capabilityMatchCount < raw.capabilityRequiredCount
      ) {
        const missing = profile.requiredCapabilities.filter(
          (cap) => !candidate.capabilities.includes(cap),
        );
        disqualificationReasons.push(
          `Missing required capabilities: ${missing.join(", ")}`,
        );
      }

      // ── Hard constraint: minimum context window ────────────────────────────
      if (
        profile.minContextWindow !== undefined &&
        raw.contextWindow < profile.minContextWindow
      ) {
        disqualificationReasons.push(
          `Context window ${raw.contextWindow} < required ${profile.minContextWindow} tokens`,
        );
      }

      const eligible = disqualificationReasons.length === 0;

      // ── Normalise scores ───────────────────────────────────────────────────
      const qualityScore = QUALITY_TIER_SCORE[candidate.qualityTier] ?? 0.0;
      const costScore = normalizeInverted(costs, idx);
      const latencyScore = normalizeInverted(ttfts, idx);
      const capabilityFitScore =
        raw.capabilityRequiredCount === 0
          ? 1.0
          : raw.capabilityMatchCount / raw.capabilityRequiredCount;
      const contextWindowSufficiency =
        profile.minContextWindow === undefined
          ? 1.0
          : raw.contextWindow >= profile.minContextWindow
            ? 1.0
            : 0.0;

      const scores: ModelDimensionScores = {
        quality: qualityScore,
        cost: costScore,
        latency: latencyScore,
        capabilityFit: capabilityFitScore,
        contextWindowSufficiency,
      };

      // ── Weighted contributions ─────────────────────────────────────────────
      const dimensionWeights: [keyof ModelScoringWeights, number][] = [
        ["quality", scores.quality],
        ["cost", scores.cost],
        ["latency", scores.latency],
        ["capabilityFit", scores.capabilityFit],
      ];

      const contributions: Record<string, number> = {};
      let weightedSum = 0;
      let weightSum = 0;

      for (const [dim, score] of dimensionWeights) {
        const w = weights[dim];
        const contribution = w * score;
        contributions[dim] = contribution;
        weightedSum += contribution;
        weightSum += w;
      }

      const totalScore = eligible
        ? weightSum > 0
          ? weightedSum / weightSum
          : 0
        : 0;

      // ── Explanation ───────────────────────────────────────────────────────
      const explanation = buildModelExplanation(raw, scores, disqualificationReasons);

      return {
        candidateId: candidate.id,
        candidateType: "model",
        eligible,
        disqualificationReasons,
        raw,
        scores,
        contributions,
        totalScore,
        explanation,
      } satisfies ModelScoreResult;
    });

    return sortResults(results);
  }

  /** Extract raw dimension values from a candidate + profile. */
  private computeRaw(
    candidate: ModelCandidate,
    profile: ModelEvaluationProfile,
  ): ModelRawDimensions {
    const inputTokens = profile.estimatedInputTokens ?? 0;
    const outputTokens = profile.estimatedOutputTokens ?? 0;

    let estimatedCostUsd: number | undefined;
    if (
      profile.estimatedInputTokens !== undefined ||
      profile.estimatedOutputTokens !== undefined
    ) {
      const inputCost = (inputTokens / 1000) * candidate.pricing.inputPer1kTokens;
      const outputCost =
        (outputTokens / 1000) * candidate.pricing.outputPer1kTokens;
      estimatedCostUsd = inputCost + outputCost;
    }

    const requiredCaps = profile.requiredCapabilities ?? [];
    const capabilityMatchCount = requiredCaps.filter((cap) =>
      candidate.capabilities.includes(cap),
    ).length;

    return {
      qualityTier: candidate.qualityTier,
      estimatedCostUsd,
      ttftMs: candidate.latencyProfile.ttftMs,
      capabilityMatchCount,
      capabilityRequiredCount: requiredCaps.length,
      contextWindow: candidate.contextWindow,
      minContextWindowRequired: profile.minContextWindow,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Min-max normalisation, inverted so that the lowest source value scores 1.0.
 * Handles undefined values by using the batch median for normalisation.
 * When all defined values are identical (or there is only one), returns 1.0.
 */
function normalizeInverted(
  values: (number | undefined)[],
  idx: number,
): number {
  const defined = values.filter((v): v is number => v !== undefined);

  if (defined.length === 0) return 0.5;

  const min = Math.min(...defined);
  const max = Math.max(...defined);

  // Compute a fallback for undefined entries: batch median of defined values
  const sorted = [...defined].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const raw = values[idx] ?? median;

  if (max === min) {
    // All identical — everyone scores 1.0 (best possible)
    return 1.0;
  }

  return 1.0 - (raw - min) / (max - min);
}

/** Sorts results: eligible first, then totalScore desc, then candidateId asc. */
function sortResults(results: ModelScoreResult[]): ModelScoreResult[] {
  return [...results].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.candidateId.localeCompare(b.candidateId);
  });
}

function buildModelExplanation(
  raw: ModelRawDimensions,
  scores: ModelDimensionScores,
  disqualificationReasons: string[],
): string[] {
  const frags: string[] = [
    `quality=${scores.quality.toFixed(2)} (tier: ${raw.qualityTier})`,
    `cost=${scores.cost.toFixed(2)}` +
      (raw.estimatedCostUsd !== undefined
        ? ` (est. $${raw.estimatedCostUsd.toFixed(4)})`
        : " (no cost estimate)"),
    `latency=${scores.latency.toFixed(2)} (TTFT: ${raw.ttftMs}ms)`,
    `capabilityFit=${scores.capabilityFit.toFixed(2)}` +
      ` (${raw.capabilityMatchCount}/${raw.capabilityRequiredCount} required caps)`,
    `contextWindow=${scores.contextWindowSufficiency.toFixed(2)}` +
      ` (${raw.contextWindow} tokens` +
      (raw.minContextWindowRequired !== undefined
        ? `, min required: ${raw.minContextWindowRequired})`
        : ")"),
  ];
  for (const reason of disqualificationReasons) {
    frags.push(`DISQUALIFIED: ${reason}`);
  }
  return frags;
}
