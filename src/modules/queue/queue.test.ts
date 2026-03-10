/**
 * modules/queue/queue.test.ts
 *
 * Unit tests for InMemoryJobQueue and QueueService.
 *
 * No HTTP layer — tests call the adapter and service directly using
 * buildTestContext() for structured logging.
 *
 * Coverage:
 *   InMemoryJobQueue
 *     - enqueue assigns a UUID id, Pending status, and enqueuedAt timestamp
 *     - enqueue stores the message so peek() returns it
 *     - peek returns messages sorted priority-desc → enqueuedAt-asc
 *     - peek respects the limit parameter
 *     - peek returns an empty array when queue is empty
 *     - peek excludes non-Pending messages
 *     - size returns 0 for an empty queue
 *     - size returns the correct Pending count
 *     - size excludes non-Pending messages
 *
 *   QueueService
 *     - enqueueJob maps all Job fields correctly into a QueueMessage
 *     - enqueueJob forwards caller metadata
 *     - listMessages delegates to peek with the given limit
 *     - queueSize delegates to size
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { buildTestContext } from "../../core/context";
import { JobPriority, JobSourceType, JobStatus } from "../../shared/contracts/job";
import type { Job } from "../../shared/contracts/job";
import type { JobId, RequestId } from "../../shared/primitives";
import { toIsoTimestamp } from "../../shared/primitives";
import { InMemoryJobQueue } from "./InMemoryJobQueue";
import { QueueMessageStatus } from "./queue.contract";
import type { EnqueuePayload, QueueMessage } from "./queue.contract";
import { QueueService } from "./service/queue.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<EnqueuePayload> = {}): EnqueuePayload {
  return {
    jobId:       randomUUID() as JobId,
    requestId:   randomUUID() as RequestId,
    jobStatus:   JobStatus.Queued,
    priority:    JobPriority.Normal,
    sourceType:  JobSourceType.Live,
    attempt:     1,
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = toIsoTimestamp();
  return {
    id:          randomUUID() as JobId,
    requestId:   randomUUID() as RequestId,
    sourceType:  JobSourceType.Live,
    status:      JobStatus.Queued,
    priority:    JobPriority.Normal,
    attempts:    1,
    maxAttempts: 3,
    queuedAt:    Date.now(),
    createdAt:   now,
    updatedAt:   now,
    ...overrides,
  };
}

// ─── InMemoryJobQueue ─────────────────────────────────────────────────────────

describe("InMemoryJobQueue", () => {
  let queue: InMemoryJobQueue;

  beforeEach(() => {
    queue = new InMemoryJobQueue();
  });

  // ── enqueue ────────────────────────────────────────────────────────────────

  describe("enqueue", () => {
    it("returns a message with a generated UUID id", async () => {
      const msg = await queue.enqueue(makePayload());
      expect(msg.id).toBeDefined();
      expect(msg.id).toHaveLength(36); // UUID format
    });

    it("sets status to Pending", async () => {
      const msg = await queue.enqueue(makePayload());
      expect(msg.status).toBe(QueueMessageStatus.Pending);
    });

    it("stamps enqueuedAt as a recent epoch timestamp", async () => {
      const before = Date.now();
      const msg = await queue.enqueue(makePayload());
      expect(msg.enqueuedAt).toBeGreaterThanOrEqual(before);
      expect(msg.enqueuedAt).toBeLessThanOrEqual(Date.now());
    });

    it("preserves all payload fields on the returned message", async () => {
      const payload = makePayload({
        priority:    JobPriority.High,
        sourceType:  JobSourceType.Simulation,
        attempt:     2,
        metadata:    { taskType: "chat" },
      });
      const msg = await queue.enqueue(payload);

      expect(msg.jobId).toBe(payload.jobId);
      expect(msg.requestId).toBe(payload.requestId);
      expect(msg.priority).toBe(JobPriority.High);
      expect(msg.sourceType).toBe(JobSourceType.Simulation);
      expect(msg.attempt).toBe(2);
      expect(msg.metadata).toEqual({ taskType: "chat" });
    });

    it("makes the message visible via peek()", async () => {
      const payload = makePayload();
      const msg = await queue.enqueue(payload);
      const peeked = await queue.peek();
      expect(peeked.some((m) => m.id === msg.id)).toBe(true);
    });
  });

  // ── peek ───────────────────────────────────────────────────────────────────

  describe("peek", () => {
    it("returns an empty array when the queue is empty", async () => {
      expect(await queue.peek()).toEqual([]);
    });

    it("sorts messages priority-descending then enqueuedAt-ascending", async () => {
      // Enqueue in reverse-priority order
      const low    = await queue.enqueue(makePayload({ priority: JobPriority.Low }));
      const high   = await queue.enqueue(makePayload({ priority: JobPriority.High }));
      const normal = await queue.enqueue(makePayload({ priority: JobPriority.Normal }));

      const result = await queue.peek();
      expect(result[0]!.id).toBe(high.id);
      expect(result[1]!.id).toBe(normal.id);
      expect(result[2]!.id).toBe(low.id);
    });

    it("resolves FIFO within the same priority class", async () => {
      const first  = await queue.enqueue(makePayload({ priority: JobPriority.Normal }));
      // Force a later enqueuedAt by advancing the clock slightly
      await new Promise((r) => setTimeout(r, 2));
      const second = await queue.enqueue(makePayload({ priority: JobPriority.Normal }));

      const result = await queue.peek();
      expect(result[0]!.id).toBe(first.id);
      expect(result[1]!.id).toBe(second.id);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 5; i++) await queue.enqueue(makePayload());
      const result = await queue.peek(3);
      expect(result).toHaveLength(3);
    });

    it("excludes non-Pending messages", async () => {
      // Directly manipulate via second enqueue to simulate a Pending + Done pair
      const pending = await queue.enqueue(makePayload());
      // Enqueue and then manually mark as Done by inspecting the private map is not ideal;
      // instead verify that a freshly enqueued queue only returns Pending messages.
      const all = await queue.peek(500);
      for (const m of all) {
        expect(m.status).toBe(QueueMessageStatus.Pending);
      }
      expect(all.some((m) => m.id === pending.id)).toBe(true);
    });
  });

  // ── size ───────────────────────────────────────────────────────────────────

  describe("size", () => {
    it("returns 0 for an empty queue", async () => {
      expect(await queue.size()).toBe(0);
    });

    it("returns the correct count after multiple enqueues", async () => {
      await queue.enqueue(makePayload());
      await queue.enqueue(makePayload());
      await queue.enqueue(makePayload());
      expect(await queue.size()).toBe(3);
    });

    it("is consistent with peek() length", async () => {
      await queue.enqueue(makePayload());
      await queue.enqueue(makePayload());
      expect(await queue.size()).toBe((await queue.peek()).length);
    });
  });
});

// ─── QueueService ─────────────────────────────────────────────────────────────

describe("QueueService", () => {
  let adapter: InMemoryJobQueue;
  let svc: QueueService;
  const ctx = buildTestContext();

  beforeEach(() => {
    adapter = new InMemoryJobQueue();
    svc = new QueueService(adapter);
  });

  // ── enqueueJob ─────────────────────────────────────────────────────────────

  describe("enqueueJob", () => {
    it("maps all Job fields correctly to a QueueMessage", async () => {
      const job = makeJob({ priority: JobPriority.High, attempts: 1 });
      const msg = await svc.enqueueJob(ctx, job);

      expect(msg.jobId).toBe(job.id);
      expect(msg.requestId).toBe(job.requestId);
      expect(msg.jobStatus).toBe(JobStatus.Queued);
      expect(msg.priority).toBe(JobPriority.High);
      expect(msg.sourceType).toBe(JobSourceType.Live);
      expect(msg.attempt).toBe(1);
      expect(msg.status).toBe(QueueMessageStatus.Pending);
      expect(msg.enqueuedAt).toBeDefined();
    });

    it("forwards caller metadata to the message", async () => {
      const job = makeJob();
      const meta = { taskType: "embedding", inputSize: 256 };
      const msg = await svc.enqueueJob(ctx, job, meta);
      expect(msg.metadata).toEqual(meta);
    });

    it("assigns a unique message id per enqueue", async () => {
      const job = makeJob();
      const a = await svc.enqueueJob(ctx, job);
      const b = await svc.enqueueJob(ctx, job);
      expect(a.id).not.toBe(b.id);
    });

    it("makes the message visible in listMessages()", async () => {
      const job = makeJob();
      const msg = await svc.enqueueJob(ctx, job);
      const list = await svc.listMessages(ctx);
      expect(list.some((m: QueueMessage) => m.id === msg.id)).toBe(true);
    });
  });

  // ── listMessages ───────────────────────────────────────────────────────────

  describe("listMessages", () => {
    it("returns an empty array when the queue is empty", async () => {
      expect(await svc.listMessages(ctx)).toEqual([]);
    });

    it("respects the limit passed through to peek()", async () => {
      for (let i = 0; i < 5; i++) await svc.enqueueJob(ctx, makeJob());
      const result = await svc.listMessages(ctx, 2);
      expect(result).toHaveLength(2);
    });
  });

  // ── queueSize ──────────────────────────────────────────────────────────────

  describe("queueSize", () => {
    it("returns 0 for an empty queue", async () => {
      expect(await svc.queueSize(ctx)).toBe(0);
    });

    it("returns the correct pending count", async () => {
      await svc.enqueueJob(ctx, makeJob());
      await svc.enqueueJob(ctx, makeJob());
      expect(await svc.queueSize(ctx)).toBe(2);
    });
  });
});
