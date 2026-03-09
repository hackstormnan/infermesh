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

// Future domain route imports will be added here, e.g.:
// import { requestsRoute } from "../modules/requests";
// import { modelsRoute }   from "../modules/models";

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // Infrastructure routes (no versioned prefix — used by load balancers / k8s probes)
  await fastify.register(healthRoute);

  // Domain routes will be namespaced under /api/v1 as modules are built out
  // await fastify.register(requestsRoute, { prefix: "/api/v1" });
}
