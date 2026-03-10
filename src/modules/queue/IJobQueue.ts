/**
 * modules/queue/IJobQueue.ts
 *
 * Transport-neutral port interface for the job queue.
 *
 * The QueueService and IntakeService depend only on this interface.
 * Swapping from the in-memory adapter to BullMQ, SQS, or RabbitMQ
 * requires implementing this interface in a new adapter file and
 * rebinding it in queue/index.ts — zero changes to business logic.
 *
 * ─── Current surface (Ticket 12) ─────────────────────────────────────────────
 *   enqueue — place a job into the queue
 *   peek    — inspect contents without consuming (debug / monitoring)
 *   size    — current pending message count
 *
 * ─── Future surface (not yet implemented) ────────────────────────────────────
 *   dequeue(n?)      — pull up to n messages for processing
 *   acknowledge(id)  — mark a message as successfully processed (Done)
 *   nack(id, reason) — return a message to the queue or dead-letter it
 *   purge()          — drain all pending messages (test utility)
 */

import type { EnqueuePayload, QueueMessage } from "./queue.contract";

export interface IJobQueue {
  /**
   * Add a job to the queue.
   *
   * The adapter assigns the message `id`, `enqueuedAt`, and initial `status`.
   * Returns the fully-constructed QueueMessage so callers can capture the ID.
   */
  enqueue(payload: EnqueuePayload): Promise<QueueMessage>;

  /**
   * Return the current queue contents without consuming any messages.
   *
   * Ordering: priority descending (Critical first), then enqueuedAt ascending
   * (FIFO within each priority class). This mirrors the expected dequeue order
   * of any production backend.
   *
   * Only Pending messages are returned — Processing / Done / Dead are excluded.
   *
   * @param limit  Maximum number of messages to return. Defaults to 100.
   */
  peek(limit?: number): Promise<QueueMessage[]>;

  /**
   * Return the count of Pending messages currently in the queue.
   * Does not include messages in Processing, Done, or Dead state.
   */
  size(): Promise<number>;
}
