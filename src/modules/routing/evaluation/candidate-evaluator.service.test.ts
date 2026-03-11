/**
 * Candidate Evaluator Service — unit tests
 *
 * Covers:
 *   Model evaluation:
 *     - Result count and candidateType
 *     - Empty input
 *     - Disqualification: context window too small, missing capabilities
 *     - Eligible when all capabilities present
 *     - Quality tier ordering (Frontier > Standard > Economy)
 *     - Cost ordering (lower cost → higher score)
 *     - Latency ordering (lower TTFT → higher score)
 *     - capabilityFit=1.0 when no required capabilities
 *     - Partial capability fit score
 *     - Single-candidate: cost/latency scores both 1.0 (no peer to compare)
 *     - Cost calculation from token estimates
 *     - No cost estimate when token counts are absent
 *     - Eligible-first ordering
 *     - Zero-weight dimension contributes 0
 *     - Custom weight: totalScore driven by single dimension
 *     - Determinism across repeated calls
 *
 *   Worker evaluation:
 *     - Result count and candidateType
 *     - Empty input
 *     - Idle worker is eligible
 *     - Offline/Unhealthy/Draining workers are disqualified
 *     - Stale heartbeat hard-disqualification (> 2× threshold)
 *     - totalScore=0 for disqualified candidates
 *     - Idle vs Busy health fitness (1.0 vs 0.7)
 *     - Load score ordering
 *     - Undefined loadScore → 0.5 neutral
 *     - Region match vs mismatch
 *     - regionFit=1.0 when no preferred region
 *     - Heartbeat freshness ordering
 *     - Throughput ascending ordering
 *     - TTFT latency ordering
 *     - Queue depth ordering
 *     - Eligible-first ordering
 *     - Zero-weight dimension
 *     - Determinism
 *     - Explanation length (7 base fragments)
 *     - DISQUALIFIED fragment in explanation
 */

import { describe, expect, it } from "vitest";
import { buildTestContext } from "../../../core/context";
import { ModelCapability, ModelProvider, ModelStatus, ModelTask, QualityTier } from "../../../shared/contracts/model";
import { WorkerStatus } from "../../../shared/contracts/worker";
import type { ModelCandidate } from "../../models/registry/model-registry.contract";
import type { WorkerCandidate } from "../../workers/registry/worker-registry.contract";
import { CandidateEvaluatorService } from "./candidate-evaluator.service";
import type {
  ModelScoringWeights,
  WorkerScoringWeights,
} from "./evaluation.contract";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeModel(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    id: "model-1",
    name: "test-model",
    provider: ModelProvider.Anthropic,
    capabilities: [ModelCapability.TextGeneration],
    supportedTasks: [ModelTask.Chat],
    qualityTier: QualityTier.Standard,
    contextWindow: 100_000,
    maxOutputTokens: 4096,
    pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
    latencyProfile: { ttftMs: 300, tokensPerSecond: 50 },
    status: ModelStatus.Active,
    ...overrides,
  };
}

function makeWorker(overrides: Partial<WorkerCandidate> = {}): WorkerCandidate {
  return {
    id: "worker-1",
    name: "test-worker",
    region: "us-east-1",
    status: WorkerStatus.Idle,
    hardware: { instanceType: "g4dn.xlarge" },
    supportedModelIds: ["model-1"],
    labels: {},
    activeJobs: 0,
    maxConcurrentJobs: 10,
    queuedJobs: 0,
    availableSlots: 10,
    loadScore: 0.1,
    tokensPerSecond: 100,
    ttftMs: 200,
    lastHeartbeatAt: Date.now() - 5_000, // 5 s ago — fresh
    ...overrides,
  };
}

const ctx = buildTestContext();
const svc = new CandidateEvaluatorService();

// ─── Model Evaluation ────────────────────────────────────────────────────────

describe("CandidateEvaluatorService — model evaluation", () => {
  it("returns one result per candidate", () => {
    const models = [makeModel({ id: "a" }), makeModel({ id: "b" })];
    const results = svc.evaluateModels(ctx, models, {});
    expect(results).toHaveLength(2);
  });

  it("sets candidateType to 'model'", () => {
    const results = svc.evaluateModels(ctx, [makeModel()], {});
    expect(results[0].candidateType).toBe("model");
  });

  it("returns empty array for empty input", () => {
    expect(svc.evaluateModels(ctx, [], {})).toEqual([]);
  });

  it("disqualifies when context window is too small", () => {
    const model = makeModel({ id: "small", contextWindow: 4_000 });
    const [result] = svc.evaluateModels(ctx, [model], {
      minContextWindow: 8_000,
    });
    expect(result.eligible).toBe(false);
    expect(result.totalScore).toBe(0);
    expect(result.disqualificationReasons.length).toBeGreaterThan(0);
    expect(result.disqualificationReasons[0]).toMatch(/context window/i);
  });

  it("disqualifies when a required capability is missing", () => {
    const model = makeModel({
      id: "no-vision",
      capabilities: [ModelCapability.TextGeneration],
    });
    const [result] = svc.evaluateModels(ctx, [model], {
      requiredCapabilities: [ModelCapability.Vision],
    });
    expect(result.eligible).toBe(false);
    expect(result.disqualificationReasons[0]).toMatch(/vision/i);
  });

  it("is eligible when all required capabilities are present", () => {
    const model = makeModel({
      capabilities: [ModelCapability.TextGeneration, ModelCapability.Vision],
    });
    const [result] = svc.evaluateModels(ctx, [model], {
      requiredCapabilities: [ModelCapability.Vision],
    });
    expect(result.eligible).toBe(true);
  });

  it("orders candidates by quality tier (Frontier > Standard > Economy)", () => {
    const frontier = makeModel({ id: "f", qualityTier: QualityTier.Frontier });
    const standard = makeModel({ id: "s", qualityTier: QualityTier.Standard });
    const economy = makeModel({ id: "e", qualityTier: QualityTier.Economy });
    // All have same cost/latency so quality drives ordering
    const results = svc.evaluateModels(ctx, [economy, standard, frontier], {}, {
      quality: 1,
      cost: 0,
      latency: 0,
      capabilityFit: 0,
    });
    expect(results[0].candidateId).toBe("f");
    expect(results[1].candidateId).toBe("s");
    expect(results[2].candidateId).toBe("e");
  });

  it("orders candidates by cost (lower cost → higher score)", () => {
    const cheap = makeModel({
      id: "cheap",
      pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 },
    });
    const expensive = makeModel({
      id: "expensive",
      pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.05 },
    });
    const results = svc.evaluateModels(
      ctx,
      [expensive, cheap],
      { estimatedInputTokens: 1000, estimatedOutputTokens: 500 },
      { quality: 0, cost: 1, latency: 0, capabilityFit: 0 },
    );
    expect(results[0].candidateId).toBe("cheap");
  });

  it("orders candidates by latency (lower TTFT → higher score)", () => {
    const fast = makeModel({ id: "fast", latencyProfile: { ttftMs: 100, tokensPerSecond: 50 } });
    const slow = makeModel({ id: "slow", latencyProfile: { ttftMs: 1000, tokensPerSecond: 50 } });
    const results = svc.evaluateModels(ctx, [slow, fast], {}, {
      quality: 0,
      cost: 0,
      latency: 1,
      capabilityFit: 0,
    });
    expect(results[0].candidateId).toBe("fast");
  });

  it("sets capabilityFit to 1.0 when no required capabilities", () => {
    const [result] = svc.evaluateModels(ctx, [makeModel()], {});
    expect(result.scores.capabilityFit).toBe(1.0);
  });

  it("computes partial capability fit score", () => {
    const model = makeModel({
      capabilities: [ModelCapability.TextGeneration, ModelCapability.Vision],
    });
    const [result] = svc.evaluateModels(ctx, [model], {
      requiredCapabilities: [
        ModelCapability.Vision,
        ModelCapability.Audio, // missing
      ],
    });
    // model is disqualified, but capabilityFit should still be computed
    expect(result.scores.capabilityFit).toBe(0.5);
    expect(result.eligible).toBe(false);
  });

  it("gives cost and latency score 1.0 for a single candidate (no peers)", () => {
    const [result] = svc.evaluateModels(
      ctx,
      [makeModel()],
      { estimatedInputTokens: 100, estimatedOutputTokens: 100 },
    );
    expect(result.scores.cost).toBe(1.0);
    expect(result.scores.latency).toBe(1.0);
  });

  it("computes estimatedCostUsd correctly", () => {
    const model = makeModel({
      pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.03 },
    });
    const [result] = svc.evaluateModels(ctx, [model], {
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 1000,
    });
    // 2000/1000 * 0.01 + 1000/1000 * 0.03 = 0.02 + 0.03 = 0.05
    expect(result.raw.estimatedCostUsd).toBeCloseTo(0.05);
  });

  it("leaves estimatedCostUsd undefined when no token estimates provided", () => {
    const [result] = svc.evaluateModels(ctx, [makeModel()], {});
    expect(result.raw.estimatedCostUsd).toBeUndefined();
  });

  it("places eligible candidates before disqualified ones", () => {
    const ok = makeModel({ id: "ok", contextWindow: 100_000 });
    const bad = makeModel({ id: "bad", contextWindow: 100 });
    const results = svc.evaluateModels(ctx, [bad, ok], { minContextWindow: 1_000 });
    expect(results[0].candidateId).toBe("ok");
    expect(results[1].candidateId).toBe("bad");
  });

  it("zero-weight dimension contributes 0 to total", () => {
    const model = makeModel({ id: "a", qualityTier: QualityTier.Economy });
    const weights: ModelScoringWeights = {
      quality: 0,
      cost: 1,
      latency: 0,
      capabilityFit: 0,
    };
    const [result] = svc.evaluateModels(ctx, [model], {
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
    }, weights);
    expect(result.contributions["quality"]).toBe(0);
    // With a single candidate cost normalises to 1.0 → total = 1.0
    expect(result.totalScore).toBeCloseTo(1.0);
  });

  it("drives totalScore entirely from quality when only quality weight is non-zero", () => {
    const frontier = makeModel({ id: "f", qualityTier: QualityTier.Frontier });
    const economy = makeModel({ id: "e", qualityTier: QualityTier.Economy });
    const weights: ModelScoringWeights = { quality: 1, cost: 0, latency: 0, capabilityFit: 0 };
    const results = svc.evaluateModels(ctx, [frontier, economy], {}, weights);
    const fResult = results.find((r) => r.candidateId === "f")!;
    const eResult = results.find((r) => r.candidateId === "e")!;
    expect(fResult.totalScore).toBeCloseTo(1.0);
    expect(eResult.totalScore).toBeCloseTo(0.0);
  });

  it("is deterministic across repeated calls", () => {
    const models = [
      makeModel({ id: "c", qualityTier: QualityTier.Economy }),
      makeModel({ id: "a", qualityTier: QualityTier.Frontier }),
      makeModel({ id: "b", qualityTier: QualityTier.Standard }),
    ];
    const r1 = svc.evaluateModels(ctx, models, {});
    const r2 = svc.evaluateModels(ctx, models, {});
    expect(r1.map((r) => r.candidateId)).toEqual(r2.map((r) => r.candidateId));
    expect(r1.map((r) => r.totalScore)).toEqual(r2.map((r) => r.totalScore));
  });
});

// ─── Worker Evaluation ────────────────────────────────────────────────────────

describe("CandidateEvaluatorService — worker evaluation", () => {
  it("returns one result per candidate", () => {
    const workers = [makeWorker({ id: "a" }), makeWorker({ id: "b" })];
    const results = svc.evaluateWorkers(ctx, workers, {});
    expect(results).toHaveLength(2);
  });

  it("sets candidateType to 'worker'", () => {
    const results = svc.evaluateWorkers(ctx, [makeWorker()], {});
    expect(results[0].candidateType).toBe("worker");
  });

  it("returns empty array for empty input", () => {
    expect(svc.evaluateWorkers(ctx, [], {})).toEqual([]);
  });

  it("marks an Idle worker as eligible", () => {
    const [result] = svc.evaluateWorkers(
      ctx,
      [makeWorker({ status: WorkerStatus.Idle })],
      {},
    );
    expect(result.eligible).toBe(true);
  });

  it.each([WorkerStatus.Offline, WorkerStatus.Unhealthy, WorkerStatus.Draining])(
    "disqualifies %s worker",
    (status) => {
      const [result] = svc.evaluateWorkers(ctx, [makeWorker({ status })], {});
      expect(result.eligible).toBe(false);
      expect(result.disqualificationReasons[0]).toMatch(/non-routable/i);
    },
  );

  it("hard-disqualifies workers with critically stale heartbeat (> 2× threshold)", () => {
    const threshold = 30_000;
    const worker = makeWorker({
      lastHeartbeatAt: Date.now() - threshold * 3, // 3× threshold — critical
    });
    const [result] = svc.evaluateWorkers(
      ctx,
      [worker],
      { heartbeatStalenessThresholdMs: threshold },
    );
    expect(result.eligible).toBe(false);
    expect(result.disqualificationReasons[0]).toMatch(/stale/i);
  });

  it("sets totalScore to 0 for disqualified candidates", () => {
    const [result] = svc.evaluateWorkers(
      ctx,
      [makeWorker({ status: WorkerStatus.Offline })],
      {},
    );
    expect(result.totalScore).toBe(0);
  });

  it("gives Idle a higher health fitness score than Busy", () => {
    const idle = makeWorker({ id: "idle", status: WorkerStatus.Idle });
    const busy = makeWorker({ id: "busy", status: WorkerStatus.Busy });
    const weights: WorkerScoringWeights = {
      load: 0, queueDepth: 0, throughput: 0, latency: 0,
      healthFitness: 1, regionFit: 0, heartbeatFreshness: 0,
    };
    const results = svc.evaluateWorkers(ctx, [busy, idle], {}, weights);
    const idleResult = results.find((r) => r.candidateId === "idle")!;
    const busyResult = results.find((r) => r.candidateId === "busy")!;
    expect(idleResult.scores.healthFitness).toBeGreaterThan(busyResult.scores.healthFitness);
    expect(idleResult.scores.healthFitness).toBeCloseTo(1.0);
    expect(busyResult.scores.healthFitness).toBeCloseTo(0.7);
  });

  it("orders by load score (lower load → higher score)", () => {
    const lowLoad = makeWorker({ id: "low", loadScore: 0.1 });
    const highLoad = makeWorker({ id: "high", loadScore: 0.9 });
    const weights: WorkerScoringWeights = {
      load: 1, queueDepth: 0, throughput: 0, latency: 0,
      healthFitness: 0, regionFit: 0, heartbeatFreshness: 0,
    };
    const results = svc.evaluateWorkers(ctx, [highLoad, lowLoad], {}, weights);
    expect(results[0].candidateId).toBe("low");
  });

  it("gives 0.5 load score when loadScore is undefined", () => {
    const worker = makeWorker({ id: "noload", loadScore: undefined });
    const [result] = svc.evaluateWorkers(ctx, [worker], {});
    expect(result.scores.load).toBeCloseTo(0.5);
  });

  it("penalises region mismatch (0.3 vs 1.0 for match)", () => {
    const matchWorker = makeWorker({ id: "match", region: "us-east-1" });
    const mismatchWorker = makeWorker({ id: "mismatch", region: "eu-west-1" });
    const weights: WorkerScoringWeights = {
      load: 0, queueDepth: 0, throughput: 0, latency: 0,
      healthFitness: 0, regionFit: 1, heartbeatFreshness: 0,
    };
    const results = svc.evaluateWorkers(
      ctx,
      [mismatchWorker, matchWorker],
      { preferredRegion: "us-east-1" },
      weights,
    );
    expect(results[0].candidateId).toBe("match");
    expect(results[0].scores.regionFit).toBeCloseTo(1.0);
    expect(results[1].scores.regionFit).toBeCloseTo(0.3);
  });

  it("sets regionFit to 1.0 when no preferred region specified", () => {
    const [result] = svc.evaluateWorkers(ctx, [makeWorker()], {});
    expect(result.scores.regionFit).toBeCloseTo(1.0);
  });

  it("orders by heartbeat freshness (fresher → higher score)", () => {
    const threshold = 60_000;
    const fresh = makeWorker({ id: "fresh", lastHeartbeatAt: Date.now() - 5_000 });
    const stale = makeWorker({ id: "stale", lastHeartbeatAt: Date.now() - 55_000 });
    const weights: WorkerScoringWeights = {
      load: 0, queueDepth: 0, throughput: 0, latency: 0,
      healthFitness: 0, regionFit: 0, heartbeatFreshness: 1,
    };
    const results = svc.evaluateWorkers(
      ctx,
      [stale, fresh],
      { heartbeatStalenessThresholdMs: threshold },
      weights,
    );
    expect(results[0].candidateId).toBe("fresh");
    expect(results[0].scores.heartbeatFreshness).toBeGreaterThan(
      results[1].scores.heartbeatFreshness,
    );
  });

  it("orders by throughput (higher tokens/s → higher score)", () => {
    const highThroughput = makeWorker({ id: "fast", tokensPerSecond: 500 });
    const lowThroughput = makeWorker({ id: "slow", tokensPerSecond: 50 });
    const weights: WorkerScoringWeights = {
      load: 0, queueDepth: 0, throughput: 1, latency: 0,
      healthFitness: 0, regionFit: 0, heartbeatFreshness: 0,
    };
    const results = svc.evaluateWorkers(ctx, [lowThroughput, highThroughput], {}, weights);
    expect(results[0].candidateId).toBe("fast");
  });

  it("orders by TTFT latency (lower TTFT → higher score)", () => {
    const fast = makeWorker({ id: "fast", ttftMs: 100 });
    const slow = makeWorker({ id: "slow", ttftMs: 800 });
    const weights: WorkerScoringWeights = {
      load: 0, queueDepth: 0, throughput: 0, latency: 1,
      healthFitness: 0, regionFit: 0, heartbeatFreshness: 0,
    };
    const results = svc.evaluateWorkers(ctx, [slow, fast], {}, weights);
    expect(results[0].candidateId).toBe("fast");
  });

  it("orders by queue depth (fewer queued jobs → higher score)", () => {
    const empty = makeWorker({ id: "empty", queuedJobs: 0, maxConcurrentJobs: 10 });
    const loaded = makeWorker({ id: "loaded", queuedJobs: 8, maxConcurrentJobs: 10 });
    const weights: WorkerScoringWeights = {
      load: 0, queueDepth: 1, throughput: 0, latency: 0,
      healthFitness: 0, regionFit: 0, heartbeatFreshness: 0,
    };
    const results = svc.evaluateWorkers(ctx, [loaded, empty], {}, weights);
    expect(results[0].candidateId).toBe("empty");
  });

  it("places eligible candidates before disqualified ones", () => {
    const ok = makeWorker({ id: "ok", status: WorkerStatus.Idle });
    const bad = makeWorker({ id: "bad", status: WorkerStatus.Offline });
    const results = svc.evaluateWorkers(ctx, [bad, ok], {});
    expect(results[0].candidateId).toBe("ok");
    expect(results[1].candidateId).toBe("bad");
  });

  it("zero-weight dimension contributes 0", () => {
    const w: WorkerScoringWeights = {
      load: 1, queueDepth: 0, throughput: 0, latency: 0,
      healthFitness: 0, regionFit: 0, heartbeatFreshness: 0,
    };
    const [result] = svc.evaluateWorkers(ctx, [makeWorker()], {}, w);
    expect(result.contributions["queueDepth"]).toBe(0);
    expect(result.contributions["throughput"]).toBe(0);
  });

  it("is deterministic across repeated calls with fixed heartbeat times", () => {
    const workers = [
      makeWorker({ id: "c", loadScore: 0.8 }),
      makeWorker({ id: "a", loadScore: 0.1 }),
      makeWorker({ id: "b", loadScore: 0.5 }),
    ];
    const r1 = svc.evaluateWorkers(ctx, workers, {});
    const r2 = svc.evaluateWorkers(ctx, workers, {});
    expect(r1.map((r) => r.candidateId)).toEqual(r2.map((r) => r.candidateId));
  });

  it("explanation has 7 base fragments for an eligible worker", () => {
    const [result] = svc.evaluateWorkers(ctx, [makeWorker()], {});
    expect(result.eligible).toBe(true);
    expect(result.explanation).toHaveLength(7);
  });

  it("adds a DISQUALIFIED fragment to explanation when disqualified", () => {
    const [result] = svc.evaluateWorkers(
      ctx,
      [makeWorker({ status: WorkerStatus.Offline })],
      {},
    );
    const hasDisqualifiedFrag = result.explanation.some((f) =>
      f.startsWith("DISQUALIFIED:"),
    );
    expect(hasDisqualifiedFrag).toBe(true);
  });
});
