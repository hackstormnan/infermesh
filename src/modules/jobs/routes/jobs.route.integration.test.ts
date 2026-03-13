/**
 * modules/jobs/routes/jobs.route.integration.test.ts
 *
 * HTTP integration tests for the jobs module routes.
 *
 * Exercises the full request pipeline: Fastify routing, context plugin,
 * route handler, service layer, and response envelope serialisation.
 *
 * The backing repositories are the shared in-memory singletons, which start
 * empty on each fresh server instance. Tests that require data in the store
 * create it via the intake endpoint first (the canonical way to create jobs).
 *
 * POST /jobs/:id/route error paths:
 *   - 404 when job ID does not exist
 *   - 409 when job is not in Queued or Retrying status (state conflict)
 *   - 503 when no active routing policy exists (NoActivePolicyError)
 *
 * The successful routing path requires registered models, workers, and an
 * active routing policy. It is covered at the unit level in job-routing.service.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../app/server";

// ─── Helper: create a job via the intake endpoint ────────────────────────────

async function createJob(server: FastifyInstance): Promise<{ jobId: string; requestId: string }> {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/inference/requests",
    headers: { "content-type": "application/json" },
    payload: {
      endpoint: "test-model",
      taskType: "chat",
      input: { prompt: "Hello" },
      inputSize: 10,
      estimatedComplexity: "low",
    },
  });
  const body = response.json() as { data: { jobId: string; requestId: string } };
  return body.data;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/jobs", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns 200 OK", async () => {
    const response = await server.inject({ method: "GET", url: "/api/v1/jobs" });
    expect(response.statusCode).toBe(200);
  });

  it("returns success envelope shape with paginated data", async () => {
    const response = await server.inject({ method: "GET", url: "/api/v1/jobs" });
    const body = response.json() as Record<string, unknown>;

    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    const data = body.data as Record<string, unknown>;
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(typeof data.page).toBe("number");
    expect(typeof data.limit).toBe("number");
  });

  it("lists created jobs", async () => {
    await createJob(server);

    const response = await server.inject({ method: "GET", url: "/api/v1/jobs" });
    const body = response.json() as { data: { items: unknown[]; total: number } };
    expect(body.data.total).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/v1/jobs/:id", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns 200 with job data for an existing job", async () => {
    const { jobId } = await createJob(server);

    const response = await server.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { success: boolean; data: { id: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(jobId);
    expect(typeof body.data.status).toBe("string");
  });

  it("returns 404 for a non-existent job ID", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/jobs/00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns error envelope on 404", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/jobs/00000000-0000-0000-0000-000000000001",
    });

    const body = response.json() as { success: boolean };
    expect(body.success).toBe(false);
  });
});

describe("POST /api/v1/jobs/:id/route", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns 404 when the job ID does not exist", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/jobs/00000000-0000-0000-0000-999999999999/route",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns error envelope on 404", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/jobs/00000000-0000-0000-0000-999999999998/route",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    const body = response.json() as { success: boolean };
    expect(body.success).toBe(false);
  });

  it("returns 503 when no active routing policy exists (NoActivePolicyError)", async () => {
    // Create a job via intake; the shared policyRepo starts empty, so routing
    // will fail with NoActivePolicyError → HTTP 503.
    const { jobId } = await createJob(server);

    const response = await server.inject({
      method: "POST",
      url: `/api/v1/jobs/${jobId}/route`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    // NoActivePolicyError extends ServiceUnavailableError → 503
    expect(response.statusCode).toBe(503);
  });

  it("returns error envelope with success=false on 503", async () => {
    const { jobId } = await createJob(server);

    const response = await server.inject({
      method: "POST",
      url: `/api/v1/jobs/${jobId}/route`,
      headers: { "content-type": "application/json" },
      payload: {},
    });

    const body = response.json() as { success: boolean };
    expect(body.success).toBe(false);
  });

  it("returns x-request-id header correlated to the request", async () => {
    const { jobId } = await createJob(server);
    const corrId = "route-corr-id-1";

    const response = await server.inject({
      method: "POST",
      url: `/api/v1/jobs/${jobId}/route`,
      headers: { "x-request-id": corrId, "content-type": "application/json" },
      payload: {},
    });

    expect(response.headers["x-request-id"]).toBe(corrId);
  });
});
