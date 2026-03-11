/**
 * modules/routing/decision/decision-history.service.test.ts
 *
 * Unit tests for DecisionHistoryService and buildDecisionDetailDto.
 *
 * RoutingService and IDecisionEvaluationStore are provided as vi.fn() mocks
 * so each test controls exactly what data is returned. Tests are organised by:
 *
 *   - buildDecisionDetailDto (pure function, no deps)
 *   - getDecisionDetail (single fetch + enrichment)
 *   - listDecisionDetails (paginated fetch + enrichment)
 *   - InMemoryDecisionRepository filter coverage (jobId, selectedModelId, selectedWorkerId)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import {
  DecisionSource,
  RoutingOutcome,
  RoutingStrategy,
} from "../../../shared/contracts/routing";
import type { RoutingDecision } from "../../../shared/contracts/routing";
import type { DecisionId, ModelId, WorkerId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { RoutingService } from "../service/routing.service";
import { InMemoryDecisionRepository } from "../repository/InMemoryDecisionRepository";
import type { IDecisionEvaluationStore, RoutingDecisionEvaluation } from "./decision-history.contract";
import { DecisionHistoryService, buildDecisionDetailDto } from "./decision-history.service";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    id: "decision-1" as DecisionId,
    requestId: "req-1" as any,
    jobId: "job-1" as any,
    policyId: "policy-1" as any,
    outcome: RoutingOutcome.Routed,
    selectedModelId: "model-a" as ModelId,
    selectedWorkerId: "worker-a" as WorkerId,
    strategy: RoutingStrategy.LeastLoaded,
    usedFallback: false,
    candidates: [],
    reason: "Model model-a (score: 0.850); Worker worker-a (score: 0.900)",
    decisionSource: DecisionSource.Live,
    decidedAt: Date.now(),
    evaluationMs: 12,
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
    ...overrides,
  };
}

function makeModelScore(id: string, eligible: boolean, score = 0.85) {
  return {
    candidateId: id,
    candidateType: "model" as const,
    eligible,
    disqualificationReasons: eligible ? [] : [`${id} failed hard constraint`],
    raw: {} as any,
    scores: {
      quality: score,
      cost: score,
      latency: score,
      capabilityFit: eligible ? 1.0 : 0.0,
      contextWindowSufficiency: 1.0,
    },
    contributions: {},
    totalScore: eligible ? score : 0,
    explanation: [`quality: ${score.toFixed(2)}`],
  };
}

function makeWorkerScore(id: string, eligible: boolean, score = 0.90) {
  return {
    candidateId: id,
    candidateType: "worker" as const,
    eligible,
    disqualificationReasons: eligible ? [] : [`${id} is offline`],
    raw: {} as any,
    scores: {
      load: score,
      queueDepth: score,
      throughput: score,
      latency: score,
      healthFitness: eligible ? 1.0 : 0.0,
      regionFit: 1.0,
      heartbeatFreshness: 1.0,
    },
    contributions: {},
    totalScore: eligible ? score : 0,
    explanation: [`load: ${score.toFixed(2)}`],
  };
}

function makeEvaluation(decisionId = "decision-1"): RoutingDecisionEvaluation {
  return {
    decisionId: decisionId as DecisionId,
    modelScores: [
      makeModelScore("model-a", true, 0.85),
      makeModelScore("model-b", true, 0.70),
      makeModelScore("model-c", false),
    ],
    workerScores: [
      makeWorkerScore("worker-a", true, 0.90),
      makeWorkerScore("worker-b", false),
    ],
    savedAt: Date.now(),
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const ctx = buildTestContext();
let getDecision: ReturnType<typeof vi.fn>;
let listDecisions: ReturnType<typeof vi.fn>;
let findByDecisionId: ReturnType<typeof vi.fn>;
let svc: DecisionHistoryService;

beforeEach(() => {
  const decision = makeDecision();
  getDecision = vi.fn().mockResolvedValue(decision);
  listDecisions = vi.fn().mockResolvedValue({
    items: [decision],
    total: 1,
    page: 1,
    limit: 20,
    hasMore: false,
  });
  findByDecisionId = vi.fn().mockResolvedValue(makeEvaluation());

  svc = new DecisionHistoryService(
    { getDecision, listDecisions } as unknown as RoutingService,
    { findByDecisionId } as unknown as IDecisionEvaluationStore,
  );
});

// ─── buildDecisionDetailDto (pure function) ───────────────────────────────────

describe("buildDecisionDetailDto — core fields", () => {
  it("maps all identity fields from the decision", () => {
    const d = makeDecision();
    const dto = buildDecisionDetailDto(d, null);

    expect(dto.id).toBe(d.id);
    expect(dto.requestId).toBe(d.requestId);
    expect(dto.jobId).toBe(d.jobId);
    expect(dto.policyId).toBe(d.policyId);
    expect(dto.decisionSource).toBe(DecisionSource.Live);
    expect(dto.outcome).toBe(RoutingOutcome.Routed);
    expect(dto.selectedModelId).toBe("model-a");
    expect(dto.selectedWorkerId).toBe("worker-a");
    expect(dto.strategy).toBe(RoutingStrategy.LeastLoaded);
    expect(dto.decidedAt).toBe(d.decidedAt);
    expect(dto.evaluationMs).toBe(12);
    expect(dto.reason).toBe(d.reason);
    expect(dto.usedFallback).toBe(false);
  });

  it("includes candidates from the core entity", () => {
    const d = makeDecision({ candidates: [{ modelId: "m" as any, workerId: "w" as any, excluded: false }] });
    const dto = buildDecisionDetailDto(d, null);
    expect(dto.candidates).toHaveLength(1);
  });

  it("sets modelEvaluation and workerEvaluation to undefined when evaluation is null", () => {
    const dto = buildDecisionDetailDto(makeDecision(), null);
    expect(dto.modelEvaluation).toBeUndefined();
    expect(dto.workerEvaluation).toBeUndefined();
  });

  it("includes fallbackReason when usedFallback=true", () => {
    const d = makeDecision({ usedFallback: true, fallbackReason: "no workers in us-east-1" });
    const dto = buildDecisionDetailDto(d, null);
    expect(dto.usedFallback).toBe(true);
    expect(dto.fallbackReason).toBe("no workers in us-east-1");
  });
});

describe("buildDecisionDetailDto — model evaluation section", () => {
  it("populates modelEvaluation when evaluation is provided", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.modelEvaluation).toBeDefined();
  });

  it("counts total and eligible candidates correctly", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.modelEvaluation?.totalCandidates).toBe(3);
    expect(dto.modelEvaluation?.eligibleCount).toBe(2);
  });

  it("sets the winner to the selected model", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.modelEvaluation?.winner?.candidateId).toBe("model-a");
    expect(dto.modelEvaluation?.winner?.eligible).toBe(true);
    expect(dto.modelEvaluation?.winner?.totalScore).toBeCloseTo(0.85);
  });

  it("places non-selected eligible models in runners", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.modelEvaluation?.runners).toHaveLength(1);
    expect(dto.modelEvaluation?.runners[0].candidateId).toBe("model-b");
  });

  it("places disqualified models in the disqualified list with reasons", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.modelEvaluation?.disqualified).toHaveLength(1);
    expect(dto.modelEvaluation?.disqualified[0].candidateId).toBe("model-c");
    expect(dto.modelEvaluation?.disqualified[0].disqualificationReasons).toHaveLength(1);
  });

  it("includes dimension scores on the winner", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    const winner = dto.modelEvaluation?.winner!;
    expect(winner.dimensionScores).toHaveProperty("quality");
    expect(winner.dimensionScores).toHaveProperty("cost");
    expect(winner.dimensionScores).toHaveProperty("capabilityFit");
    expect(winner.dimensionScores).toHaveProperty("contextWindowSufficiency");
  });

  it("sets winner to null when selectedModelId is absent", () => {
    const d = makeDecision({ selectedModelId: undefined });
    const dto = buildDecisionDetailDto(d, makeEvaluation());
    expect(dto.modelEvaluation?.winner).toBeNull();
  });
});

describe("buildDecisionDetailDto — worker evaluation section", () => {
  it("populates workerEvaluation when evaluation is provided", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.workerEvaluation).toBeDefined();
  });

  it("sets the winner to the selected worker", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.workerEvaluation?.winner?.candidateId).toBe("worker-a");
  });

  it("places disqualified workers in the disqualified list", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    expect(dto.workerEvaluation?.disqualified).toHaveLength(1);
    expect(dto.workerEvaluation?.disqualified[0].candidateId).toBe("worker-b");
  });

  it("includes worker-specific dimension scores", () => {
    const dto = buildDecisionDetailDto(makeDecision(), makeEvaluation());
    const winner = dto.workerEvaluation?.winner!;
    expect(winner.dimensionScores).toHaveProperty("load");
    expect(winner.dimensionScores).toHaveProperty("healthFitness");
    expect(winner.dimensionScores).toHaveProperty("heartbeatFreshness");
    expect(winner.dimensionScores).toHaveProperty("regionFit");
  });
});

// ─── DecisionHistoryService.getDecisionDetail ─────────────────────────────────

describe("getDecisionDetail", () => {
  it("fetches the decision and evaluation then returns a dto", async () => {
    const dto = await svc.getDecisionDetail(ctx, "decision-1");
    expect(dto.id).toBe("decision-1");
    expect(getDecision).toHaveBeenCalledWith(ctx, "decision-1");
    expect(findByDecisionId).toHaveBeenCalledWith("decision-1");
  });

  it("returns dto with evaluation when evaluation exists", async () => {
    const dto = await svc.getDecisionDetail(ctx, "decision-1");
    expect(dto.modelEvaluation).toBeDefined();
    expect(dto.workerEvaluation).toBeDefined();
  });

  it("returns dto without evaluation sections when evaluation is absent", async () => {
    findByDecisionId.mockResolvedValue(null);
    const dto = await svc.getDecisionDetail(ctx, "decision-1");
    expect(dto.modelEvaluation).toBeUndefined();
    expect(dto.workerEvaluation).toBeUndefined();
  });

  it("propagates NotFoundError when decision does not exist", async () => {
    getDecision.mockRejectedValue(new NotFoundError("Routing decision ghost"));
    await expect(svc.getDecisionDetail(ctx, "ghost")).rejects.toThrow(NotFoundError);
  });
});

// ─── DecisionHistoryService.listDecisionDetails ───────────────────────────────

describe("listDecisionDetails", () => {
  it("returns paginated list with enriched DTOs", async () => {
    const result = await svc.listDecisionDetails(ctx, { page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("decision-1");
    expect(result.total).toBe(1);
  });

  it("fetches evaluation for each item in the list", async () => {
    await svc.listDecisionDetails(ctx, { page: 1, limit: 20 });
    expect(findByDecisionId).toHaveBeenCalledOnce();
  });

  it("preserves pagination metadata from the underlying service", async () => {
    listDecisions.mockResolvedValue({
      items: [],
      total: 42,
      page: 3,
      limit: 10,
      hasMore: true,
    });
    const result = await svc.listDecisionDetails(ctx, { page: 3, limit: 10 });
    expect(result.total).toBe(42);
    expect(result.page).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it("passes query filters through to listDecisions", async () => {
    const query = { page: 1, limit: 5, jobId: "job-x", selectedModelId: "model-z" };
    await svc.listDecisionDetails(ctx, query);
    expect(listDecisions).toHaveBeenCalledWith(ctx, query);
  });
});

// ─── InMemoryDecisionRepository — new filter coverage ─────────────────────────

describe("InMemoryDecisionRepository — jobId / selectedModelId / selectedWorkerId filters", () => {
  let repo: InMemoryDecisionRepository;

  beforeEach(async () => {
    repo = new InMemoryDecisionRepository();

    await repo.save(makeDecision({
      id: "d1" as DecisionId,
      jobId: "job-1" as any,
      selectedModelId: "model-a" as ModelId,
      selectedWorkerId: "worker-a" as WorkerId,
    }));
    await repo.save(makeDecision({
      id: "d2" as DecisionId,
      jobId: "job-1" as any,
      selectedModelId: "model-b" as ModelId,
      selectedWorkerId: "worker-b" as WorkerId,
    }));
    await repo.save(makeDecision({
      id: "d3" as DecisionId,
      jobId: "job-2" as any,
      selectedModelId: "model-a" as ModelId,
      selectedWorkerId: "worker-a" as WorkerId,
    }));
  });

  it("filters by jobId", async () => {
    const result = await repo.list({ page: 1, limit: 20, jobId: "job-1" });
    expect(result.total).toBe(2);
    expect(result.items.map((d) => d.id).sort()).toEqual(["d1", "d2"].sort());
  });

  it("filters by selectedModelId", async () => {
    const result = await repo.list({ page: 1, limit: 20, selectedModelId: "model-a" });
    expect(result.total).toBe(2);
    expect(result.items.map((d) => d.id).sort()).toEqual(["d1", "d3"].sort());
  });

  it("filters by selectedWorkerId", async () => {
    const result = await repo.list({ page: 1, limit: 20, selectedWorkerId: "worker-b" });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("d2");
  });

  it("combines jobId + selectedModelId filters correctly", async () => {
    const result = await repo.list({ page: 1, limit: 20, jobId: "job-1", selectedModelId: "model-a" });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("d1");
  });

  it("returns empty list when no decisions match jobId", async () => {
    const result = await repo.list({ page: 1, limit: 20, jobId: "job-999" });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("findById still works for decisions with jobId index", async () => {
    const found = await repo.findById("d1" as DecisionId);
    expect(found?.id).toBe("d1");
  });
});
