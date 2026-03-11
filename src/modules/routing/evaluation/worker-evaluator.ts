/**
 * modules/routing/evaluation/worker-evaluator.ts
 *
 * Scores a batch of WorkerCandidates given an assignment profile and a set of
 * per-dimension weights. Returns one WorkerScoreResult per input candidate,
 * sorted: eligible candidates first, then by totalScore descending, then by
 * candidateId ascending for determinism.
 *
 * ─── Scoring dimensions ──────────────────────────────────────────────────────
 *
 *  load                — 1 - loadScore (undefined → 0.5 neutral)
 *  queueDepth          — max(0, 1 - queuedJobs / maxConcurrentJobs)
 *  throughput          — min-max ascending: highest tokens/s scores 1.0
 *  latency             — min-max inverted: lowest TTFT scores 1.0
 *  healthFitness       — Idle=1.0, Busy=0.7 (other statuses → disqualified)
 *  regionFit           — 1.0 (match or no preference), 0.3 (mismatch)
 *  heartbeatFreshness  — linear decay: 1 - (age / threshold), clamped [0, 1]
 *
 * ─── Hard disqualification rules ─────────────────────────────────────────────
 *
 *  1. Worker status is not Idle or Busy (Draining / Unhealthy / Offline)
 *  2. Heartbeat age > 2 × staleness threshold (critically stale)
 *
 * ─── Date.now() snapshot ─────────────────────────────────────────────────────
 *
 *  `Date.now()` is captured once at the start of `evaluate()` so all heartbeat
 *  age calculations in the batch are consistent.
 */

import type { RequestContext } from "../../../core/context";
import { WorkerStatus } from "../../../shared/contracts/worker";
import type { WorkerCandidate } from "../../workers/registry/worker-registry.contract";
import type {
  WorkerDimensionScores,
  WorkerEvaluationProfile,
  WorkerRawDimensions,
  WorkerScoreResult,
  WorkerScoringWeights,
} from "./evaluation.contract";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Only workers whose status appears in this map can be routed.
 * Missing key → disqualified (handles Draining / Unhealthy / Offline cleanly).
 */
const HEALTH_FITNESS_SCORE: Partial<Record<WorkerStatus, number>> = {
  [WorkerStatus.Idle]: 1.0,
  [WorkerStatus.Busy]: 0.7,
};

const DEFAULT_STALENESS_THRESHOLD_MS = 60_000;

// ─── Evaluator ────────────────────────────────────────────────────────────────

export class WorkerEvaluator {
  /**
   * Score all candidates in the provided batch.
   *
   * @param _ctx       - Request context
   * @param candidates - Worker candidates from the worker registry service
   * @param profile    - Assignment context describing preferences
   * @param weights    - Per-dimension scoring coefficients
   * @returns Sorted array of WorkerScoreResult (eligible first, score desc, id asc)
   */
  evaluate(
    _ctx: RequestContext,
    candidates: WorkerCandidate[],
    profile: WorkerEvaluationProfile,
    weights: WorkerScoringWeights,
  ): WorkerScoreResult[] {
    if (candidates.length === 0) return [];

    // Capture current time once for consistent heartbeat-age calculation
    const now = Date.now();
    const threshold =
      profile.heartbeatStalenessThresholdMs ?? DEFAULT_STALENESS_THRESHOLD_MS;

    // ── Pass 1: compute raw values + build normalisation vectors ──────────────
    const raws = candidates.map((c) => this.computeRaw(c, profile, now));
    const throughputs = raws.map((r) => r.tokensPerSecond);
    const ttfts = raws.map((r) => r.ttftMs);

    // ── Pass 2: evaluate each candidate ───────────────────────────────────────
    const results: WorkerScoreResult[] = candidates.map((candidate, idx) => {
      const raw = raws[idx];
      const disqualificationReasons: string[] = [];

      // ── Hard constraint: non-routable status ───────────────────────────────
      const healthScore = HEALTH_FITNESS_SCORE[candidate.status];
      if (healthScore === undefined) {
        disqualificationReasons.push(
          `Non-routable status: ${candidate.status}`,
        );
      }

      // ── Hard constraint: critically stale heartbeat ────────────────────────
      if (raw.heartbeatAgeMs > threshold * 2) {
        disqualificationReasons.push(
          `Heartbeat critically stale: ${raw.heartbeatAgeMs}ms > 2× threshold (${threshold * 2}ms)`,
        );
      }

      const eligible = disqualificationReasons.length === 0;

      // ── Normalise scores ───────────────────────────────────────────────────
      const loadDimScore = computeLoadScore(raw.loadScore);
      const queueDepthScore = computeQueueDepthScore(
        raw.queuedJobs,
        raw.maxConcurrentJobs,
      );
      const throughputScore = normalizeAscending(throughputs, idx);
      const latencyScore = normalizeInverted(ttfts, idx);
      const healthFitnessScore = healthScore ?? 0.0;
      const regionFitScore = computeRegionFitScore(
        raw.region,
        raw.preferredRegion,
      );
      const freshnessScore = computeHeartbeatFreshness(
        raw.heartbeatAgeMs,
        threshold,
      );

      const scores: WorkerDimensionScores = {
        load: loadDimScore,
        queueDepth: queueDepthScore,
        throughput: throughputScore,
        latency: latencyScore,
        healthFitness: healthFitnessScore,
        regionFit: regionFitScore,
        heartbeatFreshness: freshnessScore,
      };

      // ── Weighted contributions ─────────────────────────────────────────────
      const dimensionEntries: [keyof WorkerScoringWeights, number][] = [
        ["load", scores.load],
        ["queueDepth", scores.queueDepth],
        ["throughput", scores.throughput],
        ["latency", scores.latency],
        ["healthFitness", scores.healthFitness],
        ["regionFit", scores.regionFit],
        ["heartbeatFreshness", scores.heartbeatFreshness],
      ];

      const contributions: Record<string, number> = {};
      let weightedSum = 0;
      let weightSum = 0;

      for (const [dim, score] of dimensionEntries) {
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

      // ── Explanation ────────────────────────────────────────────────────────
      const explanation = buildWorkerExplanation(
        raw,
        scores,
        disqualificationReasons,
      );

      return {
        candidateId: candidate.id,
        candidateType: "worker",
        eligible,
        disqualificationReasons,
        raw,
        scores,
        contributions,
        totalScore,
        explanation,
      } satisfies WorkerScoreResult;
    });

    return sortResults(results);
  }

  private computeRaw(
    candidate: WorkerCandidate,
    profile: WorkerEvaluationProfile,
    now: number,
  ): WorkerRawDimensions {
    return {
      loadScore: candidate.loadScore,
      queuedJobs: candidate.queuedJobs,
      maxConcurrentJobs: candidate.maxConcurrentJobs,
      tokensPerSecond: candidate.tokensPerSecond,
      ttftMs: candidate.ttftMs,
      status: candidate.status,
      region: candidate.region,
      preferredRegion: profile.preferredRegion,
      heartbeatAgeMs: now - candidate.lastHeartbeatAt,
    };
  }
}

// ─── Dimension score helpers ─────────────────────────────────────────────────

/** load = 1 - loadScore; undefined → neutral 0.5 */
function computeLoadScore(loadScore: number | undefined): number {
  if (loadScore === undefined) return 0.5;
  return Math.max(0, Math.min(1, 1.0 - loadScore));
}

/** queueDepth = max(0, 1 - queuedJobs / maxConcurrentJobs) */
function computeQueueDepthScore(
  queuedJobs: number,
  maxConcurrentJobs: number,
): number {
  if (maxConcurrentJobs <= 0) return 0;
  return Math.max(0, 1.0 - queuedJobs / maxConcurrentJobs);
}

/** regionFit = 1.0 (match or no pref), 0.3 (mismatch) */
function computeRegionFitScore(
  region: string,
  preferredRegion: string | undefined,
): number {
  if (preferredRegion === undefined) return 1.0;
  return region.toLowerCase() === preferredRegion.toLowerCase() ? 1.0 : 0.3;
}

/**
 * heartbeatFreshness = 1 - (age / threshold), clamped to [0, 1].
 * Fresh heartbeat → 1.0; age at threshold → 0.0; beyond threshold → 0.0.
 */
function computeHeartbeatFreshness(
  heartbeatAgeMs: number,
  thresholdMs: number,
): number {
  if (thresholdMs <= 0) return 0;
  return Math.max(0, Math.min(1, 1.0 - heartbeatAgeMs / thresholdMs));
}

/**
 * Min-max ascending normalisation: highest source value scores 1.0.
 * Undefined values → neutral 0.5. All-identical → 1.0.
 */
function normalizeAscending(
  values: (number | undefined)[],
  idx: number,
): number {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return 0.5;

  const min = Math.min(...defined);
  const max = Math.max(...defined);

  const sorted = [...defined].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const raw = values[idx] ?? median;

  if (max === min) return 1.0;

  return (raw - min) / (max - min);
}

/**
 * Min-max inverted normalisation: lowest source value scores 1.0.
 * Undefined values → neutral 0.5. All-identical → 1.0.
 */
function normalizeInverted(
  values: (number | undefined)[],
  idx: number,
): number {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return 0.5;

  const min = Math.min(...defined);
  const max = Math.max(...defined);

  const sorted = [...defined].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const raw = values[idx] ?? median;

  if (max === min) return 1.0;

  return 1.0 - (raw - min) / (max - min);
}

/** Sorts results: eligible first, then totalScore desc, then candidateId asc. */
function sortResults(results: WorkerScoreResult[]): WorkerScoreResult[] {
  return [...results].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.candidateId.localeCompare(b.candidateId);
  });
}

function buildWorkerExplanation(
  raw: WorkerRawDimensions,
  scores: WorkerDimensionScores,
  disqualificationReasons: string[],
): string[] {
  const frags: string[] = [
    `load=${scores.load.toFixed(2)}` +
      (raw.loadScore !== undefined
        ? ` (loadScore: ${raw.loadScore.toFixed(2)})`
        : " (loadScore: unknown)"),
    `queueDepth=${scores.queueDepth.toFixed(2)} (queued: ${raw.queuedJobs}/${raw.maxConcurrentJobs})`,
    `throughput=${scores.throughput.toFixed(2)}` +
      (raw.tokensPerSecond !== undefined
        ? ` (${raw.tokensPerSecond.toFixed(0)} tok/s)`
        : " (unknown)"),
    `latency=${scores.latency.toFixed(2)}` +
      (raw.ttftMs !== undefined
        ? ` (TTFT: ${raw.ttftMs}ms)`
        : " (unknown)"),
    `healthFitness=${scores.healthFitness.toFixed(2)} (status: ${raw.status})`,
    `regionFit=${scores.regionFit.toFixed(2)}` +
      (raw.preferredRegion !== undefined
        ? ` (worker: ${raw.region}, preferred: ${raw.preferredRegion})`
        : ` (worker: ${raw.region}, no preference)`),
    `heartbeatFreshness=${scores.heartbeatFreshness.toFixed(2)} (age: ${raw.heartbeatAgeMs}ms)`,
  ];
  for (const reason of disqualificationReasons) {
    frags.push(`DISQUALIFIED: ${reason}`);
  }
  return frags;
}
