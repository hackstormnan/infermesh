/**
 * ExperimentRunnerService — unit tests
 *
 * The simulation engine and workload generator are injected as mocks so tests
 * exercise only the experiment runner's orchestration logic without requiring
 * live routing infrastructure.
 *
 * Coverage:
 *   1.  Engine called once per policy
 *   2.  Shared workload — identical profiles passed to every policy run
 *   3.  Result contains correct number of policy entries
 *   4.  Policies list in result matches input order
 *   5.  successRate derived correctly (successCount / totalRequests)
 *   6.  fallbackRate derived correctly (fallbackCount / successCount)
 *   7.  fallbackRate is 0 when successCount is 0
 *   8.  Rankings — bySuccessRate descending
 *   9.  Rankings — byFallbackRate ascending
 *   10. Rankings — byEvaluationSpeed ascending
 *   11. experimentId is a UUID (format check)
 *   12. startedAt / completedAt are ISO 8601 strings
 *   13. durationMs is non-negative
 *   14. workloadRequestCount matches workloadConfig.requestCount
 *   15. Single-policy experiment produces single result entry
 *   16. Engine exception → zero-valued result, experiment continues
 *   17. Simulation never throws even when engine throws for every policy
 *   18. perModelSelections forwarded from simulation result
 *   19. perWorkerAssignments forwarded from simulation result
 *   20. HTTP schema — valid body accepted
 *   21. HTTP schema — policies array must be non-empty
 *   22. HTTP schema — policies array max 20 enforced
 *   23. HTTP schema — workloadConfig.requestCount required
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import { ExperimentRunnerService } from "./experiment-runner.service";
import type { SimulationEngineService } from "../service/simulation-engine.service";
import type { WorkloadGeneratorService } from "../workload/workload-generator.service";
import type { SimulationRunResult } from "../contract";
import type { SyntheticRequestProfile } from "../workload/workload-generator.contract";
import { experimentRunHttpSchema } from "./experiment-runner.contract";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ctx = buildTestContext();

function makeSimResult(overrides: Partial<SimulationRunResult> = {}): SimulationRunResult {
  return {
    runId:               "run-uuid-1",
    scenarioName:        "test-scenario",
    policyId:            "policy-uuid-1",
    policyName:          "test-policy",
    startedAt:           new Date().toISOString(),
    completedAt:         new Date().toISOString(),
    durationMs:          10,
    totalRequests:       10,
    successCount:        9,
    failureCount:        1,
    fallbackCount:       2,
    averageEvaluationMs: 0.5,
    perModelSelections:  { "model-a": 9 },
    perWorkerAssignments: { "worker-1": 9 },
    errors: [],
    ...overrides,
  };
}

function makeProfile(index: number): SyntheticRequestProfile {
  return {
    requestId:            `sim-${index}`,
    taskType:             "chat",
    inputSize:            "small",
    estimatedComplexity:  "low",
    requiredCapabilities: [],
    estimatedTokenCount:  128,
  };
}

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeEngine(results: SimulationRunResult[]): SimulationEngineService {
  let callIndex = 0;
  return {
    run: vi.fn().mockImplementation(async () => results[callIndex++] ?? results[results.length - 1]),
  } as unknown as SimulationEngineService;
}

function makeGenerator(profiles: SyntheticRequestProfile[]): WorkloadGeneratorService {
  return {
    generateWorkload: vi.fn().mockReturnValue(profiles),
  } as unknown as WorkloadGeneratorService;
}

// ─── 1. Engine called once per policy ────────────────────────────────────────

describe("engine invocation count", () => {
  it("calls engine.run exactly once per policy", async () => {
    const profiles = [makeProfile(0)];
    const engine = makeEngine([makeSimResult(), makeSimResult(), makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator(profiles));

    await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1", "p2", "p3"],
      workloadConfig: { requestCount: 1 },
    });

    expect(engine.run).toHaveBeenCalledTimes(3);
  });

  it("passes the correct policyId to each engine.run call", async () => {
    const profiles = [makeProfile(0)];
    const engine = makeEngine([
      makeSimResult({ policyId: "p1" }),
      makeSimResult({ policyId: "p2" }),
    ]);
    const svc = new ExperimentRunnerService(engine, makeGenerator(profiles));

    await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1", "p2"],
      workloadConfig: { requestCount: 1 },
    });

    const calls = (engine.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].policyId).toBe("p1");
    expect(calls[1][1].policyId).toBe("p2");
  });
});

// ─── 2. Shared workload ───────────────────────────────────────────────────────

describe("shared workload", () => {
  it("generates workload exactly once regardless of policy count", async () => {
    const generator = makeGenerator([makeProfile(0)]);
    const engine = makeEngine([makeSimResult(), makeSimResult(), makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, generator);

    await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1", "p2", "p3"],
      workloadConfig: { requestCount: 1 },
    });

    expect(generator.generateWorkload).toHaveBeenCalledTimes(1);
  });

  it("passes identical workloadProfiles to every engine.run call", async () => {
    const profiles = [makeProfile(0), makeProfile(1), makeProfile(2)];
    const engine = makeEngine([makeSimResult(), makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator(profiles));

    await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1", "p2"],
      workloadConfig: { requestCount: 3 },
    });

    const calls = (engine.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].workloadProfiles).toBe(profiles);
    expect(calls[1][1].workloadProfiles).toBe(profiles);
    expect(calls[0][1].workloadProfiles).toBe(calls[1][1].workloadProfiles);
  });

  it("passes requestCount equal to number of generated profiles", async () => {
    const profiles = [makeProfile(0), makeProfile(1)];
    const engine = makeEngine([makeSimResult(), makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator(profiles));

    await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1", "p2"],
      workloadConfig: { requestCount: 2 },
    });

    const calls = (engine.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].requestCount).toBe(2);
    expect(calls[1][1].requestCount).toBe(2);
  });
});

// ─── 3–4. Result structure ────────────────────────────────────────────────────

describe("result structure", () => {
  it("results array length equals policy count", async () => {
    const engine = makeEngine([makeSimResult(), makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1", "p2"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results).toHaveLength(2);
  });

  it("result.policies preserves input order", async () => {
    const engine = makeEngine([makeSimResult(), makeSimResult(), makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["alpha", "beta", "gamma"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.policies).toEqual(["alpha", "beta", "gamma"]);
  });

  it("result.experimentName matches input", async () => {
    const engine = makeEngine([makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "my-experiment",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.experimentName).toBe("my-experiment");
  });
});

// ─── 5–7. Rate derivation ─────────────────────────────────────────────────────

describe("rate derivation", () => {
  it("successRate = successCount / totalRequests", async () => {
    const engine = makeEngine([
      makeSimResult({ totalRequests: 100, successCount: 80, failureCount: 20 }),
    ]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results[0].successRate).toBeCloseTo(0.8);
  });

  it("fallbackRate = fallbackCount / successCount", async () => {
    const engine = makeEngine([
      makeSimResult({ successCount: 80, fallbackCount: 16 }),
    ]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results[0].fallbackRate).toBeCloseTo(0.2);
  });

  it("fallbackRate is 0 when successCount is 0", async () => {
    const engine = makeEngine([
      makeSimResult({ totalRequests: 10, successCount: 0, failureCount: 10, fallbackCount: 0 }),
    ]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results[0].fallbackRate).toBe(0);
  });
});

// ─── 8–10. Rankings ───────────────────────────────────────────────────────────

describe("rankings", () => {
  async function runWithThreePolicies() {
    const engine = makeEngine([
      makeSimResult({
        policyId: "p-low-cost",
        totalRequests: 100, successCount: 94, failureCount: 6, fallbackCount: 32,
        averageEvaluationMs: 0.42,
      }),
      makeSimResult({
        policyId: "p-balanced",
        totalRequests: 100, successCount: 97, failureCount: 3, fallbackCount: 19,
        averageEvaluationMs: 0.36,
      }),
      makeSimResult({
        policyId: "p-low-latency",
        totalRequests: 100, successCount: 98, failureCount: 2, fallbackCount: 10,
        averageEvaluationMs: 0.30,
      }),
    ]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));
    return svc.run(ctx, {
      experimentName: "cost-vs-latency",
      policies: ["p-low-cost", "p-balanced", "p-low-latency"],
      workloadConfig: { requestCount: 1 },
    });
  }

  it("bySuccessRate orders highest success rate first", async () => {
    const result = await runWithThreePolicies();
    expect(result.rankings.bySuccessRate).toEqual([
      "p-low-latency",   // 0.98
      "p-balanced",      // 0.97
      "p-low-cost",      // 0.94
    ]);
  });

  it("byFallbackRate orders lowest fallback rate first", async () => {
    const result = await runWithThreePolicies();
    // fallbackRate: p-low-latency=10/98≈0.10, p-balanced=19/97≈0.20, p-low-cost=32/94≈0.34
    expect(result.rankings.byFallbackRate).toEqual([
      "p-low-latency",
      "p-balanced",
      "p-low-cost",
    ]);
  });

  it("byEvaluationSpeed orders fastest evaluation first", async () => {
    const result = await runWithThreePolicies();
    expect(result.rankings.byEvaluationSpeed).toEqual([
      "p-low-latency",   // 0.30 ms
      "p-balanced",      // 0.36 ms
      "p-low-cost",      // 0.42 ms
    ]);
  });
});

// ─── 11–14. Metadata fields ───────────────────────────────────────────────────

describe("metadata fields", () => {
  it("experimentId is a UUID", async () => {
    const engine = makeEngine([makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.experimentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("startedAt and completedAt are ISO 8601 strings", async () => {
    const engine = makeEngine([makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(() => new Date(result.startedAt)).not.toThrow();
    expect(() => new Date(result.completedAt)).not.toThrow();
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("durationMs is non-negative", async () => {
    const engine = makeEngine([makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("workloadRequestCount equals number of generated profiles", async () => {
    const profiles = [makeProfile(0), makeProfile(1), makeProfile(2)];
    const engine = makeEngine([makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator(profiles));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 3 },
    });

    expect(result.workloadRequestCount).toBe(3);
  });
});

// ─── 15. Single-policy ────────────────────────────────────────────────────────

describe("single-policy experiment", () => {
  it("produces exactly one result entry", async () => {
    const engine = makeEngine([makeSimResult()]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["only-policy"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results).toHaveLength(1);
    expect(result.rankings.bySuccessRate).toHaveLength(1);
  });
});

// ─── 16–17. Resilience ────────────────────────────────────────────────────────

describe("engine exception resilience", () => {
  it("records zero result for a policy whose engine.run throws", async () => {
    const engine = {
      run: vi.fn()
        .mockResolvedValueOnce(makeSimResult({ policyId: "p-ok", successCount: 10 }))
        .mockRejectedValueOnce(new Error("routing exploded")),
    } as unknown as SimulationEngineService;

    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p-ok", "p-broken"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results).toHaveLength(2);
    const broken = result.results.find((r) => r.policyId === "p-broken");
    expect(broken?.successRate).toBe(0);
    expect(broken?.failureCount).toBe(1); // equals requestCount
  });

  it("run() never throws even when all policy runs throw", async () => {
    const engine = {
      run: vi.fn().mockRejectedValue(new Error("total failure")),
    } as unknown as SimulationEngineService;

    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    await expect(
      svc.run(ctx, {
        experimentName: "test",
        policies: ["p1", "p2"],
        workloadConfig: { requestCount: 1 },
      }),
    ).resolves.toBeDefined();
  });
});

// ─── 18–19. Distribution forwarding ──────────────────────────────────────────

describe("distribution forwarding", () => {
  it("forwards perModelSelections from simulation result", async () => {
    const engine = makeEngine([
      makeSimResult({ perModelSelections: { "gpt-4o": 7, "claude-sonnet": 3 } }),
    ]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results[0].perModelSelections).toEqual({ "gpt-4o": 7, "claude-sonnet": 3 });
  });

  it("forwards perWorkerAssignments from simulation result", async () => {
    const engine = makeEngine([
      makeSimResult({ perWorkerAssignments: { "worker-us-east": 6, "worker-us-west": 4 } }),
    ]);
    const svc = new ExperimentRunnerService(engine, makeGenerator([makeProfile(0)]));

    const result = await svc.run(ctx, {
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 1 },
    });

    expect(result.results[0].perWorkerAssignments).toEqual({
      "worker-us-east": 6,
      "worker-us-west": 4,
    });
  });
});

// ─── 20–23. HTTP schema validation ───────────────────────────────────────────

describe("experimentRunHttpSchema", () => {
  it("accepts a valid minimal body", () => {
    const result = experimentRunHttpSchema.safeParse({
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 100 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully specified body", () => {
    const result = experimentRunHttpSchema.safeParse({
      experimentName: "full-test",
      policies: ["p1", "p2"],
      workloadConfig: {
        requestCount: 500,
        taskDistribution: { chat: 0.6, reasoning: 0.3, analysis: 0.1 },
        randomSeed: 42,
      },
      sourceTag: "ci",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty policies array", () => {
    const result = experimentRunHttpSchema.safeParse({
      experimentName: "test",
      policies: [],
      workloadConfig: { requestCount: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 policies", () => {
    const result = experimentRunHttpSchema.safeParse({
      experimentName: "test",
      policies: Array.from({ length: 21 }, (_, i) => `p${i}`),
      workloadConfig: { requestCount: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing workloadConfig.requestCount", () => {
    const result = experimentRunHttpSchema.safeParse({
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects requestCount > 10 000 in workloadConfig", () => {
    const result = experimentRunHttpSchema.safeParse({
      experimentName: "test",
      policies: ["p1"],
      workloadConfig: { requestCount: 10_001 },
    });
    expect(result.success).toBe(false);
  });
});
