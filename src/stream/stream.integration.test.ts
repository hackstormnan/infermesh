/**
 * stream/stream.integration.test.ts
 *
 * HTTP integration tests for the stream gateway.
 *
 * WebSocket upgrade paths require a real network connection and cannot be
 * exercised via fastify.inject(). These tests instead cover:
 *
 *   1. POST /api/v1/internal/stream/emit   — dev/test publish endpoint
 *   2. GET  /api/v1/internal/stream/status — connection stats snapshot
 *
 * Both endpoints are available over plain HTTP and fully exercise the broker
 * and registry at the HTTP boundary layer. WebSocket subscription behaviour is
 * covered in stream/broker/stream-broker.test.ts (unit).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../app/server";

describe("Stream gateway — internal HTTP endpoints", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── GET /api/v1/internal/stream/status ───────────────────────────────────────

  describe("GET /api/v1/internal/stream/status", () => {
    it("returns 200 with connection stats", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/internal/stream/status",
      });

      expect(response.statusCode).toBe(200);
    });

    it("includes activeConnections count in the response", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/internal/stream/status",
      });

      const body = response.json() as { activeConnections: number; connections: unknown[] };
      expect(typeof body.activeConnections).toBe("number");
      expect(body.activeConnections).toBe(0); // no WS clients in inject mode
    });

    it("includes connections array in the response", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/internal/stream/status",
      });

      const body = response.json() as { activeConnections: number; connections: unknown[] };
      expect(Array.isArray(body.connections)).toBe(true);
      expect(body.connections).toHaveLength(0);
    });
  });

  // ── POST /api/v1/internal/stream/emit ────────────────────────────────────────

  describe("POST /api/v1/internal/stream/emit", () => {
    it("returns 200 when publishing to a valid channel", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/internal/stream/emit",
        headers: { "content-type": "application/json" },
        payload: { channel: "requests", data: { requestId: "req-test" } },
      });

      expect(response.statusCode).toBe(200);
    });

    it("response includes published=true and channel name", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/internal/stream/emit",
        headers: { "content-type": "application/json" },
        payload: { channel: "decisions", data: { id: "dec-1" } },
      });

      const body = response.json() as { published: boolean; channel: string; subscriberCount: number };
      expect(body.published).toBe(true);
      expect(body.channel).toBe("decisions");
    });

    it("reports zero subscriberCount when no WS clients are connected", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/internal/stream/emit",
        headers: { "content-type": "application/json" },
        payload: { channel: "workers", data: { workerId: "w-1" } },
      });

      const body = response.json() as { subscriberCount: number };
      expect(body.subscriberCount).toBe(0);
    });

    it("can publish to each of the known channels", async () => {
      const channels = ["requests", "workers", "routing", "decisions"] as const;

      for (const channel of channels) {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/internal/stream/emit",
          headers: { "content-type": "application/json" },
          payload: { channel, data: { test: true } },
        });
        expect(response.statusCode).toBe(200);
      }
    });

    it("returns 400 for an unknown channel", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/internal/stream/emit",
        headers: { "content-type": "application/json" },
        payload: { channel: "not-a-real-channel", data: {} },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when channel is missing from the body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/internal/stream/emit",
        headers: { "content-type": "application/json" },
        payload: { data: { foo: "bar" } },
      });

      expect(response.statusCode).toBe(400);
    });

    it("accepts an empty data object", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/internal/stream/emit",
        headers: { "content-type": "application/json" },
        payload: { channel: "routing", data: {} },
      });

      expect(response.statusCode).toBe(200);
    });

    it("accepts arbitrary data payload structure", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/internal/stream/emit",
        headers: { "content-type": "application/json" },
        payload: {
          channel: "decisions",
          data: {
            nested: { deep: { value: [1, 2, 3] } },
            timestamp: new Date().toISOString(),
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

});
