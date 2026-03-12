/**
 * modules/routing/decision/routing-decision.service.streaming.test.ts
 *
 * Unit tests for RoutingDecisionService — stream event publishing.
 *
 * Tests cover:
 *   - broker.publish() called exactly once on a successful decideRoute
 *   - published to the "decisions" channel
 *   - payload matches the RoutingDecisionPayload UI spec exactly
 *   - payload fields are derived from the correct decision record
 *   - publish NOT called when no broker is provided (backward compat)
 *   - broker error does NOT propagate or abort the routing flow
 *   - publish happens AFTER the decision record is saved
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import {
  ModelCapability,
  ModelProvider,
  ModelStatus,
  ModelTask,
  QualityTier,
} from "../../../shared/contracts/model";
import {
  RoutingPolicyStatus,
  RoutingStrategy,
} from "../../../shared/contracts/routing";
import type { RoutingPolicy } from "../../../shared/contracts/routing";
import type { PolicyId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import { WorkerStatus } from "../../../shared/contracts/worker";
import type { ModelCandidate } from "../../models/registry/model-registry.contract";
import type { WorkerCandidate } from "../../workers/registry/worker-registry.contract";
import type { ModelRegistryService } from "../../models/registry/model-registry.service";
import type { WorkerRegistryService } from "../../workers/registry/worker-registry.service";
import type { IPolicyRepository } from "../repository/IPolicyRepository";
import type { IDecisionRepository } from "../repository/IDecisionRepository";
import type { IStreamBroker } from "../../../stream/broker/IStreamBroker";
import type { RoutingDecisionPayload } from "../../../stream/contract";
import { CandidateEvaluatorService } from "../evaluation/candidate-evaluator.service";
import { RoutingDecisionService } from "./routing-decision.service";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<RoutingPolicy> = {}): RoutingPolicy {
  return {
    id: "policy-1" as PolicyId,
    name: "test-policy",
    description: "Test routing policy",
    strategy: RoutingStrategy.LeastLoaded,
    constraints: {},
    weights: { quality: 0.25, cost: 0.25, latency: 0.25, load: 0.25 },
    allowFallback: false,
    priority: 0,
    version: 1,
    status: RoutingPolicyStatus.Active,
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
    ...overrides,
  };
}

function makeModelCandidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    id: "model-gpt4o",
    name: "gpt-4o",
    provider: ModelProvider.Anthropic,
    capabilities: [ModelCapability.TextGeneration],
    supportedTasks: [ModelTask.General],
    qualityTier: QualityTier.Standard,
    contextWindow: 8_192,
    maxOutputTokens: 4_096,
    pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
    latencyProfile: { ttftMs: 300, tokensPerSecond: 50 },
    status: ModelStatus.Active,
    ...overrides,
  };
}

function makeWorkerCandidate(overrides: Partial<WorkerCandidate> = {}): WorkerCandidate {
  return {
    id: "worker-us-1",
    name: "us-east-worker-1",
    region: "us-east-1",
    status: WorkerStatus.Idle,
    hardware: { instanceType: "g4dn.xlarge" },
    supportedModelIds: ["model-gpt4o"],
    labels: {},
    activeJobs: 0,
    maxConcurrentJobs: 10,
    queuedJobs: 0,
    availableSlots: 10,
    loadScore: 0.1,
    tokensPerSecond: 100,
    ttftMs: 200,
    lastHeartbeatAt: Date.now() - 5_000,
    ...overrides,
  };
}

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeDeps() {
  const activePolicy = makePolicy();

  const policyRepo = {
    findByName: vi.fn().mockImplementation(async (name: string) =>
      activePolicy.name === name ? activePolicy : null,
    ),
    findById: vi.fn().mockImplementation(async (id: string) =>
      activePolicy.id === id ? activePolicy : null,
    ),
    list: vi.fn().mockResolvedValue({
      items: [activePolicy],
      total: 1, page: 1, limit: 1, hasMore: false,
    }),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as IPolicyRepository;

  const decisionRepo = {
    save:    vi.fn().mockImplementation(async (d) => d),
    findById: vi.fn().mockResolvedValue(null),
    list:    vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, hasMore: false }),
  } as unknown as IDecisionRepository;

  const modelRegistry = {
    findEligible: vi.fn().mockResolvedValue([makeModelCandidate()]),
  } as unknown as ModelRegistryService;

  const workerRegistry = {
    findEligible: vi.fn().mockResolvedValue([makeWorkerCandidate()]),
  } as unknown as WorkerRegistryService;

  return { policyRepo, decisionRepo, modelRegistry, workerRegistry };
}

function makeBroker(): IStreamBroker & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn() };
}

const ctx = buildTestContext();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RoutingDecisionService — stream publishing", () => {
  let deps: ReturnType<typeof makeDeps>;
  let broker: ReturnType<typeof makeBroker>;

  beforeEach(() => {
    deps   = makeDeps();
    broker = makeBroker();
  });

  function buildSvc(b?: IStreamBroker): RoutingDecisionService {
    return new RoutingDecisionService(
      deps.policyRepo,
      deps.decisionRepo,
      deps.modelRegistry,
      deps.workerRegistry,
      new CandidateEvaluatorService(),
      null,
      b,
    );
  }

  // ── Broker invocation ──────────────────────────────────────────────────────

  it("calls broker.publish exactly once on a successful decideRoute", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(broker.publish).toHaveBeenCalledOnce();
  });

  it("publishes to the 'decisions' channel", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const [channel] = broker.publish.mock.calls[0];
    expect(channel).toBe("decisions");
  });

  it("does NOT call broker.publish when no broker is provided", async () => {
    const svc = buildSvc(); // no broker
    await expect(svc.decideRoute(ctx, { requestId: "req-1" })).resolves.toBeDefined();
    // no assertion needed — if broker were called it would throw (undefined)
  });

  // ── Payload shape (UI spec alignment) ─────────────────────────────────────

  it("payload.id equals the persisted decision ID", async () => {
    const svc = buildSvc(broker);
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(payload.id).toBe(result.decision.id);
  });

  it("payload.timestamp is a valid ISO 8601 string matching createdAt", async () => {
    const svc = buildSvc(broker);
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(payload.timestamp).toBe(result.decision.createdAt);
    expect(isNaN(new Date(payload.timestamp).getTime())).toBe(false);
  });

  it("payload.selectedModel equals the selected model ID", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(payload.selectedModel).toBe("model-gpt4o");
  });

  it("payload.reason is a non-empty string", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(typeof payload.reason).toBe("string");
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  it("payload.reason contains the selected model and worker IDs", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(payload.reason).toContain("model-gpt4o");
    expect(payload.reason).toContain("worker-us-1");
  });

  it("payload.factors.latency is a number in [0, 1]", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(typeof payload.factors.latency).toBe("number");
    expect(payload.factors.latency).toBeGreaterThanOrEqual(0);
    expect(payload.factors.latency).toBeLessThanOrEqual(1);
  });

  it("payload.factors.cost is a number in [0, 1]", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(typeof payload.factors.cost).toBe("number");
    expect(payload.factors.cost).toBeGreaterThanOrEqual(0);
    expect(payload.factors.cost).toBeLessThanOrEqual(1);
  });

  it("payload.factors.availability is a number in [0, 1]", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    expect(typeof payload.factors.availability).toBe("number");
    expect(payload.factors.availability).toBeGreaterThanOrEqual(0);
    expect(payload.factors.availability).toBeLessThanOrEqual(1);
  });

  it("payload has exactly the required UI-spec fields (no extra top-level fields)", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    const keys = Object.keys(payload).sort();
    expect(keys).toEqual(["factors", "id", "reason", "selectedModel", "timestamp"]);
  });

  it("payload.factors has exactly the three required fields", async () => {
    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });
    const payload = broker.publish.mock.calls[0][1] as RoutingDecisionPayload;
    const factorKeys = Object.keys(payload.factors).sort();
    expect(factorKeys).toEqual(["availability", "cost", "latency"]);
  });

  // ── Publish timing ─────────────────────────────────────────────────────────

  it("publish is called after the decision record is saved", async () => {
    const callOrder: string[] = [];

    (deps.decisionRepo as unknown as { save: ReturnType<typeof vi.fn> }).save =
      vi.fn().mockImplementation(async (d: unknown) => {
        callOrder.push("save");
        return d;
      });

    broker.publish = vi.fn().mockImplementation(() => {
      callOrder.push("publish");
    });

    const svc = buildSvc(broker);
    await svc.decideRoute(ctx, { requestId: "req-1" });

    expect(callOrder.indexOf("publish")).toBeGreaterThan(callOrder.indexOf("save"));
  });

  // ── Resilience: broker failure must not abort routing ──────────────────────

  it("a broker.publish() exception does NOT propagate — decideRoute still returns", async () => {
    broker.publish.mockImplementationOnce(() => {
      throw new Error("broker unavailable");
    });

    const svc = buildSvc(broker);
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });

    // Decision record should still be returned
    expect(result.decision.id).toBeTruthy();
    expect(result.decision.selectedModelId).toBe("model-gpt4o");
  });

  it("decideRoute returns the same result regardless of broker presence", async () => {
    const withBroker    = buildSvc(broker);
    const withoutBroker = buildSvc();

    const r1 = await withBroker.decideRoute(ctx, { requestId: "req-A" });
    const r2 = await withoutBroker.decideRoute(ctx, { requestId: "req-B" });

    // Both should produce a valid Routed decision
    expect(r1.decision.selectedModelId).toBe(r2.decision.selectedModelId);
    expect(r1.decision.selectedWorkerId).toBe(r2.decision.selectedWorkerId);
    expect(r1.modelScores.length).toBe(r2.modelScores.length);
    expect(r1.workerScores.length).toBe(r2.workerScores.length);
  });
});
