/**
 * modules/queue/service/queue.service.ts
 *
 * Application-level orchestration layer for the job queue.
 *
 * Route handlers and other modules interact with the queue through this service.
 * They never call the IJobQueue adapter directly, which keeps the adapter
 * swappable without touching business logic.
 *
 * ─── Operations ───────────────────────────────────────────────────────────────
 *   enqueueJob    — build a QueueMessage from a Job and enqueue it
 *   listMessages  — inspect pending messages (used by the debug endpoint)
 *   queueSize     — return the current pending message count
 *
 * ─── Future operations (Ticket 13+) ──────────────────────────────────────────
 *   dequeueForRouting — pull the next Pending message and transition the job
 *                       to Routing via JobLifecycleService
 *   acknowledge       — mark a message Done after successful routing
 *   nack              — return a message to the queue on transient failure
 */

import type { RequestContext } from "../../../core/context";
import type { Job } from "../../../shared/contracts/job";
import type { IJobQueue } from "../IJobQueue";
import type { QueueMessage } from "../queue.contract";

export class QueueService {
  constructor(private readonly queue: IJobQueue) {}

  // ─── Write operations ───────────────────────────────────────────────────────

  /**
   * Enqueue a newly created job for routing and execution.
   *
   * Builds a QueueMessage from the Job entity, forwarding scheduling
   * signals (priority, sourceType, attempt) and optional caller metadata.
   *
   * @param job   The Job entity to enqueue (must be in Queued status).
   * @param meta  Arbitrary key-value pairs forwarded to the routing engine.
   *              Typically includes taskType, inputSize, estimatedComplexity.
   */
  async enqueueJob(
    ctx: RequestContext,
    job: Job,
    meta?: Record<string, unknown>,
  ): Promise<QueueMessage> {
    ctx.log.info(
      { jobId: job.id, priority: job.priority, attempt: job.attempts },
      "Enqueueing job",
    );

    return this.queue.enqueue({
      jobId:       job.id,
      requestId:   job.requestId,
      jobStatus:   job.status,
      priority:    job.priority,
      sourceType:  job.sourceType,
      attempt:     job.attempts,
      metadata:    meta,
    });
  }

  // ─── Read operations ────────────────────────────────────────────────────────

  /**
   * Return the current pending queue contents, ordered by priority then age.
   * Intended for the internal debug endpoint — not exposed in production.
   *
   * @param limit  Cap on the number of messages returned. Defaults to 100.
   */
  async listMessages(
    ctx: RequestContext,
    limit?: number,
  ): Promise<QueueMessage[]> {
    ctx.log.debug({ limit }, "Listing queue messages");
    return this.queue.peek(limit);
  }

  /**
   * Return the number of messages currently waiting to be processed.
   */
  async queueSize(ctx: RequestContext): Promise<number> {
    const n = await this.queue.size();
    ctx.log.debug({ size: n }, "Queue size requested");
    return n;
  }
}
