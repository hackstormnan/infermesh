/**
 * modules/metrics/repository/InMemoryMetricsRepository.ts
 *
 * Stub implementation of IMetricsRepository for local development and testing.
 *
 * All methods return structurally valid but zeroed responses — no actual metric
 * ingestion or aggregation is performed yet.  This is intentional: the domain
 * model, query contracts, and API surface are established here so that a
 * production-grade implementation (backed by InfluxDB, Prometheus, or a
 * time-series DB) can slot in without touching the service or route layers.
 *
 * Not suitable for production deployments.
 */

import type {
  CostBreakdown,
  LatencyPercentilesReport,
  MetricPeriod,
  MetricsSummary,
  TimeSeriesData,
  TimeSeriesPoint,
  TrendIndicator,
} from "../../../shared/contracts/metrics";
import { toIsoTimestamp } from "../../../shared/primitives";
import { PERIOD_DURATION_MS, PERIOD_GRANULARITY_MS } from "../queries";
import type { IMetricsRepository } from "./IMetricsRepository";

// ─── Zero-value helpers ───────────────────────────────────────────────────────

const FLAT_TREND: TrendIndicator = { delta: 0, percent: 0, direction: "flat" };

// ─── Repository ───────────────────────────────────────────────────────────────

export class InMemoryMetricsRepository implements IMetricsRepository {
  async getSummary(period: MetricPeriod): Promise<MetricsSummary> {
    return {
      period,
      generatedAt: toIsoTimestamp(),
      // Volume
      totalRequests: 0,
      requests24h: 0,
      requestsPerSecond: 0,
      // Latency
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      // Quality
      successRate: 0,
      errorRate: 0,
      // Cost
      totalCostUsd: 0,
      avgCostPerRequestUsd: 0,
      // Trends
      requestsTrend: FLAT_TREND,
      latencyTrend: FLAT_TREND,
      errorRateTrend: FLAT_TREND,
      costTrend: FLAT_TREND,
    };
  }

  async getTimeSeries(period: MetricPeriod): Promise<TimeSeriesData> {
    const granularityMs = PERIOD_GRANULARITY_MS[period];
    const durationMs = PERIOD_DURATION_MS[period];
    const bucketCount = Math.round(durationMs / granularityMs);
    const now = Date.now();
    const windowStart = now - durationMs;

    const points: TimeSeriesPoint[] = Array.from({ length: bucketCount }, (_, i) => ({
      timestamp: windowStart + i * granularityMs,
      requests: 0,
      avgLatencyMs: 0,
      costUsd: 0,
      errors: 0,
    }));

    return {
      period,
      granularityMs,
      points,
      generatedAt: toIsoTimestamp(),
    };
  }

  async getLatencyPercentiles(period: MetricPeriod): Promise<LatencyPercentilesReport> {
    return {
      period,
      sampleCount: 0,
      p50Ms: 0,
      p75Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      generatedAt: toIsoTimestamp(),
    };
  }

  async getCostBreakdown(period: MetricPeriod): Promise<CostBreakdown> {
    return {
      period,
      totalCostUsd: 0,
      entries: [],
      generatedAt: toIsoTimestamp(),
    };
  }
}
