/**
 * modules/jobs/orchestration/job-routing.service.test.ts
 *
 * Unit tests for JobRoutingService.
 *
 * All three dependencies (JobsService, JobLifecycleService, RoutingDecisionService)
 * are provided as vi.fn() mocks so each test has full control over return values.
 * No real repositories or evaluators are involved — this is a pure orchestration test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import type { Job } from "../../../shared/contracts/job";
import { JobPriority, JobSourceType, JobStatus } from "../../../shared/contracts/job";
import {
  DecisionSource,
  RoutingOutcome,
  RoutingStrategy,
} from "../../../shared/contracts/routing";
import type { JobId, RequestId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { JobsService } from "../service/jobs.service";
import type { JobLifecycleService } from "../lifecycle/job-lifecycle.service";
import type { RoutingDecisionService } from "../../routing/decision/routing-decision.service";
import type { DecideRouteResult } from "../../routing/decision/routing-decision.contract";
import {
  NoActivePolicyError,
  NoEligibleModelError,
  NoEligibleWorkerError,
} from "../../routing/decision/routing-decision.contract";
import { JobRoutingService } from "./job-routing.service";
import { JobNotRoutableError } from "./job-routing.contract";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1" as JobId,
    requestId: "req-1" as RequestId,
    sourceType: JobSourceType.Live,
    status: JobStatus.Queued,
    priority: JobPriority.Normal,
    attempts: 1,
    maxAttempts: 3,
    queuedAt: Date.now(),
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
    ...overrides,
  };
}

function makeDecideRouteResult(overrides: Partial<DecideRouteResult> = {}): DecideRouteResult {
  return {
    decision: {
      id: "decision-1" as any,
      requestId: "req-1" as any,
      jobId: "job-1" as any,
      policyId: "policy-1" as any,
      outcome: RoutingOutcome.Routed,
      selectedModelId: "model-1" as any,
      selectedWorkerId: "worker-1" as any,
      strategy: RoutingStrategy.LeastLoaded,
      usedFallback: false,
      candidates: [],
      reason: "Model model-1; Worker worker-1",
      decisionSource: DecisionSource.Live,
      decidedAt: Date.now(),
      evaluationMs: 12,
      createdAt: toIsoTimestamp(),
      updatedAt: toIsoTimestamp(),
    },
    modelScores: [],
    workerScores: [],
    modelSummary: {
      selectedModelId: "model-1",
      totalCandidates: 2,
      eligibleCount: 2,
      topScore: 0.85,
      explanation: ["quality: 0.85", "cost: 0.70"],
    },
    workerSummary: {
      selectedWorkerId: "worker-1",
      totalCandidates: 1,
      eligibleCount: 1,
      topScore: 0.90,
      explanation: ["load: 0.95", "latency: 0.80"],
    },
    evaluationMs: 12,
    ...overrides,
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const ctx = buildTestContext();

let getById: ReturnType<typeof vi.fn>;
let moveToRouting: ReturnType<typeof vi.fn>;
let assignJob: ReturnType<typeof vi.fn>;
let failJob: ReturnType<typeof vi.fn>;
let decideRoute: ReturnType<typeof vi.fn>;
let svc: JobRoutingService;

function buildSvc(queuedJob: Job = makeJob()) {
  const assignedJob: Job = { ...queuedJob, status: JobStatus.Assigned };

  getById = vi.fn().mockResolvedValue(queuedJob);
  moveToRouting = vi.fn().mockResolvedValue({ ...queuedJob, status: JobStatus.Routing });
  assignJob = vi.fn().mockResolvedValue(assignedJob);
  failJob = vi.fn().mockResolvedValue({ ...queuedJob, status: JobStatus.Failed });
  decideRoute = vi.fn().mockResolvedValue(makeDecideRouteResult());

  svc = new JobRoutingService(
    { getById } as unknown as JobsService,
    { moveToRouting, assignJob, failJob } as unknown as JobLifecycleService,
    { decideRoute } as unknown as RoutingDecisionService,
  );
}

beforeEach(() => buildSvc());

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("routeJob — happy path", () => {
  it("returns a RouteJobResult with the assigned job and decision", async () => {
    const result = await svc.routeJob(ctx, { jobId: "job-1" });
    expect(result.job.status).toBe(JobStatus.Assigned);
    expect(result.decision.selectedModelId).toBe("model-1");
    expect(result.decision.selectedWorkerId).toBe("worker-1");
  });

  it("returns modelSummary and workerSummary from the decision result", async () => {
    const result = await svc.routeJob(ctx, { jobId: "job-1" });
    expect(result.modelSummary.selectedModelId).toBe("model-1");
    expect(result.workerSummary.selectedWorkerId).toBe("worker-1");
    expect(result.evaluationMs).toBe(12);
  });

  it("calls moveToRouting before decideRoute", async () => {
    const order: string[] = [];
    moveToRouting.mockImplementation(async () => { order.push("moveToRouting"); return makeJob(); });
    decideRoute.mockImplementation(async () => { order.push("decideRoute"); return makeDecideRouteResult(); });

    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(order).toEqual(["moveToRouting", "decideRoute"]);
  });

  it("calls assignJob with the selected model, worker, and decision IDs", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(assignJob).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      "model-1",
      "worker-1",
      "decision-1",
      expect.objectContaining({ source: "job_routing_service" }),
    );
  });

  it("passes decisionSource through to decideRoute", async () => {
    await svc.routeJob(ctx, { jobId: "job-1", decisionSource: DecisionSource.Simulation });
    expect(decideRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decisionSource: DecisionSource.Simulation }),
    );
  });

  it("defaults decisionSource to Live when not provided", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(decideRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decisionSource: DecisionSource.Live }),
    );
  });

  it("passes policyOverride through to decideRoute", async () => {
    await svc.routeJob(ctx, { jobId: "job-1", policyOverride: "latency-v2" });
    expect(decideRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ policyOverride: "latency-v2" }),
    );
  });

  it("includes job requestId and jobId in the decideRoute input", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(decideRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: "req-1", jobId: "job-1" }),
    );
  });

  it("does not call failJob on success", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(failJob).not.toHaveBeenCalled();
  });
});

// ─── State validation ─────────────────────────────────────────────────────────

describe("routeJob — state validation", () => {
  it("throws JobNotRoutableError when job is in Routing status", async () => {
    buildSvc(makeJob({ status: JobStatus.Routing }));
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(JobNotRoutableError);
  });

  it("throws JobNotRoutableError when job is in Assigned status", async () => {
    buildSvc(makeJob({ status: JobStatus.Assigned }));
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(JobNotRoutableError);
  });

  it("throws JobNotRoutableError when job is Failed", async () => {
    buildSvc(makeJob({ status: JobStatus.Failed }));
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(JobNotRoutableError);
  });

  it("throws NotFoundError when job does not exist", async () => {
    getById.mockRejectedValue(new NotFoundError("Job job-x"));
    await expect(svc.routeJob(ctx, { jobId: "job-x" })).rejects.toThrow(NotFoundError);
  });

  it("does not call moveToRouting when job is in an invalid state", async () => {
    buildSvc(makeJob({ status: JobStatus.Running }));
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(moveToRouting).not.toHaveBeenCalled();
  });
});

// ─── Routing failure behavior ─────────────────────────────────────────────────

describe("routeJob — routing failure behavior", () => {
  it("calls failJob and re-throws when decideRoute throws NoEligibleModelError", async () => {
    const err = new NoEligibleModelError("No models available");
    decideRoute.mockRejectedValue(err);
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(NoEligibleModelError);
    expect(failJob).toHaveBeenCalledOnce();
  });

  it("calls failJob and re-throws when decideRoute throws NoEligibleWorkerError", async () => {
    const err = new NoEligibleWorkerError("No workers available");
    decideRoute.mockRejectedValue(err);
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(NoEligibleWorkerError);
    expect(failJob).toHaveBeenCalledOnce();
  });

  it("calls failJob and re-throws when decideRoute throws NoActivePolicyError", async () => {
    const err = new NoActivePolicyError();
    decideRoute.mockRejectedValue(err);
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(NoActivePolicyError);
    expect(failJob).toHaveBeenCalledOnce();
  });

  it("stamps NO_ELIGIBLE_MODEL code on the job when model routing fails", async () => {
    decideRoute.mockRejectedValue(new NoEligibleModelError("none"));
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(failJob).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({ code: "NO_ELIGIBLE_MODEL" }),
      expect.anything(),
    );
  });

  it("stamps NO_ELIGIBLE_WORKER code on the job when worker routing fails", async () => {
    decideRoute.mockRejectedValue(new NoEligibleWorkerError("none"));
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(failJob).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({ code: "NO_ELIGIBLE_WORKER" }),
      expect.anything(),
    );
  });

  it("stamps NO_ACTIVE_POLICY code on the job when no policy is active", async () => {
    decideRoute.mockRejectedValue(new NoActivePolicyError());
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(failJob).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({ code: "NO_ACTIVE_POLICY" }),
      expect.anything(),
    );
  });

  it("does not call assignJob when routing fails", async () => {
    decideRoute.mockRejectedValue(new NoEligibleModelError("none"));
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(assignJob).not.toHaveBeenCalled();
  });
});
