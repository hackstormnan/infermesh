/**
 * modules/metrics — Observability & Aggregated Metrics
 *
 * Consumes raw metric records emitted by the requests and workers modules,
 * aggregates them over configurable time windows, and exposes read APIs.
 *
 * Depends on shared contracts:
 *   RequestMetricRecord, WorkerMetricRecord (write models)
 *   AggregatedMetrics, WorkerSnapshot, ModelSnapshot (read models)
 *   MetricWindow
 *
 * Will expose (future tickets):
 *   GET /api/v1/metrics/summary          — system-wide aggregated metrics
 *   GET /api/v1/metrics/workers          — per-worker health snapshots
 *   GET /api/v1/metrics/models           — per-model utilisation snapshots
 *   GET /metrics                         — Prometheus-compatible scrape endpoint
 */

export type {
  RequestMetricRecord,
  WorkerMetricRecord,
  AggregatedMetrics,
  WorkerSnapshot,
  ModelSnapshot,
  LatencyPercentiles,
} from "../../shared/contracts/metrics";

export { MetricWindow } from "../../shared/contracts/metrics";
