/**
 * modules/requests — Inference Request Lifecycle
 *
 * Owns the full lifecycle of InferenceRequest entities: creation, state
 * transitions, and read access. Future tickets will extend this module with
 * queueing, routing dispatch, and streaming support.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * - Internal layers (repository, service, routes) are not re-exported.
 *   Consumers interact with this module only through its public surface.
 * - Other modules that need request data receive InferenceRequestDto values;
 *   they do not import InferenceRequest (the internal entity) directly.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET  /api/v1/requests       — paginated list with status/model/ID filters
 *   GET  /api/v1/requests/:id   — fetch a single request by ID
 *   POST /api/v1/requests       — submit a new request (Ticket 6)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { requestsRoute } from "../modules/requests";
 *   fastify.register(requestsRoute, { prefix: "/api/v1" });
 */

import { InMemoryRequestRepository } from "./repository/InMemoryRequestRepository";
import { RequestsService } from "./service/requests.service";
import { buildRequestsRoute } from "./routes/requests.route";

// ─── Module composition ───────────────────────────────────────────────────────
// In-memory repository is the default binding.
// Replace with a database-backed repository here when persistence is added.

const repo = new InMemoryRequestRepository();

/** Singleton service instance for this module */
export const requestsService = new RequestsService(repo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const requestsRoute = buildRequestsRoute(requestsService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export type {
  InferenceRequest,
  InferenceRequestDto,
  CreateInferenceRequestDto,
  ChatMessage,
  InferenceParams,
  RoutingHints,
} from "../../shared/contracts/request";

export {
  RequestStatus,
  MessageRole,
  createInferenceRequestSchema,
} from "../../shared/contracts/request";

export type { ListRequestsQuery } from "./queries";
export { listRequestsQuerySchema } from "./queries";

export type { IRequestRepository, StatusUpdate } from "./repository/IRequestRepository";
