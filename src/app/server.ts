/**
 * app/server.ts
 *
 * Fastify server factory.
 *
 * Responsibilities:
 *   - Create and configure the Fastify instance
 *   - Register global infrastructure plugins (context, request ID)
 *   - Wire error and not-found handlers
 *   - Delegate route registration to app/routes.ts
 *
 * Keeping this as a factory function (not a module-level singleton) ensures
 * each test can spin up its own isolated server with no shared state.
 *
 * ─── Why Fastify? ────────────────────────────────────────────────────────────
 * InferMesh routes high-throughput AI inference traffic. Fastify is 2-3× faster
 * than Express in benchmarks, ships Pino logging out of the box, has a clean
 * plugin lifecycle for modular architecture, and provides native TypeScript types.
 */

import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { config } from "../core/config";
import { contextPlugin } from "../core/context";
import { errorHandler, notFoundHandler } from "../core/errors";
import { buildLoggerConfig } from "../infra/middleware/requestLogger";
import { echoRequestIdHook, genReqId } from "../infra/middleware/requestId";
import { registerRoutes } from "./routes";

export async function buildServer() {
  const fastify = Fastify({
    logger: buildLoggerConfig(config.logging.pretty, config.logging.level),

    // Request ID: honour inbound x-request-id header or generate a UUID v4
    genReqId,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",

    // Treat /foo/ and /foo as the same route
    routerOptions: { ignoreTrailingSlash: true },

    // Cap request body size to configured limit
    bodyLimit: config.server.bodyLimitBytes,
  });

  // ── Global plugins ────────────────────────────────────────────────────────
  // RequestContext decorator — must be registered before routes
  await fastify.register(contextPlugin);

  // WebSocket support — must be registered before any WebSocket route plugins
  await fastify.register(fastifyWebsocket);

  // Echo resolved request ID back as a response header for client correlation
  await echoRequestIdHook(fastify);

  // ── Error handling ────────────────────────────────────────────────────────
  fastify.setErrorHandler(errorHandler);
  fastify.setNotFoundHandler(notFoundHandler);

  // ── Routes ────────────────────────────────────────────────────────────────
  await registerRoutes(fastify);

  return fastify;
}
