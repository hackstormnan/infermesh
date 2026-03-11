/**
 * shared/contracts/routing.ts
 *
 * Contracts for the **Routing** module — the policy-driven placement engine
 * that selects the optimal (model, worker) pair for each InferenceRequest.
 *
 * Key concepts:
 *   - RoutingStrategy    — algorithm used to rank candidate pairs
 *   - RoutingPolicy      — a named, versioned, persisted policy entity
 *   - RoutingConstraints — hard limits that candidates must satisfy
 *   - ScoreBreakdown     — structured scoring across quality/cost/latency/load
 *   - RoutingCandidate   — a (model, worker) pair under evaluation
 *   - RoutingDecision    — the final placement output with full audit trail
 */

import { z } from "zod";
import type {
  BaseEntity,
  DecisionId,
  JobId,
  ModelId,
  PolicyId,
  RequestId,
  WorkerId,
} from "../primitives";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum RoutingStrategy {
  /** Distribute requests evenly across all healthy workers */
  RoundRobin = "round_robin",
  /** Route to the worker with the lowest current load score */
  LeastLoaded = "least_loaded",
  /** Prefer the lowest-cost (model, worker) pair that satisfies constraints */
  CostOptimised = "cost_optimised",
  /** Prefer the pair with the lowest historical time-to-first-token */
  LatencyOptimised = "latency_optimised",
  /** Sticky routing — return requests from the same context to the same worker */
  Affinity = "affinity",
  /** Split traffic across a canary variant by configured weights */
  Canary = "canary",
}

export enum RoutingOutcome {
  /** A suitable (model, worker) pair was found */
  Routed = "routed",
  /** No workers are available (all offline, draining, or at capacity) */
  NoWorkersAvailable = "no_workers_available",
  /** Workers exist but none satisfies all hard constraints */
  ConstraintsNotMet = "constraints_not_met",
  /** The requested model is not registered or is inactive */
  ModelUnavailable = "model_unavailable",
}

/**
 * Lifecycle status of a routing policy.
 * Only Active policies are considered during routing evaluation.
 */
export enum RoutingPolicyStatus {
  /** This policy is applied to matching requests */
  Active = "active",
  /** Defined but not yet applied — used for staging / preview */
  Inactive = "inactive",
  /** No longer used; retained for audit and simulation replay */
  Archived = "archived",
}

/**
 * Indicates whether a routing decision was produced during live traffic
 * or as part of a simulation run (Ticket 11).
 */
export enum DecisionSource {
  Live = "live",
  Simulation = "simulation",
}

// ─── Value objects ────────────────────────────────────────────────────────────

/**
 * Hard constraints — a candidate is excluded if any constraint is violated.
 * Soft preferences (e.g. cost vs latency trade-off) are encoded in the strategy
 * weights rather than as hard limits.
 */
export interface RoutingConstraints {
  /** If set, only workers in this region are eligible */
  region?: string;
  /** Maximum acceptable estimated cost in USD for this job */
  maxCostUsd?: number;
  /** Maximum acceptable time-to-first-token in milliseconds */
  maxLatencyMs?: number;
  /** Worker labels that must all be present (key-value equality) */
  requiredLabels?: Record<string, string>;
  /** Model capability tags that the selected model must support */
  requiredCapabilities?: string[];
}

/**
 * Dimension weights used by scoring strategies.
 * Each field is a coefficient (0.0–1.0) applied to the corresponding
 * normalised score. Weights need not sum to 1 — they are relative.
 *
 * Example: { quality: 0.5, cost: 0.3, latency: 0.2, load: 0.0 } biases
 * strongly toward model quality, with cost and latency as secondary signals.
 */
export interface StrategyWeights {
  /** Weight applied to the model quality tier score */
  quality: number;
  /** Weight applied to the inverted cost score (lower cost → higher score) */
  cost: number;
  /** Weight applied to the inverted latency score (lower TTFT → higher score) */
  latency: number;
  /** Weight applied to the inverted load score (lower load → higher score) */
  load: number;
}

/**
 * Structured score breakdown for a single routing candidate.
 *
 * Each dimension is normalised to [0, 1] before weighting:
 *   quality  — derived from model.qualityTier (Frontier=1.0, Economy=0.0)
 *   cost     — inverted: lowest-cost candidate scores 1.0
 *   latency  — inverted: fastest candidate scores 1.0
 *   load     — inverted: least-loaded worker scores 1.0
 *   total    — weighted sum using the policy's StrategyWeights
 */
export interface ScoreBreakdown {
  quality: number;
  cost: number;
  latency: number;
  load: number;
  /** Weighted composite — the value used for final candidate ranking */
  total: number;
  /**
   * Human-readable narrative explaining why this score was assigned.
   * Useful for operator dashboards, debugging, and simulation reports.
   */
  rationale: string;
}

// ─── Domain entities ──────────────────────────────────────────────────────────

/**
 * RoutingPolicy — a named, versioned, persisted placement configuration.
 *
 * Immutable fields (readonly) are set at creation and may only change via
 * creating a new version (version is bumped on each update).
 * `status` is the only mutable field — flipped by operators to activate,
 * deactivate, or archive a policy.
 */
export interface RoutingPolicy extends BaseEntity {
  readonly id: PolicyId;
  /** Unique human-readable identifier, e.g. "prod-latency-optimised" */
  readonly name: string;
  readonly description?: string;
  readonly strategy: RoutingStrategy;
  readonly constraints: RoutingConstraints;
  /**
   * Scoring dimension weights applied by the strategy.
   * Only meaningful for weighted strategies (CostOptimised, LatencyOptimised).
   * RoundRobin and LeastLoaded ignore these.
   */
  readonly weights: StrategyWeights;
  /**
   * Traffic split for the Canary strategy.
   * Maps WorkerId → fraction of traffic (0.0–1.0); values should sum to 1.
   */
  readonly canaryWeights?: Record<string, number>;
  readonly allowFallback: boolean;
  readonly fallbackStrategy?: RoutingStrategy;
  /**
   * Priority used when multiple active policies match a request.
   * Higher value = higher priority. Default is 0.
   */
  readonly priority: number;
  /**
   * Monotonically increasing version counter.
   * Bumped on each update so decisions can be audited against the
   * exact policy version that produced them.
   */
  readonly version: number;
  /** Only Active policies are applied during live routing evaluation */
  status: RoutingPolicyStatus;
}

/**
 * A single (model, worker) combination evaluated during placement.
 * The router scores all eligible candidates and selects the highest-scoring
 * one that also passes hard constraints.
 */
export interface RoutingCandidate {
  readonly modelId: ModelId;
  readonly workerId: WorkerId;
  /** Estimated cost in USD for this request on this candidate */
  readonly estimatedCostUsd?: number;
  /** Estimated TTFT in milliseconds based on model + worker latency profiles */
  readonly estimatedLatencyMs?: number;
  /**
   * Structured score breakdown — each dimension is normalised [0, 1].
   * Absent when the candidate was excluded by a hard constraint before scoring.
   */
  readonly scoreBreakdown?: ScoreBreakdown;
  /** True when this candidate was excluded due to a constraint violation */
  readonly excluded: boolean;
  /** Reason the candidate was excluded, if applicable */
  readonly exclusionReason?: string;
}

/**
 * The output of a routing evaluation — the final placement decision
 * with full candidate list, winner selection, and audit metadata.
 *
 * Decisions are immutable once recorded (append-only log).
 */
export interface RoutingDecision extends BaseEntity {
  readonly id: DecisionId;
  readonly requestId: RequestId;
  /** Job associated with this routing decision, if available */
  readonly jobId?: JobId;
  /** The policy that governed this evaluation */
  readonly policyId: PolicyId;
  readonly outcome: RoutingOutcome;
  /** Present when outcome is Routed */
  readonly selectedModelId?: ModelId;
  readonly selectedWorkerId?: WorkerId;
  readonly strategy: RoutingStrategy;
  /** Whether the primary strategy succeeded, or if a fallback was applied */
  readonly usedFallback: boolean;
  /** Human-readable explanation of why the fallback strategy was applied */
  readonly fallbackReason?: string;
  /** All evaluated candidates (for audit, replay, and simulation analysis) */
  readonly candidates: RoutingCandidate[];
  /** Human-readable explanation of why the selected candidate was chosen */
  readonly reason: string;
  /** Whether this decision was produced during live traffic or a simulation run */
  readonly decisionSource: DecisionSource;
  /** Unix epoch ms of when the decision was made */
  readonly decidedAt: number;
  /** Duration of the routing evaluation in milliseconds */
  readonly evaluationMs: number;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const routingConstraintsSchema = z.object({
  region: z.string().optional(),
  maxCostUsd: z.number().positive().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  requiredLabels: z.record(z.string()).optional(),
  requiredCapabilities: z.array(z.string()).optional(),
});

export const strategyWeightsSchema = z.object({
  quality: z.number().min(0).max(1).default(0.25),
  cost: z.number().min(0).max(1).default(0.25),
  latency: z.number().min(0).max(1).default(0.25),
  load: z.number().min(0).max(1).default(0.25),
});

/** Validated shape for creating a new routing policy */
export const createRoutingPolicySchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/, "Policy name must be lowercase alphanumeric with hyphens"),
  description: z.string().optional(),
  strategy: z.nativeEnum(RoutingStrategy),
  constraints: routingConstraintsSchema.default({}),
  weights: strategyWeightsSchema.default({}),
  canaryWeights: z.record(z.number().min(0).max(1)).optional(),
  allowFallback: z.boolean().default(true),
  fallbackStrategy: z.nativeEnum(RoutingStrategy).optional(),
  priority: z.number().int().min(0).default(0),
});

export type CreateRoutingPolicyDto = z.infer<typeof createRoutingPolicySchema>;

/** Validated shape for updating a policy's status */
export const updateRoutingPolicySchema = z.object({
  status: z.nativeEnum(RoutingPolicyStatus).optional(),
  description: z.string().optional(),
});

export type UpdateRoutingPolicyDto = z.infer<typeof updateRoutingPolicySchema>;

// Keep the legacy export alias so existing code compiles without changes
export const routingPolicySchema = createRoutingPolicySchema;
