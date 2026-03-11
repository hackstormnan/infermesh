/**
 * modules/routing/decision/routing-decision.service.test.ts
 *
 * Unit tests for RoutingDecisionService.
 *
 * Dependencies are provided as vi.fn() mocks so each test has full control
 * over return values. The real CandidateEvaluatorService is used to verify
 * end-to-end scoring behaviour without mocking internals.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import {
  ModelCapability,
  ModelProvider,
  ModelStatus,
  ModelTask,
  QualityTier,
} from "../../../shared/contracts/model";
import {
  DecisionSource,
  RoutingOutcome,
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
import { CandidateEvaluatorService } from "../evaluation/candidate-evaluator.service";
import { RoutingDecisionService } from "./routing-decision.service";
import {
  NoActivePolicyError,
  NoEligibleModelError,
  NoEligibleWorkerError,
} from "./routing-decision.contract";

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

function makeModelCandidate(
  overrides: Partial<ModelCandidate> = {},
): ModelCandidate {
  return {
    id: "model-1",
    name: "test-model",
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

function makeWorkerCandidate(
  overrides: Partial<WorkerCandidate> = {},
): WorkerCandidate {
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

// ─── Test setup ───────────────────────────────────────────────────────────────

const ctx = buildTestContext();

let findEligibleModels: ReturnType<typeof vi.fn>;
let findEligibleWorkers: ReturnType<typeof vi.fn>;
let saveDecision: ReturnType<typeof vi.fn>;
let findPolicyByName: ReturnType<typeof vi.fn>;
let findPolicyById: ReturnType<typeof vi.fn>;
let listPolicies: ReturnType<typeof vi.fn>;
let svc: RoutingDecisionService;

function buildSvc(policyOverride?: RoutingPolicy) {
  const activePolicy = policyOverride ?? makePolicy();

  findEligibleModels = vi.fn().mockResolvedValue([makeModelCandidate()]);
  findEligibleWorkers = vi.fn().mockResolvedValue([makeWorkerCandidate()]);
  saveDecision = vi.fn().mockImplementation(async (d) => d);
  findPolicyByName = vi
    .fn()
    .mockImplementation(async (name: string) =>
      activePolicy.name === name ? activePolicy : null,
    );
  findPolicyById = vi
    .fn()
    .mockImplementation(async (id: string) =>
      activePolicy.id === id ? activePolicy : null,
    );
  listPolicies = vi.fn().mockImplementation(async (q: { status?: RoutingPolicyStatus }) => {
    const matches = q.status === undefined || activePolicy.status === q.status;
    const items = matches ? [activePolicy] : [];
    return { items, total: items.length, page: 1, limit: 1, hasMore: false };
  });

  svc = new RoutingDecisionService(
    {
      findByName: findPolicyByName,
      findById: findPolicyById,
      list: listPolicies,
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as IPolicyRepository,
    {
      save: saveDecision,
      findById: vi.fn().mockResolvedValue(null),
      list: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, hasMore: false }),
    } as unknown as IDecisionRepository,
    { findEligible: findEligibleModels } as unknown as ModelRegistryService,
    { findEligible: findEligibleWorkers } as unknown as WorkerRegistryService,
    new CandidateEvaluatorService(),
  );
}

beforeEach(() => buildSvc());

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("decideRoute — happy path", () => {
  it("returns outcome=Routed with selected model and worker IDs", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.outcome).toBe(RoutingOutcome.Routed);
    expect(result.decision.selectedModelId).toBe("model-1");
    expect(result.decision.selectedWorkerId).toBe("worker-1");
  });

  it("persists the decision via decisionRepo.save()", async () => {
    await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(saveDecision).toHaveBeenCalledOnce();
  });

  it("decision has a generated UUID id", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("includes jobId in the decision when provided", async () => {
    const result = await svc.decideRoute(ctx, {
      requestId: "req-1",
      jobId: "job-99",
    });
    expect(result.decision.jobId).toBe("job-99");
  });

  it("jobId is undefined when not provided", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.jobId).toBeUndefined();
  });

  it("passes decisionSource=Simulation through to the decision record", async () => {
    const result = await svc.decideRoute(ctx, {
      requestId: "req-1",
      decisionSource: DecisionSource.Simulation,
    });
    expect(result.decision.decisionSource).toBe(DecisionSource.Simulation);
  });

  it("defaults decisionSource to Live when not provided", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.decisionSource).toBe(DecisionSource.Live);
  });

  it("returns full modelScores and workerScores arrays", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.modelScores).toHaveLength(1);
    expect(result.workerScores).toHaveLength(1);
    expect(result.modelScores[0].candidateId).toBe("model-1");
    expect(result.workerScores[0].candidateId).toBe("worker-1");
  });

  it("populates modelSummary with correct selectedModelId and counts", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.modelSummary.selectedModelId).toBe("model-1");
    expect(result.modelSummary.totalCandidates).toBe(1);
    expect(result.modelSummary.eligibleCount).toBe(1);
    expect(result.modelSummary.topScore).toBeGreaterThan(0);
    expect(result.modelSummary.explanation.length).toBeGreaterThan(0);
  });

  it("populates workerSummary with correct selectedWorkerId and counts", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.workerSummary.selectedWorkerId).toBe("worker-1");
    expect(result.workerSummary.totalCandidates).toBe(1);
    expect(result.workerSummary.eligibleCount).toBe(1);
    expect(result.workerSummary.topScore).toBeGreaterThan(0);
  });

  it("decision.reason contains selected model and worker IDs", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.reason).toContain("model-1");
    expect(result.decision.reason).toContain("worker-1");
  });

  it("evaluationMs is a positive number", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.evaluationMs).toBeGreaterThanOrEqual(0);
    expect(result.decision.evaluationMs).toBe(result.evaluationMs);
  });
});

// ─── Policy resolution ────────────────────────────────────────────────────────

describe("decideRoute — policy resolution", () => {
  it("uses the highest-priority active policy when no override provided", async () => {
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.policyId).toBe("policy-1");
    expect(listPolicies).toHaveBeenCalledWith(
      expect.objectContaining({ status: RoutingPolicyStatus.Active }),
    );
  });

  it("uses policyOverride by name (does not call list)", async () => {
    const result = await svc.decideRoute(ctx, {
      requestId: "req-1",
      policyOverride: "test-policy",
    });
    expect(findPolicyByName).toHaveBeenCalledWith("test-policy");
    expect(result.decision.policyId).toBe("policy-1");
    expect(listPolicies).not.toHaveBeenCalled();
  });

  it("falls back to ID lookup when name not found", async () => {
    findPolicyByName.mockResolvedValue(null);
    const result = await svc.decideRoute(ctx, {
      requestId: "req-1",
      policyOverride: "policy-1",
    });
    expect(findPolicyById).toHaveBeenCalledWith("policy-1");
    expect(result.decision.policyId).toBe("policy-1");
  });

  it("throws NoActivePolicyError when no active policy exists", async () => {
    listPolicies.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 1,
      hasMore: false,
    });
    await expect(
      svc.decideRoute(ctx, { requestId: "req-1" }),
    ).rejects.toThrow(NoActivePolicyError);
  });

  it("throws NotFoundError when policyOverride does not exist", async () => {
    findPolicyByName.mockResolvedValue(null);
    findPolicyById.mockResolvedValue(null);
    await expect(
      svc.decideRoute(ctx, { requestId: "req-1", policyOverride: "ghost-policy" }),
    ).rejects.toThrow(NotFoundError);
  });
});

// ─── Model candidate failures ─────────────────────────────────────────────────

describe("decideRoute — model candidate failures", () => {
  it("throws NoEligibleModelError when no model candidates found", async () => {
    findEligibleModels.mockResolvedValue([]);
    await expect(
      svc.decideRoute(ctx, { requestId: "req-1" }),
    ).rejects.toThrow(NoEligibleModelError);
  });

  it("throws NoEligibleModelError when all models are disqualified", async () => {
    const tinyModel = makeModelCandidate({ contextWindow: 100 });
    findEligibleModels.mockResolvedValue([tinyModel]);
    await expect(
      svc.decideRoute(ctx, {
        requestId: "req-1",
        modelProfile: { minContextWindow: 100_000 },
      }),
    ).rejects.toThrow(NoEligibleModelError);
  });
});

// ─── Worker candidate failures ────────────────────────────────────────────────

describe("decideRoute — worker candidate failures", () => {
  it("throws NoEligibleWorkerError when no worker candidates found", async () => {
    findEligibleWorkers.mockResolvedValue([]);
    await expect(
      svc.decideRoute(ctx, { requestId: "req-1" }),
    ).rejects.toThrow(NoEligibleWorkerError);
  });

  it("throws NoEligibleWorkerError when all workers are disqualified (critically stale)", async () => {
    const threshold = 60_000;
    const staleWorker = makeWorkerCandidate({
      lastHeartbeatAt: Date.now() - threshold * 3, // 3× threshold → critical
    });
    findEligibleWorkers.mockResolvedValue([staleWorker]);
    await expect(
      svc.decideRoute(ctx, {
        requestId: "req-1",
        workerProfile: { heartbeatStalenessThresholdMs: threshold },
      }),
    ).rejects.toThrow(NoEligibleWorkerError);
  });
});

// ─── Candidate scoping and selection ──────────────────────────────────────────

describe("decideRoute — candidate scoping and selection", () => {
  it("scopes worker query to the selected model's ID", async () => {
    await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(findEligibleWorkers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requiredModelId: "model-1" }),
    );
  });

  it("selects the highest-scoring eligible model", async () => {
    const economy = makeModelCandidate({
      id: "model-economy",
      qualityTier: QualityTier.Economy,
    });
    const frontier = makeModelCandidate({
      id: "model-frontier",
      qualityTier: QualityTier.Frontier,
    });
    // Put lower-quality first to confirm ordering is by score, not insertion
    findEligibleModels.mockResolvedValue([economy, frontier]);
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.selectedModelId).toBe("model-frontier");
  });

  it("selects the highest-scoring eligible worker", async () => {
    const heavyLoad = makeWorkerCandidate({
      id: "worker-heavy",
      status: WorkerStatus.Idle,
      loadScore: 0.95,
      lastHeartbeatAt: Date.now() - 1_000,
    });
    const lightLoad = makeWorkerCandidate({
      id: "worker-light",
      status: WorkerStatus.Idle,
      loadScore: 0.05,
      lastHeartbeatAt: Date.now() - 1_000,
    });
    // Put heavy-load first to confirm ordering is by score, not insertion
    findEligibleWorkers.mockResolvedValue([heavyLoad, lightLoad]);
    const result = await svc.decideRoute(ctx, { requestId: "req-1" });
    expect(result.decision.selectedWorkerId).toBe("worker-light");
  });
});
