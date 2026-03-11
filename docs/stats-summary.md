# Stats Summary

> Ticket 20 — Overview-level aggregation API for dashboard use

## Overview

The stats module exposes a single endpoint that aggregates high-level system
metrics from the live in-memory state of the requests, jobs, models, and workers
modules. It is designed as a **point-in-time snapshot** for dashboard display,
not a historical analytics pipeline.

```
GET /api/v1/stats/summary
```

## Response Shape

```ts
{
  totalRequests:       number;   // all InferenceRequest records (all statuses)
  requestsPerSecond:   number;   // requests/s in the last 60 s window
  avgLatency:          number;   // ms — average job execution time (all time)
  totalCost:           number;   // USD — estimated cost from token usage
  activeWorkers:       number;   // workers with status Idle or Busy
  successRate:         number;   // 0.0–1.0 — succeeded / all terminal jobs
  totalSucceededJobs:  number;
  totalFailedJobs:     number;
  changes: {
    totalRequests:     StatChange;  // delta vs prior 60 s window
    requestsPerSecond: StatChange;
    avgLatency:        StatChange;
    totalCost:         StatChange;
  };
  windowMs:    number;  // 60000 — window length used for rps + changes
  computedAt:  number;  // Unix epoch ms when snapshot was taken
}
```

### StatChange

```ts
{
  delta:     number;   // raw numeric change (current − prior)
  formatted: string;   // "+12", "-0.30 rps", "+15ms", "+$0.0020"
  direction: "up" | "down" | "neutral";
}
```

## Metric Derivations

### totalRequests
Count of all `InferenceRequest` records regardless of status. Includes Queued,
Dispatched, Streaming, Completed, Failed, and Cancelled.

### requestsPerSecond
Count of requests with `completedAt` falling within the last `windowMs`
milliseconds, divided by the window duration in seconds.

```
rps = requests_completed_in_last_60s / 60
```

This is a recent-window rate, not a rolling average. It responds to load changes
within one window length.

### avgLatency
Average of `(job.completedAt − job.startedAt)` for all `Succeeded` jobs that
have both timestamps populated (Unix epoch ms). This measures **execution time**
only — from when the worker began processing to when the job completed. Queue
wait time (`queuedAt → startedAt`) is excluded.

Falls back to `0` when no jobs have execution timing data.

### totalCost
Estimated USD cost summed across all `Succeeded` jobs with a `modelId`:

```
cost_per_job = (tokensIn × inputPer1kTokens + tokensOut × outputPer1kTokens) / 1000
```

Cross-references:
- `Job.requestId` → `InferenceRequest.tokensIn` / `tokensOut`
- `Job.modelId`   → `Model.pricing.inputPer1kTokens` / `outputPer1kTokens`

Jobs without a `modelId`, an unregistered model, or missing token counts
contribute `$0`.

### activeWorkers
Count of `Worker` records with `status ∈ { Idle, Busy }`. Draining, Unhealthy,
and Offline workers are excluded.

### successRate
```
successRate = succeededJobs / (succeededJobs + failedJobs + cancelledJobs)
```
Defaults to `1.0` when no terminal jobs exist yet.

### changes
Each change field compares the **current 60 s window** to the **prior 60 s
window** (60–120 s ago). For latency and cost, windows are defined by
`Job.completedAt` (Unix epoch ms). For counts, windows use
`InferenceRequest.completedAt` (ISO string, parsed to epoch ms).

When either window has no data, the delta is `0` and direction is `"neutral"`.

## Architecture

```
GET /api/v1/stats/summary
  └── SummaryStatsService.getSummary(ctx)
        ├── requestsService.list(ctx, { page: 1, limit: 10_000 })
        ├── jobsService.list(ctx, { page: 1, limit: 10_000 })
        ├── modelsService.list(ctx, { page: 1, limit: 10_000 })
        └── workersService.list(ctx, { page: 1, limit: 10_000 })
              → aggregate in memory → SummaryStatsDto
```

All four service calls are made in parallel (`Promise.all`).

## Current Limitations

| Limitation | Notes |
|---|---|
| Full-scan aggregation | Uses `list({ limit: 10_000 })` — designed for in-process stores only. Replace with pre-aggregated views for production. |
| No caching | Each request to `/stats/summary` performs four full list queries. Add a TTL cache (e.g. 5 s) before high-traffic use. |
| avgLatency excludes queue time | Only measures execution (`startedAt → completedAt`), not queue wait. |
| totalCost requires token data | Requests without `tokensIn`/`tokensOut` (e.g. still streaming) contribute $0. |
| Window-based rps | A single busy second within a 60 s window is averaged across the full window, dampening spikes. |
| No time-series history | Point-in-time only. Historical trends and percentiles are deferred to the metrics analytics pipeline. |

## Key Files

| File | Purpose |
|---|---|
| `src/modules/stats/stats.contract.ts` | `SummaryStatsDto`, `StatChange`, `SummaryChanges` |
| `src/modules/stats/stats.service.ts` | `SummaryStatsService`, aggregation + change logic |
| `src/modules/stats/stats.service.test.ts` | Unit tests (30+ cases) |
| `src/modules/stats/routes/stats.route.ts` | Fastify plugin for GET /stats/summary |
| `src/modules/stats/index.ts` | Module composition + exports |
