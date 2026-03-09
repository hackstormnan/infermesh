/**
 * modules/models — Model Registry & Capability Catalog
 *
 * Owns the full lifecycle of registered AI models: creation, capability
 * metadata, status management, and name/alias resolution.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repository, service, routes) are not re-exported.
 * All cross-module access goes through the public service instance or DTO types.
 *
 * ─── Key consumer: routing engine (Ticket 7) ─────────────────────────────────
 * The routing engine calls modelsService.getByName() to resolve a caller-supplied
 * model name to the full Model record (pricing, latencyProfile, qualityTier,
 * capabilities, supportedTasks) needed for candidate scoring.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET  /api/v1/models          — paginated list with status/provider/capability filters
 *   GET  /api/v1/models/:id      — fetch a model by UUID
 *   POST /api/v1/models          — register a model (Ticket 7+ / admin API)
 *   PATCH /api/v1/models/:id     — update status, pricing, or latency (Ticket 7+)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { modelsRoute } from "../modules/models";
 *   fastify.register(modelsRoute, { prefix: "/api/v1" });
 */

import { InMemoryModelRepository } from "./repository/InMemoryModelRepository";
import { ModelsService } from "./service/models.service";
import { buildModelsRoute } from "./routes/models.route";

// ─── Module composition ───────────────────────────────────────────────────────

const repo = new InMemoryModelRepository();

/** Singleton service instance — shared across the process lifetime */
export const modelsService = new ModelsService(repo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const modelsRoute = buildModelsRoute(modelsService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export type {
  Model,
  ModelDto,
  RegisterModelDto,
  UpdateModelDto,
  ModelPricing,
  ModelLatencyProfile,
} from "../../shared/contracts/model";

export {
  ModelStatus,
  ModelProvider,
  ModelCapability,
  QualityTier,
  ModelTask,
  registerModelSchema,
  updateModelSchema,
} from "../../shared/contracts/model";

export type { ListModelsQuery } from "./queries";
export { listModelsQuerySchema } from "./queries";

export type { IModelRepository } from "./repository/IModelRepository";
