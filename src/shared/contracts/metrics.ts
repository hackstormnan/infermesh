/**
 * shared/contracts/metrics.ts
 *
 * Contracts for the **Metrics** module — observability and aggregated telemetry.
 *
 * Two tiers of data are defined here:
 *
 *   1. Raw event records (RequestMetricRecord, WorkerMetricRecord) —
 *      emitted per-event by the requests and workers modules and stored
 *      for aggregation. These are internal write models.
 *
 *   2. Aggregated snapshots (AggregatedMetrics, WorkerSnapshot) —
 *      computed over time windows and exposed via the /metrics API.
 *      These are read models for dashboards and the simulation module.
 */

import type { IsoTimestamp, ModelId, RequestId, WorkerId } from "../primitives";
import type { RequestStatus } from "./request";

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum MetricWindow {
  /** Last 60 seconds */
  OneMinute = "1m",
  /** Last 5 minutes */
  FiveMinutes = "5m",
  /** Last 15 minutes */
  FifteenMinutes = "15m",
  /** Last 60 minutes */
  OneHour = "1h",
  /** Last 24 hours */
  OneDay = "1d",
}

// ─── Raw event records (write models) ────────────────────────────────────────

/**
 * Emitted once per completed InferenceRequest.
 * Written by the requests module; consumed by the metrics aggregator.
 */
export interface RequestMetricRecord {
  readonly requestId: RequestId;
  readonly modelId: ModelId;
  readonly workerId: WorkerId;
  readonly status: RequestStatus;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** Total end-to-end duration in milliseconds (from intake to terminal state) */
  readonly durationMs: number;
  /** Time-to-first-token in milliseconds (undefined for non-streaming requests) */
  readonly ttftMs?: number;
  /** Estimated cost in USD for this request */
  readonly estimatedCostUsd?: number;
  readonly timestamp: IsoTimestamp;
}

/**
 * Emitted per worker on each heartbeat cycle.
 * Written by the workers module; consumed by the metrics aggregator.
 */
export interface WorkerMetricRecord {
  readonly workerId: WorkerId;
  readonly activeJobs: number;
  readonly queuedJobs: number;
  /** Error rate over the last 60 seconds (0.0 – 1.0) */
  readonly errorRate: number;
  /** Tokens generated per second over the last 60 seconds */
  readonly throughputTokensPerSec: number;
  readonly timestamp: IsoTimestamp;
}

// ─── Percentile snapshot ──────────────────────────────────────────────────────

export interface LatencyPercentiles {
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
}

// ─── Aggregated snapshots (read models) ───────────────────────────────────────

/**
 * System-wide aggregated metrics over a time window.
 * Returned by GET /metrics/summary.
 */
export interface AggregatedMetrics {
  window: MetricWindow;
  windowStartAt: IsoTimestamp;
  windowEndAt: IsoTimestamp;
  /** Total requests that entered the system */
  totalRequests: number;
  /** Requests completed successfully */
  successfulRequests: number;
  /** Requests that reached a terminal failure state */
  failedRequests: number;
  /** Requests cancelled by the caller */
  cancelledRequests: number;
  /** Requests per second averaged over the window */
  throughputRps: number;
  /** Total tokens processed (in + out) across all requests */
  totalTokens: number;
  /** End-to-end request duration percentiles */
  latency: LatencyPercentiles;
  /** Time-to-first-token percentiles (streaming requests only) */
  ttft: LatencyPercentiles;
  /** Total estimated cost in USD for all requests in the window */
  totalCostUsd: number;
}

/**
 * Per-worker health and throughput snapshot.
 * Returned by GET /metrics/workers.
 */
export interface WorkerSnapshot {
  workerId: WorkerId;
  windowStartAt: IsoTimestamp;
  activeJobs: number;
  queuedJobs: number;
  completedJobsInWindow: number;
  failedJobsInWindow: number;
  errorRate: number;
  throughputTokensPerSec: number;
}

/**
 * Per-model utilisation snapshot.
 * Returned by GET /metrics/models.
 */
export interface ModelSnapshot {
  modelId: ModelId;
  windowStartAt: IsoTimestamp;
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  averageDurationMs: number;
  errorRate: number;
}
