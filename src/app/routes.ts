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

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // Infrastructure routes (no versioned prefix — used by load balancers / k8s probes)
  await fastify.register(healthRoute);

  // Domain routes — versioned under /api/v1
  await fastify.register(requestsRoute, { prefix: "/api/v1" });
}
