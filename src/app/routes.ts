/**
 * app/routes.ts
 *
 * Central route registry. All route plugins are registered here so
 * app/server.ts stays focused on server configuration only.
 *
 * To add a new module's routes:
 *   1. Import the plugin from the module folder
 *   2. Register it with an appropriate prefix below
 */

import type { FastifyInstance } from "fastify";
import { healthRoute } from "../infra/health/health.route";
import { requestsRoute } from "../modules/requests";
import { modelsRoute } from "../modules/models";
import { workersRoute } from "../modules/workers";
import { routingRoute } from "../modules/routing";
import { metricsRoute } from "../modules/metrics";
import { buildJobsModule } from "../modules/jobs";
import { buildIntakeModule } from "../modules/intake";
import { queueRoute } from "../modules/queue";
import { statsRoute } from "../modules/stats";
import {
  streamGateway,
  ConnectionRegistry,
  InMemoryStreamBroker,
} from "../stream";

// ─── Stream gateway singletons ────────────────────────────────────────────────
//
// Created once per server instance (i.e. once per buildServer() call) so tests
// each get an isolated registry and broker with no shared state.
//
// The broker is exported so domain services can receive it via constructor
// injection in future tickets (e.g. IntakeService, WorkersService, RoutingDecisionService).
//
// Future: replace InMemoryStreamBroker with a Redis-backed or Kafka-backed
//         implementation without touching any call sites that depend on IStreamBroker.

export function createStreamServices() {
  const registry = new ConnectionRegistry();
  const broker = new InMemoryStreamBroker(registry);
  return { registry, broker };
}

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Stream services — created first so the broker can be threaded into
  //    any module that needs to publish events (intake, workers, routing, …).
  //    The registry and broker are singletons scoped to this server instance,
  //    so each buildServer() call (e.g. in tests) gets fully isolated state.
  const { registry, broker } = createStreamServices();

  // Infrastructure routes (no versioned prefix — used by load balancers / k8s probes)
  await fastify.register(healthRoute);

  // Intake — primary entry point for inference requests.
  // Receives the broker so it can publish "requests" stream events on acceptance.
  await fastify.register(buildIntakeModule(broker), { prefix: "/api/v1" });

  // Queue — internal/debug inspection endpoint
  await fastify.register(queueRoute, { prefix: "/api/v1" });

  // Domain read/management routes — versioned under /api/v1
  await fastify.register(requestsRoute, { prefix: "/api/v1" });
  await fastify.register(modelsRoute, { prefix: "/api/v1" });
  await fastify.register(workersRoute, { prefix: "/api/v1" });
  await fastify.register(routingRoute, { prefix: "/api/v1" });
  await fastify.register(metricsRoute, { prefix: "/api/v1" });
  // Jobs — receives the broker so POST /jobs/:id/route publishes "decisions" events.
  await fastify.register(buildJobsModule(broker), { prefix: "/api/v1" });
  await fastify.register(statsRoute, { prefix: "/api/v1" });

  // ── Stream gateway — WebSocket + internal emit ──────────────────────────────
  //
  // Upgrade path: ws://host/api/v1/stream
  // Internal endpoints: POST /api/v1/internal/stream/emit
  //                     GET  /api/v1/internal/stream/status
  await fastify.register(streamGateway, {
    prefix: "/api/v1",
    registry,
    broker,
  });
}
