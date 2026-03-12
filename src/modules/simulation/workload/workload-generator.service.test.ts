/**
 * WorkloadGeneratorService — unit tests
 *
 * Coverage:
 *   1. Output size — always equals requestCount
 *   2. Request ID format — prefix-index
 *   3. Deterministic generation — same seed produces identical output
 *   4. Non-determinism without seed — two calls with no seed likely differ
 *   5. Distribution correctness — heavily weighted option dominates output
 *   6. Uniform fallback — absent distribution produces all vocab values
 *   7. Token count ranges — values within bounds per (inputSize, complexity)
 *   8. Capabilities per task type — correct defaults from TASK_CAPABILITIES
 *   9. Burst pattern — burst slots carry burst overrides; regular slots don't
 *  10. Burst partial period — final partial burst still applies correctly
 *  11. Custom burst overrides — burstTaskType / burstInputSize / burstComplexity
 *  12. Custom requestIdPrefix
 *  13. Config validation — workloadConfigSchema rejects invalid input
 */

import { describe, it, expect } from "vitest";
import { WorkloadGeneratorService } from "./workload-generator.service";
import {
  TOKEN_RANGES,
  TASK_CAPABILITIES,
  workloadConfigSchema,
  type WorkloadConfig,
} from "./workload-generator.contract";
import { ModelCapability } from "../../../shared/contracts/model";

const svc = new WorkloadGeneratorService();

// ─── 1. Output size ───────────────────────────────────────────────────────────

describe("output size", () => {
  it("returns exactly requestCount profiles", () => {
    expect(svc.generateWorkload({ requestCount: 50 })).toHaveLength(50);
  });

  it("returns exactly 1 profile for requestCount=1", () => {
    expect(svc.generateWorkload({ requestCount: 1 })).toHaveLength(1);
  });

  it("returns exactly 1000 profiles for requestCount=1000", () => {
    expect(svc.generateWorkload({ requestCount: 1_000 })).toHaveLength(1_000);
  });
});

// ─── 2. Request ID format ─────────────────────────────────────────────────────

describe("request ID format", () => {
  it("uses default prefix 'sim'", () => {
    const profiles = svc.generateWorkload({ requestCount: 3, randomSeed: 1 });
    expect(profiles[0].requestId).toBe("sim-0");
    expect(profiles[1].requestId).toBe("sim-1");
    expect(profiles[2].requestId).toBe("sim-2");
  });

  it("applies a custom requestIdPrefix", () => {
    const profiles = svc.generateWorkload({
      requestCount: 2,
      requestIdPrefix: "perf-test",
      randomSeed: 1,
    });
    expect(profiles[0].requestId).toBe("perf-test-0");
    expect(profiles[1].requestId).toBe("perf-test-1");
  });
});

// ─── 3. Deterministic generation ─────────────────────────────────────────────

describe("deterministic generation", () => {
  it("produces identical output for the same seed and config", () => {
    const config: WorkloadConfig = {
      requestCount: 20,
      taskDistribution: { chat: 0.6, reasoning: 0.3, analysis: 0.1 },
      inputSizeDistribution: { small: 0.5, medium: 0.4, large: 0.1 },
      complexityDistribution: { low: 0.5, medium: 0.3, high: 0.2 },
      randomSeed: 42,
    };
    const run1 = svc.generateWorkload(config);
    const run2 = svc.generateWorkload(config);
    expect(run1).toEqual(run2);
  });

  it("produces different output for different seeds", () => {
    const base: WorkloadConfig = { requestCount: 20, randomSeed: 1 };
    const run1 = svc.generateWorkload({ ...base, randomSeed: 1 });
    const run2 = svc.generateWorkload({ ...base, randomSeed: 2 });
    // Very unlikely to be identical with 20 profiles and full vocab
    const allEqual = run1.every(
      (p, i) =>
        p.taskType === run2[i].taskType &&
        p.inputSize === run2[i].inputSize &&
        p.estimatedComplexity === run2[i].estimatedComplexity,
    );
    expect(allEqual).toBe(false);
  });
});

// ─── 4. Distribution correctness ─────────────────────────────────────────────

describe("distribution correctness", () => {
  it("strongly favours the highest-weight task type", () => {
    const profiles = svc.generateWorkload({
      requestCount: 500,
      taskDistribution: { chat: 100, analysis: 1, reasoning: 1 },
      randomSeed: 7,
    });
    const chatCount = profiles.filter((p) => p.taskType === "chat").length;
    // With weight 100:1:1 we expect ~98% chat; use a conservative 80% threshold
    expect(chatCount).toBeGreaterThan(400);
  });

  it("strongly favours the highest-weight input size", () => {
    const profiles = svc.generateWorkload({
      requestCount: 500,
      inputSizeDistribution: { small: 100, medium: 1, large: 1 },
      randomSeed: 7,
    });
    const smallCount = profiles.filter((p) => p.inputSize === "small").length;
    expect(smallCount).toBeGreaterThan(400);
  });

  it("strongly favours the highest-weight complexity", () => {
    const profiles = svc.generateWorkload({
      requestCount: 500,
      complexityDistribution: { high: 100, medium: 1, low: 1 },
      randomSeed: 7,
    });
    const highCount = profiles.filter(
      (p) => p.estimatedComplexity === "high",
    ).length;
    expect(highCount).toBeGreaterThan(400);
  });
});

// ─── 5. Uniform fallback ──────────────────────────────────────────────────────

describe("uniform fallback", () => {
  it("produces all three task types when no distribution is given", () => {
    const profiles = svc.generateWorkload({ requestCount: 300, randomSeed: 5 });
    const types = new Set(profiles.map((p) => p.taskType));
    expect(types.has("chat")).toBe(true);
    expect(types.has("analysis")).toBe(true);
    expect(types.has("reasoning")).toBe(true);
  });

  it("produces all three input sizes when no distribution is given", () => {
    const profiles = svc.generateWorkload({ requestCount: 300, randomSeed: 5 });
    const sizes = new Set(profiles.map((p) => p.inputSize));
    expect(sizes.has("small")).toBe(true);
    expect(sizes.has("medium")).toBe(true);
    expect(sizes.has("large")).toBe(true);
  });

  it("produces all three complexities when no distribution is given", () => {
    const profiles = svc.generateWorkload({ requestCount: 300, randomSeed: 5 });
    const complexities = new Set(profiles.map((p) => p.estimatedComplexity));
    expect(complexities.has("low")).toBe(true);
    expect(complexities.has("medium")).toBe(true);
    expect(complexities.has("high")).toBe(true);
  });
});

// ─── 6. Token count ranges ────────────────────────────────────────────────────

describe("token count ranges", () => {
  // Exhaustively verify every (inputSize, complexity) cell over 200 samples
  const inputSizes = ["small", "medium", "large"] as const;
  const complexities = ["low", "medium", "high"] as const;

  for (const inputSize of inputSizes) {
    for (const complexity of complexities) {
      it(`${inputSize}/${complexity} token counts are within [min, max)`, () => {
        const profiles = svc.generateWorkload({
          requestCount: 200,
          inputSizeDistribution: { [inputSize]: 1 },
          complexityDistribution: { [complexity]: 1 },
          randomSeed: 99,
        });
        const { min, max } = TOKEN_RANGES[inputSize][complexity];
        for (const p of profiles) {
          expect(p.estimatedTokenCount).toBeGreaterThanOrEqual(min);
          expect(p.estimatedTokenCount).toBeLessThan(max);
        }
      });
    }
  }

  it("token counts are always positive integers", () => {
    const profiles = svc.generateWorkload({ requestCount: 100, randomSeed: 3 });
    for (const p of profiles) {
      expect(Number.isInteger(p.estimatedTokenCount)).toBe(true);
      expect(p.estimatedTokenCount).toBeGreaterThan(0);
    }
  });
});

// ─── 7. Capabilities per task type ───────────────────────────────────────────

describe("capabilities per task type", () => {
  it("chat profiles have no required capabilities", () => {
    const profiles = svc.generateWorkload({
      requestCount: 50,
      taskDistribution: { chat: 1 },
      randomSeed: 1,
    });
    for (const p of profiles) {
      expect(p.requiredCapabilities).toEqual([]);
    }
  });

  it("analysis profiles require ToolUse capability", () => {
    const profiles = svc.generateWorkload({
      requestCount: 50,
      taskDistribution: { analysis: 1 },
      randomSeed: 1,
    });
    for (const p of profiles) {
      expect(p.requiredCapabilities).toContain(ModelCapability.ToolUse as string);
    }
  });

  it("reasoning profiles have no required capabilities by default", () => {
    const profiles = svc.generateWorkload({
      requestCount: 50,
      taskDistribution: { reasoning: 1 },
      randomSeed: 1,
    });
    for (const p of profiles) {
      expect(p.requiredCapabilities).toEqual([]);
    }
  });

  it("TASK_CAPABILITIES constant matches produced profiles", () => {
    // Verify the service reads capabilities from the same TASK_CAPABILITIES table
    const profiles = svc.generateWorkload({
      requestCount: 30,
      taskDistribution: { analysis: 1 },
      randomSeed: 2,
    });
    const expected = TASK_CAPABILITIES["analysis"].map((c) => c as string);
    for (const p of profiles) {
      expect(p.requiredCapabilities).toEqual(expected);
    }
  });
});

// ─── 8. Burst pattern ─────────────────────────────────────────────────────────

describe("burst pattern", () => {
  it("burst slots carry default burst overrides (reasoning / large / high)", () => {
    // burstInterval=5, burstSize=2 → slots 5,6,12,13,... are burst
    const profiles = svc.generateWorkload({
      requestCount: 20,
      burstPattern: { burstInterval: 5, burstSize: 2 },
      randomSeed: 10,
    });
    const burstIndices = [5, 6, 12, 13];
    for (const i of burstIndices) {
      expect(profiles[i].taskType).toBe("reasoning");
      expect(profiles[i].inputSize).toBe("large");
      expect(profiles[i].estimatedComplexity).toBe("high");
    }
  });

  it("regular slots (outside burst) use configured distributions", () => {
    const profiles = svc.generateWorkload({
      requestCount: 20,
      taskDistribution: { chat: 1 },   // force all regular slots to chat
      burstPattern: { burstInterval: 5, burstSize: 2 },
      randomSeed: 10,
    });
    // Regular slots: 0-4, 7-11, 14-18
    const regularIndices = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18];
    for (const i of regularIndices) {
      expect(profiles[i].taskType).toBe("chat");
    }
  });

  it("burst does not change total output length", () => {
    const profiles = svc.generateWorkload({
      requestCount: 25,
      burstPattern: { burstInterval: 10, burstSize: 3 },
      randomSeed: 1,
    });
    expect(profiles).toHaveLength(25);
  });

  it("custom burst overrides are applied to burst slots", () => {
    const profiles = svc.generateWorkload({
      requestCount: 10,
      burstPattern: {
        burstInterval: 3,
        burstSize: 2,
        burstTaskType: "analysis",
        burstInputSize: "small",
        burstComplexity: "low",
      },
      randomSeed: 1,
    });
    // Burst slots: 3, 4, 8, 9
    for (const i of [3, 4, 8, 9]) {
      expect(profiles[i].taskType).toBe("analysis");
      expect(profiles[i].inputSize).toBe("small");
      expect(profiles[i].estimatedComplexity).toBe("low");
    }
  });

  it("partial final burst period is still applied", () => {
    // requestCount=7, burstInterval=5, burstSize=5 → slots 5,6 are burst
    const profiles = svc.generateWorkload({
      requestCount: 7,
      burstPattern: { burstInterval: 5, burstSize: 5 },
      randomSeed: 1,
    });
    expect(profiles[5].inputSize).toBe("large");
    expect(profiles[6].inputSize).toBe("large");
  });
});

// ─── 9. Schema validation ─────────────────────────────────────────────────────

describe("workloadConfigSchema", () => {
  it("accepts a valid minimal config", () => {
    const result = workloadConfigSchema.safeParse({ requestCount: 10 });
    expect(result.success).toBe(true);
  });

  it("accepts a fully specified valid config", () => {
    const result = workloadConfigSchema.safeParse({
      requestCount: 100,
      taskDistribution: { chat: 0.7, reasoning: 0.2, analysis: 0.1 },
      inputSizeDistribution: { small: 0.5, medium: 0.3, large: 0.2 },
      complexityDistribution: { low: 0.4, medium: 0.4, high: 0.2 },
      burstPattern: {
        burstInterval: 10,
        burstSize: 3,
        burstTaskType: "reasoning",
        burstInputSize: "large",
        burstComplexity: "high",
      },
      randomSeed: 42,
      requestIdPrefix: "test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects requestCount = 0", () => {
    const result = workloadConfigSchema.safeParse({ requestCount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects requestCount > 10 000", () => {
    const result = workloadConfigSchema.safeParse({ requestCount: 10_001 });
    expect(result.success).toBe(false);
  });

  it("rejects negative weights in distributions", () => {
    const result = workloadConfigSchema.safeParse({
      requestCount: 10,
      taskDistribution: { chat: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects burstInterval = 0", () => {
    const result = workloadConfigSchema.safeParse({
      requestCount: 10,
      burstPattern: { burstInterval: 0, burstSize: 2 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects burstSize = 0", () => {
    const result = workloadConfigSchema.safeParse({
      requestCount: 10,
      burstPattern: { burstInterval: 5, burstSize: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty requestIdPrefix", () => {
    const result = workloadConfigSchema.safeParse({
      requestCount: 10,
      requestIdPrefix: "",
    });
    expect(result.success).toBe(false);
  });
});
