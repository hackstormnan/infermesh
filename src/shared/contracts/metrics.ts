/**
 * shared/contracts/metrics.ts
 *
 * Contracts for the **Metrics** module — observability and aggregated telemetry.
 *
 * Three tiers of data are defined here:
 *
 *   1. Raw event records (RequestMetricRecord, WorkerMetricRecord) —
 *      emitted per-event by the requests and workers modules and stored
 *      for aggregation. These are internal write models.
 *
 *   2. Aggregated snapshots (AggregatedMetrics, WorkerSnapshot, ModelSnapshot) —
 *      computed over MetricWindow intervals for internal use and the simulation
 *      module. These are lower-level read models.
 *
 *   3. Dashboard DTOs (MetricsSummary, TimeSeriesData, LatencyPercentilesReport,
 *      CostBreakdown) — MetricPeriod-scoped API responses for /metrics/* endpoints.
 *      These are higher-level read models consumed directly by API clients.
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

/**
 * Dashboard query period for the /metrics/* endpoints.
 * Coarser than MetricWindow — intended for human-facing analytics intervals.
 */
export type MetricPeriod = "1h" | "24h" | "7d" | "30d";

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
 * Used internally and by the simulation module.
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

// ─── Dashboard DTOs (MetricPeriod-scoped read models) ─────────────────────────

/**
 * Change indicator comparing a metric value against the prior equivalent period.
 * `percent` is positive for an increase, negative for a decrease.
 */
export interface TrendIndicator {
  /** Absolute change from previous period */
  readonly delta: number;
  /** Percentage change from previous period (positive = increased) */
  readonly percent: number;
  readonly direction: "up" | "down" | "flat";
}

/**
 * Top-level dashboard summary returned by GET /api/v1/metrics/summary.
 * Covers volume, latency, quality, cost, and period-over-period trends.
 */
export interface MetricsSummary {
  readonly period: MetricPeriod;
  readonly generatedAt: IsoTimestamp;
  // ── Volume ──────────────────────────────────────────────────────────────────
  /** Total requests completed in the requested period */
  readonly totalRequests: number;
  /** Requests in the last 24 hours — absolute, independent of `period` */
  readonly requests24h: number;
  /** Average requests per second over the period */
  readonly requestsPerSecond: number;
  // ── Latency ─────────────────────────────────────────────────────────────────
  readonly avgLatencyMs: number;
  readonly p95LatencyMs: number;
  // ── Quality ─────────────────────────────────────────────────────────────────
  /** Fraction of requests that completed successfully (0–1) */
  readonly successRate: number;
  /** Fraction of requests that reached a failure state (0–1) */
  readonly errorRate: number;
  // ── Cost ────────────────────────────────────────────────────────────────────
  readonly totalCostUsd: number;
  readonly avgCostPerRequestUsd: number;
  // ── Trends (vs prior equivalent period) ─────────────────────────────────────
  readonly requestsTrend: TrendIndicator;
  readonly latencyTrend: TrendIndicator;
  readonly errorRateTrend: TrendIndicator;
  readonly costTrend: TrendIndicator;
}

/**
 * Single bucket in a time series aggregated over `granularityMs` milliseconds.
 * Returned as elements of TimeSeriesData.points.
 */
export interface TimeSeriesPoint {
  /** Bucket start time as Unix epoch milliseconds */
  readonly timestamp: number;
  readonly requests: number;
  readonly avgLatencyMs: number;
  readonly costUsd: number;
  readonly errors: number;
}

/**
 * Ordered sequence of time-series buckets for GET /api/v1/metrics/time-series.
 * Points are sorted by timestamp ascending.
 */
export interface TimeSeriesData {
  readonly period: MetricPeriod;
  /** Width of each bucket in milliseconds */
  readonly granularityMs: number;
  readonly points: TimeSeriesPoint[];
  readonly generatedAt: IsoTimestamp;
}

/**
 * Latency percentile breakdown for GET /api/v1/metrics/latency-percentiles.
 */
export interface LatencyPercentilesReport {
  readonly period: MetricPeriod;
  readonly sampleCount: number;
  readonly p50Ms: number;
  readonly p75Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly generatedAt: IsoTimestamp;
}

/**
 * A single model's contribution to total cost.
 */
export interface CostBreakdownEntry {
  readonly modelId: ModelId;
  readonly modelName: string;
  readonly costUsd: number;
  readonly requestCount: number;
  /** This model's share of totalCostUsd (0–100) */
  readonly percentage: number;
}

/**
 * Cost breakdown by model for GET /api/v1/metrics/cost-breakdown.
 * Entries are sorted by costUsd descending.
 */
export interface CostBreakdown {
  readonly period: MetricPeriod;
  readonly totalCostUsd: number;
  readonly entries: CostBreakdownEntry[];
  readonly generatedAt: IsoTimestamp;
}
