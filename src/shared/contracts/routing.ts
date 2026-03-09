/**
 * shared/contracts/routing.ts
 *
 * Contracts for the **Routing** module — the policy-driven placement engine
 * that selects the optimal (model, worker) pair for each InferenceRequest.
 *
 * This file defines *what* routing decisions look like and *what policies*
 * can be configured. The actual placement algorithms live in the routing module.
 *
 * Key concepts:
 *   - RoutingStrategy   — algorithm used to rank candidate workers
 *   - RoutingPolicy     — a named, reusable configuration applied per request
 *   - RoutingConstraint — hard limits that a candidate must satisfy
 *   - RoutingCandidate  — a (model, worker) pair under consideration
 *   - RoutingDecision   — the final output: who handles this request and why
 */

import { z } from "zod";
import type { ModelId, RequestId, WorkerId } from "../primitives";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum RoutingStrategy {
  /** Distribute requests evenly across all healthy workers */
  RoundRobin = "round_robin",
  /** Route to the worker with the lowest current active job count */
  LeastLoaded = "least_loaded",
  /** Prefer the lowest-cost (model, worker) pair that satisfies constraints */
  CostOptimised = "cost_optimised",
  /** Prefer the pair with the lowest historical time-to-first-token */
  LatencyOptimised = "latency_optimised",
  /** Sticky routing — return requests from the same context to the same worker */
  Affinity = "affinity",
  /** Assign a percentage of traffic to a canary worker/model variant */
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

// ─── Value objects ────────────────────────────────────────────────────────────

/**
 * Hard constraints — a candidate is excluded if any constraint is violated.
 * Soft preferences (cost vs latency trade-off) are expressed in the strategy.
 */
export interface RoutingConstraints {
  /** If set, only workers in this region are eligible */
  region?: string;
  /** Maximum acceptable cost in USD for this job */
  maxCostUsd?: number;
  /** Maximum acceptable time-to-first-token in milliseconds */
  maxLatencyMs?: number;
  /** Worker labels that must all be present (key-value equality) */
  requiredLabels?: Record<string, string>;
  /** Model capabilities that the selected model must support */
  requiredCapabilities?: string[];
}

/**
 * A named, reusable routing policy that can be applied to a class of requests.
 * Policies are defined by operators; callers may reference them by name via
 * routing hints, or the router applies a system default.
 */
export interface RoutingPolicy {
  readonly name: string;
  readonly description?: string;
  readonly strategy: RoutingStrategy;
  readonly constraints: RoutingConstraints;
  /** Weight map used only when strategy is Canary */
  readonly canaryWeights?: Record<WorkerId, number>;
  /** Whether to allow automatic fallback if the primary strategy yields no candidates */
  readonly allowFallback: boolean;
  /** Fallback strategy applied when allowFallback is true and primary yields nothing */
  readonly fallbackStrategy?: RoutingStrategy;
}

/**
 * A single (model, worker) combination evaluated during placement.
 * The router scores all candidates and selects the highest-scoring one
 * that passes all hard constraints.
 */
export interface RoutingCandidate {
  modelId: ModelId;
  workerId: WorkerId;
  /** Composite score assigned by the strategy (higher = preferred) */
  score: number;
  /** Estimated cost in USD for this request on this candidate */
  estimatedCostUsd?: number;
  /** Estimated TTFT in milliseconds based on historical latency profile */
  estimatedLatencyMs?: number;
  /** Human-readable explanation of this candidate's score */
  scoreBreakdown?: string;
}

/**
 * The output of a routing evaluation — the final placement decision
 * including the winning candidate and full audit trail.
 */
export interface RoutingDecision {
  readonly requestId: RequestId;
  readonly outcome: RoutingOutcome;
  /** Present when outcome is Routed */
  readonly selectedModelId?: ModelId;
  readonly selectedWorkerId?: WorkerId;
  readonly strategy: RoutingStrategy;
  /** All evaluated candidates (for audit logs and simulation replay) */
  readonly candidates: RoutingCandidate[];
  /** Human-readable explanation of why this candidate was chosen */
  readonly reason: string;
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

export const routingPolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  strategy: z.nativeEnum(RoutingStrategy),
  constraints: routingConstraintsSchema.default({}),
  canaryWeights: z.record(z.number().positive()).optional(),
  allowFallback: z.boolean().default(true),
  fallbackStrategy: z.nativeEnum(RoutingStrategy).optional(),
});

export type CreateRoutingPolicyDto = z.infer<typeof routingPolicySchema>;
