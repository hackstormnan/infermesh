/**
 * shared/contracts/worker.ts
 *
 * Contracts for the **Workers** module — the registry of inference workers
 * that can execute AI jobs on behalf of InferMesh.
 *
 * A worker is any process (local or remote) that:
 *   1. Registers itself with InferMesh on startup
 *   2. Sends periodic heartbeats to report capacity and health
 *   3. Receives job dispatch payloads and executes them
 *   4. Reports completion (tokens, duration) back to the requests module
 *
 * Layers:
 *   - Enums         — WorkerStatus
 *   - Entity        — Worker (internal registry record)
 *   - DTOs          — WorkerRegistrationDto, WorkerHeartbeatDto, WorkerDto
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
 * The router uses these values for least-loaded routing.
 */
export interface WorkerCapacity {
  /** Number of jobs currently executing */
  activeJobs: number;
  /** Maximum concurrent jobs this worker can handle */
  maxConcurrentJobs: number;
  /** Approximate number of jobs waiting in the worker's local queue */
  queuedJobs: number;
}

// ─── Domain entity ────────────────────────────────────────────────────────────

/**
 * Worker — a registered inference executor in the InferMesh network.
 * Created on first registration; updated on every heartbeat.
 */
export interface Worker extends BaseEntity {
  readonly id: WorkerId;
  /** Display name for dashboards and logs */
  readonly name: string;
  /** Base URL the worker listens on for dispatch payloads */
  readonly endpoint: string;
  /** Set of model IDs this worker can execute */
  readonly supportedModelIds: ModelId[];
  /** Geographic or logical region, used for affinity routing */
  readonly region: string;
  status: WorkerStatus;
  capacity: WorkerCapacity;
  /** Unix epoch ms of last received heartbeat */
  lastHeartbeatAt: number;
  /** Free-form labels for custom routing affinity rules */
  labels: Record<string, string>;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const workerCapacitySchema = z.object({
  activeJobs: z.number().int().nonnegative(),
  maxConcurrentJobs: z.number().int().positive(),
  queuedJobs: z.number().int().nonnegative(),
});

/** Validated shape for POST /workers (worker self-registration) */
export const registerWorkerSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().url("Worker endpoint must be a valid URL"),
  supportedModelIds: z
    .array(z.string().min(1))
    .min(1, "Worker must support at least one model"),
  region: z.string().default("default"),
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
});

export type WorkerHeartbeatDto = z.infer<typeof workerHeartbeatSchema>;

// ─── API DTO ──────────────────────────────────────────────────────────────────

/** Public-facing worker shape returned by GET /workers and GET /workers/:id */
export interface WorkerDto {
  id: string;
  name: string;
  endpoint: string;
  supportedModelIds: string[];
  region: string;
  status: WorkerStatus;
  capacity: WorkerCapacity;
  lastHeartbeatAt: number;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
