/**
 * modules/simulation/workload/workload-generator.service.ts
 *
 * Synthetic workload generator.
 *
 * Produces an array of SyntheticRequestProfile values from a WorkloadConfig.
 * Generation is:
 *   - Deterministic   — same seed + same config = identical output
 *   - Isolated        — no live database records are created
 *   - Weighted        — task type, input size, and complexity follow caller-
 *                       supplied probability distributions (or uniform fallback)
 *   - Burst-aware     — optional periodic spike pattern inserts high-load slots
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   import { workloadGeneratorService } from "../modules/simulation";
 *
 *   const profiles = workloadGeneratorService.generateWorkload({
 *     requestCount: 100,
 *     taskDistribution: { chat: 0.6, reasoning: 0.3, analysis: 0.1 },
 *     inputSizeDistribution: { small: 0.5, medium: 0.4, large: 0.1 },
 *     randomSeed: 42,
 *   });
 *
 * ─── PRNG ────────────────────────────────────────────────────────────────────
 *
 * Uses the mulberry32 algorithm — a compact, high-quality 32-bit PRNG with
 * excellent statistical properties for simulation use cases. The seed is
 * accepted as a JavaScript number and truncated to a 32-bit unsigned integer
 * via `>>> 0`.
 */

import {
  type BurstPattern,
  type SyntheticRequestProfile,
  type WeightedDistribution,
  type WorkloadComplexity,
  type WorkloadConfig,
  type WorkloadInputSize,
  type WorkloadTaskType,
  TASK_CAPABILITIES,
  TOKEN_RANGES,
} from "./workload-generator.contract";

// ─── PRNG ─────────────────────────────────────────────────────────────────────

/**
 * Mulberry32 seeded pseudo-random number generator.
 * Returns a function that produces a float in [0, 1) on each call.
 * The seed is truncated to a 32-bit unsigned integer.
 */
function createRng(seed?: number): () => number {
  let s = (seed ?? (Date.now() & 0xffffffff)) >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// ─── Sampling helpers ─────────────────────────────────────────────────────────

/**
 * Sample a value from a weighted distribution.
 * Falls back to uniform sampling over `defaults` when the distribution is
 * absent or all weights are zero.
 */
function sampleWeighted<T extends string>(
  dist: WeightedDistribution<T> | undefined,
  defaults: readonly T[],
  rng: () => number,
): T {
  if (dist) {
    const entries = (Object.entries(dist) as [T, number][]).filter(
      ([, w]) => w > 0,
    );
    if (entries.length > 0) {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let r = rng() * total;
      for (const [key, weight] of entries) {
        r -= weight;
        if (r <= 0) return key;
      }
      return entries[entries.length - 1][0];
    }
  }
  return defaults[Math.floor(rng() * defaults.length)];
}

/** Sample a token count uniformly within the range for (inputSize, complexity). */
function sampleTokenCount(
  inputSize: WorkloadInputSize,
  complexity: WorkloadComplexity,
  rng: () => number,
): number {
  const { min, max } = TOKEN_RANGES[inputSize][complexity];
  return Math.floor(min + rng() * (max - min));
}

// ─── Burst helper ─────────────────────────────────────────────────────────────

/**
 * Returns true when the request at `index` falls within a burst slot.
 *
 * The pattern repeats every `burstInterval + burstSize` indices:
 *   [0 .. burstInterval-1]              → regular
 *   [burstInterval .. period-1]         → burst
 *   [period .. period+burstInterval-1]  → regular
 *   …
 */
function isBurstSlot(index: number, burst: BurstPattern): boolean {
  const period = burst.burstInterval + burst.burstSize;
  return index % period >= burst.burstInterval;
}

// ─── Vocabulary defaults ──────────────────────────────────────────────────────

const ALL_TASK_TYPES: readonly WorkloadTaskType[] = ["chat", "analysis", "reasoning"];
const ALL_INPUT_SIZES: readonly WorkloadInputSize[] = ["small", "medium", "large"];
const ALL_COMPLEXITIES: readonly WorkloadComplexity[] = ["low", "medium", "high"];

// ─── Service ──────────────────────────────────────────────────────────────────

export class WorkloadGeneratorService {
  /**
   * Generate an array of synthetic request profiles.
   *
   * The output contains exactly `config.requestCount` profiles.
   * Each profile is fully self-contained — no live registries are queried and
   * no database writes are performed.
   *
   * @param config  Workload configuration (use workloadConfigSchema to validate
   *                user-supplied input before calling this method)
   * @returns       Array of SyntheticRequestProfile with length === requestCount
   */
  generateWorkload(config: WorkloadConfig): SyntheticRequestProfile[] {
    const rng = createRng(config.randomSeed);
    const prefix = config.requestIdPrefix ?? "sim";
    const profiles: SyntheticRequestProfile[] = [];

    for (let i = 0; i < config.requestCount; i++) {
      const burst = config.burstPattern && isBurstSlot(i, config.burstPattern);

      const taskType = burst
        ? (config.burstPattern!.burstTaskType ?? "reasoning")
        : sampleWeighted(config.taskDistribution, ALL_TASK_TYPES, rng);

      const inputSize = burst
        ? (config.burstPattern!.burstInputSize ?? "large")
        : sampleWeighted(config.inputSizeDistribution, ALL_INPUT_SIZES, rng);

      const complexity = burst
        ? (config.burstPattern!.burstComplexity ?? "high")
        : sampleWeighted(config.complexityDistribution, ALL_COMPLEXITIES, rng);

      const estimatedTokenCount = sampleTokenCount(inputSize, complexity, rng);

      // Capabilities are derived from task type. Cast to string[] so the
      // contract stays decoupled from the ModelCapability enum at the type
      // level — the mapping is applied when routing evaluation consumes the
      // profile (see toModelProfile() in the simulation engine).
      const requiredCapabilities: string[] = TASK_CAPABILITIES[taskType].map(
        (c) => c as string,
      );

      profiles.push({
        requestId:            `${prefix}-${i}`,
        taskType,
        inputSize,
        estimatedComplexity:  complexity,
        requiredCapabilities,
        estimatedTokenCount,
      });
    }

    return profiles;
  }
}
