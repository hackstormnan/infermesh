/**
 * app/server.ts
 *
 * Fastify server factory.
 *
 * Responsibilities:
 *   - Create and configure the Fastify instance
 *   - Wire up global plugins (request ID, error handler, logging)
 *   - Delegate route registration to app/routes.ts
 *
 * Keeping this as a factory function (not a singleton) makes the server
 * fully testable — tests can call buildServer() without side-effects.
 *
 * ─── Why Fastify? ────────────────────────────────────────────────────────────
 * InferMesh will handle high-throughput AI inference requests. Fastify is
 * 2-3x faster than Express in benchmarks, ships with structured Pino logging
 * out of the box, has a clean plugin/lifecycle model for modular architecture,
 * and provides native TypeScript types. These properties make it the right
 * foundation for a latency-sensitive, modular inference router.
 */

import Fastify from "fastify";
import { config } from "../core/config";
import { errorHandler } from "../core/errors";
import { buildLoggerConfig } from "../infra/middleware/requestLogger";
import { echoRequestIdHook, genReqId } from "../infra/middleware/requestId";
import { registerRoutes } from "./routes";

export async function buildServer() {
  const fastify = Fastify({
    // Pino logger — config built in requestLogger.ts
    logger: buildLoggerConfig(config.NODE_ENV, config.LOG_LEVEL),

    // Request ID: honour inbound x-request-id header or generate a UUID
    genReqId,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",

    // Discard trailing slashes (e.g. /health/ → /health)
    routerOptions: { ignoreTrailingSlash: true },
  });

  // ── Global hooks ──────────────────────────────────────────────────────────
  // Echo the resolved request ID back to the caller as a response header
  await echoRequestIdHook(fastify);

  // ── Global error handler ──────────────────────────────────────────────────
  fastify.setErrorHandler(errorHandler);

  // ── 404 handler ───────────────────────────────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found`,
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  await registerRoutes(fastify);

  return fastify;
}
