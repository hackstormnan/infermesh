/**
 * modules/metrics/analytics/analytics-aggregation.service.ts
 *
 * AnalyticsAggregationService — computes real-data metrics by aggregating
 * from the live in-memory repositories of requests, jobs, and models.
 *
 * Replaces the zeroed InMemoryMetricsRepository stubs for the four dashboard
 * endpoints. Wired into buildMetricsRoute() as an optional second argument;
 * when present it takes precedence over the stub MetricsService.
 *
 * ─── Method overview ─────────────────────────────────────────────────────────
 *
 * getTimeSeries        — bucketed request volume, avg latency, cost, and error
 *                        counts for the requested period
 * getLatencyPercentiles — p50/p75/p95/p99 across all Succeeded jobs in period
 * getCostBreakdown     — per-model cost share sorted by cost descending
 * getSummary           — overview metrics with period-over-period trend indicators
 *
 * ─── Data sources ────────────────────────────────────────────────────────────
 *
 * requestsService  — request counts, error counts, completedAt timestamps
 * jobsService      — execution latency (completedAt − startedAt), modelId
 * modelsService    — pricing (inputPer1kTokens / outputPer1kTokens) for cost
 *
 * ─── Approximation notes ─────────────────────────────────────────────────────
 *
 * latency   Measures end-to-end job execution (startedAt → completedAt) for
 *           Succeeded jobs only. Queue wait time (queuedAt → startedAt) is
 *           excluded. Jobs without startedAt are not counted.
 *
 * cost      Derived from token usage × model pricing. Jobs without modelId or
 *           linked requests without tokensIn/Out contribute $0.
 *
 * all-time  getSummary.requests24h always reflects the last 24 h regardless of
 *           the period parameter.
 *
 * limits    All four methods use limit: FETCH_LIMIT (10 000) per service call.
 *           This is an intentional in-process-only assumption. Replace with
 *           streaming / pre-aggregated queries before deploying against durable
 *           storage.
 */

import type { RequestContext } from "../../../core/context";
import { JobStatus } from "../../../shared/contracts/job";
import type { Job } from "../../../shared/contracts/job";
import { RequestStatus } from "../../../shared/contracts/request";
import type { InferenceRequestDto } from "../../../shared/contracts/request";
import type { ModelDto } from "../../../shared/contracts/model";
import type {
  CostBreakdown,
  CostBreakdownEntry,
  LatencyPercentilesReport,
  MetricsSummary,
  TimeSeriesData,
  TimeSeriesPoint,
  TrendIndicator,
} from "../../../shared/contracts/metrics";
import type { ModelId } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { RequestsService } from "../../requests/service/requests.service";
import type { JobsService } from "../../jobs/service/jobs.service";
import type { ModelsService } from "../../models/service/models.service";
import type { MetricsQuery } from "../queries";
import { PERIOD_DURATION_MS, PERIOD_GRANULARITY_MS } from "../queries";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Upper bound on records fetched per service call.
 * Documents the in-process-only assumption for all aggregation methods.
 */
export const FETCH_LIMIT = 10_000;

/** Fixed 24-hour window used by MetricsSummary.requests24h (period-independent). */
const WINDOW_24H_MS = 24 * 60 * 60 * 1_000;

// ─── Public pure-function exports (for direct unit testing) ───────────────────

export interface BucketRange {
  readonly start: number; // epoch ms — inclusive
  readonly end: number; // epoch ms — exclusive
}

/**
 * Generate contiguous, non-overlapping time buckets spanning [periodStart, periodEnd).
 * Each bucket has width granularityMs; the last bucket is clipped to periodEnd.
 * Buckets are ordered by start time ascending.
 *
 * @example
 *   generateBuckets(0, 3_600_000, 300_000)
 *   // → 12 buckets, each 5 minutes wide
 */
export function generateBuckets(
  periodStart: number,
  periodEnd: number,
  granularityMs: number,
): BucketRange[] {
  const buckets: BucketRange[] = [];
  for (let t = periodStart; t < periodEnd; t += granularityMs) {
    buckets.push({ start: t, end: Math.min(t + granularityMs, periodEnd) });
  }
  return buckets;
}

/**
 * Compute the p-th percentile from a pre-sorted ascending array using the
 * nearest-rank (ceiling) method. Returns 0 for an empty array.
 *
 * @param sortedValues  Array sorted ascending — caller is responsible for sorting.
 * @param p             Percentile in the range [0, 100].
 *
 * @example
 *   computePercentile([10, 20, 30, 40, 50], 50) // → 30
 *   computePercentile([10, 20, 30, 40, 50], 90) // → 50
 */
export function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, idx)];
}

/**
 * Estimated cost in USD for a single job.
 * Returns 0 when model pricing or token data is unavailable.
 *
 * Formula: (tokensIn × inputPer1kTokens + tokensOut × outputPer1kTokens) / 1000
 */
export function deriveJobCost(
  job: Job,
  requestMap: Map<string, InferenceRequestDto>,
  modelMap: Map<string, ModelDto>,
): number {
  const model = modelMap.get(job.modelId as string);
  if (!model) return 0;

  const request = requestMap.get(job.requestId as string);
  const tokensIn = request?.tokensIn ?? 0;
  const tokensOut = request?.tokensOut ?? 0;
  if (tokensIn === 0 && tokensOut === 0) return 0;

  return (
    (tokensIn * model.pricing.inputPer1kTokens +
      tokensOut * model.pricing.outputPer1kTokens) /
    1000
  );
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AnalyticsAggregationService {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly jobsService: JobsService,
    private readonly modelsService: ModelsService,
  ) {}

  // ── GET /metrics/time-series ───────────────────────────────────────────────

  async getTimeSeries(ctx: RequestContext, query: MetricsQuery): Promise<TimeSeriesData> {
    const now = Date.now();
    const { period } = query;
    const durationMs = PERIOD_DURATION_MS[period];
    const granularityMs = PERIOD_GRANULARITY_MS[period];
    const periodStart = now - durationMs;

    const [requestsPage, jobsPage, modelsPage] = await Promise.all([
      this.requestsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.jobsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.modelsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
    ]);

    const requests = requestsPage.items;
    const jobs = jobsPage.items as Job[];
    const models = modelsPage.items as ModelDto[];

    const modelMap = new Map(models.map((m) => [m.id as string, m]));
    const requestMap = new Map(requests.map((r) => [r.id, r]));
    const buckets = generateBuckets(periodStart, now, granularityMs);

    const points: TimeSeriesPoint[] = buckets.map(({ start, end }) => {
      // Requests (any status) completed in bucket
      const requestsInBucket = requests.filter((r) => {
        if (!r.completedAt) return false;
        const ts = new Date(r.completedAt).getTime();
        return ts >= start && ts < end;
      });

      // Succeeded jobs completed in bucket
      const succeededInBucket = jobs.filter(
        (j) =>
          j.status === JobStatus.Succeeded &&
          j.completedAt !== undefined &&
          j.completedAt >= start &&
          j.completedAt < end,
      );

      // Failed requests completed in bucket
      const errors = requests.filter((r) => {
        if (r.status !== RequestStatus.Failed) return false;
        if (!r.completedAt) return false;
        const ts = new Date(r.completedAt).getTime();
        return ts >= start && ts < end;
      }).length;

      // Avg execution latency (ms)
      const latencies = succeededInBucket
        .filter((j) => j.startedAt !== undefined)
        .map((j) => j.completedAt! - j.startedAt!);
      const avgLatencyMs =
        latencies.length > 0
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0;

      // Estimated cost for bucket
      const costUsd = succeededInBucket
        .filter((j) => j.modelId !== undefined)
        .reduce((sum, job) => sum + deriveJobCost(job, requestMap, modelMap), 0);

      return {
        timestamp: start,
        requests: requestsInBucket.length,
        avgLatencyMs,
        costUsd: round(costUsd, 4),
        errors,
      };
    });

    return {
      period,
      granularityMs,
      points,
      generatedAt: toIsoTimestamp(),
    };
  }

  // ── GET /metrics/latency-percentiles ──────────────────────────────────────

  async getLatencyPercentiles(
    ctx: RequestContext,
    query: MetricsQuery,
  ): Promise<LatencyPercentilesReport> {
    const now = Date.now();
    const { period } = query;
    const periodStart = now - PERIOD_DURATION_MS[period];

    const jobsPage = await this.jobsService.list(ctx, { page: 1, limit: FETCH_LIMIT });
    const jobs = jobsPage.items as Job[];

    // Collect all execution latencies for Succeeded jobs within the period
    const latencies = jobs
      .filter(
        (j) =>
          j.status === JobStatus.Succeeded &&
          j.startedAt !== undefined &&
          j.completedAt !== undefined &&
          j.completedAt >= periodStart &&
          j.completedAt <= now,
      )
      .map((j) => j.completedAt! - j.startedAt!)
      .sort((a, b) => a - b);

    return {
      period,
      sampleCount: latencies.length,
      p50Ms: computePercentile(latencies, 50),
      p75Ms: computePercentile(latencies, 75),
      p95Ms: computePercentile(latencies, 95),
      p99Ms: computePercentile(latencies, 99),
      generatedAt: toIsoTimestamp(),
    };
  }

  // ── GET /metrics/cost-breakdown ───────────────────────────────────────────

  async getCostBreakdown(ctx: RequestContext, query: MetricsQuery): Promise<CostBreakdown> {
    const now = Date.now();
    const { period } = query;
    const periodStart = now - PERIOD_DURATION_MS[period];

    const [requestsPage, jobsPage, modelsPage] = await Promise.all([
      this.requestsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.jobsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.modelsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
    ]);

    const jobs = jobsPage.items as Job[];
    const models = modelsPage.items as ModelDto[];
    const requests = requestsPage.items;

    const modelMap = new Map(models.map((m) => [m.id as string, m]));
    const requestMap = new Map(requests.map((r) => [r.id, r]));

    // Only Succeeded jobs within the period contribute to cost
    const jobsInPeriod = jobs.filter(
      (j) =>
        j.status === JobStatus.Succeeded &&
        j.completedAt !== undefined &&
        j.completedAt >= periodStart &&
        j.completedAt <= now,
    );

    // Accumulate per-model cost and request count
    const perModel = new Map<string, { costUsd: number; count: number }>();
    for (const job of jobsInPeriod) {
      if (!job.modelId) continue;
      const id = job.modelId as string;
      const cost = deriveJobCost(job, requestMap, modelMap);
      const entry = perModel.get(id) ?? { costUsd: 0, count: 0 };
      perModel.set(id, { costUsd: entry.costUsd + cost, count: entry.count + 1 });
    }

    const totalCostUsd = Array.from(perModel.values()).reduce((s, e) => s + e.costUsd, 0);

    const entries: CostBreakdownEntry[] = Array.from(perModel.entries())
      .map(([id, { costUsd, count }]) => ({
        modelId: id as unknown as ModelId,
        modelName: modelMap.get(id)?.name ?? id,
        costUsd: round(costUsd, 4),
        requestCount: count,
        percentage: totalCostUsd > 0 ? round((costUsd / totalCostUsd) * 100, 2) : 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return {
      period,
      totalCostUsd: round(totalCostUsd, 4),
      entries,
      generatedAt: toIsoTimestamp(),
    };
  }

  // ── GET /metrics/summary ──────────────────────────────────────────────────

  async getSummary(ctx: RequestContext, query: MetricsQuery): Promise<MetricsSummary> {
    const now = Date.now();
    const { period } = query;
    const durationMs = PERIOD_DURATION_MS[period];
    const periodStart = now - durationMs;
    const priorStart = periodStart - durationMs;
    const window24hStart = now - WINDOW_24H_MS;

    const [requestsPage, jobsPage, modelsPage] = await Promise.all([
      this.requestsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.jobsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
      this.modelsService.list(ctx, { page: 1, limit: FETCH_LIMIT }),
    ]);

    const requests = requestsPage.items;
    const jobs = jobsPage.items as Job[];
    const models = modelsPage.items as ModelDto[];

    const modelMap = new Map(models.map((m) => [m.id as string, m]));
    const requestMap = new Map(requests.map((r) => [r.id, r]));

    // ── Current period aggregation ─────────────────────────────────────────

    const current = slicePeriod(requests, jobs, requestMap, modelMap, periodStart, now);
    const prior = slicePeriod(requests, jobs, requestMap, modelMap, priorStart, periodStart);

    const requests24h = requests.filter((r) => {
      if (!r.completedAt) return false;
      return new Date(r.completedAt).getTime() >= window24hStart;
    }).length;

    const requestsPerSecond = round(current.requestCount / (durationMs / 1000), 4);
    const successRate = current.terminal > 0 ? round(current.succeeded / current.terminal, 4) : 1.0;
    const errorRate = current.terminal > 0 ? round(current.failed / current.terminal, 4) : 0.0;
    const avgCostPerRequestUsd =
      current.requestCount > 0 ? round(current.costUsd / current.requestCount, 6) : 0;

    // ── Prior period aggregation (for trend indicators) ────────────────────

    const priorErrorRate = prior.terminal > 0 ? prior.failed / prior.terminal : 0.0;

    return {
      period,
      generatedAt: toIsoTimestamp(),
      totalRequests: current.requestCount,
      requests24h,
      requestsPerSecond,
      avgLatencyMs: Math.round(current.avgLatencyMs),
      p95LatencyMs: current.p95LatencyMs,
      successRate,
      errorRate,
      totalCostUsd: round(current.costUsd, 4),
      avgCostPerRequestUsd,
      requestsTrend: buildTrendIndicator(current.requestCount, prior.requestCount),
      latencyTrend: buildTrendIndicator(current.avgLatencyMs, prior.avgLatencyMs),
      errorRateTrend: buildTrendIndicator(errorRate, priorErrorRate),
      costTrend: buildTrendIndicator(current.costUsd, prior.costUsd),
    };
  }
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

interface PeriodStats {
  requestCount: number;
  succeeded: number;
  failed: number;
  terminal: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  costUsd: number;
}

/**
 * Compute aggregate stats for a single time window [start, end).
 * Uses InferenceRequest.completedAt (ISO → epoch) for counts;
 * Job.completedAt (epoch ms) for latency and cost.
 */
function slicePeriod(
  requests: InferenceRequestDto[],
  jobs: Job[],
  requestMap: Map<string, InferenceRequestDto>,
  modelMap: Map<string, ModelDto>,
  start: number,
  end: number,
): PeriodStats {
  const requestCount = requests.filter((r) => {
    if (!r.completedAt) return false;
    const ts = new Date(r.completedAt).getTime();
    return ts >= start && ts < end;
  }).length;

  const jobsInWindow = jobs.filter(
    (j) => j.completedAt !== undefined && j.completedAt >= start && j.completedAt < end,
  );

  const succeededJobs = jobsInWindow.filter((j) => j.status === JobStatus.Succeeded);
  const failedJobs = jobsInWindow.filter((j) => j.status === JobStatus.Failed);
  const cancelledJobs = jobsInWindow.filter((j) => j.status === JobStatus.Cancelled);

  const latencies = succeededJobs
    .filter((j) => j.startedAt !== undefined)
    .map((j) => j.completedAt! - j.startedAt!)
    .sort((a, b) => a - b);

  const avgLatencyMs =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  const costUsd = succeededJobs
    .filter((j) => j.modelId !== undefined)
    .reduce((sum, job) => sum + deriveJobCost(job, requestMap, modelMap), 0);

  return {
    requestCount,
    succeeded: succeededJobs.length,
    failed: failedJobs.length,
    terminal: succeededJobs.length + failedJobs.length + cancelledJobs.length,
    avgLatencyMs,
    p95LatencyMs: computePercentile(latencies, 95),
    costUsd,
  };
}

function buildTrendIndicator(current: number, prior: number): TrendIndicator {
  const delta = current - prior;
  const percent = prior !== 0 ? round((delta / prior) * 100, 2) : current !== 0 ? 100 : 0;
  const direction: TrendIndicator["direction"] =
    delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { delta: round(delta, 4), percent, direction };
}

// ─── Numeric utility ──────────────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
