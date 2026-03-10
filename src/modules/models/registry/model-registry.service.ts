/**
 * modules/models/registry/model-registry.service.ts
 *
 * Routing-time model lookup, eligibility filtering, and candidate preparation.
 *
 * This service is the primary interface between the routing engine and the
 * model catalog. It wraps the raw repository with:
 *
 *   1. Multi-dimensional eligibility filtering (task, capability, provider,
 *      quality tier, context window, status)
 *   2. Candidate projection — converts internal Model entities to the lean
 *      ModelCandidate shape that routing strategies consume
 *
 * ─── Design notes ─────────────────────────────────────────────────────────────
 *   - All filtering logic lives here, not in the repository or route handlers.
 *   - The repository only does storage and basic indexed lookups (findAll,
 *     findById, findByName). The registry service owns eligibility semantics.
 *   - `findAll()` is used rather than the paginated `list()` because routing
 *     needs a complete candidate set — pagination would silently drop models.
 *   - Quality tier ordering is encoded as a numeric rank so `minQualityTier`
 *     filtering works correctly across all three tiers.
 *
 * ─── Consumers ────────────────────────────────────────────────────────────────
 *   - Routing engine (Ticket 14+): calls `findEligible()` at decision time
 *   - Debug/dev: GET /api/v1/models/candidates exposes the same logic via HTTP
 */

import type { RequestContext } from "../../../core/context";
import { ModelStatus, QualityTier } from "../../../shared/contracts/model";
import type { Model } from "../../../shared/contracts/model";
import type { IModelRepository } from "../repository/IModelRepository";
import type { ModelCandidate, ModelRegistryFilter } from "./model-registry.contract";

// ─── Quality tier rank ────────────────────────────────────────────────────────

/**
 * Numeric rank for quality tier comparison.
 * Higher rank = higher quality. Used to implement minQualityTier filtering.
 */
const QUALITY_TIER_RANK: Record<QualityTier, number> = {
  [QualityTier.Economy]:  0,
  [QualityTier.Standard]: 1,
  [QualityTier.Frontier]: 2,
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class ModelRegistryService {
  constructor(private readonly repo: IModelRepository) {}

  /**
   * Return all Active models as routing candidates.
   *
   * Convenience method for the common routing case of "give me everything
   * that can currently accept requests". Equivalent to
   * `findEligible(ctx, { status: ModelStatus.Active })`.
   */
  async listActive(ctx: RequestContext): Promise<ModelCandidate[]> {
    return this.findEligible(ctx, { status: ModelStatus.Active });
  }

  /**
   * Find all models that satisfy every constraint in `filter` and return
   * them as routing-ready `ModelCandidate` objects.
   *
   * Default behaviour:
   *   - `filter.status` defaults to `ModelStatus.Active` when not provided,
   *     so routing queries always return dispatch-ready models unless the
   *     caller explicitly requests a different status.
   *   - An empty `requiredCapabilities` array applies no capability constraint.
   *   - All other omitted fields are not used as constraints.
   *
   * Results are sorted by quality tier descending (Frontier first), then
   * alphabetically by name within each tier — a stable ordering that
   * routing strategies can rely on before applying their own scoring.
   */
  async findEligible(
    ctx: RequestContext,
    filter: ModelRegistryFilter = {},
  ): Promise<ModelCandidate[]> {
    const effectiveFilter: ModelRegistryFilter = {
      status: ModelStatus.Active, // routing default: active only
      ...filter,
    };

    ctx.log.debug({ filter: effectiveFilter }, "ModelRegistry: finding eligible models");

    const all = await this.repo.findAll();
    const eligible = this.applyFilter(all, effectiveFilter);

    ctx.log.debug(
      { total: all.length, eligible: eligible.length },
      "ModelRegistry: eligibility filter complete",
    );

    return eligible
      .sort(byQualityDescThenNameAsc)
      .map(toCandidate);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Apply all active filter constraints sequentially.
   * Each clause narrows the candidate set; absent clauses are skipped.
   */
  private applyFilter(models: Model[], filter: ModelRegistryFilter): Model[] {
    let result = models;

    // Status — most selective first to reduce subsequent iterations
    if (filter.status !== undefined) {
      result = result.filter((m) => m.status === filter.status);
    }

    // Task type — must be in the model's supported tasks list
    if (filter.taskType !== undefined) {
      const taskType = filter.taskType;
      result = result.filter((m) => m.supportedTasks.includes(taskType));
    }

    // Required capabilities — model must declare ALL listed capabilities
    if (filter.requiredCapabilities !== undefined && filter.requiredCapabilities.length > 0) {
      const caps = filter.requiredCapabilities;
      result = result.filter((m) =>
        caps.every((cap) => m.capabilities.includes(cap)),
      );
    }

    // Provider
    if (filter.provider !== undefined) {
      result = result.filter((m) => m.provider === filter.provider);
    }

    // Minimum quality tier (inclusive rank comparison)
    if (filter.minQualityTier !== undefined) {
      const minRank = QUALITY_TIER_RANK[filter.minQualityTier];
      result = result.filter((m) => QUALITY_TIER_RANK[m.qualityTier] >= minRank);
    }

    // Minimum context window
    if (filter.minContextWindow !== undefined) {
      const minCtx = filter.minContextWindow;
      result = result.filter((m) => m.contextWindow >= minCtx);
    }

    return result;
  }
}

// ─── Sort comparator ──────────────────────────────────────────────────────────

function byQualityDescThenNameAsc(a: Model, b: Model): number {
  const rankDiff = QUALITY_TIER_RANK[b.qualityTier] - QUALITY_TIER_RANK[a.qualityTier];
  if (rankDiff !== 0) return rankDiff;
  return a.name.localeCompare(b.name);
}

// ─── Projection ───────────────────────────────────────────────────────────────

/**
 * Project the full internal Model entity onto the lean ModelCandidate shape.
 * Internal `metadata` and admin-only fields are excluded.
 */
function toCandidate(model: Model): ModelCandidate {
  return {
    id:             model.id,
    name:           model.name,
    provider:       model.provider,
    version:        model.version,
    capabilities:   model.capabilities,
    supportedTasks: model.supportedTasks,
    qualityTier:    model.qualityTier,
    contextWindow:  model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    pricing:        model.pricing,
    latencyProfile: model.latencyProfile,
    status:         model.status,
  };
}
