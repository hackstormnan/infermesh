/**
 * modules/routing/evaluation/evaluation.contract.ts
 *
 * Type contracts for the candidate evaluation layer.
 *
 * These types live between the registry layer (which produces ModelCandidate /
 * WorkerCandidate) and the routing decision layer (which selects a winner).
 * The evaluator assigns a structured score to each candidate but does NOT pick
 * a final winner — that remains a routing-strategy concern.
 *
 * ─── Concepts ────────────────────────────────────────────────────────────────
 *
 * EvaluationProfile  — lightweight description of the request under evaluation
 * ScoringWeights     — per-dimension coefficients (separate for model vs worker)
 * RawDimensions      — un-normalised values extracted from the candidate
 * DimensionScores    — normalised [0, 1] values per scoring dimension
 * ScoreResult        — full per-candidate output (raw → normalised → weighted → total)
 *
 * ─── Normalisation rules ─────────────────────────────────────────────────────
 *
 * All dimension scores are [0, 1].
 *   - Quality tier   → static map (Frontier=1.0, Standard=0.5, Economy=0.0)
 *   - Cost / Latency → min-max, inverted: lower source value = higher score
 *   - Throughput     → min-max, ascending: higher source value = higher score
 *   - Undefined      → neutral 0.5 (new workers without runtime metrics)
 *   - Hard failure   → eligible=false, totalScore=0, disqualificationReasons filled
 *
 * ─── Weighted total formula ──────────────────────────────────────────────────
 *
 *   total = sum(weight_i × score_i) / sum(weight_i)
 *
 * Dividing by the sum of weights preserves the [0, 1] range even when weights
 * do not sum to 1. Zero-weight dimensions contribute 0 and are excluded from
 * the denominator to avoid artificially deflating the total.
 */

import type { ModelCapability, ModelTask } from "../../../shared/contracts/model";

// ─── Request profile ──────────────────────────────────────────────────────────

/**
 * Lightweight description of the request used to evaluate model candidates.
 * All fields are optional — absent fields disable the corresponding check.
 */
export interface ModelEvaluationProfile {
  /** Estimated number of input tokens (used for cost calculation) */
  estimatedInputTokens?: number;
  /** Estimated number of output tokens (used for cost calculation) */
  estimatedOutputTokens?: number;
  /** Task type to match against model.supportedTasks */
  taskType?: ModelTask;
  /** Capabilities the model must expose — missing any → disqualified */
  requiredCapabilities?: ModelCapability[];
  /** Minimum context window the model must provide (tokens) */
  minContextWindow?: number;
}

/**
 * Lightweight description of the assignment context used to evaluate worker
 * candidates. All fields are optional.
 */
export interface WorkerEvaluationProfile {
  /** Preferred region for latency-aware routing (soft preference, not a hard filter) */
  preferredRegion?: string;
  /**
   * Age (ms) beyond which a heartbeat is considered stale (soft penalty).
   * Beyond 2× this threshold the worker is hard-disqualified.
   * Defaults to 60_000 ms if not provided.
   */
  heartbeatStalenessThresholdMs?: number;
}

// ─── Scoring weight interfaces ────────────────────────────────────────────────

/**
 * Per-dimension scoring weights for model evaluation.
 * Each value is a non-negative coefficient applied to the normalised dimension
 * score. Weights need not sum to 1 — they are relative.
 */
export interface ModelScoringWeights {
  /** Coefficient for the quality-tier dimension (Frontier=1.0 … Economy=0.0) */
  quality: number;
  /** Coefficient for the cost dimension (lower estimated cost → higher score) */
  cost: number;
  /** Coefficient for the TTFT latency dimension (lower TTFT → higher score) */
  latency: number;
  /** Coefficient for capability and task fit (fraction of required caps matched) */
  capabilityFit: number;
}

/**
 * Per-dimension scoring weights for worker evaluation.
 * Seven independent dimensions; fine-grained to support different routing strategies
 * (e.g. a latency-biased strategy can bump `latency` and reduce `throughput`).
 */
export interface WorkerScoringWeights {
  /** Coefficient for load score (lower load → higher score) */
  load: number;
  /** Coefficient for queue depth (fewer queued jobs → higher score) */
  queueDepth: number;
  /** Coefficient for token throughput (higher tokens/s → higher score) */
  throughput: number;
  /** Coefficient for TTFT latency (lower TTFT → higher score) */
  latency: number;
  /** Coefficient for health / status fitness (Idle=1.0, Busy=0.7, else disqualified) */
  healthFitness: number;
  /** Coefficient for region preference match (match=1.0, no pref=1.0, mismatch=0.3) */
  regionFit: number;
  /** Coefficient for heartbeat freshness (linear decay from threshold to 0) */
  heartbeatFreshness: number;
}

// ─── Default weights ──────────────────────────────────────────────────────────

/** Balanced defaults that slightly favour quality then cost/latency then capability fit. */
export const DEFAULT_MODEL_SCORING_WEIGHTS: ModelScoringWeights = {
  quality: 0.35,
  cost: 0.25,
  latency: 0.25,
  capabilityFit: 0.15,
};

/**
 * Worker defaults that prioritise load distribution over throughput/freshness.
 * Sum = 1.0, but the formula divides by sum(weights) so this is not required.
 */
export const DEFAULT_WORKER_SCORING_WEIGHTS: WorkerScoringWeights = {
  load: 0.30,
  queueDepth: 0.20,
  throughput: 0.15,
  latency: 0.15,
  healthFitness: 0.10,
  regionFit: 0.05,
  heartbeatFreshness: 0.05,
};

// ─── Raw dimension values ─────────────────────────────────────────────────────

/**
 * Un-normalised values extracted from a model candidate and the evaluation
 * profile. Preserved in the result for auditability and debugging.
 */
export interface ModelRawDimensions {
  /** QualityTier string value, e.g. "frontier" */
  qualityTier: string;
  /** Estimated cost in USD, computed from pricing × token estimates. Absent if no token estimates provided. */
  estimatedCostUsd?: number;
  /** Model's median TTFT in ms from its latency profile */
  ttftMs: number;
  /** Number of required capabilities the model satisfies */
  capabilityMatchCount: number;
  /** Total number of required capabilities requested */
  capabilityRequiredCount: number;
  /** Model's total context window in tokens */
  contextWindow: number;
  /** The minContextWindow from the evaluation profile, if provided */
  minContextWindowRequired?: number;
}

/**
 * Un-normalised values extracted from a worker candidate and the evaluation
 * context. Preserved in the result for auditability.
 */
export interface WorkerRawDimensions {
  /** Raw load score (0.0–1.0); undefined if not yet reported */
  loadScore?: number;
  /** Number of jobs in the worker's local queue */
  queuedJobs: number;
  /** Max concurrent jobs this worker supports */
  maxConcurrentJobs: number;
  /** Token throughput in tokens/s; undefined if not yet reported */
  tokensPerSecond?: number;
  /** Observed TTFT in ms; undefined if not yet reported */
  ttftMs?: number;
  /** Worker lifecycle status */
  status: string;
  /** Worker's registered region */
  region: string;
  /** Preferred region from the evaluation profile */
  preferredRegion?: string;
  /** Age of the most recent heartbeat in ms at evaluation time */
  heartbeatAgeMs: number;
}

// ─── Normalised dimension scores ─────────────────────────────────────────────

/**
 * Normalised [0, 1] scores per model dimension.
 * contextWindowSufficiency is binary (1.0 = passes, 0.0 = too small) but
 * is not used as a hard-disqualifier on its own when the profile only requests
 * a soft preference.
 */
export interface ModelDimensionScores {
  quality: number;
  cost: number;
  latency: number;
  capabilityFit: number;
  /** 1.0 if context window ≥ required; 0.0 otherwise */
  contextWindowSufficiency: number;
}

/** Normalised [0, 1] scores per worker dimension. */
export interface WorkerDimensionScores {
  load: number;
  queueDepth: number;
  throughput: number;
  latency: number;
  /** 1.0 (Idle), 0.7 (Busy); disqualified for all other statuses */
  healthFitness: number;
  /** 1.0 (match or no preference), 0.3 (mismatch) */
  regionFit: number;
  /** 1.0 (fresh) → 0.0 (stale at threshold), linear decay */
  heartbeatFreshness: number;
}

// ─── Score results ────────────────────────────────────────────────────────────

/**
 * Full evaluation result for a single model candidate.
 *
 * Disqualified candidates have eligible=false, totalScore=0, and at least one
 * entry in disqualificationReasons. All other score fields are still populated
 * for diagnostic use.
 */
export interface ModelScoreResult {
  candidateId: string;
  candidateType: "model";
  /** False when a hard constraint is violated (missing capability, small context window) */
  eligible: boolean;
  /** Human-readable reasons why this candidate was disqualified, if any */
  disqualificationReasons: string[];
  /** Un-normalised dimension values */
  raw: ModelRawDimensions;
  /** Normalised [0, 1] per-dimension scores */
  scores: ModelDimensionScores;
  /** weight × score per dimension (keyed by dimension name) */
  contributions: Record<string, number>;
  /** Weighted composite score [0, 1]; 0 for disqualified candidates */
  totalScore: number;
  /** Human-readable explanation fragments, one per scored dimension */
  explanation: string[];
}

/**
 * Full evaluation result for a single worker candidate.
 *
 * Same structure as ModelScoreResult but with worker-specific dimensions.
 */
export interface WorkerScoreResult {
  candidateId: string;
  candidateType: "worker";
  /** False when a hard constraint is violated (non-routable status, critically stale heartbeat) */
  eligible: boolean;
  /** Human-readable reasons why this candidate was disqualified, if any */
  disqualificationReasons: string[];
  /** Un-normalised dimension values */
  raw: WorkerRawDimensions;
  /** Normalised [0, 1] per-dimension scores */
  scores: WorkerDimensionScores;
  /** weight × score per dimension (keyed by dimension name) */
  contributions: Record<string, number>;
  /** Weighted composite score [0, 1]; 0 for disqualified candidates */
  totalScore: number;
  /** Human-readable explanation fragments, one per scored dimension */
  explanation: string[];
}

/** Discriminated union for mixed candidate pools */
export type CandidateScoreResult = ModelScoreResult | WorkerScoreResult;
