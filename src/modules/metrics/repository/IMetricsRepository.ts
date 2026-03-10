/**
 * modules/metrics/repository/IMetricsRepository.ts
 *
 * Port interface for the metrics read-store.
 *
 * All four methods are query-only — this repository never accepts writes
 * directly from callers. Raw metric records are written by the requests and
 * workers modules; the repository implementation is responsible for computing
 * or caching the aggregated views.
 *
 * Implementations:
 *   InMemoryMetricsRepository — stub returning zeroed data (local dev / tests)
 *   Future: TimeSeriesDbMetricsRepository — backed by InfluxDB / Prometheus
 */

import type {
  CostBreakdown,
  LatencyPercentilesReport,
  MetricPeriod,
  MetricsSummary,
  TimeSeriesData,
} from "../../../shared/contracts/metrics";

export interface IMetricsRepository {
  /**
   * Return system-wide summary metrics for the requested period.
   * Includes volume, latency, quality, cost, and trend indicators.
   */
  getSummary(period: MetricPeriod): Promise<MetricsSummary>;

  /**
   * Return bucketed time-series data for the requested period.
   * Bucket granularity is determined by the period (see queries.ts).
   */
  getTimeSeries(period: MetricPeriod): Promise<TimeSeriesData>;

  /**
   * Return latency percentile breakdown for the requested period.
   */
  getLatencyPercentiles(period: MetricPeriod): Promise<LatencyPercentilesReport>;

  /**
   * Return per-model cost breakdown for the requested period.
   * Entries are sorted by cost descending.
   */
  getCostBreakdown(period: MetricPeriod): Promise<CostBreakdown>;
}
