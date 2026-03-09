/**
 * modules/models — Model Registry & Capability Catalog
 *
 * Owns the catalog of available AI models and their metadata.
 *
 * Depends on shared contracts:
 *   Model, ModelStatus, ModelProvider, ModelCapability, RegisterModelDto
 *
 * Will expose (future tickets):
 *   POST /api/v1/models        — register a new model
 *   GET  /api/v1/models        — list models with capability/status filters
 *   GET  /api/v1/models/:id    — single model detail
 *   PATCH /api/v1/models/:id   — update model status or pricing
 *   GET  /api/v1/models/resolve/:alias — resolve alias to canonical model ID
 */

export type {
  Model,
  ModelDto,
  RegisterModelDto,
  ModelPricing,
  ModelLatencyProfile,
} from "../../shared/contracts/model";

export {
  ModelStatus,
  ModelProvider,
  ModelCapability,
  registerModelSchema,
} from "../../shared/contracts/model";
