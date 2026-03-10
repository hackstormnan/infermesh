/**
 * modules/metrics/service/metrics.service.ts
 *
 * Service layer for the metrics module.
 *
 * Route handlers call this service — they never access repositories directly.
 * The service owns structured logging and any future cross-cutting concerns
 * (caching, access control checks, result enrichment).
 *
 * ─── Operations ───────────────────────────────────────────────────────────────
 *   getSummary          — system-wide summary with trends
 *   getTimeSeries       — bucketed time-series for volume, latency, cost, errors
 *   getLatencyPercentiles — p50/p75/p95/p99 breakdown
 *   getCostBreakdown    — per-model cost share
 *
 * ─── Future work ──────────────────────────────────────────────────────────────
 *   When metric ingestion is wired (Ticket 9), ingestRequest() and
 *   ingestWorkerHeartbeat() will be added here. The repository will shift
 *   from a stub to a real aggregator, but the service signature stays stable.
 */

import type { RequestContext } from "../../../core/context";
import type {
  CostBreakdown,
  LatencyPercentilesReport,
  MetricsSummary,
  TimeSeriesData,
} from "../../../shared/contracts/metrics";
import type { MetricsQuery } from "../queries";
import type { IMetricsRepository } from "../repository/IMetricsRepository";

export class MetricsService {
  constructor(private readonly repo: IMetricsRepository) {}

  async getSummary(
    ctx: RequestContext,
    query: MetricsQuery,
  ): Promise<MetricsSummary> {
    ctx.log.debug({ period: query.period }, "Fetching metrics summary");
    return this.repo.getSummary(query.period);
  }

  async getTimeSeries(
    ctx: RequestContext,
    query: MetricsQuery,
  ): Promise<TimeSeriesData> {
    ctx.log.debug({ period: query.period }, "Fetching time-series metrics");
    return this.repo.getTimeSeries(query.period);
  }

  async getLatencyPercentiles(
    ctx: RequestContext,
    query: MetricsQuery,
  ): Promise<LatencyPercentilesReport> {
    ctx.log.debug({ period: query.period }, "Fetching latency percentiles");
    return this.repo.getLatencyPercentiles(query.period);
  }

  async getCostBreakdown(
    ctx: RequestContext,
    query: MetricsQuery,
  ): Promise<CostBreakdown> {
    ctx.log.debug({ period: query.period }, "Fetching cost breakdown");
    return this.repo.getCostBreakdown(query.period);
  }
}

// ─── Public DTO re-exports ────────────────────────────────────────────────────
// Route handlers import DTOs from the service to avoid reaching into shared contracts.

export type {
  MetricPeriod,
  MetricsSummary,
  TimeSeriesData,
  LatencyPercentilesReport,
  CostBreakdown,
  CostBreakdownEntry,
  TimeSeriesPoint,
  TrendIndicator,
} from "../../../shared/contracts/metrics";
