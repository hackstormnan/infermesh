/**
 * modules/intake/routes/intake.route.integration.test.ts
 *
 * Integration tests for POST /api/v1/inference/requests.
 *
 * These tests use the full server factory (buildServer) so every layer is
 * exercised — HTTP parsing, Fastify JSON schema validation, context plugin,
 * route handler, IntakeService, and the response envelope shape.
 *
 * In-memory repositories mean no external dependencies are needed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../app/server";

describe("POST /api/v1/inference/requests", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("returns 202 Accepted with a valid intake body", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: {
        endpoint: "gpt-4o",
        taskType: "chat",
        input: { prompt: "Hello, world!" },
        inputSize: 12,
        estimatedComplexity: "low",
      },
    });

    expect(response.statusCode).toBe(202);
  });

  it("returns success envelope shape", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: {
        endpoint: "claude-sonnet-4-6",
        taskType: "reasoning",
        input: { messages: [{ role: "user", content: "Explain quantum tunnelling" }] },
        inputSize: 64,
        estimatedComplexity: "high",
        priority: "high",
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.meta).toBeDefined();
  });

  it("returns intake response DTO fields", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: {
        endpoint: "llama-3-70b",
        taskType: "chat",
        input: { text: "Summarise this document" },
        inputSize: 500,
        estimatedComplexity: "medium",
      },
    });

    const body = response.json();
    const data = body.data;

    expect(typeof data.requestId).toBe("string");
    expect(data.requestId.length).toBeGreaterThan(0);
    expect(typeof data.jobId).toBe("string");
    expect(data.jobId.length).toBeGreaterThan(0);
    expect(typeof data.queueMessageId).toBe("string");
    expect(typeof data.status).toBe("string");
    expect(typeof data.jobStatus).toBe("string");
    expect(typeof data.createdAt).toBe("string");
    expect(typeof data.enqueuedAt).toBe("number");
  });

  it("includes meta.requestId and meta.timestamp in response", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: {
        endpoint: "gpt-4o",
        taskType: "chat",
        input: {},
        inputSize: 0,
        estimatedComplexity: "low",
      },
    });

    const body = response.json();
    expect(typeof body.meta.requestId).toBe("string");
    expect(typeof body.meta.timestamp).toBe("string");
  });

  it("echoes x-request-id header as meta.requestId", async () => {
    const correlationId = "intake-test-correlation-id";

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: {
        "content-type": "application/json",
        "x-request-id": correlationId,
      },
      payload: {
        endpoint: "gpt-4o",
        taskType: "chat",
        input: {},
        inputSize: 0,
        estimatedComplexity: "low",
      },
    });

    const body = response.json();
    expect(body.meta.requestId).toBe(correlationId);
    expect(response.headers["x-request-id"]).toBe(correlationId);
  });

  it("two requests get distinct requestIds", async () => {
    const send = () =>
      server.inject({
        method: "POST",
        url: "/api/v1/inference/requests",
        headers: { "content-type": "application/json" },
        payload: {
          endpoint: "gpt-4o",
          taskType: "chat",
          input: {},
          inputSize: 0,
          estimatedComplexity: "low",
        },
      });

    const [r1, r2] = await Promise.all([send(), send()]);
    const id1 = r1.json().data.requestId;
    const id2 = r2.json().data.requestId;

    expect(id1).not.toBe(id2);
  });

  // ── Validation failures ─────────────────────────────────────────────────────

  it("returns 400 when required field 'endpoint' is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: {
        taskType: "chat",
        input: {},
        inputSize: 0,
        estimatedComplexity: "low",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when required field 'input' is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: {
        endpoint: "gpt-4o",
        taskType: "chat",
        inputSize: 10,
        estimatedComplexity: "low",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when estimatedComplexity is not one of low/medium/high", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: {
        endpoint: "gpt-4o",
        taskType: "chat",
        input: {},
        inputSize: 0,
        estimatedComplexity: "extreme",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when body is missing entirely", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns error envelope with success=false on validation failure", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/inference/requests",
      headers: { "content-type": "application/json" },
      payload: { endpoint: "gpt-4o" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.success).toBe(false);
  });
});
