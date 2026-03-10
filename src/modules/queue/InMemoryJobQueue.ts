/**
 * modules/queue/InMemoryJobQueue.ts
 *
 * In-memory implementation of IJobQueue for local development and testing.
 *
 * ─── Storage ──────────────────────────────────────────────────────────────────
 * Messages are stored in a Map<id, QueueMessage> for O(1) lookup.
 * peek() materialises a sorted view on demand rather than keeping a sorted
 * data structure, which is fine for dev-time volumes.
 *
 * ─── Ordering ─────────────────────────────────────────────────────────────────
 * peek() sorts by:
 *   1. priority   — descending (Critical=3 first, Low=0 last)
 *   2. enqueuedAt — ascending  (older messages first within a priority class)
 *
 * This matches the expected behaviour of a production priority queue (BullMQ,
 * SQS with priority attributes) so the rest of the system behaves consistently
 * regardless of which adapter is active.
 *
 * ─── Limitations ──────────────────────────────────────────────────────────────
 * - No persistence — state is lost on restart
 * - No dequeue / acknowledge — messages are never consumed (Ticket 13+)
 * - No back-pressure or capacity limits
 * - Not thread-safe (Node.js is single-threaded, so safe in practice)
 */

import { randomUUID } from "crypto";
import type { EnqueuePayload, QueueMessage } from "./queue.contract";
import { QueueMessageStatus } from "./queue.contract";
import type { IJobQueue } from "./IJobQueue";

const DEFAULT_PEEK_LIMIT = 100;

export class InMemoryJobQueue implements IJobQueue {
  private readonly messages = new Map<string, QueueMessage>();

  // ─── Write operations ───────────────────────────────────────────────────────

  async enqueue(payload: EnqueuePayload): Promise<QueueMessage> {
    const message: QueueMessage = {
      ...payload,
      id:          randomUUID(),
      status:      QueueMessageStatus.Pending,
      enqueuedAt:  Date.now(),
    };

    this.messages.set(message.id, message);
    return message;
  }

  // ─── Read operations ────────────────────────────────────────────────────────

  async peek(limit = DEFAULT_PEEK_LIMIT): Promise<QueueMessage[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.status === QueueMessageStatus.Pending)
      .sort(byPriorityDescThenEnqueuedAtAsc)
      .slice(0, limit);
  }

  async size(): Promise<number> {
    let count = 0;
    for (const m of this.messages.values()) {
      if (m.status === QueueMessageStatus.Pending) count++;
    }
    return count;
  }
}

// ─── Sort comparator ───────────────────────────────────────────────────────────

/**
 * Orders messages for the dequeue processor:
 *   priority desc  — higher priority messages are dequeued first
 *   enqueuedAt asc — FIFO within each priority class (oldest first)
 */
function byPriorityDescThenEnqueuedAtAsc(a: QueueMessage, b: QueueMessage): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.enqueuedAt - b.enqueuedAt;
}
