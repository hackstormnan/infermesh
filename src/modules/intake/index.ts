/**
 * modules/intake — Request Intake Orchestration
 *
 * Owns the POST /api/v1/inference/requests endpoint and the application-level
 * orchestration logic that bridges the requests, jobs, queue, and stream modules.
 *
 * ─── Responsibilities ─────────────────────────────────────────────────────────
 * This module is a pure orchestration layer. It does not own any domain entities
 * or repositories. Instead it coordinates four modules:
 *   - modules/requests — persists the InferenceRequest record
 *   - modules/jobs     — creates and links the internal Job record
 *   - modules/queue    — enqueues the job for async routing + execution
 *   - stream broker    — publishes a "requests" channel event on intake success
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   POST /api/v1/inference/requests — submit an inference request for intake
 *
 * ─── Intake flow ─────────────────────────────────────────────────────────────
 *   1. Validate IntakeRequestBody (Zod)
 *   2. Create InferenceRequest via requestsService (status: Queued)
 *   3. Create Job via jobsService (status: Queued)
 *   4. Enqueue job via queueService → QueueMessage (status: Pending)
 *   5. Link Job → Request (status: Dispatched, jobId stamped)
 *   6. Publish RequestAcceptedPayload to "requests" stream channel (best-effort)
 *   7. Return IntakeResponseDto — 202 Accepted (requestId, jobId, queueMessageId, ...)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * In app/routes.ts, pass the stream broker from createStreamServices():
 *
 *   import { buildIntakeModule } from "../modules/intake";
 *   const { registry, broker } = createStreamServices();
 *   fastify.register(buildIntakeModule(broker), { prefix: "/api/v1" });
 */

import type { IStreamBroker } from "../../stream/broker/IStreamBroker";
import { requestsService } from "../requests";
import { jobsService } from "../jobs";
import { queueService } from "../queue";
import { IntakeService } from "./service/intake.service";
import { buildIntakeRoute } from "./routes/intake.route";

// ─── Module factory ───────────────────────────────────────────────────────────

/**
 * Build the intake Fastify plugin with an injected stream broker.
 *
 * Called from app/routes.ts where the stream broker singleton is available.
 * Passing the broker here wires request stream events without coupling
 * IntakeService or the route handler to any WebSocket internals.
 *
 * The broker is optional so the factory can also be used in integration
 * tests that don't need stream coverage.
 */
export function buildIntakeModule(broker?: IStreamBroker) {
  const service = new IntakeService(requestsService, jobsService, queueService, broker);
  return buildIntakeRoute(service);
}

// ─── Public type re-exports ───────────────────────────────────────────────────

export { IntakeService };
export type { IntakeRequestBody, IntakeResponseDto } from "./dto";
export { intakeRequestSchema } from "./dto";
