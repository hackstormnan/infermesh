/**
 * modules/simulation/routes/simulation.route.integration.test.ts
 *
 * HTTP integration tests for POST /api/v1/simulation/runs and
 * POST /api/v1/simulation/experiments.
 *
 * The simulation engine never throws — individual routing failures are
 * captured per request in the errors[] array, so the HTTP status is always
 * 200 on a structurally valid request. With empty in-memory registries and no
 * active policy, all simulation requests fail with NoActivePolicyError, which
 * lets us verify:
 *   - The response envelope shape remains stable regardless of routing outcome
 *   - All required result fields are present even when successCount = 0
 *   - Input validation rejects malformed bodies with 400
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../app/server";

// ─── Minimum valid payloads ───────────────────────────────────────────────────

const MIN_RUN_BODY = {
  scenarioName: "integration-test-run",
  requestCount: 3,
};

const MIN_EXPERIMENT_BODY = {
  experimentName: "integration-test-experiment",
  policies: ["policy-a"],
  workloadConfig: {
    requestCount: 3,
    randomSeed: 42,
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/simulation/runs", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── Envelope shape ──────────────────────────────────────────────────────────

  it("returns 200 with a valid body", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: MIN_RUN_BODY,
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns success envelope", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: MIN_RUN_BODY,
    });

    const body = response.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.meta).toBeDefined();
  });

  it("data contains required SimulationRunResult fields", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: MIN_RUN_BODY,
    });

    const { data } = response.json() as { data: Record<string, unknown> };
    expect(typeof data.runId).toBe("string");
    expect(typeof data.scenarioName).toBe("string");
    expect(typeof data.totalRequests).toBe("number");
    expect(typeof data.successCount).toBe("number");
    expect(typeof data.failureCount).toBe("number");
    expect(typeof data.fallbackCount).toBe("number");
    expect(typeof data.averageEvaluationMs).toBe("number");
    expect(typeof data.startedAt).toBe("string");
    expect(typeof data.completedAt).toBe("string");
    expect(typeof data.durationMs).toBe("number");
    expect(Array.isArray(data.errors)).toBe(true);
    expect(typeof data.perModelSelections).toBe("object");
    expect(typeof data.perWorkerAssignments).toBe("object");
  });

  it("totalRequests equals the requested count", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: { ...MIN_RUN_BODY, requestCount: 5 },
    });

    const { data } = response.json() as { data: { totalRequests: number; successCount: number; failureCount: number } };
    expect(data.totalRequests).toBe(5);
    expect(data.successCount + data.failureCount).toBe(5);
  });

  it("errors array entries have required fields when routing fails", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: MIN_RUN_BODY,
    });

    const { data } = response.json() as {
      data: { errors: Array<Record<string, unknown>> };
    };

    for (const err of data.errors) {
      expect(typeof err.requestIndex).toBe("number");
      expect(typeof err.requestId).toBe("string");
      expect(typeof err.errorType).toBe("string");
      expect(typeof err.message).toBe("string");
    }
  });

  it("scenario name in result matches the input", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: { ...MIN_RUN_BODY, scenarioName: "my-custom-scenario" },
    });

    const { data } = response.json() as { data: { scenarioName: string } };
    expect(data.scenarioName).toBe("my-custom-scenario");
  });

  it("durationMs is non-negative", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: MIN_RUN_BODY,
    });

    const { data } = response.json() as { data: { durationMs: number } };
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it("returns 400 when scenarioName is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: { requestCount: 3 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when requestCount is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: { scenarioName: "test" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when requestCount exceeds 1000", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/runs",
      headers: { "content-type": "application/json" },
      payload: { scenarioName: "test", requestCount: 9999 },
    });

    expect(response.statusCode).toBe(400);
  });
});

// ── POST /api/v1/simulation/experiments ──────────────────────────────────────

describe("POST /api/v1/simulation/experiments", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns 200 with a valid body", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: MIN_EXPERIMENT_BODY,
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns success envelope", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: MIN_EXPERIMENT_BODY,
    });

    const body = response.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("data contains required ExperimentResult fields", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: MIN_EXPERIMENT_BODY,
    });

    const { data } = response.json() as { data: Record<string, unknown> };
    expect(typeof data.experimentId).toBe("string");
    expect(typeof data.experimentName).toBe("string");
    expect(typeof data.workloadRequestCount).toBe("number");
    expect(Array.isArray(data.policies)).toBe(true);
    expect(Array.isArray(data.results)).toBe(true);
    expect(typeof data.rankings).toBe("object");
    expect(typeof data.startedAt).toBe("string");
    expect(typeof data.completedAt).toBe("string");
  });

  it("results length matches policies count", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: {
        ...MIN_EXPERIMENT_BODY,
        policies: ["policy-a", "policy-b"],
      },
    });

    const { data } = response.json() as { data: { results: unknown[]; policies: unknown[] } };
    expect(data.results).toHaveLength(2);
    expect(data.policies).toHaveLength(2);
  });

  it("rankings object has bySuccessRate, byFallbackRate, byEvaluationSpeed arrays", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: {
        ...MIN_EXPERIMENT_BODY,
        policies: ["policy-a", "policy-b"],
      },
    });

    const { data } = response.json() as {
      data: { rankings: Record<string, unknown> };
    };
    expect(Array.isArray(data.rankings.bySuccessRate)).toBe(true);
    expect(Array.isArray(data.rankings.byFallbackRate)).toBe(true);
    expect(Array.isArray(data.rankings.byEvaluationSpeed)).toBe(true);
  });

  it("workloadRequestCount matches workloadConfig.requestCount", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: {
        ...MIN_EXPERIMENT_BODY,
        workloadConfig: { requestCount: 7, randomSeed: 99 },
      },
    });

    const { data } = response.json() as { data: { workloadRequestCount: number } };
    expect(data.workloadRequestCount).toBe(7);
  });

  it("experiment name in result matches input", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: { ...MIN_EXPERIMENT_BODY, experimentName: "my-test-experiment" },
    });

    const { data } = response.json() as { data: { experimentName: string } };
    expect(data.experimentName).toBe("my-test-experiment");
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it("returns 400 when policies array is empty", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: { ...MIN_EXPERIMENT_BODY, policies: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when experimentName is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: { policies: ["policy-a"], workloadConfig: { requestCount: 3 } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when policies exceeds 20", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/simulation/experiments",
      headers: { "content-type": "application/json" },
      payload: {
        ...MIN_EXPERIMENT_BODY,
        policies: Array.from({ length: 21 }, (_, i) => `policy-${i}`),
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
