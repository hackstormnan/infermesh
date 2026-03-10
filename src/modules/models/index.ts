/**
 * modules/models — Model Registry & Capability Catalog
 *
 * Owns the full lifecycle of registered AI models: creation, capability
 * metadata, status management, name/alias resolution, and routing-time
 * eligibility filtering.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repository, service, routes) are not re-exported.
 * All cross-module access goes through the public service instances or types.
 *
 * ─── Service instances ───────────────────────────────────────────────────────
 *   modelsService        — CRUD operations (register, update, getById, list)
 *   modelRegistryService — routing-time lookup, eligibility filtering,
 *                          candidate preparation (findEligible, listActive)
 *
 * ─── Key consumer: routing engine (Ticket 14+) ───────────────────────────────
 * The routing engine calls modelRegistryService.findEligible(ctx, filter) to
 * get a filtered ModelCandidate[] at decision time. Each candidate carries the
 * pricing, latencyProfile, qualityTier, and capabilities needed to compute a
 * ScoreBreakdown without loading the full Model entity.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET  /api/v1/models/candidates — registry filter → ModelCandidate[] (routing/debug)
 *   GET  /api/v1/models            — paginated list with status/provider/capability filters
 *   GET  /api/v1/models/:id        — fetch a model by UUID
 *   POST /api/v1/models            — register a model (admin API, Ticket 14+)
 *   PATCH /api/v1/models/:id       — update status, pricing, or latency (Ticket 14+)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { modelsRoute } from "../modules/models";
 *   fastify.register(modelsRoute, { prefix: "/api/v1" });
 */

import { InMemoryModelRepository } from "./repository/InMemoryModelRepository";
import { ModelsService } from "./service/models.service";
import { ModelRegistryService } from "./registry/model-registry.service";
import { buildModelsRoute } from "./routes/models.route";

// ─── Module composition ───────────────────────────────────────────────────────

const repo = new InMemoryModelRepository();

/** Singleton CRUD service — shared across the process lifetime */
export const modelsService = new ModelsService(repo);

/**
 * Singleton registry service — used by the routing engine to query eligible
 * candidates at decision time.
 *
 * Shares the same repo instance as modelsService so both views of the catalog
 * are always consistent.
 */
export const modelRegistryService = new ModelRegistryService(repo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const modelsRoute = buildModelsRoute(modelsService, modelRegistryService);

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

export type { ListModelsQuery, ModelCandidatesQuery } from "./queries";
export { listModelsQuerySchema, modelCandidatesQuerySchema } from "./queries";

export type { IModelRepository } from "./repository/IModelRepository";

export type { ModelRegistryFilter, ModelCandidate } from "./registry/model-registry.contract";
export { ModelRegistryService } from "./registry/model-registry.service";
