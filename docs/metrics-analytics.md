# Metrics Analytics

> Ticket 21 — Dashboard Analytics APIs (time-series, latency percentiles, cost breakdown)

## Overview

The metrics analytics layer provides chart-ready aggregation APIs for dashboard use.
It replaces the zeroed `InMemoryMetricsRepository` stubs with real-data aggregation
derived from the live in-memory state of the requests, jobs, and models modules.

## Endpoints

All four endpoints accept a single `period` query parameter and return JSON in the
standard `{ success, data, meta }` envelope.

| Endpoint | Default period | Description |
|---|---|---|
| `GET /api/v1/metrics/summary` | `24h` | High-level KPIs with period-over-period trends |
| `GET /api/v1/metrics/time-series` | `24h` | Bucketed volume / latency / cost / error counts |
| `GET /api/v1/metrics/latency-percentiles` | `24h` | p50 / p75 / p95 / p99 for the full period |
| `GET /api/v1/metrics/cost-breakdown` | `24h` | Per-model cost share sorted by cost |

### Supported Periods and Bucket Granularity

| Period | Duration | Bucket size | Points returned |
|---|---|---|---|
| `1h`  | 1 hour   | 5 minutes | 12 |
| `24h` | 24 hours | 1 hour    | 24 |
| `7d`  | 7 days   | 6 hours   | 28 |
| `30d` | 30 days  | 1 day     | 30 |

## Response Shapes

### `GET /metrics/time-series`

```ts
{
  period: MetricPeriod;
  granularityMs: number;
  generatedAt: IsoTimestamp;
  points: Array<{
    timestamp: number;    // bucket start (Unix epoch ms)
    requests: number;     // requests with completedAt in bucket
    avgLatencyMs: number; // avg (job.completedAt - job.startedAt) for Succeeded jobs
    costUsd: number;      // estimated cost for Succeeded jobs in bucket
    errors: number;       // count of Failed requests in bucket
  }>;
}
```

### `GET /metrics/latency-percentiles`

```ts
{
  period: MetricPeriod;
  sampleCount: number;  // Succeeded jobs with timing data in period
  p50Ms: number;
  p75Ms: number;
  p95Ms: number;
  p99Ms: number;
  generatedAt: IsoTimestamp;
}
```

### `GET /metrics/cost-breakdown`

```ts
{
  period: MetricPeriod;
  totalCostUsd: number;
  generatedAt: IsoTimestamp;
  entries: Array<{
    modelId: ModelId;
    modelName: string;
    costUsd: number;
    requestCount: number;
    percentage: number;    // 0–100, this model's share of totalCostUsd
  }>;  // sorted by costUsd descending
}
```

### `GET /metrics/summary`

```ts
{
  period: MetricPeriod;
  generatedAt: IsoTimestamp;
  totalRequests: number;
  requests24h: number;     // always last 24h, regardless of period
  requestsPerSecond: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  successRate: number;     // 0.0–1.0
  errorRate: number;       // 0.0–1.0
  totalCostUsd: number;
  avgCostPerRequestUsd: number;
  requestsTrend: TrendIndicator;
  latencyTrend: TrendIndicator;
  errorRateTrend: TrendIndicator;
  costTrend: TrendIndicator;
}

// TrendIndicator
{
  delta: number;               // current − prior (signed)
  percent: number;             // % change from prior period
  direction: "up" | "down" | "flat";
}
```

## Metric Derivations

### latency (`avgLatencyMs`, `p50Ms`..`p99Ms`)
Derived from `Job.completedAt − Job.startedAt` for `Succeeded` jobs with both
timestamps populated (Unix epoch ms). This measures **worker execution time only**;
queue wait time (`queuedAt → startedAt`) is excluded. Jobs without `startedAt`
are not counted.

### cost (`costUsd`, `totalCostUsd`)
```
cost_per_job = (tokensIn × inputPer1kTokens + tokensOut × outputPer1kTokens) / 1000
```
Cross-references: `Job.requestId → InferenceRequest.tokensIn/tokensOut` and
`Job.modelId → Model.pricing`. Jobs without a `modelId`, an unregistered model,
or requests without token counts contribute $0.

### errors
Count of `InferenceRequest` records with `status = Failed` and `completedAt` in
the bucket/period. Cancellations are not counted as errors.

### trend indicators
Compare the current period to the immediately preceding period of the same length.
For example, `period=24h` compares [now−24h, now) vs [now−48h, now−24h).
`percent = (delta / prior) × 100`; when prior is 0 and current > 0, percent = 100.

## Architecture

```
GET /api/v1/metrics/*
  └── metrics.route.ts
        └── AnalyticsAggregationService (preferred)
              ├── requestsService.list({ limit: 10_000 })
              ├── jobsService.list({ limit: 10_000 })
              └── modelsService.list({ limit: 10_000 })
                    → aggregate in memory → dashboard DTO

        └── MetricsService (fallback if analytics not wired)
              └── InMemoryMetricsRepository → zeroed stubs
```

The `buildMetricsRoute(service, analytics?)` factory accepts the analytics service
as an optional second argument. When present, all four routes delegate to it. When
absent (or in test overrides), the stub MetricsService is used.

## Exported Pure Functions

`generateBuckets` and `computePercentile` are exported for direct unit testing
and for use by other analytics layers.

```ts
import { generateBuckets, computePercentile } from "../modules/metrics";

// Generate 12 five-minute buckets for a 1-hour period
const buckets = generateBuckets(periodStart, periodEnd, PERIOD_GRANULARITY_MS["1h"]);

// Compute p95 from a sorted array of latency samples
const p95 = computePercentile(sortedLatencies, 95);
```

## Current Limitations

| Limitation | Notes |
|---|---|
| Full-scan aggregation | Uses `list({ limit: 10_000 })` — designed for in-process stores only |
| No caching | Each request performs three full list queries in parallel |
| latency = execution only | Queue wait time not included |
| cost requires token data | Requests still in progress (no tokensIn/Out yet) contribute $0 |
| No real-time ingestion | Metrics are computed on-demand from current state, not from a pre-aggregated time-series store |
| No windowed aggregates | Rolling windows (e.g. 1-minute p99) are not pre-computed |

## Key Files

| File | Purpose |
|---|---|
| `src/modules/metrics/analytics/analytics-aggregation.service.ts` | Core aggregation logic |
| `src/modules/metrics/analytics/analytics-aggregation.service.test.ts` | Unit tests (30+ cases) |
| `src/modules/metrics/routes/metrics.route.ts` | Updated with optional analytics arg |
| `src/modules/metrics/index.ts` | Wires `analyticsService` into `metricsRoute` |
| `src/modules/metrics/queries.ts` | `PERIOD_DURATION_MS`, `PERIOD_GRANULARITY_MS` constants |
| `src/shared/contracts/metrics.ts` | All dashboard DTO contracts |
