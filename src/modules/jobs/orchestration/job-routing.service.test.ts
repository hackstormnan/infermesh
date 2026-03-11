/**
 * modules/jobs/orchestration/job-routing.service.test.ts
 *
 * Unit tests for JobRoutingService (T17 + T18).
 *
 * All three dependencies (JobsService, JobLifecycleService, RoutingRecoveryService)
 * are provided as vi.fn() mocks. Tests are organised by scenario:
 *
 *   - happy path (AssignedJobOutcome)
 *   - state validation (JobNotRoutableError)
 *   - retrying-job path (Retrying → Assigned directly)
 *   - retry scheduling (retryable failure → RetryingJobOutcome)
 *   - retry exhaustion (attempts >= maxAttempts → terminal)
 *   - non-retryable terminal failures
 *   - fallback routing (recovery.info present on AssignedJobOutcome)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import { NotFoundError } from "../../../core/errors";
import type { Job } from "../../../shared/contracts/job";
import { JobPriority, JobSourceType, JobStatus } from "../../../shared/contracts/job";
import { DecisionSource, RoutingOutcome, RoutingStrategy } from "../../../shared/contracts/routing";
import type { JobId, RequestId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { JobsService } from "../service/jobs.service";
import type { JobLifecycleService } from "../lifecycle/job-lifecycle.service";
import type { RoutingRecoveryService } from "./recovery/routing-recovery.service";
import type { RecoveryOutcome } from "./recovery/routing-recovery.contract";
import { RoutingFailureClass } from "./recovery/routing-recovery.contract";
import {
  NoActivePolicyError,
  NoEligibleModelError,
  NoEligibleWorkerError,
} from "../../routing/decision/routing-decision.contract";
import { JobRoutingService } from "./job-routing.service";
import { JobNotRoutableError } from "./job-routing.contract";
import type { AssignedJobOutcome, RetryingJobOutcome } from "./job-routing.contract";

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

function makeSuccessRecovery(overrides: Partial<RecoveryOutcome> = {}): RecoveryOutcome {
  return {
    status: "succeeded",
    result: {
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
        reason: "test",
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
      evaluationMs: 12,
    },
    ...overrides,
  };
}

function makeFailedRecovery(
  failureClass: RoutingFailureClass,
  retryEligible: boolean,
  error: Error,
): RecoveryOutcome {
  return {
    status: "failed",
    info: {
      primaryFailureClass: failureClass,
      primaryFailureReason: error.message,
      usedFallback: false,
      totalAttempts: 1,
    },
    error,
    retryEligible,
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const ctx = buildTestContext();

let getById: ReturnType<typeof vi.fn>;
let moveToRouting: ReturnType<typeof vi.fn>;
let assignJob: ReturnType<typeof vi.fn>;
let failJob: ReturnType<typeof vi.fn>;
let retryJob: ReturnType<typeof vi.fn>;
let incrementRetryCount: ReturnType<typeof vi.fn>;
let attemptWithRecovery: ReturnType<typeof vi.fn>;
let svc: JobRoutingService;

function buildSvc(queuedJob: Job = makeJob()) {
  const assignedJob: Job = { ...queuedJob, status: JobStatus.Assigned };
  const failedJob: Job = { ...queuedJob, status: JobStatus.Failed };
  const retryingJob: Job = { ...queuedJob, status: JobStatus.Retrying };

  getById = vi.fn().mockResolvedValue(queuedJob);
  moveToRouting = vi.fn().mockResolvedValue({ ...queuedJob, status: JobStatus.Routing });
  assignJob = vi.fn().mockResolvedValue(assignedJob);
  failJob = vi.fn().mockResolvedValue(failedJob);
  retryJob = vi.fn().mockResolvedValue(retryingJob);
  incrementRetryCount = vi.fn().mockResolvedValue({ ...queuedJob, attempts: queuedJob.attempts + 1 });
  attemptWithRecovery = vi.fn().mockResolvedValue(makeSuccessRecovery());

  svc = new JobRoutingService(
    { getById, incrementRetryCount } as unknown as JobsService,
    { moveToRouting, assignJob, failJob, retryJob } as unknown as JobLifecycleService,
    { attemptWithRecovery } as unknown as RoutingRecoveryService,
  );
}

beforeEach(() => buildSvc());

// ─── Happy path (AssignedJobOutcome) ──────────────────────────────────────────

describe("routeJob — happy path", () => {
  it("returns outcome=assigned with the assigned job and decision", async () => {
    const result = await svc.routeJob(ctx, { jobId: "job-1" });
    expect(result.outcome).toBe("assigned");
    const r = result as AssignedJobOutcome;
    expect(r.job.status).toBe(JobStatus.Assigned);
    expect(r.decision.selectedModelId).toBe("model-1");
    expect(r.decision.selectedWorkerId).toBe("worker-1");
  });

  it("returns modelSummary and workerSummary from the recovery result", async () => {
    const result = await svc.routeJob(ctx, { jobId: "job-1" }) as AssignedJobOutcome;
    expect(result.modelSummary.selectedModelId).toBe("model-1");
    expect(result.workerSummary.selectedWorkerId).toBe("worker-1");
    expect(result.evaluationMs).toBe(12);
  });

  it("calls moveToRouting before attemptWithRecovery", async () => {
    const order: string[] = [];
    moveToRouting.mockImplementation(async () => { order.push("moveToRouting"); return {}; });
    attemptWithRecovery.mockImplementation(async () => { order.push("attemptWithRecovery"); return makeSuccessRecovery(); });
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(order).toEqual(["moveToRouting", "attemptWithRecovery"]);
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

  it("passes decisionSource through to attemptWithRecovery", async () => {
    await svc.routeJob(ctx, { jobId: "job-1", decisionSource: DecisionSource.Simulation });
    expect(attemptWithRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decisionSource: DecisionSource.Simulation }),
    );
  });

  it("defaults decisionSource to Live", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(attemptWithRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decisionSource: DecisionSource.Live }),
    );
  });

  it("passes policyOverride through to attemptWithRecovery", async () => {
    await svc.routeJob(ctx, { jobId: "job-1", policyOverride: "latency-v2" });
    expect(attemptWithRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ policyOverride: "latency-v2" }),
    );
  });

  it("does not call failJob or retryJob on success", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(failJob).not.toHaveBeenCalled();
    expect(retryJob).not.toHaveBeenCalled();
  });

  it("includes recovery info when fallback was used", async () => {
    const recoveryWithFallback = makeSuccessRecovery();
    (recoveryWithFallback as any).info = {
      primaryFailureClass: RoutingFailureClass.NoEligibleWorker,
      primaryFailureReason: "none",
      usedFallback: true,
      totalAttempts: 2,
    };
    attemptWithRecovery.mockResolvedValue(recoveryWithFallback);

    const result = await svc.routeJob(ctx, { jobId: "job-1" }) as AssignedJobOutcome;
    expect(result.recovery).toBeDefined();
    expect(result.recovery?.usedFallback).toBe(true);
  });

  it("throws when the routing decision is missing selectedModelId or selectedWorkerId", async () => {
    const incomplete = makeSuccessRecovery();
    (incomplete.result.decision as any).selectedModelId = undefined;
    attemptWithRecovery.mockResolvedValue(incomplete);
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(
      "Routing decision returned without model or worker selection",
    );
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

  it("throws JobNotRoutableError when job is in Failed status", async () => {
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

// ─── Retrying-job path ────────────────────────────────────────────────────────

describe("routeJob — Retrying job (retry attempt)", () => {
  it("accepts a Retrying job and skips moveToRouting", async () => {
    buildSvc(makeJob({ status: JobStatus.Retrying, attempts: 2 }));
    const result = await svc.routeJob(ctx, { jobId: "job-1" });
    expect(result.outcome).toBe("assigned");
    expect(moveToRouting).not.toHaveBeenCalled();
  });

  it("calls assignJob directly (Retrying → Assigned)", async () => {
    buildSvc(makeJob({ status: JobStatus.Retrying, attempts: 2 }));
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(assignJob).toHaveBeenCalledOnce();
  });

  it("still calls attemptWithRecovery for the retry attempt", async () => {
    buildSvc(makeJob({ status: JobStatus.Retrying, attempts: 2 }));
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(attemptWithRecovery).toHaveBeenCalledOnce();
  });
});

// ─── Retry scheduling ─────────────────────────────────────────────────────────

describe("routeJob — retry scheduling (retryable failure, attempts remaining)", () => {
  beforeEach(() => {
    // attempts=1, maxAttempts=3 → can retry
    buildSvc(makeJob({ attempts: 1, maxAttempts: 3 }));
    attemptWithRecovery.mockResolvedValue(
      makeFailedRecovery(RoutingFailureClass.NoEligibleWorker, true, new NoEligibleWorkerError("all busy")),
    );
  });

  it("returns outcome=retrying", async () => {
    const result = await svc.routeJob(ctx, { jobId: "job-1" });
    expect(result.outcome).toBe("retrying");
  });

  it("calls failJob then retryJob", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(failJob).toHaveBeenCalledOnce();
    expect(retryJob).toHaveBeenCalledOnce();
  });

  it("calls incrementRetryCount after scheduling retry", async () => {
    await svc.routeJob(ctx, { jobId: "job-1" });
    expect(incrementRetryCount).toHaveBeenCalledWith(expect.anything(), "job-1");
  });

  it("returns the correct nextAttemptNumber", async () => {
    const result = await svc.routeJob(ctx, { jobId: "job-1" }) as RetryingJobOutcome;
    expect(result.nextAttemptNumber).toBe(2); // attempts=1 → next=2
  });

  it("includes recovery info on the retrying outcome", async () => {
    const result = await svc.routeJob(ctx, { jobId: "job-1" }) as RetryingJobOutcome;
    expect(result.recovery.primaryFailureClass).toBe(RoutingFailureClass.NoEligibleWorker);
    expect(result.retryReason).toContain("all busy");
  });

  it("does not throw — returns gracefully", async () => {
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).resolves.toBeDefined();
  });

  it("outcome.job.attempts reflects the post-increment value", async () => {
    // incrementRetryCount mock returns attempts+1; the returned job should match
    const result = await svc.routeJob(ctx, { jobId: "job-1" }) as RetryingJobOutcome;
    expect(result.job.attempts).toBe(2); // 1 (initial) + 1 (incremented)
  });
});

// ─── Retry exhaustion (terminal) ──────────────────────────────────────────────

describe("routeJob — retry exhaustion", () => {
  beforeEach(() => {
    // attempts=3, maxAttempts=3 → exhausted
    buildSvc(makeJob({ attempts: 3, maxAttempts: 3 }));
    attemptWithRecovery.mockResolvedValue(
      makeFailedRecovery(RoutingFailureClass.NoEligibleWorker, true, new NoEligibleWorkerError("all busy")),
    );
  });

  it("throws the original routing error when retries are exhausted", async () => {
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(NoEligibleWorkerError);
  });

  it("calls failJob but NOT retryJob when exhausted", async () => {
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(failJob).toHaveBeenCalledOnce();
    expect(retryJob).not.toHaveBeenCalled();
  });

  it("does not call incrementRetryCount when exhausted", async () => {
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(incrementRetryCount).not.toHaveBeenCalled();
  });
});

// ─── Non-retryable terminal failures ─────────────────────────────────────────

describe("routeJob — non-retryable terminal failures", () => {
  it("throws NoActivePolicyError (PolicyBlocked, not retryable)", async () => {
    const err = new NoActivePolicyError();
    attemptWithRecovery.mockResolvedValue(
      makeFailedRecovery(RoutingFailureClass.PolicyBlocked, false, err),
    );
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(NoActivePolicyError);
  });

  it("calls failJob but not retryJob for non-retryable failures", async () => {
    const err = new NoActivePolicyError();
    attemptWithRecovery.mockResolvedValue(
      makeFailedRecovery(RoutingFailureClass.PolicyBlocked, false, err),
    );
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow();
    expect(failJob).toHaveBeenCalledOnce();
    expect(retryJob).not.toHaveBeenCalled();
  });

  it("throws NoEligibleModelError when model retry is also exhausted", async () => {
    buildSvc(makeJob({ attempts: 3, maxAttempts: 3 }));
    const err = new NoEligibleModelError("no models registered");
    attemptWithRecovery.mockResolvedValue(
      makeFailedRecovery(RoutingFailureClass.NoEligibleModel, true, err),
    );
    await expect(svc.routeJob(ctx, { jobId: "job-1" })).rejects.toThrow(NoEligibleModelError);
  });
});
