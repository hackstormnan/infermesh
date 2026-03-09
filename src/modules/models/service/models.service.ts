/**
 * modules/models/service/models.service.ts
 *
 * Service layer for the models module.
 *
 * Route handlers call this service — they never access the repository directly.
 * Routes handle HTTP concerns (parsing, status codes); the service handles
 * business logic: ID generation, conflict detection, alias resolution, mapping.
 *
 * ─── Operations ───────────────────────────────────────────────────────────────
 *   register   — create and persist a new model; enforces name uniqueness
 *   getById    — fetch by UUID; throws NotFoundError if absent
 *   getByName  — fetch by canonical name or alias; throws NotFoundError if absent
 *   list       — paginated, filtered list mapped to DTOs
 *   update     — apply a partial patch to mutable fields
 *
 * ─── Future extension points ──────────────────────────────────────────────────
 *   - Ticket 7 (routing engine): getByName used to resolve modelId → Model
 *     for candidate scoring (pricing, latencyProfile, qualityTier, capabilities)
 *   - Ticket 8 (metrics): latencyProfile refreshed from observed p50/p95 telemetry
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import { ConflictError, NotFoundError } from "../../../core/errors";
import type {
  Model,
  ModelDto,
  RegisterModelDto,
  UpdateModelDto,
} from "../../../shared/contracts/model";
import { ModelStatus } from "../../../shared/contracts/model";
import type { ModelId, PaginatedResponse } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { IModelRepository } from "../repository/IModelRepository";
import type { ListModelsQuery } from "../queries";

export class ModelsService {
  constructor(private readonly repo: IModelRepository) {}

  // ─── Write operations ──────────────────────────────────────────────────────

  /**
   * Register a new model in the catalog.
   * Rejects if the canonical name (or any alias) is already taken.
   */
  async register(
    ctx: RequestContext,
    dto: RegisterModelDto,
  ): Promise<ModelDto> {
    // Enforce name uniqueness (canonical name and each alias)
    const names = [dto.name, ...dto.aliases];
    for (const name of names) {
      const existing = await this.repo.findByName(name);
      if (existing) {
        throw new ConflictError(
          `Model name or alias "${name}" is already registered`,
          { conflictingId: existing.id },
        );
      }
    }

    const now = toIsoTimestamp();
    const model: Model = {
      id: randomUUID() as ModelId,
      name: dto.name,
      aliases: dto.aliases,
      provider: dto.provider,
      version: dto.version,
      capabilities: dto.capabilities,
      supportedTasks: dto.supportedTasks,
      qualityTier: dto.qualityTier,
      contextWindow: dto.contextWindow,
      maxOutputTokens: dto.maxOutputTokens,
      pricing: dto.pricing,
      latencyProfile: dto.latencyProfile,
      metadata: dto.metadata,
      status: ModelStatus.Active,
      createdAt: now,
      updatedAt: now,
    };

    ctx.log.info(
      { modelId: model.id, name: model.name, provider: model.provider },
      "Registering model",
    );

    const saved = await this.repo.create(model);
    return toDto(saved);
  }

  /**
   * Update mutable fields on a registered model.
   * Immutable registration fields (name, provider, capabilities, etc.) cannot
   * be changed after registration.
   */
  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateModelDto,
  ): Promise<ModelDto> {
    ctx.log.info({ modelId: id }, "Updating model");

    const updated = await this.repo.update(id as ModelId, dto);
    if (!updated) {
      throw new NotFoundError(`Model ${id}`);
    }

    return toDto(updated);
  }

  // ─── Read operations ───────────────────────────────────────────────────────

  async getById(ctx: RequestContext, id: string): Promise<ModelDto> {
    ctx.log.debug({ modelId: id }, "Fetching model by ID");

    const model = await this.repo.findById(id as ModelId);
    if (!model) {
      throw new NotFoundError(`Model ${id}`);
    }

    return toDto(model);
  }

  /**
   * Fetch a model by canonical name or alias.
   * Used by the routing engine to resolve the caller-supplied `modelId` string
   * to the full Model record (pricing, latency, capabilities, qualityTier).
   */
  async getByName(ctx: RequestContext, nameOrAlias: string): Promise<ModelDto> {
    ctx.log.debug({ nameOrAlias }, "Resolving model by name/alias");

    const model = await this.repo.findByName(nameOrAlias);
    if (!model) {
      throw new NotFoundError(`Model "${nameOrAlias}"`);
    }

    return toDto(model);
  }

  async list(
    ctx: RequestContext,
    query: ListModelsQuery,
  ): Promise<PaginatedResponse<ModelDto>> {
    ctx.log.debug({ query }, "Listing models");

    const result = await this.repo.list(query);
    return { ...result, items: result.items.map(toDto) };
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Projects the internal Model entity onto the public ModelDto.
 * The `metadata` field is intentionally excluded from the response —
 * it may contain provider-specific secrets or internal configuration.
 */
function toDto(model: Model): ModelDto {
  return {
    id: model.id,
    name: model.name,
    aliases: model.aliases,
    provider: model.provider,
    version: model.version,
    capabilities: model.capabilities,
    supportedTasks: model.supportedTasks,
    qualityTier: model.qualityTier,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    pricing: model.pricing,
    latencyProfile: model.latencyProfile,
    status: model.status,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}
