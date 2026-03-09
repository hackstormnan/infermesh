/**
 * shared/contracts/simulation.ts
 *
 * Contracts for the **Simulation** module — load testing and policy backtesting.
 *
 * The simulation module generates synthetic workloads (or replays recorded
 * traffic) against a routing configuration, producing metric snapshots that
 * let operators evaluate policy trade-offs before applying them in production.
 *
 * These contracts define the inputs (SimulationConfig) and outputs
 * (SimulationResult) — not the execution engine itself.
 */

import { z } from "zod";
import type { IsoTimestamp, ModelId, SimulationId, WorkerId } from "../primitives";
import type { AggregatedMetrics } from "./metrics";
import type { RoutingPolicy } from "./routing";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum SimulationStatus {
  /** Config submitted; not yet started */
  Pending = "pending",
  /** Actively generating and routing synthetic requests */
  Running = "running",
  /** Completed normally */
  Completed = "completed",
  /** Stopped early by an operator */
  Cancelled = "cancelled",
  /** Terminated due to an internal error */
  Failed = "failed",
}

// ─── Value objects ────────────────────────────────────────────────────────────

/**
 * Describes how synthetic request traffic should be shaped.
 * Models a Poisson arrival process with a configurable mean rate.
 */
export interface TrafficProfile {
  /** Target average requests per second */
  arrivalRateRps: number;
  /** Total number of requests to generate (simulation ends when reached) */
  totalRequests: number;
  /**
   * Probability distribution over model IDs for request generation.
   * Keys are model IDs; values are weights (need not sum to 1 — normalised internally).
   * e.g. { "claude-sonnet": 0.7, "gpt-4o": 0.3 }
   */
  modelWeights: Record<string, number>;
  /**
   * Token count distribution. Requests are sampled from this range uniformly.
   * More realistic distributions can be added in a future ticket.
   */
  tokenRange: { minTokens: number; maxTokens: number };
}

/**
 * A virtual worker definition used only within the simulation.
 * Allows testing hypothetical worker pools without real infrastructure.
 */
export interface SimulatedWorker {
  /** Reference to a real worker ID, or a synthetic identifier */
  workerId: WorkerId;
  modelIds: ModelId[];
  region: string;
  maxConcurrentJobs: number;
  /** Simulated TTFT in milliseconds (used instead of real network latency) */
  simulatedTtftMs: number;
  /** Simulated tokens/second throughput */
  simulatedThroughputTps: number;
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * SimulationConfig — the complete specification for a simulation run.
 * Submitted by an operator via the API; executed by the simulation module.
 */
export interface SimulationConfig {
  readonly id: SimulationId;
  readonly name: string;
  readonly description?: string;
  /** The routing policy under test */
  readonly policy: RoutingPolicy;
  readonly trafficProfile: TrafficProfile;
  /** Virtual worker pool; if empty, uses the live worker registry */
  readonly workers: SimulatedWorker[];
  /** If provided, replay this recorded traffic trace instead of generating synthetic requests */
  readonly replayTraceId?: string;
  readonly createdAt: IsoTimestamp;
}

/**
 * SimulationResult — metrics produced by a completed simulation run.
 * Stored alongside the config so operators can compare runs.
 */
export interface SimulationResult {
  readonly simulationId: SimulationId;
  readonly status: SimulationStatus;
  /** Aggregated metrics produced over the full simulation window */
  readonly metrics?: AggregatedMetrics;
  /** Per-strategy breakdown when comparing multiple strategies in one run */
  readonly strategyBreakdown?: Record<string, AggregatedMetrics>;
  readonly startedAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
  readonly failureReason?: string;
  /** Total wall-clock duration of the simulation in milliseconds */
  readonly durationMs?: number;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const trafficProfileSchema = z.object({
  arrivalRateRps: z.number().positive().max(10_000),
  totalRequests: z.number().int().positive().max(1_000_000),
  modelWeights: z.record(z.number().positive()),
  tokenRange: z.object({
    minTokens: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
  }).refine((r) => r.maxTokens >= r.minTokens, {
    message: "maxTokens must be >= minTokens",
  }),
});

export const simulatedWorkerSchema = z.object({
  workerId: z.string().min(1),
  modelIds: z.array(z.string().min(1)).min(1),
  region: z.string().default("default"),
  maxConcurrentJobs: z.number().int().positive(),
  simulatedTtftMs: z.number().int().nonnegative(),
  simulatedThroughputTps: z.number().positive(),
});

/** Validated shape for POST /simulations */
export const createSimulationSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  policy: z.object({
    name: z.string().min(1),
    strategy: z.string(),
    constraints: z.record(z.unknown()).default({}),
    allowFallback: z.boolean().default(true),
  }),
  trafficProfile: trafficProfileSchema,
  workers: z.array(simulatedWorkerSchema).default([]),
  replayTraceId: z.string().optional(),
});

export type CreateSimulationDto = z.infer<typeof createSimulationSchema>;

/** Public-facing simulation status shape returned by GET /simulations/:id */
export interface SimulationDto {
  id: string;
  name: string;
  description?: string;
  status: SimulationStatus;
  trafficProfile: TrafficProfile;
  workerCount: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  failureReason?: string;
  createdAt: string;
}
