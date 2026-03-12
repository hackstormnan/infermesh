/**
 * modules/simulation/experiment/experiment-runner.contract.ts
 *
 * Input/output contracts for the policy experiment runner.
 *
 * A policy experiment runs the same synthetic workload through multiple routing
 * policies and produces a side-by-side comparison of their performance metrics.
 * All simulation runs in an experiment are fully isolated from the live system
 * (same guarantees as SimulationEngineService).
 *
 * ─── Key types ────────────────────────────────────────────────────────────────
 *   ExperimentRunInput       — what to compare (policies + workload config)
 *   PolicyComparisonResult   — per-policy metrics derived from a simulation run
 *   ExperimentRankings       — ordered policy lists per metric dimension
 *   ExperimentResult         — top-level output containing all policy results
 *
 * ─── Isolation guarantees ────────────────────────────────────────────────────
 *   Inherited from SimulationEngineService — see that module for full details.
 *   Each policy run uses a fresh in-memory decision repository and carries
 *   DecisionSource.Simulation on every routing call.
 */

import { z } from "zod";
import { workloadConfigSchema } from "../workload/workload-generator.contract";
import type { ModelCandidate } from "../../models/registry/model-registry.contract";
import type { WorkerCandidate } from "../../workers/registry/worker-registry.contract";

// ─── Input ────────────────────────────────────────────────────────────────────

/**
 * Input to a single experiment run.
 *
 * The workload is generated once and reused identically across all policy runs.
 * Providing a `randomSeed` inside `workloadConfig` makes the experiment fully
 * deterministic and reproducible.
 */
export interface ExperimentRunInput {
  /** Human-readable name for this experiment (e.g. "cost-vs-latency-q1-2026") */
  experimentName: string;

  /**
   * Policy names or UUIDs to evaluate.
   * Each policy receives an independent simulation run with the same workload.
   * At least one policy is required; a maximum of 20 is enforced via the HTTP
   * schema to bound response latency.
   */
  policies: string[];

  /**
   * Workload configuration passed to WorkloadGeneratorService.generateWorkload().
   * The generated profiles are shared across all policy runs — set `randomSeed`
   * for reproducible comparisons.
   */
  workloadConfig: { requestCount: number; [key: string]: unknown };

  /**
   * Fixed model candidate list forwarded to every simulation run.
   * Bypasses the live model registry — useful for controlled infrastructure
   * comparisons where the model pool should be identical across runs.
   * Programmatic-only (not exposed via HTTP in this version).
   */
  modelOverrides?: ModelCandidate[];

  /**
   * Fixed worker candidate list forwarded to every simulation run.
   * Same isolation rationale as modelOverrides.
   * Programmatic-only.
   */
  workerOverrides?: WorkerCandidate[];

  /** Free-form tag attached to every simulation run for downstream filtering */
  sourceTag?: string;
}

// ─── Per-policy result ────────────────────────────────────────────────────────

/**
 * Metrics derived from a single policy's simulation run.
 *
 * Rates are normalised to [0, 1]:
 *   successRate   = successCount / totalRequests
 *   fallbackRate  = fallbackCount / successCount  (0 when successCount = 0)
 */
export interface PolicyComparisonResult {
  /** Policy UUID resolved by the routing engine */
  policyId: string;
  /** Human-readable policy name */
  policyName: string;
  /** Server-assigned UUID of the underlying simulation run */
  runId: string;

  // ── Counts ────────────────────────────────────────────────────────────────
  totalRequests: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;

  // ── Derived rates ─────────────────────────────────────────────────────────
  /** Fraction of requests that produced a successful routing decision [0, 1] */
  successRate: number;
  /** Fraction of successful decisions that used the fallback strategy [0, 1] */
  fallbackRate: number;

  // ── Latency proxy ─────────────────────────────────────────────────────────
  /**
   * Mean routing evaluation time in milliseconds across successful decisions.
   * This is the time spent inside decideRoute() — a proxy for routing overhead,
   * not end-to-end model latency.
   */
  averageEvaluationMs: number;

  // ── Distribution breakdowns ───────────────────────────────────────────────
  /** How many times each model was selected across successful decisions */
  perModelSelections: Record<string, number>;
  /** How many times each worker was assigned across successful decisions */
  perWorkerAssignments: Record<string, number>;
}

// ─── Rankings ─────────────────────────────────────────────────────────────────

/**
 * Ordered policy lists, one per comparable metric dimension.
 * Each list is sorted best → worst for that dimension:
 *   bySuccessRate     — highest success rate first
 *   byFallbackRate    — lowest fallback rate first (fewer fallbacks = better)
 *   byEvaluationSpeed — fastest (lowest averageEvaluationMs) first
 */
export interface ExperimentRankings {
  /** Policy IDs ordered by successRate descending (best first) */
  bySuccessRate: string[];
  /** Policy IDs ordered by fallbackRate ascending (fewest fallbacks first) */
  byFallbackRate: string[];
  /** Policy IDs ordered by averageEvaluationMs ascending (fastest first) */
  byEvaluationSpeed: string[];
}

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * Top-level output of an experiment run.
 *
 * Contains per-policy metrics and pre-computed rankings so consumers can
 * immediately identify the best-performing policy without post-processing.
 */
export interface ExperimentResult {
  /** Server-assigned UUID for this experiment */
  experimentId: string;
  /** Experiment name from the input */
  experimentName: string;
  /** Number of synthetic requests generated and routed per policy */
  workloadRequestCount: number;
  /** Ordered list of evaluated policy IDs (same order as input) */
  policies: string[];
  /** ISO 8601 timestamp when the experiment started */
  startedAt: string;
  /** ISO 8601 timestamp when all policy runs completed */
  completedAt: string;
  /** Total wall-clock duration in milliseconds */
  durationMs: number;
  /** Per-policy simulation result summary (same order as input.policies) */
  results: PolicyComparisonResult[];
  /** Pre-computed rankings across all metric dimensions */
  rankings: ExperimentRankings;
}

// ─── HTTP schema ──────────────────────────────────────────────────────────────

/**
 * Zod schema for POST /simulation/experiments request body.
 *
 * Model/worker overrides are programmatic-only and not exposed here.
 * `workloadConfig` includes the full workload configuration with optional
 * distributions, burst pattern, and seed.
 */
export const experimentRunHttpSchema = z.object({
  experimentName: z.string().min(1),
  /** At least 1 policy; maximum 20 to bound synchronous response latency */
  policies: z.array(z.string().min(1)).min(1).max(20),
  workloadConfig: workloadConfigSchema,
  sourceTag: z.string().optional(),
});

export type ExperimentRunHttpInput = z.infer<typeof experimentRunHttpSchema>;
