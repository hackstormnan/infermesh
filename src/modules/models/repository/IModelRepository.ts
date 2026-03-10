/**
 * modules/models/repository/IModelRepository.ts
 *
 * Repository interface (port) for Model persistence.
 *
 * The service layer depends only on this interface. The in-memory adapter
 * is used during development and tests; a database-backed adapter (Postgres,
 * DynamoDB, Redis) can be swapped in by changing the binding in index.ts.
 *
 * ─── Lookup semantics ────────────────────────────────────────────────────────
 *   findAll    — all models (no filtering), used by the registry service
 *   findById   — exact match on the branded ModelId (UUID)
 *   findByName — matches canonical name OR any alias (case-insensitive)
 *   list       — paginated, filtered, sorted by name ascending
 *
 * ─── Mutation semantics ──────────────────────────────────────────────────────
 *   create — caller supplies a fully-constructed Model entity
 *   update — applies a partial patch to mutable fields only
 */

import type { Model, UpdateModelDto } from "../../../shared/contracts/model";
import type { ModelId, PaginatedResponse } from "../../../shared/primitives";
import type { ListModelsQuery } from "../queries";

export interface IModelRepository {
  /** Persist a new model. The caller must supply a fully-constructed entity. */
  create(model: Model): Promise<Model>;

  /**
   * Return every registered model without filtering or pagination.
   *
   * Used by the model registry service to retrieve a complete candidate set
   * for eligibility filtering at routing time. Prefer this over the paginated
   * `list()` when the caller needs all models (routing must not silently drop
   * candidates due to a page boundary).
   */
  findAll(): Promise<Model[]>;

  /** Retrieve a model by its UUID. Returns null if not found. */
  findById(id: ModelId): Promise<Model | null>;

  /**
   * Look up a model by canonical name or alias (case-insensitive).
   * Returns null if no model matches.
   *
   * Used by the routing engine to resolve the `modelId` field in an
   * InferenceRequest to a concrete registered model.
   */
  findByName(nameOrAlias: string): Promise<Model | null>;

  /**
   * Paginated, filtered list of models.
   * Results are sorted alphabetically by canonical name.
   */
  list(query: ListModelsQuery): Promise<PaginatedResponse<Model>>;

  /**
   * Apply a partial update to a registered model.
   * Only mutable fields (status, pricing, latencyProfile, metadata) are accepted.
   * Returns the updated entity, or null if the model ID is not found.
   */
  update(id: ModelId, patch: UpdateModelDto): Promise<Model | null>;
}
