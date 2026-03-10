/**
 * modules/models/repository/InMemoryModelRepository.ts
 *
 * In-memory implementation of IModelRepository.
 *
 * Uses two indexes for O(1) and O(k) lookups:
 *   - `byId`   — Map<ModelId, Model>  for findById
 *   - `byName` — Map<string, ModelId> for findByName (name + all aliases, lowercase)
 *
 * The name index is rebuilt on every write. State is lost on restart.
 * Not suitable for production or multi-instance deployments.
 */

import type { Model, UpdateModelDto } from "../../../shared/contracts/model";
import type { ModelId, PaginatedResponse } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { ListModelsQuery } from "../queries";
import type { IModelRepository } from "./IModelRepository";

export class InMemoryModelRepository implements IModelRepository {
  /** Primary store keyed by model UUID */
  private readonly byId = new Map<string, Model>();

  /**
   * Secondary name/alias index.
   * Maps any lowercase name or alias → the model's UUID.
   * Rebuilt on every create/update to stay consistent with byId.
   */
  private readonly byName = new Map<string, string>();

  async create(model: Model): Promise<Model> {
    this.byId.set(model.id, model);
    this.indexNames(model);
    return model;
  }

  async findAll(): Promise<Model[]> {
    return Array.from(this.byId.values());
  }

  async findById(id: ModelId): Promise<Model | null> {
    return this.byId.get(id) ?? null;
  }

  async findByName(nameOrAlias: string): Promise<Model | null> {
    const id = this.byName.get(nameOrAlias.toLowerCase());
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  async list(query: ListModelsQuery): Promise<PaginatedResponse<Model>> {
    let items = Array.from(this.byId.values());

    // ── Filters ─────────────────────────────────────────────────────────────

    if (query.status !== undefined) {
      items = items.filter((m) => m.status === query.status);
    }

    if (query.provider !== undefined) {
      items = items.filter((m) => m.provider === query.provider);
    }

    if (query.capability !== undefined) {
      items = items.filter((m) => m.capabilities.includes(query.capability!));
    }

    if (query.qualityTier !== undefined) {
      items = items.filter((m) => m.qualityTier === query.qualityTier);
    }

    if (query.name !== undefined) {
      const prefix = query.name.toLowerCase();
      items = items.filter(
        (m) =>
          m.name.toLowerCase().startsWith(prefix) ||
          m.aliases.some((a) => a.toLowerCase().startsWith(prefix)),
      );
    }

    // ── Sort: alphabetical by canonical name ─────────────────────────────────

    items.sort((a, b) => a.name.localeCompare(b.name));

    // ── Pagination ───────────────────────────────────────────────────────────

    const total = items.length;
    const { page, limit } = query;
    const offset = (page - 1) * limit;
    const slice = items.slice(offset, offset + limit);

    return { items: slice, total, page, limit, hasMore: offset + slice.length < total };
  }

  async update(id: ModelId, patch: UpdateModelDto): Promise<Model | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;

    // Remove stale name entries before overwriting
    this.removeNameIndex(existing);

    const updated: Model = {
      ...existing,
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.pricing !== undefined && { pricing: patch.pricing }),
      ...(patch.latencyProfile !== undefined && { latencyProfile: patch.latencyProfile }),
      ...(patch.metadata !== undefined && { metadata: patch.metadata }),
      updatedAt: toIsoTimestamp(),
    };

    this.byId.set(id, updated);
    this.indexNames(updated);
    return updated;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Register a model's canonical name and all aliases in the name index */
  private indexNames(model: Model): void {
    this.byName.set(model.name.toLowerCase(), model.id);
    for (const alias of model.aliases) {
      this.byName.set(alias.toLowerCase(), model.id);
    }
  }

  /** Remove all name index entries belonging to a model */
  private removeNameIndex(model: Model): void {
    this.byName.delete(model.name.toLowerCase());
    for (const alias of model.aliases) {
      this.byName.delete(alias.toLowerCase());
    }
  }
}
