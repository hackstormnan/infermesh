/**
 * modules/metrics/analytics/analytics-aggregation.service.test.ts
 *
 * Unit tests for AnalyticsAggregationService and its exported pure helpers.
 *
 * Test groups:
 *   - generateBuckets         (pure function — no mocks needed)
 *   - computePercentile       (pure function — no mocks needed)
 *   - getTimeSeries           (bucket counts, request placement, latency, cost, errors)
 *   - getLatencyPercentiles   (sampleCount, p50/p75/p95/p99, period filtering)
 *   - getCostBreakdown        (sorting, percentages, period filtering)
 *   - getSummary              (shape, trends, requests24h independence)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../../core/context";
import { JobStatus } from "../../../shared/contracts/job";
import { RequestStatus } from "../../../shared/contracts/request";
import { WorkerStatus } from "../../../shared/contracts/worker";
import {
  AnalyticsAggregationService,
  generateBuckets,
  computePercentile,
  deriveJobCost,
} from "./analytics-aggregation.service";
import { PERIOD_DURATION_MS, PERIOD_GRANULARITY_MS } from "../queries";

// ─── Test context & mock factories ───────────────────────────────────────────

const ctx = buildTestContext();

function makePaginated<T>(items: T[]) {
  return { items, total: items.length, page: 1, limit: 10_000, hasMore: false };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    modelId: "model-a",
    messages: [],
    params: {},
    routingHints: {},
    status: RequestStatus.Completed,
    tokensIn: 1000,
    tokensOut: 500,
    completedAt: new Date(Date.now() - 30_000).toISOString(), // 30 s ago
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 30_000).toISOString(),
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "job-1",
    requestId: "req-1",
    status: JobStatus.Succeeded,
    modelId: "model-a",
    workerId: "worker-a",
    attempts: 1,
    maxAttempts: 3,
    priority: 1,
    sourceType: "live",
    queuedAt: now - 60_000,
    startedAt: now - 40_000,
    completedAt: now - 30_000,  // 30 s ago
    createdAt: new Date(now - 60_000).toISOString(),
    updatedAt: new Date(now - 30_000).toISOString(),
    ...overrides,
  };
}

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "model-a",
    name: "test-model",
    aliases: [],
    provider: "anthropic",
    capabilities: [],
    supportedTasks: [],
    qualityTier: "standard",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    pricing: { inputPer1kTokens: 1.0, outputPer1kTokens: 2.0 },
    latencyProfile: { ttftMs: 200, tokensPerSecond: 50 },
    status: "active",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildSvc(opts: {
  requests?: unknown[];
  jobs?: unknown[];
  models?: unknown[];
} = {}) {
  const listRequests = vi.fn().mockResolvedValue(makePaginated(opts.requests ?? []));
  const listJobs = vi.fn().mockResolvedValue(makePaginated(opts.jobs ?? []));
  const listModels = vi.fn().mockResolvedValue(makePaginated(opts.models ?? [makeModel()]));

  const svc = new AnalyticsAggregationService(
    { list: listRequests } as any,
    { list: listJobs } as any,
    { list: listModels } as any,
  );

  return { svc, listRequests, listJobs, listModels };
}

// ─── generateBuckets ─────────────────────────────────────────────────────────

describe("generateBuckets", () => {
  it.each([
    ["1h", 12],
    ["24h", 24],
    ["7d", 28],
    ["30d", 30],
  ] as const)("generates correct bucket count for period %s", (period, expected) => {
    const now = Date.now();
    const periodStart = now - PERIOD_DURATION_MS[period];
    const buckets = generateBuckets(periodStart, now, PERIOD_GRANULARITY_MS[period]);
    expect(buckets).toHaveLength(expected);
  });

  it("first bucket starts at periodStart", () => {
    const periodStart = 1_000_000;
    const buckets = generateBuckets(periodStart, periodStart + 3_600_000, 300_000);
    expect(buckets[0].start).toBe(periodStart);
  });

  it("buckets are contiguous (each bucket.end equals next bucket.start)", () => {
    const periodStart = 0;
    const buckets = generateBuckets(periodStart, 3_600_000, 300_000);
    for (let i = 0; i < buckets.length - 1; i++) {
      expect(buckets[i].end).toBe(buckets[i + 1].start);
    }
  });

  it("last bucket end equals periodEnd", () => {
    const periodEnd = 3_600_000;
    const buckets = generateBuckets(0, periodEnd, 300_000);
    expect(buckets[buckets.length - 1].end).toBe(periodEnd);
  });

  it("returns empty array when periodStart >= periodEnd", () => {
    const buckets = generateBuckets(1000, 1000, 300_000);
    expect(buckets).toHaveLength(0);
  });
});

// ─── computePercentile ───────────────────────────────────────────────────────

describe("computePercentile", () => {
  it("returns 0 for an empty array", () => {
    expect(computePercentile([], 50)).toBe(0);
    expect(computePercentile([], 99)).toBe(0);
  });

  it("returns the single element for any percentile when array has one item", () => {
    expect(computePercentile([42], 50)).toBe(42);
    expect(computePercentile([42], 99)).toBe(42);
  });

  it("computes p50 correctly for odd-length array", () => {
    expect(computePercentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it("computes p50 for even-length array (ceiling index)", () => {
    // 4 elements, ceil(0.50 * 4) - 1 = ceil(2) - 1 = 1 → value at index 1 = 20
    expect(computePercentile([10, 20, 30, 40], 50)).toBe(20);
  });

  it("computes p95 for 100 sorted values [1..100]", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(computePercentile(values, 95)).toBe(95);
  });

  it("computes p99 for 100 sorted values [1..100]", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(computePercentile(values, 99)).toBe(99);
  });

  it("computes p75 correctly", () => {
    // [10, 20, 30, 40]: ceil(0.75 * 4) - 1 = ceil(3) - 1 = 2 → value at index 2 = 30
    expect(computePercentile([10, 20, 30, 40], 75)).toBe(30);
  });
});

// ─── getTimeSeries ───────────────────────────────────────────────────────────

describe("getTimeSeries — bucket count", () => {
  it.each([
    ["1h", 12],
    ["24h", 24],
    ["7d", 28],
    ["30d", 30],
  ] as const)("returns %i points for period %s", async (period, expected) => {
    const { svc } = buildSvc();
    const result = await svc.getTimeSeries(ctx, { period });
    expect(result.points).toHaveLength(expected);
    expect(result.period).toBe(period);
    expect(result.granularityMs).toBe(PERIOD_GRANULARITY_MS[period]);
  });
});

describe("getTimeSeries — request placement in buckets", () => {
  it("counts a request completed 30 s ago in the last bucket of the 1h period", async () => {
    const { svc } = buildSvc({
      requests: [makeRequest({ completedAt: new Date(Date.now() - 30_000).toISOString() })],
    });
    const result = await svc.getTimeSeries(ctx, { period: "1h" });
    // 30 s ago is in the last 5-minute bucket
    const lastBucket = result.points[result.points.length - 1];
    expect(lastBucket.requests).toBe(1);
  });

  it("does not count a request completed before the period start", async () => {
    const { svc } = buildSvc({
      requests: [
        makeRequest({
          completedAt: new Date(Date.now() - PERIOD_DURATION_MS["1h"] - 1_000).toISOString(),
        }),
      ],
    });
    const result = await svc.getTimeSeries(ctx, { period: "1h" });
    const totalRequests = result.points.reduce((s, p) => s + p.requests, 0);
    expect(totalRequests).toBe(0);
  });
});

describe("getTimeSeries — errors", () => {
  it("counts Failed requests as errors in the correct bucket", async () => {
    const { svc } = buildSvc({
      requests: [
        makeRequest({
          status: RequestStatus.Failed,
          completedAt: new Date(Date.now() - 30_000).toISOString(),
        }),
      ],
    });
    const result = await svc.getTimeSeries(ctx, { period: "1h" });
    const totalErrors = result.points.reduce((s, p) => s + p.errors, 0);
    expect(totalErrors).toBe(1);
  });

  it("does not count Completed requests as errors", async () => {
    const { svc } = buildSvc({ requests: [makeRequest()] });
    const result = await svc.getTimeSeries(ctx, { period: "1h" });
    const totalErrors = result.points.reduce((s, p) => s + p.errors, 0);
    expect(totalErrors).toBe(0);
  });
});

describe("getTimeSeries — avgLatency", () => {
  it("computes avgLatencyMs from succeeded jobs in the bucket", async () => {
    const now = Date.now();
    // Job: startedAt = now - 8000, completedAt = now - 30_000?
    // Wait: completedAt must be after startedAt. Let me recalculate.
    // Job completed 30 s ago, started 8 s before completion = 8000 ms latency
    const completedAt = now - 30_000;
    const startedAt = completedAt - 8_000;

    const { svc } = buildSvc({
      jobs: [makeJob({ startedAt, completedAt })],
    });
    const result = await svc.getTimeSeries(ctx, { period: "1h" });
    const lastBucket = result.points[result.points.length - 1];
    expect(lastBucket.avgLatencyMs).toBe(8_000);
  });

  it("returns 0 avgLatency when no succeeded jobs in bucket", async () => {
    const { svc } = buildSvc({ jobs: [] });
    const result = await svc.getTimeSeries(ctx, { period: "1h" });
    const totalAvg = result.points.reduce((s, p) => s + p.avgLatencyMs, 0);
    expect(totalAvg).toBe(0);
  });
});

describe("getTimeSeries — costUsd", () => {
  it("computes costUsd from token usage × model pricing", async () => {
    // tokensIn=1000 × inputPer1kTokens=1.0 = $1.00
    // tokensOut=500 × outputPer1kTokens=2.0 = $1.00
    // total = $2.00
    const now = Date.now();
    const completedAt = now - 30_000;

    const { svc } = buildSvc({
      requests: [makeRequest({ tokensIn: 1000, tokensOut: 500 })],
      jobs: [makeJob({ startedAt: completedAt - 8_000, completedAt })],
      models: [makeModel({ pricing: { inputPer1kTokens: 1.0, outputPer1kTokens: 2.0 } })],
    });

    const result = await svc.getTimeSeries(ctx, { period: "1h" });
    const lastBucket = result.points[result.points.length - 1];
    expect(lastBucket.costUsd).toBeCloseTo(2.0, 4);
  });
});

// ─── getLatencyPercentiles ────────────────────────────────────────────────────

describe("getLatencyPercentiles", () => {
  it("returns sampleCount 0 and all-zero percentiles when no jobs exist", async () => {
    const { svc } = buildSvc({ jobs: [] });
    const result = await svc.getLatencyPercentiles(ctx, { period: "24h" });

    expect(result.sampleCount).toBe(0);
    expect(result.p50Ms).toBe(0);
    expect(result.p75Ms).toBe(0);
    expect(result.p95Ms).toBe(0);
    expect(result.p99Ms).toBe(0);
    expect(result.period).toBe("24h");
  });

  it("counts only Succeeded jobs with both startedAt and completedAt", async () => {
    const now = Date.now();
    const completedAt = now - 30_000;

    const { svc } = buildSvc({
      jobs: [
        makeJob({ startedAt: completedAt - 1000, completedAt }),                   // included
        makeJob({ id: "j2", requestId: "r2", status: JobStatus.Failed,             // excluded: Failed
          startedAt: completedAt - 500, completedAt }),
        makeJob({ id: "j3", requestId: "r3", startedAt: undefined, completedAt }), // excluded: no startedAt
      ],
    });

    const result = await svc.getLatencyPercentiles(ctx, { period: "24h" });
    expect(result.sampleCount).toBe(1);
  });

  it("computes correct percentiles for known latency values", async () => {
    const now = Date.now();
    // 4 jobs with latencies: 100, 200, 300, 400 ms
    const jobs = [100, 200, 300, 400].map((latencyMs, i) => {
      const completedAt = now - (30_000 - i * 100); // spread slightly so each is unique
      return makeJob({
        id: `j${i}`,
        requestId: `r${i}`,
        startedAt: completedAt - latencyMs,
        completedAt,
      });
    });

    const { svc } = buildSvc({ jobs });
    const result = await svc.getLatencyPercentiles(ctx, { period: "24h" });

    expect(result.sampleCount).toBe(4);
    // sorted: [100, 200, 300, 400]
    // p50: ceil(0.50*4)-1 = 1 → 200
    // p75: ceil(0.75*4)-1 = 2 → 300
    // p95: ceil(0.95*4)-1 = 3 → 400
    // p99: ceil(0.99*4)-1 = 3 → 400
    expect(result.p50Ms).toBe(200);
    expect(result.p75Ms).toBe(300);
    expect(result.p95Ms).toBe(400);
    expect(result.p99Ms).toBe(400);
  });

  it("excludes jobs completed before the period start", async () => {
    const now = Date.now();
    const tooOld = now - PERIOD_DURATION_MS["1h"] - 1_000; // just outside 1h period

    const { svc } = buildSvc({
      jobs: [
        makeJob({ startedAt: tooOld - 1000, completedAt: tooOld }), // excluded
      ],
    });

    const result = await svc.getLatencyPercentiles(ctx, { period: "1h" });
    expect(result.sampleCount).toBe(0);
  });
});

// ─── getCostBreakdown ─────────────────────────────────────────────────────────

describe("getCostBreakdown", () => {
  it("returns empty entries and zero total when no jobs", async () => {
    const { svc } = buildSvc({ jobs: [] });
    const result = await svc.getCostBreakdown(ctx, { period: "24h" });

    expect(result.totalCostUsd).toBe(0);
    expect(result.entries).toHaveLength(0);
    expect(result.period).toBe("24h");
  });

  it("creates one entry per distinct model", async () => {
    const now = Date.now();
    const completedAt = now - 30_000;

    const { svc } = buildSvc({
      requests: [
        makeRequest({ id: "req-a", modelId: "model-a", tokensIn: 1000, tokensOut: 0 }),
        makeRequest({ id: "req-b", modelId: "model-b", tokensIn: 1000, tokensOut: 0 }),
      ],
      jobs: [
        makeJob({ id: "j1", requestId: "req-a", modelId: "model-a",
          startedAt: completedAt - 1000, completedAt }),
        makeJob({ id: "j2", requestId: "req-b", modelId: "model-b",
          startedAt: completedAt - 1000, completedAt }),
      ],
      models: [
        makeModel({ id: "model-a", name: "model-alpha", pricing: { inputPer1kTokens: 1.0, outputPer1kTokens: 0 } }),
        makeModel({ id: "model-b", name: "model-beta",  pricing: { inputPer1kTokens: 2.0, outputPer1kTokens: 0 } }),
      ],
    });

    const result = await svc.getCostBreakdown(ctx, { period: "24h" });
    expect(result.entries).toHaveLength(2);
  });

  it("sorts entries by costUsd descending", async () => {
    const now = Date.now();
    const completedAt = now - 30_000;

    const { svc } = buildSvc({
      requests: [
        makeRequest({ id: "req-a", tokensIn: 1000, tokensOut: 0 }),
        makeRequest({ id: "req-b", modelId: "model-b", tokensIn: 5000, tokensOut: 0 }),
      ],
      jobs: [
        makeJob({ id: "j1", requestId: "req-a", modelId: "model-a",
          startedAt: completedAt - 1000, completedAt }),
        makeJob({ id: "j2", requestId: "req-b", modelId: "model-b",
          startedAt: completedAt - 1000, completedAt }),
      ],
      models: [
        makeModel({ id: "model-a", name: "cheap",      pricing: { inputPer1kTokens: 0.5, outputPer1kTokens: 0 } }),
        makeModel({ id: "model-b", name: "expensive",  pricing: { inputPer1kTokens: 2.0, outputPer1kTokens: 0 } }),
      ],
    });

    const result = await svc.getCostBreakdown(ctx, { period: "24h" });
    expect(result.entries[0].modelName).toBe("expensive");
    expect(result.entries[1].modelName).toBe("cheap");
  });

  it("percentages sum to approximately 100 when multiple models present", async () => {
    const now = Date.now();
    const completedAt = now - 30_000;

    const { svc } = buildSvc({
      requests: [
        makeRequest({ id: "req-a", tokensIn: 1000, tokensOut: 0 }),
        makeRequest({ id: "req-b", modelId: "model-b", tokensIn: 1000, tokensOut: 0 }),
      ],
      jobs: [
        makeJob({ id: "j1", requestId: "req-a", modelId: "model-a",
          startedAt: completedAt - 1000, completedAt }),
        makeJob({ id: "j2", requestId: "req-b", modelId: "model-b",
          startedAt: completedAt - 1000, completedAt }),
      ],
      models: [
        makeModel({ id: "model-a", pricing: { inputPer1kTokens: 1.0, outputPer1kTokens: 0 } }),
        makeModel({ id: "model-b", pricing: { inputPer1kTokens: 3.0, outputPer1kTokens: 0 } }),
      ],
    });

    const result = await svc.getCostBreakdown(ctx, { period: "24h" });
    const pctSum = result.entries.reduce((s, e) => s + e.percentage, 0);
    expect(pctSum).toBeCloseTo(100, 1);
  });

  it("excludes jobs completed before the period start", async () => {
    const tooOld = Date.now() - PERIOD_DURATION_MS["1h"] - 1_000;

    const { svc } = buildSvc({
      requests: [makeRequest({ tokensIn: 1000, tokensOut: 0 })],
      jobs: [makeJob({ startedAt: tooOld - 1000, completedAt: tooOld })],
      models: [makeModel()],
    });

    const result = await svc.getCostBreakdown(ctx, { period: "1h" });
    expect(result.totalCostUsd).toBe(0);
    expect(result.entries).toHaveLength(0);
  });
});

// ─── getSummary ───────────────────────────────────────────────────────────────

describe("getSummary — shape", () => {
  it("returns all required MetricsSummary fields", async () => {
    const { svc } = buildSvc();
    const result = await svc.getSummary(ctx, { period: "24h" });

    expect(result).toHaveProperty("period", "24h");
    expect(result).toHaveProperty("generatedAt");
    expect(result).toHaveProperty("totalRequests");
    expect(result).toHaveProperty("requests24h");
    expect(result).toHaveProperty("requestsPerSecond");
    expect(result).toHaveProperty("avgLatencyMs");
    expect(result).toHaveProperty("p95LatencyMs");
    expect(result).toHaveProperty("successRate");
    expect(result).toHaveProperty("errorRate");
    expect(result).toHaveProperty("totalCostUsd");
    expect(result).toHaveProperty("avgCostPerRequestUsd");
    expect(result).toHaveProperty("requestsTrend");
    expect(result).toHaveProperty("latencyTrend");
    expect(result).toHaveProperty("errorRateTrend");
    expect(result).toHaveProperty("costTrend");
  });

  it("returns TrendIndicator shape on each trend field", async () => {
    const { svc } = buildSvc();
    const result = await svc.getSummary(ctx, { period: "24h" });

    for (const trend of [
      result.requestsTrend,
      result.latencyTrend,
      result.errorRateTrend,
      result.costTrend,
    ]) {
      expect(trend).toHaveProperty("delta");
      expect(trend).toHaveProperty("percent");
      expect(["up", "down", "flat"]).toContain(trend.direction);
    }
  });
});

describe("getSummary — trend directions", () => {
  it("requestsTrend direction is 'up' when current period has more requests", async () => {
    const now = Date.now();
    const duration = PERIOD_DURATION_MS["24h"]; // 24 h
    // 2 requests in the current period (last 24h), 0 in prior period (24-48 h ago)
    const { svc } = buildSvc({
      requests: [
        makeRequest({ id: "r1", completedAt: new Date(now - 1_000).toISOString() }),
        makeRequest({ id: "r2", completedAt: new Date(now - 2_000).toISOString() }),
      ],
    });

    const result = await svc.getSummary(ctx, { period: "24h" });
    expect(result.requestsTrend.direction).toBe("up");
    expect(result.requestsTrend.delta).toBeGreaterThan(0);
  });

  it("requestsTrend direction is 'flat' when both periods are empty", async () => {
    const { svc } = buildSvc();
    const result = await svc.getSummary(ctx, { period: "24h" });
    expect(result.requestsTrend.direction).toBe("flat");
  });
});

describe("getSummary — requests24h", () => {
  it("always reflects last 24h regardless of period parameter", async () => {
    const now = Date.now();
    // 1 request completed 12 h ago → in last 24h, but NOT in last 1h
    const { svc } = buildSvc({
      requests: [
        makeRequest({
          completedAt: new Date(now - 12 * 60 * 60 * 1_000).toISOString(),
        }),
      ],
    });

    const result1h = await svc.getSummary(ctx, { period: "1h" });
    const result24h = await svc.getSummary(ctx, { period: "24h" });
    const result7d = await svc.getSummary(ctx, { period: "7d" });

    // requests24h should be 1 in all cases
    expect(result1h.requests24h).toBe(1);
    expect(result24h.requests24h).toBe(1);
    expect(result7d.requests24h).toBe(1);

    // but totalRequests for 1h should be 0 (request is 12h old, outside 1h window)
    expect(result1h.totalRequests).toBe(0);
  });
});

describe("getSummary — successRate and errorRate", () => {
  it("defaults successRate to 1.0 and errorRate to 0.0 when no terminal jobs", async () => {
    const { svc } = buildSvc();
    const result = await svc.getSummary(ctx, { period: "24h" });
    expect(result.successRate).toBe(1.0);
    expect(result.errorRate).toBe(0.0);
  });

  it("computes errorRate from failed / terminal jobs", async () => {
    const now = Date.now();
    const completedAt = now - 30_000;

    const { svc } = buildSvc({
      jobs: [
        makeJob({ id: "j1", requestId: "r1", status: JobStatus.Succeeded,
          startedAt: completedAt - 1000, completedAt }),
        makeJob({ id: "j2", requestId: "r2", status: JobStatus.Failed,
          startedAt: completedAt - 1000, completedAt }),
        makeJob({ id: "j3", requestId: "r3", status: JobStatus.Failed,
          startedAt: completedAt - 1000, completedAt }),
      ],
    });

    const result = await svc.getSummary(ctx, { period: "24h" });
    expect(result.errorRate).toBeCloseTo(2 / 3, 4);
    expect(result.successRate).toBeCloseTo(1 / 3, 4);
  });
});
