/**
 * modules/simulation/workload/workload-generator.contract.ts
 *
 * Type contracts and constants for the synthetic workload generator.
 *
 * The generator produces arrays of SyntheticRequestProfile values from a
 * WorkloadConfig. Profiles are independent of routing and job services — they
 * carry no live IDs and create no database records. They are designed to map
 * cleanly onto ModelEvaluationProfile so the simulation engine can pass them
 * directly into RoutingDecisionService.decideRoute().
 *
 * ─── Key types ────────────────────────────────────────────────────────────────
 *   WorkloadConfig          — input to generateWorkload()
 *   SyntheticRequestProfile — output per generated request
 *   BurstPattern            — periodic spike configuration
 *   WeightedDistribution    — record of option → relative weight
 *
 * ─── Constants ────────────────────────────────────────────────────────────────
 *   TOKEN_RANGES     — (inputSize, complexity) → (min, max) token count
 *   TASK_CAPABILITIES — taskType → default required ModelCapability[]
 *   TASK_TYPE_MAP     — taskType → ModelTask enum value
 */

import { z } from "zod";
import { ModelCapability, ModelTask } from "../../../shared/contracts/model";

// ─── Workload vocabulary ──────────────────────────────────────────────────────

/**
 * Task categories understood by the workload generator.
 * These map to a curated subset of ModelTask values relevant to routing
 * simulation scenarios (see TASK_TYPE_MAP below).
 */
export type WorkloadTaskType = "chat" | "analysis" | "reasoning";

/** Coarse input size classes — each maps to a token-count range. */
export type WorkloadInputSize = "small" | "medium" | "large";

/** Coarse complexity class — combined with input size to determine token count. */
export type WorkloadComplexity = "low" | "medium" | "high";

/**
 * Weighted distribution over a set of string values.
 * Keys are the possible values; values are non-negative relative weights.
 * Absent keys have zero weight. The generator normalises internally —
 * weights need not sum to 1.
 */
export type WeightedDistribution<T extends string> = Partial<Record<T, number>>;

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Token count ranges keyed by [inputSize][complexity].
 *
 * The generator samples uniformly within [min, max) for each cell.
 * Ranges are chosen to reflect realistic LLM workloads:
 *   small  = prompt-style requests (<1 k tokens)
 *   medium = document-scale requests (1 k–5 k tokens)
 *   large  = long-context requests (5 k–32 k tokens)
 */
export const TOKEN_RANGES: Record<
  WorkloadInputSize,
  Record<WorkloadComplexity, { min: number; max: number }>
> = {
  small: {
    low:    { min: 64,    max: 256    },
    medium: { min: 256,   max: 512    },
    high:   { min: 512,   max: 1_024  },
  },
  medium: {
    low:    { min: 512,   max: 1_500  },
    medium: { min: 1_500, max: 3_000  },
    high:   { min: 3_000, max: 5_000  },
  },
  large: {
    low:    { min: 5_000,  max: 8_000  },
    medium: { min: 8_000,  max: 16_000 },
    high:   { min: 16_000, max: 32_000 },
  },
};

/**
 * Default required capabilities per task type.
 *
 * "analysis" tasks are modelled as tool-assisted extraction, so they require
 * ToolUse. Chat and reasoning tasks have no hard capability requirements by
 * default (any text-generation model qualifies).
 *
 * Callers can override capabilities at the WorkloadConfig level by supplying
 * a custom complexityDistribution or post-processing the profiles.
 */
export const TASK_CAPABILITIES: Record<WorkloadTaskType, ModelCapability[]> = {
  chat:      [],
  analysis:  [ModelCapability.ToolUse],
  reasoning: [],
};

/**
 * Maps generator task types onto ModelTask enum values consumed by the
 * routing evaluation layer.
 */
export const TASK_TYPE_MAP: Record<WorkloadTaskType, ModelTask> = {
  chat:      ModelTask.Chat,
  analysis:  ModelTask.Extraction,
  reasoning: ModelTask.Reasoning,
};

// ─── Burst pattern ────────────────────────────────────────────────────────────

/**
 * Configures a periodic spike in request complexity.
 *
 * After every `burstInterval` regular requests, the next `burstSize` slots in
 * the output are treated as burst requests. Burst slots default to large/high
 * complexity reasoning — the heaviest profile in the generator vocabulary.
 *
 * The total output length is always exactly `requestCount` regardless of the
 * burst pattern; burst slots replace regular slots rather than supplementing
 * them.
 *
 * Example: burstInterval=10, burstSize=3, requestCount=25
 *   Indices 0–9:  regular
 *   Indices 10–12: burst
 *   Indices 13–22: regular
 *   Indices 23–25: burst (partial — only 2 requests remain)
 */
export interface BurstPattern {
  /**
   * Number of regular requests between each burst.
   * Must be ≥ 1.
   */
  burstInterval: number;
  /**
   * Number of consecutive burst requests per burst period.
   * Must be ≥ 1.
   */
  burstSize: number;
  /** Task type applied to burst slots (default: "reasoning") */
  burstTaskType?: WorkloadTaskType;
  /** Input size applied to burst slots (default: "large") */
  burstInputSize?: WorkloadInputSize;
  /** Complexity applied to burst slots (default: "high") */
  burstComplexity?: WorkloadComplexity;
}

// ─── Workload config ──────────────────────────────────────────────────────────

/**
 * Input to WorkloadGeneratorService.generateWorkload().
 *
 * All distribution fields are optional. When omitted the generator falls back
 * to a uniform distribution over the full vocabulary.
 */
export interface WorkloadConfig {
  /**
   * Total number of synthetic request profiles to generate.
   * The output array will have exactly this many elements.
   */
  requestCount: number;

  /**
   * Weighted distribution over task types.
   * Example: { chat: 0.6, reasoning: 0.3, analysis: 0.1 }
   */
  taskDistribution?: WeightedDistribution<WorkloadTaskType>;

  /**
   * Weighted distribution over input size classes.
   * Example: { small: 0.5, medium: 0.4, large: 0.1 }
   */
  inputSizeDistribution?: WeightedDistribution<WorkloadInputSize>;

  /**
   * Weighted distribution over complexity classes.
   * Example: { low: 0.5, medium: 0.3, high: 0.2 }
   */
  complexityDistribution?: WeightedDistribution<WorkloadComplexity>;

  /**
   * Optional burst spike pattern. When provided, periodic slots in the
   * output use burst-override properties rather than the configured
   * distributions.
   */
  burstPattern?: BurstPattern;

  /**
   * Seed for the deterministic PRNG.
   * Same seed + same config always produces the same output. Omit for a
   * time-seeded (non-deterministic) run.
   */
  randomSeed?: number;

  /**
   * Prefix for synthetic request IDs.
   * Output IDs take the form `<prefix>-<index>` (default prefix: "sim").
   */
  requestIdPrefix?: string;
}

// ─── Output profile ───────────────────────────────────────────────────────────

/**
 * A single synthetic request profile produced by the generator.
 *
 * This type is compatible with RoutingDecisionService.decideRoute() via the
 * toModelProfile() helper in the simulation engine:
 *   taskType             → ModelEvaluationProfile.taskType (via TASK_TYPE_MAP)
 *   requiredCapabilities → ModelEvaluationProfile.requiredCapabilities
 *   estimatedTokenCount  → ModelEvaluationProfile.estimatedInputTokens
 *
 * No live database records are created — profiles exist only in memory.
 */
export interface SyntheticRequestProfile {
  /** Synthetic request ID (e.g. "sim-0", "perf-test-42") */
  requestId: string;
  /** Coarse task category for model selection */
  taskType: WorkloadTaskType;
  /** Coarse input volume class */
  inputSize: WorkloadInputSize;
  /** Coarse complexity class */
  estimatedComplexity: WorkloadComplexity;
  /**
   * Required model capabilities (string form of ModelCapability enum values).
   * Defaults are derived from taskType via TASK_CAPABILITIES; burst slots may
   * carry different defaults.
   */
  requiredCapabilities: string[];
  /** Estimated total input token count sampled from TOKEN_RANGES */
  estimatedTokenCount: number;
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const taskDistributionSchema = z
  .object({
    chat:      z.number().nonnegative().optional(),
    analysis:  z.number().nonnegative().optional(),
    reasoning: z.number().nonnegative().optional(),
  })
  .optional();

const inputSizeDistributionSchema = z
  .object({
    small:  z.number().nonnegative().optional(),
    medium: z.number().nonnegative().optional(),
    large:  z.number().nonnegative().optional(),
  })
  .optional();

const complexityDistributionSchema = z
  .object({
    low:    z.number().nonnegative().optional(),
    medium: z.number().nonnegative().optional(),
    high:   z.number().nonnegative().optional(),
  })
  .optional();

/**
 * Zod schema for WorkloadConfig.
 * Use this to validate user-supplied config before calling generateWorkload().
 */
export const workloadConfigSchema = z.object({
  requestCount: z.number().int().positive().max(10_000),
  taskDistribution:       taskDistributionSchema,
  inputSizeDistribution:  inputSizeDistributionSchema,
  complexityDistribution: complexityDistributionSchema,
  burstPattern: z
    .object({
      burstInterval:  z.number().int().min(1),
      burstSize:      z.number().int().min(1),
      burstTaskType:  z.enum(["chat", "analysis", "reasoning"]).optional(),
      burstInputSize: z.enum(["small", "medium", "large"]).optional(),
      burstComplexity: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  randomSeed:      z.number().optional(),
  requestIdPrefix: z.string().min(1).optional(),
});
