/**
 * modules/metrics/metrics.route.integration.test.ts
 *
 * HTTP integration tests for GET /api/v1/metrics/* and GET /api/v1/stats/summary.
 *
 * Uses buildServer() + fastify.inject() so the full request pipeline is exercised:
 * Fastify JSON schema serialisation, context plugin, route handler, analytics
 * aggregation service, and the response envelope. The backing repositories are
 * empty in-memory stores, so all counts and sums default to zero — the tests
 * verify envelope structure and required field presence, not specific values.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../app/server";

describe("Metrics & stats endpoints", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── Shared helpers ──────────────────────────────────────────────────────────

  function expectSuccessEnvelope(body: Record<string, unknown>): void {
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.meta).toBeDefined();
    const meta = body.meta as Record<string, unknown>;
    expect(typeof meta.requestId).toBe("string");
    expect(typeof meta.timestamp).toBe("string");
  }

  // ── GET /api/v1/metrics/summary ─────────────────────────────────────────────

  describe("GET /api/v1/metrics/summary", () => {
    it("returns 200 OK", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary" });
      expect(response.statusCode).toBe(200);
    });

    it("returns success envelope shape", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary" });
      expectSuccessEnvelope(response.json());
    });

    it("data contains required MetricsSummary fields", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary" });
      const { data } = response.json() as { data: Record<string, unknown> };

      expect(typeof data.totalRequests).toBe("number");
      expect(typeof data.requestsPerSecond).toBe("number");
      expect(typeof data.avgLatencyMs).toBe("number");
      expect(typeof data.successRate).toBe("number");
      expect(typeof data.errorRate).toBe("number");
      expect(typeof data.totalCostUsd).toBe("number");
    });

    it("data contains trend indicators", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary" });
      const { data } = response.json() as { data: Record<string, unknown> };

      expect(data.requestsTrend).toBeDefined();
      expect(data.latencyTrend).toBeDefined();
      expect(data.errorRateTrend).toBeDefined();
      expect(data.costTrend).toBeDefined();
    });

    it("trend indicators have delta, percent, direction fields", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary" });
      const { data } = response.json() as { data: Record<string, unknown> };
      const trend = data.requestsTrend as Record<string, unknown>;

      expect(typeof trend.delta).toBe("number");
      expect(typeof trend.percent).toBe("number");
      expect(["up", "down", "flat"]).toContain(trend.direction);
    });

    it("accepts ?period=1h", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary?period=1h" });
      expect(response.statusCode).toBe(200);
    });

    it("accepts ?period=7d", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary?period=7d" });
      expect(response.statusCode).toBe(200);
    });

    it("returns 400 for unsupported period value", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/summary?period=99y" });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── GET /api/v1/metrics/time-series ─────────────────────────────────────────

  describe("GET /api/v1/metrics/time-series", () => {
    it("returns 200 OK", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/time-series" });
      expect(response.statusCode).toBe(200);
    });

    it("returns success envelope shape", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/time-series" });
      expectSuccessEnvelope(response.json());
    });

    it("data contains required TimeSeriesData fields", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/time-series" });
      const { data } = response.json() as { data: Record<string, unknown> };

      expect(typeof data.period).toBe("string");
      expect(typeof data.granularityMs).toBe("number");
      expect(Array.isArray(data.points)).toBe(true);
      expect(typeof data.generatedAt).toBe("string");
    });

    it("time-series points have required fields when present", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/time-series" });
      const { data } = response.json() as { data: { points: Record<string, unknown>[] } };

      // With an empty repository, points may be empty or contain zeroed buckets.
      // Validate the shape of any points that exist.
      for (const point of data.points) {
        expect(typeof point.timestamp).toBe("number");
        expect(typeof point.requests).toBe("number");
        expect(typeof point.avgLatencyMs).toBe("number");
        expect(typeof point.costUsd).toBe("number");
        expect(typeof point.errors).toBe("number");
      }
    });
  });

  // ── GET /api/v1/metrics/latency-percentiles ──────────────────────────────────

  describe("GET /api/v1/metrics/latency-percentiles", () => {
    it("returns 200 OK", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/latency-percentiles" });
      expect(response.statusCode).toBe(200);
    });

    it("returns success envelope shape", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/latency-percentiles" });
      expectSuccessEnvelope(response.json());
    });

    it("data contains required LatencyPercentilesReport fields", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/latency-percentiles" });
      const { data } = response.json() as { data: Record<string, unknown> };

      expect(typeof data.period).toBe("string");
      expect(typeof data.sampleCount).toBe("number");
      expect(typeof data.p50Ms).toBe("number");
      expect(typeof data.p75Ms).toBe("number");
      expect(typeof data.p95Ms).toBe("number");
      expect(typeof data.p99Ms).toBe("number");
      expect(typeof data.generatedAt).toBe("string");
    });
  });

  // ── GET /api/v1/metrics/cost-breakdown ──────────────────────────────────────

  describe("GET /api/v1/metrics/cost-breakdown", () => {
    it("returns 200 OK", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/cost-breakdown" });
      expect(response.statusCode).toBe(200);
    });

    it("returns success envelope shape", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/cost-breakdown" });
      expectSuccessEnvelope(response.json());
    });

    it("data contains required CostBreakdown fields", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/metrics/cost-breakdown" });
      const { data } = response.json() as { data: Record<string, unknown> };

      expect(typeof data.period).toBe("string");
      expect(typeof data.totalCostUsd).toBe("number");
      expect(Array.isArray(data.entries)).toBe(true);
      expect(typeof data.generatedAt).toBe("string");
    });
  });

  // ── GET /api/v1/stats/summary ────────────────────────────────────────────────

  describe("GET /api/v1/stats/summary", () => {
    it("returns 200 OK", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/stats/summary" });
      expect(response.statusCode).toBe(200);
    });

    it("returns success envelope shape", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/stats/summary" });
      expectSuccessEnvelope(response.json());
    });

    it("data contains required SummaryStatsDto fields", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/stats/summary" });
      const { data } = response.json() as { data: Record<string, unknown> };

      expect(typeof data.totalRequests).toBe("number");
      expect(typeof data.requestsPerSecond).toBe("number");
      expect(typeof data.avgLatency).toBe("number");
      expect(typeof data.totalCost).toBe("number");
      expect(typeof data.activeWorkers).toBe("number");
      expect(typeof data.successRate).toBe("number");
      expect(typeof data.totalSucceededJobs).toBe("number");
      expect(typeof data.totalFailedJobs).toBe("number");
      expect(typeof data.windowMs).toBe("number");
      expect(typeof data.computedAt).toBe("number");
    });

    it("data.changes contains all four change indicators", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/stats/summary" });
      const { data } = response.json() as { data: { changes: Record<string, unknown> } };

      const { changes } = data;
      expect(changes.totalRequests).toBeDefined();
      expect(changes.requestsPerSecond).toBeDefined();
      expect(changes.avgLatency).toBeDefined();
      expect(changes.totalCost).toBeDefined();
    });

    it("each change indicator has delta, formatted, direction fields", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/stats/summary" });
      const { data } = response.json() as { data: { changes: Record<string, Record<string, unknown>> } };

      for (const key of ["totalRequests", "requestsPerSecond", "avgLatency", "totalCost"]) {
        const change = data.changes[key];
        expect(typeof change.delta).toBe("number");
        expect(typeof change.formatted).toBe("string");
        expect(["up", "down", "neutral"]).toContain(change.direction);
      }
    });

    it("reports successRate as 1.0 when no jobs have run (empty store)", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/stats/summary" });
      const { data } = response.json() as { data: { successRate: number } };

      // Empty repo: no terminal jobs → terminalCount = 0 → successRate defaults to 1.0
      expect(data.successRate).toBe(1.0);
    });

    it("includes x-request-id header in response", async () => {
      const correlationId = "stats-test-corr-id";
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/stats/summary",
        headers: { "x-request-id": correlationId },
      });

      expect(response.headers["x-request-id"]).toBe(correlationId);
    });
  });
});
