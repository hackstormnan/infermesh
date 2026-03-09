/**
 * health.route.test.ts
 *
 * Smoke tests for the /health endpoint.
 * Demonstrates the server factory pattern — each test gets a fresh instance.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../app/server";

describe("GET /health", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns 200 with success envelope", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.service).toBeDefined();
    expect(body.meta.requestId).toBeDefined();
    expect(body.meta.timestamp).toBeDefined();
  });

  it("echoes x-request-id header when provided", async () => {
    const correlationId = "test-correlation-id-123";

    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": correlationId },
    });

    expect(response.headers["x-request-id"]).toBe(correlationId);
    expect(response.json().meta.requestId).toBe(correlationId);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/not-a-real-route",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().success).toBe(false);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });
});
