/**
 * modules/simulation/routes/simulation.route.ts
 *
 * HTTP route handler for the simulation engine.
 *
 * Routes registered:
 *   POST /simulation/runs — execute a simulation run and return aggregate results
 *
 * The controller is intentionally thin: it validates the request body, delegates
 * all work to SimulationEngineService, and serialises the result. No business
 * logic lives here.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import { simulationRunHttpSchema } from "../contract";
import type { SimulationRunResult } from "../contract";
import type { SimulationEngineService } from "../service/simulation-engine.service";

/**
 * Factory that creates the simulation Fastify plugin.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildSimulationRoute(simulationEngineService), { prefix: "/api/v1" });
 */
export function buildSimulationRoute(
  service: SimulationEngineService,
): FastifyPluginAsync {
  return async (fastify) => {
    // ── POST /simulation/runs ─────────────────────────────────────────────────

    fastify.post<{
      Body: unknown;
      Reply: ReturnType<typeof successResponse<SimulationRunResult>>;
    }>(
      "/simulation/runs",
      {
        schema: {
          body: {
            type: "object",
            required: ["scenarioName", "requestCount"],
            properties: {
              scenarioName:  { type: "string" },
              policyId:      { type: "string" },
              requestCount:  { type: "number", minimum: 1, maximum: 1000 },
              workload: {
                type: "object",
                properties: {
                  requestIdPrefix: { type: "string" },
                },
              },
              sourceTag: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                success:   { type: "boolean" },
                data:      { type: "object", additionalProperties: true },
                meta: {
                  type: "object",
                  properties: {
                    requestId:  { type: "string" },
                    timestamp:  { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const input = simulationRunHttpSchema.parse(request.body);
        const result = await service.run(request.ctx, input);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
