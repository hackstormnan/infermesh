/**
 * modules/jobs/orchestration/recovery/routing-recovery.service.test.ts
 *
 * Unit tests for RoutingRecoveryService.
 *
 * RoutingDecisionService is provided as a vi.fn() mock so each test controls
 * exactly which attempt succeeds or fails. No real routing logic is involved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../../core/context";
import { NotFoundError } from "../../../../core/errors";
import { DecisionSource, RoutingOutcome, RoutingStrategy } from "../../../../shared/contracts/routing";
import { InvalidTransitionError } from "../../lifecycle/transitions";
import { JobStatus } from "../../../../shared/contracts/job";
import type { RoutingDecisionService } from "../../../routing/decision/routing-decision.service";
import type { DecideRouteResult } from "../../../routing/decision/routing-decision.contract";
import {
  NoActivePolicyError,
  NoEligibleModelError,
  NoEligibleWorkerError,
} from "../../../routing/decision/routing-decision.contract";
import { toIsoTimestamp } from "../../../../shared/primitives";
import { RoutingRecoveryService, classifyRoutingFailure } from "./routing-recovery.service";
import { RoutingFailureClass } from "./routing-recovery.contract";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDecideRouteResult(overrides: Partial<DecideRouteResult> = {}): DecideRouteResult {
  return {
    decision: {
      id: "decision-1" as any,
      requestId: "req-1" as any,
      policyId: "policy-1" as any,
      outcome: RoutingOutcome.Routed,
      selectedModelId: "model-1" as any,
      selectedWorkerId: "worker-1" as any,
      strategy: RoutingStrategy.LeastLoaded,
      usedFallback: false,
      candidates: [],
      reason: "test",
      decisionSource: DecisionSource.Live,
      decidedAt: Date.now(),
      evaluationMs: 8,
      createdAt: toIsoTimestamp(),
      updatedAt: toIsoTimestamp(),
    },
    modelScores: [],
    workerScores: [],
    modelSummary: {
      selectedModelId: "model-1",
      totalCandidates: 1,
      eligibleCount: 1,
      topScore: 0.85,
      explanation: ["quality: 0.85"],
    },
    workerSummary: {
      selectedWorkerId: "worker-1",
      totalCandidates: 1,
      eligibleCount: 1,
      topScore: 0.90,
      explanation: ["load: 0.90"],
    },
    evaluationMs: 8,
    ...overrides,
  };
}

const baseInput = {
  requestId: "req-1",
  jobId: "job-1",
  decisionSource: DecisionSource.Live,
};

// ─── Test setup ───────────────────────────────────────────────────────────────

const ctx = buildTestContext();

let decideRoute: ReturnType<typeof vi.fn>;
let svc: RoutingRecoveryService;

beforeEach(() => {
  decideRoute = vi.fn().mockResolvedValue(makeDecideRouteResult());
  svc = new RoutingRecoveryService(
    { decideRoute } as unknown as RoutingDecisionService,
  );
});

// ─── classifyRoutingFailure helper ────────────────────────────────────────────

describe("classifyRoutingFailure", () => {
  it("classifies NoActivePolicyError as PolicyBlocked", () => {
    expect(classifyRoutingFailure(new NoActivePolicyError())).toBe(RoutingFailureClass.PolicyBlocked);
  });

  it("classifies NoEligibleModelError as NoEligibleModel", () => {
    expect(classifyRoutingFailure(new NoEligibleModelError("none"))).toBe(RoutingFailureClass.NoEligibleModel);
  });

  it("classifies NoEligibleWorkerError as NoEligibleWorker", () => {
    expect(classifyRoutingFailure(new NoEligibleWorkerError("none"))).toBe(RoutingFailureClass.NoEligibleWorker);
  });

  it("classifies NotFoundError as PolicyNotFound", () => {
    expect(classifyRoutingFailure(new NotFoundError("policy"))).toBe(RoutingFailureClass.PolicyNotFound);
  });

  it("classifies InvalidTransitionError as AssignmentConflict", () => {
    expect(
      classifyRoutingFailure(new InvalidTransitionError(JobStatus.Assigned, JobStatus.Routing)),
    ).toBe(RoutingFailureClass.AssignmentConflict);
  });

  it("classifies unknown errors as NonRetryable", () => {
    expect(classifyRoutingFailure(new Error("surprise"))).toBe(RoutingFailureClass.NonRetryable);
    expect(classifyRoutingFailure("string error")).toBe(RoutingFailureClass.NonRetryable);
  });
});

// ─── Primary success ──────────────────────────────────────────────────────────

describe("attemptWithRecovery — primary success", () => {
  it("returns status=succeeded with the decision result", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.result.decision.selectedModelId).toBe("model-1");
    }
  });

  it("does not include recovery info when primary succeeds without fallback", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "succeeded") {
      expect(outcome.info).toBeUndefined();
    }
  });

  it("calls decideRoute exactly once on primary success", async () => {
    await svc.attemptWithRecovery(ctx, baseInput);
    expect(decideRoute).toHaveBeenCalledOnce();
  });
});

// ─── Fallback success ─────────────────────────────────────────────────────────

describe("attemptWithRecovery — fallback success (NoEligibleWorker)", () => {
  beforeEach(() => {
    const fallbackResult = makeDecideRouteResult({
      decision: { ...makeDecideRouteResult().decision, selectedWorkerId: "worker-fallback" as any },
    });
    decideRoute
      .mockRejectedValueOnce(new NoEligibleWorkerError("primary workers exhausted"))
      .mockResolvedValueOnce(fallbackResult);
  });

  it("returns status=succeeded after fallback", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    expect(outcome.status).toBe("succeeded");
  });

  it("calls decideRoute twice (primary + fallback)", async () => {
    await svc.attemptWithRecovery(ctx, baseInput);
    expect(decideRoute).toHaveBeenCalledTimes(2);
  });

  it("passes usedFallback=true and fallbackReason to the second decideRoute call", async () => {
    await svc.attemptWithRecovery(ctx, baseInput);
    expect(decideRoute).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        usedFallback: true,
        fallbackReason: expect.any(String),
        workerProfile: {},
      }),
    );
  });

  it("includes recovery info on the succeeded outcome", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "succeeded") {
      expect(outcome.info).toBeDefined();
      expect(outcome.info?.usedFallback).toBe(true);
      expect(outcome.info?.primaryFailureClass).toBe(RoutingFailureClass.NoEligibleWorker);
      expect(outcome.info?.totalAttempts).toBe(2);
    }
  });

  it("strips workerProfile for the fallback call but preserves modelProfile", async () => {
    const inputWithProfiles = {
      ...baseInput,
      modelProfile: { minContextWindow: 8192 },
      workerProfile: { preferredRegion: "us-east-1" },
    };
    await svc.attemptWithRecovery(ctx, inputWithProfiles);
    expect(decideRoute).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        modelProfile: { minContextWindow: 8192 },
        workerProfile: {},
      }),
    );
  });
});

// ─── Non-fallback failures ────────────────────────────────────────────────────

describe("attemptWithRecovery — non-fallback failures", () => {
  it("returns status=failed for NoEligibleModelError without fallback attempt", async () => {
    decideRoute.mockRejectedValue(new NoEligibleModelError("no models"));
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    expect(outcome.status).toBe("failed");
    expect(decideRoute).toHaveBeenCalledOnce();
  });

  it("returns status=failed for NoActivePolicyError without fallback attempt", async () => {
    decideRoute.mockRejectedValue(new NoActivePolicyError());
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    expect(outcome.status).toBe("failed");
    expect(decideRoute).toHaveBeenCalledOnce();
  });

  it("NoEligibleModel is marked retryEligible=true", async () => {
    decideRoute.mockRejectedValue(new NoEligibleModelError("no models"));
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "failed") {
      expect(outcome.retryEligible).toBe(true);
    }
  });

  it("PolicyBlocked is marked retryEligible=false", async () => {
    decideRoute.mockRejectedValue(new NoActivePolicyError());
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "failed") {
      expect(outcome.retryEligible).toBe(false);
    }
  });

  it("PolicyNotFound is marked retryEligible=false", async () => {
    decideRoute.mockRejectedValue(new NotFoundError("policy ghost"));
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "failed") {
      expect(outcome.retryEligible).toBe(false);
    }
  });

  it("records correct failure class in the recovery info", async () => {
    decideRoute.mockRejectedValue(new NoActivePolicyError());
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "failed") {
      expect(outcome.info.primaryFailureClass).toBe(RoutingFailureClass.PolicyBlocked);
      expect(outcome.info.usedFallback).toBe(false);
      expect(outcome.info.totalAttempts).toBe(1);
    }
  });
});

// ─── Fallback also fails ──────────────────────────────────────────────────────

describe("attemptWithRecovery — both primary and fallback fail", () => {
  beforeEach(() => {
    decideRoute
      .mockRejectedValueOnce(new NoEligibleWorkerError("primary workers exhausted"))
      .mockRejectedValueOnce(new NoEligibleWorkerError("fallback workers also exhausted"));
  });

  it("returns status=failed after both attempts fail", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    expect(outcome.status).toBe("failed");
  });

  it("calls decideRoute twice", async () => {
    await svc.attemptWithRecovery(ctx, baseInput);
    expect(decideRoute).toHaveBeenCalledTimes(2);
  });

  it("records both failure classes in the recovery info", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "failed") {
      expect(outcome.info.usedFallback).toBe(true);
      expect(outcome.info.primaryFailureClass).toBe(RoutingFailureClass.NoEligibleWorker);
      expect(outcome.info.fallbackFailureClass).toBe(RoutingFailureClass.NoEligibleWorker);
      expect(outcome.info.totalAttempts).toBe(2);
    }
  });

  it("remains retryEligible=true after fallback exhaustion", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "failed") {
      expect(outcome.retryEligible).toBe(true);
    }
  });

  it("exposes the original primary error on the failed outcome", async () => {
    const outcome = await svc.attemptWithRecovery(ctx, baseInput);
    if (outcome.status === "failed") {
      expect(outcome.error).toBeInstanceOf(NoEligibleWorkerError);
    }
  });
});
