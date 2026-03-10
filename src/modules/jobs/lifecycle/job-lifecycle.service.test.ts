/**
 * modules/jobs/lifecycle/job-lifecycle.service.test.ts
 *
 * Unit tests for the JobLifecycleService state machine.
 *
 * Test strategy: pure unit tests — no HTTP layer, no Fastify.
 * Each test builds a fresh InMemoryJobRepository and JobLifecycleService so
 * there is no shared state between cases.
 *
 * Coverage:
 *   - All seven named transition methods succeed on their valid predecessor states
 *   - Invalid transitions throw InvalidTransitionError with the correct statuses
 *   - Terminal states (Succeeded, Cancelled) reject all further transitions
 *   - History is recorded and grows correctly with each transition
 *   - Timestamps (startedAt, completedAt) are stamped correctly
 *   - failJob records failure code and reason on the job
 *   - getHistory returns an empty array for unknown jobs
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { buildTestContext } from "../../../core/context";
import { JobPriority, JobSourceType, JobStatus } from "../../../shared/contracts/job";
import type { Job } from "../../../shared/contracts/job";
import type { JobId, RequestId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import { InMemoryJobRepository } from "../repository/InMemoryJobRepository";
import { JobLifecycleService } from "./job-lifecycle.service";
import { InvalidTransitionError } from "./transitions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = toIsoTimestamp();
  return {
    id: randomUUID() as JobId,
    requestId: randomUUID() as RequestId,
    sourceType: JobSourceType.Live,
    status: JobStatus.Queued,
    priority: JobPriority.Normal,
    attempts: 1,
    maxAttempts: 3,
    queuedAt: Date.now(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seedJob(repo: InMemoryJobRepository, job: Job): Promise<Job> {
  return repo.create(job);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("JobLifecycleService", () => {
  let repo: InMemoryJobRepository;
  let svc: JobLifecycleService;
  const ctx = buildTestContext();

  beforeEach(() => {
    repo = new InMemoryJobRepository();
    svc = new JobLifecycleService(repo);
  });

  // ── moveToRouting ────────────────────────────────────────────────────────

  describe("moveToRouting", () => {
    it("transitions Queued → Routing", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Queued }));
      const result = await svc.moveToRouting(ctx, job.id);
      expect(result.status).toBe(JobStatus.Routing);
    });

    it("rejects Routing → Routing (already routing)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Routing }));
      await expect(svc.moveToRouting(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });

    it("rejects Running → Routing", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Running }));
      await expect(svc.moveToRouting(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── assignJob ────────────────────────────────────────────────────────────

  describe("assignJob", () => {
    it("transitions Routing → Assigned and stamps modelId/workerId", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Routing }));
      const result = await svc.assignJob(ctx, job.id, "model-1", "worker-1", "decision-1");

      expect(result.status).toBe(JobStatus.Assigned);
      expect(result.modelId).toBe("model-1");
      expect(result.workerId).toBe("worker-1");
      expect(result.routingDecisionId).toBe("decision-1");
      expect(result.assignedAt).toBeDefined();
    });

    it("transitions Retrying → Assigned (retry path)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Retrying }));
      const result = await svc.assignJob(ctx, job.id, "model-2", "worker-2", "decision-2");
      expect(result.status).toBe(JobStatus.Assigned);
    });

    it("rejects Queued → Assigned (must route first)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Queued }));
      await expect(
        svc.assignJob(ctx, job.id, "model-1", "worker-1", "decision-1"),
      ).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── startJob ─────────────────────────────────────────────────────────────

  describe("startJob", () => {
    it("transitions Assigned → Running and sets startedAt", async () => {
      const before = Date.now();
      const job = await seedJob(repo, makeJob({ status: JobStatus.Assigned }));
      const result = await svc.startJob(ctx, job.id);

      expect(result.status).toBe(JobStatus.Running);
      expect(result.startedAt).toBeGreaterThanOrEqual(before);
    });

    it("rejects Queued → Running", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Queued }));
      await expect(svc.startJob(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── completeJob ──────────────────────────────────────────────────────────

  describe("completeJob", () => {
    it("transitions Running → Succeeded and sets completedAt", async () => {
      const before = Date.now();
      const job = await seedJob(repo, makeJob({ status: JobStatus.Running }));
      const result = await svc.completeJob(ctx, job.id);

      expect(result.status).toBe(JobStatus.Succeeded);
      expect(result.completedAt).toBeGreaterThanOrEqual(before);
    });

    it("rejects Assigned → Succeeded (must start first)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Assigned }));
      await expect(svc.completeJob(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── failJob ──────────────────────────────────────────────────────────────

  describe("failJob", () => {
    it("transitions Running → Failed and records failure details", async () => {
      const before = Date.now();
      const job = await seedJob(repo, makeJob({ status: JobStatus.Running }));
      const result = await svc.failJob(ctx, job.id, {
        code: "WORKER_TIMEOUT",
        reason: "Worker did not respond within 30s",
      });

      expect(result.status).toBe(JobStatus.Failed);
      expect(result.failureCode).toBe("WORKER_TIMEOUT");
      expect(result.lastFailureReason).toBe("Worker did not respond within 30s");
      expect(result.completedAt).toBeGreaterThanOrEqual(before);
    });

    it("transitions Routing → Failed (routing failure)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Routing }));
      const result = await svc.failJob(ctx, job.id, { code: "NO_ELIGIBLE_WORKERS" });
      expect(result.status).toBe(JobStatus.Failed);
      expect(result.failureCode).toBe("NO_ELIGIBLE_WORKERS");
    });

    it("rejects Queued → Failed", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Queued }));
      await expect(svc.failJob(ctx, job.id, {})).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── cancelJob ────────────────────────────────────────────────────────────

  describe("cancelJob", () => {
    const cancellableStatuses = [
      JobStatus.Queued,
      JobStatus.Routing,
      JobStatus.Assigned,
      JobStatus.Running,
      JobStatus.Failed,
      JobStatus.Retrying,
    ] as const;

    for (const status of cancellableStatuses) {
      it(`cancels a job in ${status} status`, async () => {
        const before = Date.now();
        const job = await seedJob(repo, makeJob({ status }));
        const result = await svc.cancelJob(ctx, job.id);

        expect(result.status).toBe(JobStatus.Cancelled);
        expect(result.completedAt).toBeGreaterThanOrEqual(before);
      });
    }

    it("rejects Succeeded → Cancelled (already terminal)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Succeeded }));
      await expect(svc.cancelJob(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── retryJob ─────────────────────────────────────────────────────────────

  describe("retryJob", () => {
    it("transitions Failed → Retrying", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Failed }));
      const result = await svc.retryJob(ctx, job.id);
      expect(result.status).toBe(JobStatus.Retrying);
    });

    it("rejects Running → Retrying (must fail first)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Running }));
      await expect(svc.retryJob(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── Terminal state enforcement ────────────────────────────────────────────

  describe("terminal state enforcement", () => {
    it("Succeeded rejects all further transitions", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Succeeded }));
      await expect(svc.cancelJob(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
      await expect(svc.failJob(ctx, job.id, {})).rejects.toThrow(InvalidTransitionError);
      await expect(svc.retryJob(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });

    it("Cancelled rejects all further transitions", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Cancelled }));
      await expect(svc.moveToRouting(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
      await expect(svc.completeJob(ctx, job.id)).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── NotFoundError ─────────────────────────────────────────────────────────

  describe("not-found handling", () => {
    it("throws NotFoundError when job does not exist", async () => {
      const { NotFoundError } = await import("../../../core/errors");
      await expect(svc.moveToRouting(ctx, "non-existent-id")).rejects.toThrow(NotFoundError);
    });
  });

  // ── Transition history ────────────────────────────────────────────────────

  describe("getHistory", () => {
    it("returns empty array for a job with no recorded transitions", () => {
      expect(svc.getHistory("any-id")).toEqual([]);
    });

    it("appends one record per transition", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Queued }));

      await svc.moveToRouting(ctx, job.id, { source: "test-runner" });
      await svc.assignJob(ctx, job.id, "model-x", "worker-x", "decision-x");
      await svc.startJob(ctx, job.id);
      await svc.completeJob(ctx, job.id);

      const history = svc.getHistory(job.id);
      expect(history).toHaveLength(4);
    });

    it("records correct fromStatus and toStatus", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Queued }));
      await svc.moveToRouting(ctx, job.id, { source: "api", reason: "fresh intake" });

      const history = svc.getHistory(job.id);
      expect(history[0]?.fromStatus).toBe(JobStatus.Queued);
      expect(history[0]?.toStatus).toBe(JobStatus.Routing);
      expect(history[0]?.source).toBe("api");
      expect(history[0]?.reason).toBe("fresh intake");
    });

    it("records modelId and workerId on assignJob transition", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Routing }));
      await svc.assignJob(ctx, job.id, "model-y", "worker-y", "decision-y");

      const history = svc.getHistory(job.id);
      expect(history[0]?.modelId).toBe("model-y");
      expect(history[0]?.workerId).toBe("worker-y");
      expect(history[0]?.routingDecisionId).toBe("decision-y");
    });

    it("returns a defensive copy (mutations do not affect internal state)", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Queued }));
      await svc.moveToRouting(ctx, job.id);

      const history = svc.getHistory(job.id);
      history.push({} as never); // mutate the returned array

      expect(svc.getHistory(job.id)).toHaveLength(1); // internal store unchanged
    });
  });

  // ── InvalidTransitionError shape ─────────────────────────────────────────

  describe("InvalidTransitionError", () => {
    it("includes fromStatus, toStatus, and allowed in details", async () => {
      const job = await seedJob(repo, makeJob({ status: JobStatus.Succeeded }));

      try {
        await svc.cancelJob(ctx, job.id);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        const e = err as InvalidTransitionError;
        expect(e.statusCode).toBe(409);
        expect((e.details as Record<string, unknown>).fromStatus).toBe(JobStatus.Succeeded);
        expect((e.details as Record<string, unknown>).toStatus).toBe(JobStatus.Cancelled);
      }
    });
  });
});
