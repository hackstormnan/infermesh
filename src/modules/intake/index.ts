/**
 * modules/intake — Request Intake Orchestration
 *
 * Owns the POST /api/v1/inference/requests endpoint and the application-level
 * orchestration logic that bridges the requests and jobs modules.
 *
 * ─── Responsibilities ─────────────────────────────────────────────────────────
 * This module is a pure orchestration layer. It does not own any domain entities
 * or repositories. Instead it coordinates two domain modules:
 *   - modules/requests — persists the InferenceRequest record
 *   - modules/jobs     — creates and links the internal Job record
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   POST /api/v1/inference/requests — submit an inference request for intake
 *
 * ─── Intake flow ─────────────────────────────────────────────────────────────
 *   1. Validate IntakeRequestBody (Zod)
 *   2. Create InferenceRequest via requestsService (status: Queued)
 *   3. Create Job via jobsService (status: Queued)
 *   4. Link Job → Request (status: Dispatched, jobId stamped)
 *   5. Return IntakeResponseDto (requestId, jobId, status, jobStatus, createdAt)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { intakeRoute } from "../modules/intake";
 *   fastify.register(intakeRoute, { prefix: "/api/v1" });
 */

import { requestsService } from "../requests";
import { jobsService } from "../jobs";
import { IntakeService } from "./service/intake.service";
import { buildIntakeRoute } from "./routes/intake.route";

// ─── Module composition ───────────────────────────────────────────────────────

const intakeService = new IntakeService(requestsService, jobsService);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const intakeRoute = buildIntakeRoute(intakeService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export { IntakeService };
export type { IntakeRequestBody, IntakeResponseDto } from "./dto";
export { intakeRequestSchema } from "./dto";
