/**
 * modules/workers/registry/worker-registry.contract.ts
 *
 * Assignment-facing types for the worker registry service.
 *
 * These types cross the boundary between the workers module and the routing /
 * assignment engine (Ticket 15+). They are kept separate from the admin-facing
 * WorkerDto so each concern can evolve independently.
 *
 *   WorkerAssignmentFilter — criteria the routing engine passes at lookup time
 *   WorkerCandidate        — assignment-ready projection of a registered worker
 */

import type { WorkerHardware, WorkerStatus } from "../../../shared/contracts/worker";

// ─── Filter ───────────────────────────────────────────────────────────────────

/**
 * Multi-dimensional filter passed by the routing / assignment engine (or an
 * internal dev/debug caller) to narrow the pool of eligible workers.
 *
 * All fields are optional. Absent fields are not used as constraints.
 *
 * Default behaviour when used from routing:
 *   - `statuses` defaults to [Idle, Busy] (both can still accept jobs)
 *   - `maxLoadScore` is not enforced unless explicitly set
 *   - Workers whose `loadScore` is undefined always pass the load filter
 *     (the score may simply not have been reported yet)
 */
export interface WorkerAssignmentFilter {
  /**
   * Worker must list this model ID in `supportedModelIds`.
   * The primary filter used by the routing engine to match job → worker.
   */
  requiredModelId?: string;

  /**
   * Worker must have ALL of these keys present in its `labels` map.
   * Used for capability-based affinity (e.g. "vision-enabled", "high-memory").
   * An empty array (or omitted field) applies no label constraint.
   */
  requiredCapabilityTags?: string[];

  /**
   * Restrict to workers in this region (exact match, case-insensitive).
   * Used for latency-aware routing and data-residency constraints.
   */
  preferredRegion?: string;

  /**
   * Worker's `capacity.queuedJobs` must be ≤ this threshold.
   * Prevents dispatching to workers with already-deep local queues.
   */
  maxQueueSize?: number;

  /**
   * Worker's `runtimeMetrics.loadScore` must be ≤ this value (0.0–1.0).
   * Workers whose `loadScore` is undefined are not excluded by this filter.
   */
  maxLoadScore?: number;

  /**
   * Worker's `lastHeartbeatAt` must be within this many milliseconds of now.
   * Excludes workers whose heartbeat has gone stale (likely unreachable).
   * e.g. 30_000 rejects workers that haven't reported in over 30 seconds.
   */
  minHeartbeatFreshnessMs?: number;

  /**
   * Restrict by lifecycle status.
   * Defaults to [Idle, Busy] when not provided.
   * Supply [Idle] for strict dispatch-only filtering.
   */
  statuses?: WorkerStatus[];

  /**
   * Restrict by hardware instance type (exact match).
   * e.g. "g4dn.xlarge" or "a100-80gb"
   */
  instanceType?: string;

  /**
   * When true, only GPU-accelerated workers (hardware.gpuModel is set) pass.
   * When false or omitted, GPU presence is not required.
   */
  gpuRequired?: boolean;
}

// ─── Candidate ────────────────────────────────────────────────────────────────

/**
 * Assignment-optimised projection of a registered worker.
 *
 * Contains exactly the fields a routing / load-balancing strategy needs to
 * score and select a worker. Internal fields such as `endpoint` (which should
 * not be shared with callers outside the dispatch path) are excluded.
 *
 * `availableSlots` is eagerly computed so scoring strategies do not need to
 * re-derive it from `maxConcurrentJobs - activeJobs` at every call site.
 */
export interface WorkerCandidate {
  /** Stable UUID — used as the foreign key in Job.workerId */
  id: string;
  name: string;
  region: string;
  status: WorkerStatus;
  hardware: WorkerHardware;
  /** Set of model IDs this worker can execute */
  supportedModelIds: string[];
  /** Free-form labels for affinity rules — e.g. { "vision-enabled": "true" } */
  labels: Record<string, string>;

  // ── Capacity snapshot (from last heartbeat) ────────────────────────────────
  activeJobs: number;
  maxConcurrentJobs: number;
  queuedJobs: number;
  /**
   * Remaining concurrency headroom: `maxConcurrentJobs - activeJobs`.
   * Pre-computed so routing strategies can rank by capacity without
   * recalculating on every candidate.
   */
  availableSlots: number;

  // ── Runtime metrics (may be absent if not yet reported) ───────────────────
  /** Composite load score 0.0 (idle) – 1.0 (saturated) */
  loadScore?: number;
  /** Output throughput in tokens per second */
  tokensPerSecond?: number;
  /** Observed time-to-first-token in ms */
  ttftMs?: number;
  /** CPU utilisation percentage */
  cpuUsagePercent?: number;
  /** Memory utilisation percentage */
  memoryUsagePercent?: number;

  // ── Freshness ─────────────────────────────────────────────────────────────
  /** Unix epoch ms of the most recent received heartbeat */
  lastHeartbeatAt: number;
}
