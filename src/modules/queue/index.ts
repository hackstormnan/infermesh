/**
 * modules/queue — Job Queue Abstraction
 *
 * Owns the transport-neutral queue layer that decouples job creation from job
 * execution. The intake flow enqueues newly created jobs; a dequeue processor
 * (Ticket 13+) will consume them and hand them to the routing engine.
 *
 * ─── Architecture ─────────────────────────────────────────────────────────────
 *   IJobQueue          — port interface (transport-neutral)
 *   InMemoryJobQueue   — in-memory adapter (local dev / tests)
 *   QueueService       — application layer; intake and other modules use this
 *   buildQueueRoute    — Fastify plugin for the internal /queue/items endpoint
 *
 * ─── Swapping backends ────────────────────────────────────────────────────────
 * To replace the in-memory adapter with BullMQ, SQS, or another backend:
 *   1. Create a new class implementing IJobQueue
 *   2. Replace `new InMemoryJobQueue()` with your adapter below
 *   3. No other files need to change
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET /api/v1/queue/items  — [INTERNAL] list pending messages (dev / debug)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { queueRoute } from "../modules/queue";
 *   fastify.register(queueRoute, { prefix: "/api/v1" });
 */

import { InMemoryJobQueue } from "./InMemoryJobQueue";
import { QueueService } from "./service/queue.service";
import { buildQueueRoute } from "./routes/queue.route";

// ─── Module composition ───────────────────────────────────────────────────────

/** Active queue adapter — swap this binding to change backends */
const jobQueue = new InMemoryJobQueue();

/** Singleton service instance shared across the process lifetime */
export const queueService = new QueueService(jobQueue);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const queueRoute = buildQueueRoute(queueService);

// ─── Public type + class re-exports ──────────────────────────────────────────

export { QueueService } from "./service/queue.service";
export { InMemoryJobQueue } from "./InMemoryJobQueue";

export type { IJobQueue } from "./IJobQueue";
export type { QueueMessage, EnqueuePayload } from "./queue.contract";
export { QueueMessageStatus } from "./queue.contract";
