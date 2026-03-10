/**
 * shared/contracts/worker.ts
 *
 * Contracts for the **Workers** module — the registry of inference workers
 * that can execute AI jobs on behalf of InferMesh.
 *
 * A worker is any process (local or remote) that:
 *   1. Registers itself with InferMesh on startup
 *   2. Sends periodic heartbeats to report capacity, health, and runtime metrics
 *   3. Receives job dispatch payloads and executes them
 *   4. Reports completion (tokens, duration) back to the requests module
 *
 * Layers:
 *   - Enums         — WorkerStatus
 *   - Value objects — WorkerCapacity, WorkerHardware, WorkerRuntimeMetrics
 *   - Entity        — Worker (internal registry record)
 *   - DTOs          — RegisterWorkerDto, WorkerHeartbeatDto, WorkerDto, WorkerUpdate
 *   - Zod schemas   — for validating registration and heartbeat payloads
 */

import { z } from "zod";
import type { BaseEntity, ModelId, WorkerId } from "../primitives";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum WorkerStatus {
  /** Online and below capacity — can accept new jobs */
  Idle = "idle",
  /** Online and at or near capacity — router may deprioritise */
  Busy = "busy",
  /** Finishing current jobs; not accepting new dispatches */
  Draining = "draining",
  /** Unhealthy or missed heartbeat deadline; excluded from routing */
  Unhealthy = "unhealthy",
  /** Gracefully shut down or deregistered */
  Offline = "offline",
}

// ─── Value objects ────────────────────────────────────────────────────────────

/**
 * Real-time capacity snapshot reported in each heartbeat.
 * The routing engine uses these values for least-loaded placement.
 */
export interface WorkerCapacity {
  /** Number of jobs currently executing */
  activeJobs: number;
  /** Maximum concurrent jobs this worker can handle */
  maxConcurrentJobs: number;
  /** Approximate number of jobs waiting in the worker's local queue */
  queuedJobs: number;
}

/**
 * Hardware description set at registration time — never changes.
 * Used by routing strategies that require GPU capability or a specific
 * hardware tier (e.g. routing vision workloads to GPU workers only).
 */
export interface WorkerHardware {
  /**
   * Cloud instance type or hardware label.
   * e.g. "g4dn.xlarge", "a100-80gb", "cpu-only", "m5.2xlarge"
   */
  instanceType: string;
  /**
   * GPU model name for accelerated workers.
   * Omitted for CPU-only workers.
   * e.g. "NVIDIA A100 80GB", "NVIDIA L4", "AMD MI300X"
   */
  gpuModel?: string;
}

/**
 * Runtime metrics reported on each heartbeat.
 * Used by the routing engine to compute load scores and avoid hot workers.
 * All fields are optional — workers report what they can observe.
 */
export interface WorkerRuntimeMetrics {
  /** Observed output throughput in tokens per second */
  tokensPerSecond?: number;
  /**
   * Composite load score: 0.0 = idle, 1.0 = fully saturated.
   * Workers may compute this from activeJobs / maxConcurrentJobs or
   * from GPU/CPU utilisation — whichever is more representative.
   */
  loadScore?: number;
  /** Observed time-to-first-token in milliseconds (rolling average) */
  ttftMs?: number;
  /** CPU utilisation percentage (0–100) */
  cpuUsagePercent?: number;
  /** Memory utilisation percentage (0–100) */
  memoryUsagePercent?: number;
  /** Worker process uptime in seconds */
  uptimeSeconds?: number;
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * Worker — a registered inference executor in the InferMesh network.
 *
 * Immutable fields (readonly) are set at registration and never change.
 * Mutable fields (status, capacity, lastHeartbeatAt, labels, runtimeMetrics)
 * are updated on every heartbeat by the workers service.
 */
export interface Worker extends BaseEntity {
  readonly id: WorkerId;
  /** Display name for dashboards and logs */
  readonly name: string;
  /** Base URL the worker listens on for dispatch payloads */
  readonly endpoint: string;
  /** Set of model IDs this worker can execute */
  readonly supportedModelIds: ModelId[];
  /** Geographic or logical region — used for affinity and latency routing */
  readonly region: string;
  /** Hardware description set at registration */
  readonly hardware: WorkerHardware;
  /** Current lifecycle status */
  status: WorkerStatus;
  /** Real-time concurrency snapshot — updated every heartbeat */
  capacity: WorkerCapacity;
  /** Unix epoch ms of the last received heartbeat */
  lastHeartbeatAt: number;
  /** Observed runtime metrics — updated every heartbeat */
  runtimeMetrics: WorkerRuntimeMetrics;
  /** Free-form labels for custom routing affinity rules */
  labels: Record<string, string>;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const workerCapacitySchema = z.object({
  activeJobs: z.number().int().nonnegative(),
  maxConcurrentJobs: z.number().int().positive(),
  queuedJobs: z.number().int().nonnegative(),
});

export const workerHardwareSchema = z.object({
  instanceType: z.string().min(1),
  gpuModel: z.string().optional(),
});

export const workerRuntimeMetricsSchema = z.object({
  tokensPerSecond: z.number().nonnegative().optional(),
  loadScore: z.number().min(0).max(1).optional(),
  ttftMs: z.number().int().nonnegative().optional(),
  cpuUsagePercent: z.number().min(0).max(100).optional(),
  memoryUsagePercent: z.number().min(0).max(100).optional(),
  uptimeSeconds: z.number().nonnegative().optional(),
});

/** Validated shape for POST /workers (worker self-registration) */
export const registerWorkerSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().url("Worker endpoint must be a valid URL"),
  supportedModelIds: z
    .array(z.string().min(1))
    .min(1, "Worker must support at least one model"),
  region: z.string().default("default"),
  hardware: workerHardwareSchema,
  capacity: workerCapacitySchema,
  labels: z.record(z.string()).default({}),
});

export type RegisterWorkerDto = z.infer<typeof registerWorkerSchema>;

/** Validated shape for POST /workers/:id/heartbeat */
export const workerHeartbeatSchema = z.object({
  status: z.nativeEnum(WorkerStatus),
  capacity: workerCapacitySchema,
  /** Unix epoch ms — server uses this to detect clock skew */
  reportedAt: z.number().int().positive(),
  /** Runtime metrics observed since the last heartbeat */
  runtimeMetrics: workerRuntimeMetricsSchema.optional().default({}),
});

export type WorkerHeartbeatDto = z.infer<typeof workerHeartbeatSchema>;

// ─── API DTO (response projection) ───────────────────────────────────────────

/** Public-facing worker shape returned by GET /workers and GET /workers/:id */
export interface WorkerDto {
  id: string;
  name: string;
  endpoint: string;
  supportedModelIds: string[];
  region: string;
  hardware: WorkerHardware;
  status: WorkerStatus;
  capacity: WorkerCapacity;
  lastHeartbeatAt: number;
  runtimeMetrics: WorkerRuntimeMetrics;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// ─── Patch type ───────────────────────────────────────────────────────────────

/**
 * Partial update applied to mutable Worker fields.
 * Passed to IWorkerRepository.update() by the service layer.
 */
export type WorkerUpdate = Partial<
  Pick<
    Worker,
    | "status"
    | "capacity"
    | "lastHeartbeatAt"
    | "runtimeMetrics"
    | "labels"
  >
>;
