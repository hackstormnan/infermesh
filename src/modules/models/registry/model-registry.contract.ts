/**
 * modules/models/registry/model-registry.contract.ts
 *
 * Routing-facing types for the model registry service.
 *
 * These types cross the boundary between the models module and the routing
 * engine (Ticket 14+). They are intentionally kept separate from the admin-
 * facing ModelDto so each concern can evolve independently.
 *
 *   ModelRegistryFilter — criteria the routing engine passes at lookup time
 *   ModelCandidate      — routing-ready projection of a registered model
 */

import type {
  ModelCapability,
  ModelLatencyProfile,
  ModelPricing,
  ModelProvider,
  ModelStatus,
  ModelTask,
  QualityTier,
} from "../../../shared/contracts/model";

// ─── Filter ───────────────────────────────────────────────────────────────────

/**
 * Multi-dimensional filter passed by the routing engine (or an internal
 * dev/debug caller) to narrow the set of eligible models.
 *
 * All fields are optional. Absent fields are not used as constraints.
 * When used from the routing engine, `status` defaults to `ModelStatus.Active`.
 */
export interface ModelRegistryFilter {
  /**
   * Only return models that list this task as a supported use-case.
   * e.g. ModelTask.Coding narrows to coding-optimised models.
   */
  taskType?: ModelTask;

  /**
   * Model must declare ALL of the listed capabilities.
   * An empty array (or omitted field) applies no capability constraint.
   * e.g. [ModelCapability.ToolUse, ModelCapability.Vision]
   */
  requiredCapabilities?: ModelCapability[];

  /** Restrict candidates to a single provider. */
  provider?: ModelProvider;

  /**
   * Minimum acceptable quality tier (inclusive).
   *
   * Tier ordering: Economy (0) < Standard (1) < Frontier (2)
   * e.g. minQualityTier = Standard → Economy models are excluded.
   */
  minQualityTier?: QualityTier;

  /**
   * Model context window must be at least this many tokens.
   * Useful for large-input requests that need a wide context window.
   */
  minContextWindow?: number;

  /**
   * Restrict by model status.
   * When called from the routing engine this defaults to Active.
   * Can be set to undefined to retrieve models of all statuses (admin use).
   */
  status?: ModelStatus;
}

// ─── Candidate ────────────────────────────────────────────────────────────────

/**
 * Routing-optimised projection of a registered model.
 *
 * Contains exactly the fields a routing strategy needs to score and select a
 * model. Internal `metadata` and admin-only fields are excluded.
 *
 * The routing engine receives a `ModelCandidate[]` from `ModelRegistryService`
 * and attaches a `ScoreBreakdown` to each before producing a `RoutingDecision`.
 */
export interface ModelCandidate {
  /** Stable UUID — used as the foreign key in Job.modelId */
  id: string;
  /** Canonical model name, e.g. "claude-sonnet-4-6" */
  name: string;
  provider: ModelProvider;
  /** Provider-specific version string, e.g. "4-6" */
  version?: string;
  capabilities: ModelCapability[];
  supportedTasks: ModelTask[];
  qualityTier: QualityTier;
  /** Total context window in tokens (prompt + completion combined) */
  contextWindow: number;
  /** Maximum tokens the model generates per response */
  maxOutputTokens: number;
  /** Cost profile used by cost-optimising strategies */
  pricing: ModelPricing;
  /** Latency profile used by latency-sensitive strategies */
  latencyProfile: ModelLatencyProfile;
  status: ModelStatus;
}
