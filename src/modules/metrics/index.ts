/**
 * modules/metrics — Observability & Dashboard Metrics
 *
 * Owns the domain model and API surface for system-wide observability.
 * Four read-only endpoints expose aggregated views of request volume,
 * latency distributions, cost allocation, and period-over-period trends.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repositories, service, routes) are not re-exported.
 * Cross-module access goes through the public service instance or DTO types.
 *
 * ─── Key consumers ───────────────────────────────────────────────────────────
 * - Dashboard / frontend clients: call the /metrics/* REST endpoints
 * - Simulation module (Ticket 11): will call metricsService directly to
 *   compare simulated vs live policy performance
 *
 * ─── Repository design ───────────────────────────────────────────────────────
 * IMetricsRepository is a pure read-store; it never accepts direct writes.
 * Metric ingestion (from requests / workers modules) and aggregation will be
 * wired in Ticket 9. The InMemoryMetricsRepository returns zeroed stubs for now.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET /api/v1/metrics/summary             — system-wide summary + trends
 *   GET /api/v1/metrics/time-series         — bucketed time-series data
 *   GET /api/v1/metrics/latency-percentiles — p50/p75/p95/p99 breakdown
 *   GET /api/v1/metrics/cost-breakdown      — per-model cost allocation
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { metricsRoute } from "../modules/metrics";
 *   fastify.register(metricsRoute, { prefix: "/api/v1" });
 */

import { InMemoryMetricsRepository } from "./repository/InMemoryMetricsRepository";
import { MetricsService } from "./service/metrics.service";
import { buildMetricsRoute } from "./routes/metrics.route";

// ─── Module composition ───────────────────────────────────────────────────────

const metricsRepo = new InMemoryMetricsRepository();

/** Singleton service instance — shared across the process lifetime */
export const metricsService = new MetricsService(metricsRepo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const metricsRoute = buildMetricsRoute(metricsService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export type {
  MetricPeriod,
  MetricsSummary,
  TimeSeriesData,
  TimeSeriesPoint,
  LatencyPercentilesReport,
  CostBreakdown,
  CostBreakdownEntry,
  TrendIndicator,
  // Lower-level aggregated models (used by simulation module)
  AggregatedMetrics,
  WorkerSnapshot,
  ModelSnapshot,
  LatencyPercentiles,
  // Raw write models (used by requests / workers modules)
  RequestMetricRecord,
  WorkerMetricRecord,
} from "../../shared/contracts/metrics";

export { MetricWindow } from "../../shared/contracts/metrics";

export type { MetricsQuery } from "./queries";
export { metricsQuerySchema, METRIC_PERIODS, PERIOD_DURATION_MS, PERIOD_GRANULARITY_MS } from "./queries";

export type { IMetricsRepository } from "./repository/IMetricsRepository";
