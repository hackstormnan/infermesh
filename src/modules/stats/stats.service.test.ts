/**
 * modules/stats/stats.service.test.ts
 *
 * Unit tests for SummaryStatsService.
 *
 * All four dependencies are vi.fn() mocks that return PaginatedResponse shapes.
 * Tests cover:
 *   - Empty state: all-zero/default values
 *   - totalRequests: count of request records
 *   - avgLatency: avg (completedAt − startedAt) for Succeeded jobs
 *   - totalCost: tokens × model pricing
 *   - activeWorkers: Idle + Busy only
 *   - successRate: succeeded / terminal jobs
 *   - requestsPerSecond: requests completed in last WINDOW_MS / window seconds
 *   - changes direction: up / down / neutral
 *   - changes.formatted strings: count, rps, latency, cost formats
 *   - Edge cases: missing startedAt, missing modelId, missing tokens, no prior window data
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../../core/context";
import { JobStatus } from "../../shared/contracts/job";
import { WorkerStatus } from "../../shared/contracts/worker";
import { RequestStatus } from "../../shared/contracts/request";
import { SummaryStatsService, WINDOW_MS } from "./stats.service";
import type { SummaryStatsDto } from "./stats.contract";

// ─── Mock factories ───────────────────────────────────────────────────────────

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
    tokensIn: 100,
    tokensOut: 50,
    completedAt: new Date(Date.now() - 5_000).toISOString(), // 5 s ago → in current window
    createdAt: new Date(Date.now() - 10_000).toISOString(),
    updatedAt: new Date(Date.now() - 5_000).toISOString(),
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
    queuedAt: now - 10_000,
    startedAt: now - 8_000,
    completedAt: now - 5_000,  // 5 s ago → in current window
    createdAt: new Date(now - 10_000).toISOString(),
    updatedAt: new Date(now - 5_000).toISOString(),
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
    pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 },
    latencyProfile: { ttftMs: 200, tokensPerSecond: 50 },
    status: "active",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWorker(status: WorkerStatus = WorkerStatus.Idle) {
  return {
    id: "worker-1",
    name: "worker-alpha",
    status,
    region: "us-east-1",
    hardware: { instanceType: "g4dn.xlarge" },
    supportedModelIds: ["model-a"],
    capacity: { activeJobs: 0, maxConcurrentJobs: 4, queuedJobs: 0 },
    lastHeartbeatAt: Date.now(),
    runtimeMetrics: {},
    labels: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildMocks(overrides: {
  requests?: unknown[];
  jobs?: unknown[];
  models?: unknown[];
  workers?: unknown[];
} = {}) {
  const requests = vi.fn().mockResolvedValue(makePaginated(overrides.requests ?? []));
  const jobs = vi.fn().mockResolvedValue(makePaginated(overrides.jobs ?? []));
  const models = vi.fn().mockResolvedValue(makePaginated(overrides.models ?? [makeModel()]));
  const workers = vi.fn().mockResolvedValue(makePaginated(overrides.workers ?? []));

  const svc = new SummaryStatsService(
    { list: requests } as any,
    { list: jobs } as any,
    { list: models } as any,
    { list: workers } as any,
  );

  return { svc, requests, jobs, models, workers };
}

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("SummaryStatsService — empty state", () => {
  it("returns a well-formed DTO with all-zero numeric fields", async () => {
    const { svc } = buildMocks();
    const dto = await svc.getSummary(ctx);

    expect(dto.totalRequests).toBe(0);
    expect(dto.requestsPerSecond).toBe(0);
    expect(dto.avgLatency).toBe(0);
    expect(dto.totalCost).toBe(0);
    expect(dto.activeWorkers).toBe(0);
    expect(dto.totalSucceededJobs).toBe(0);
    expect(dto.totalFailedJobs).toBe(0);
  });

  it("defaults successRate to 1.0 when no terminal jobs exist", async () => {
    const { svc } = buildMocks();
    const dto = await svc.getSummary(ctx);
    expect(dto.successRate).toBe(1.0);
  });

  it("returns all neutral changes when both windows are empty", async () => {
    const { svc } = buildMocks();
    const dto = await svc.getSummary(ctx);

    expect(dto.changes.totalRequests.direction).toBe("neutral");
    expect(dto.changes.requestsPerSecond.direction).toBe("neutral");
    expect(dto.changes.avgLatency.direction).toBe("neutral");
    expect(dto.changes.totalCost.direction).toBe("neutral");
  });

  it("includes windowMs and computedAt metadata", async () => {
    const before = Date.now();
    const { svc } = buildMocks();
    const dto = await svc.getSummary(ctx);
    const after = Date.now();

    expect(dto.windowMs).toBe(WINDOW_MS);
    expect(dto.computedAt).toBeGreaterThanOrEqual(before);
    expect(dto.computedAt).toBeLessThanOrEqual(after);
  });
});

// ─── totalRequests ────────────────────────────────────────────────────────────

describe("totalRequests", () => {
  it("counts all request records regardless of status", async () => {
    const { svc } = buildMocks({
      requests: [
        makeRequest({ status: RequestStatus.Completed }),
        makeRequest({ id: "req-2", status: RequestStatus.Failed }),
        makeRequest({ id: "req-3", status: RequestStatus.Queued, completedAt: undefined }),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.totalRequests).toBe(3);
  });
});

// ─── avgLatency ───────────────────────────────────────────────────────────────

describe("avgLatency", () => {
  it("computes average execution time (completedAt − startedAt) for Succeeded jobs", async () => {
    const now = Date.now();
    const { svc } = buildMocks({
      jobs: [
        makeJob({ startedAt: now - 1000, completedAt: now - 500 }),   // 500 ms
        makeJob({ id: "job-2", requestId: "req-2", startedAt: now - 2000, completedAt: now - 1000 }), // 1000 ms
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.avgLatency).toBe(750); // (500 + 1000) / 2
  });

  it("excludes jobs without startedAt from latency calculation", async () => {
    const now = Date.now();
    const { svc } = buildMocks({
      jobs: [
        makeJob({ startedAt: now - 1000, completedAt: now - 500 }),   // 500 ms
        makeJob({ id: "job-2", requestId: "req-2", startedAt: undefined, completedAt: now - 500 }), // excluded
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.avgLatency).toBe(500);
  });

  it("excludes Failed/Queued jobs from latency", async () => {
    const now = Date.now();
    const { svc } = buildMocks({
      jobs: [
        makeJob({ startedAt: now - 500, completedAt: now - 200 }),
        makeJob({ id: "job-2", requestId: "req-2", status: JobStatus.Failed, startedAt: now - 5000, completedAt: now - 3000 }),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.avgLatency).toBe(300); // only first job
  });

  it("returns 0 when no jobs have timing data", async () => {
    const { svc } = buildMocks({ jobs: [] });
    const dto = await svc.getSummary(ctx);
    expect(dto.avgLatency).toBe(0);
  });
});

// ─── totalCost ────────────────────────────────────────────────────────────────

describe("totalCost", () => {
  it("computes cost from tokensIn × inputRate + tokensOut × outputRate", async () => {
    // tokensIn=100, outputPer1kTokens=0.001 → $0.0001
    // tokensOut=50, outputPer1kTokens=0.002 → $0.0001
    // total = $0.0002
    const { svc } = buildMocks({
      requests: [makeRequest({ tokensIn: 100, tokensOut: 50 })],
      jobs: [makeJob()],
      models: [makeModel({ pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 } })],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.totalCost).toBeCloseTo(0.0002, 6);
  });

  it("contributes $0 when job has no modelId", async () => {
    const { svc } = buildMocks({
      requests: [makeRequest({ tokensIn: 1000, tokensOut: 1000 })],
      jobs: [makeJob({ modelId: undefined })],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.totalCost).toBe(0);
  });

  it("contributes $0 when request has no token data", async () => {
    const { svc } = buildMocks({
      requests: [makeRequest({ tokensIn: undefined, tokensOut: undefined })],
      jobs: [makeJob()],
      models: [makeModel()],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.totalCost).toBe(0);
  });

  it("excludes Failed jobs from total cost", async () => {
    const { svc } = buildMocks({
      requests: [makeRequest({ tokensIn: 1000, tokensOut: 1000 })],
      jobs: [makeJob({ status: JobStatus.Failed })],
      models: [makeModel()],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.totalCost).toBe(0);
  });

  it("sums cost across multiple jobs correctly", async () => {
    const now = Date.now();
    const { svc } = buildMocks({
      requests: [
        makeRequest({ id: "req-1", tokensIn: 1000, tokensOut: 0 }),
        makeRequest({ id: "req-2", tokensIn: 0, tokensOut: 1000 }),
      ],
      jobs: [
        makeJob({ id: "job-1", requestId: "req-1", completedAt: now - 5000, startedAt: now - 8000 }),
        makeJob({ id: "job-2", requestId: "req-2", completedAt: now - 4000, startedAt: now - 7000 }),
      ],
      models: [makeModel({ pricing: { inputPer1kTokens: 1.0, outputPer1kTokens: 2.0 } })],
    });

    const dto = await svc.getSummary(ctx);
    // job-1: 1000 * 1.0 / 1000 = $1.00
    // job-2: 1000 * 2.0 / 1000 = $2.00
    expect(dto.totalCost).toBeCloseTo(3.0, 6);
  });
});

// ─── activeWorkers ────────────────────────────────────────────────────────────

describe("activeWorkers", () => {
  it("counts Idle + Busy workers as active", async () => {
    const { svc } = buildMocks({
      workers: [
        makeWorker(WorkerStatus.Idle),
        makeWorker(WorkerStatus.Busy),
        makeWorker(WorkerStatus.Draining),
        makeWorker(WorkerStatus.Unhealthy),
        makeWorker(WorkerStatus.Offline),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.activeWorkers).toBe(2);
  });
});

// ─── successRate ──────────────────────────────────────────────────────────────

describe("successRate", () => {
  it("computes ratio of Succeeded jobs to all terminal jobs", async () => {
    const now = Date.now();
    const { svc } = buildMocks({
      jobs: [
        makeJob({ id: "j1", requestId: "r1", status: JobStatus.Succeeded }),
        makeJob({ id: "j2", requestId: "r2", status: JobStatus.Succeeded }),
        makeJob({ id: "j3", requestId: "r3", status: JobStatus.Failed, startedAt: now - 500, completedAt: now - 200 }),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.successRate).toBeCloseTo(2 / 3, 4);
    expect(dto.totalSucceededJobs).toBe(2);
    expect(dto.totalFailedJobs).toBe(1);
  });
});

// ─── requestsPerSecond ────────────────────────────────────────────────────────

describe("requestsPerSecond", () => {
  it("counts requests completed in the current window divided by window seconds", async () => {
    // 3 requests completed 5 s ago → in current 60 s window
    // rps = 3 / 60 = 0.05
    const { svc } = buildMocks({
      requests: [
        makeRequest({ id: "r1", completedAt: new Date(Date.now() - 5_000).toISOString() }),
        makeRequest({ id: "r2", completedAt: new Date(Date.now() - 10_000).toISOString() }),
        makeRequest({ id: "r3", completedAt: new Date(Date.now() - 15_000).toISOString() }),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.requestsPerSecond).toBeCloseTo(3 / 60, 2);
  });

  it("excludes requests completed before the current window", async () => {
    const { svc } = buildMocks({
      requests: [
        makeRequest({ id: "r1", completedAt: new Date(Date.now() - 5_000).toISOString() }), // in window
        makeRequest({ id: "r2", completedAt: new Date(Date.now() - WINDOW_MS - 5_000).toISOString() }), // before window
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.requestsPerSecond).toBeCloseTo(1 / 60, 2);
  });

  it("returns 0 when no requests completed in current window", async () => {
    const { svc } = buildMocks({
      requests: [
        makeRequest({ completedAt: new Date(Date.now() - WINDOW_MS - 5_000).toISOString() }),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.requestsPerSecond).toBe(0);
  });

  it("excludes requests with no completedAt", async () => {
    const { svc } = buildMocks({
      requests: [makeRequest({ completedAt: undefined })],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.requestsPerSecond).toBe(0);
  });
});

// ─── changes ──────────────────────────────────────────────────────────────────

describe("changes — direction", () => {
  it("is 'up' when current window has more requests than prior window", async () => {
    const now = Date.now();
    // 2 requests in current window (< 60 s ago), 0 in prior window
    const { svc } = buildMocks({
      requests: [
        makeRequest({ id: "r1", completedAt: new Date(now - 5_000).toISOString() }),
        makeRequest({ id: "r2", completedAt: new Date(now - 10_000).toISOString() }),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.changes.totalRequests.direction).toBe("up");
    expect(dto.changes.totalRequests.delta).toBeGreaterThan(0);
  });

  it("is 'down' when current window has fewer requests than prior window", async () => {
    const now = Date.now();
    // 0 in current window, 1 in prior window (60–120 s ago)
    const { svc } = buildMocks({
      requests: [
        makeRequest({ id: "r1", completedAt: new Date(now - WINDOW_MS - 5_000).toISOString() }),
      ],
    });

    const dto = await svc.getSummary(ctx);
    expect(dto.changes.totalRequests.direction).toBe("down");
    expect(dto.changes.totalRequests.delta).toBeLessThan(0);
  });
});

describe("changes — formatted strings", () => {
  let dto: SummaryStatsDto;

  beforeEach(async () => {
    const { svc } = buildMocks();
    dto = await svc.getSummary(ctx);
  });

  it("totalRequests formatted is a signed integer string", () => {
    expect(dto.changes.totalRequests.formatted).toMatch(/^[+-]?\d+$/);
  });

  it("requestsPerSecond formatted includes ' rps' suffix", () => {
    expect(dto.changes.requestsPerSecond.formatted).toMatch(/^[+-]\d+\.\d+ rps$/);
  });

  it("avgLatency formatted includes 'ms' suffix", () => {
    expect(dto.changes.avgLatency.formatted).toMatch(/^[+-]\d+ms$/);
  });

  it("totalCost formatted includes '$' prefix", () => {
    expect(dto.changes.totalCost.formatted).toMatch(/^[+-]\$\d+\.\d+$/);
  });
});
