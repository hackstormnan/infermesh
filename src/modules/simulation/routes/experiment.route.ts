/**
 * modules/simulation/routes/experiment.route.ts
 *
 * HTTP route handler for the policy experiment runner.
 *
 * Routes registered:
 *   POST /simulation/experiments — run a multi-policy comparison experiment
 *
 * The controller is intentionally thin: it validates the request body,
 * delegates all work to ExperimentRunnerService, and serialises the result.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import { experimentRunHttpSchema } from "../experiment/experiment-runner.contract";
import type { ExperimentResult } from "../experiment/experiment-runner.contract";
import type { ExperimentRunnerService } from "../experiment/experiment-runner.service";

/**
 * Factory that creates the experiment Fastify plugin.
 *
 * Register in the simulation module index alongside the simulation runs route:
 *   fastify.register(buildExperimentRoute(experimentRunnerService));
 */
export function buildExperimentRoute(
  service: ExperimentRunnerService,
): FastifyPluginAsync {
  return async (fastify) => {
    // ── POST /simulation/experiments ─────────────────────────────────────────

    fastify.post<{
      Body: unknown;
      Reply: ReturnType<typeof successResponse<ExperimentResult>>;
    }>(
      "/simulation/experiments",
      {
        schema: {
          body: {
            type: "object",
            required: ["experimentName", "policies", "workloadConfig"],
            properties: {
              experimentName: { type: "string" },
              policies: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 20,
              },
              workloadConfig: {
                type: "object",
                required: ["requestCount"],
                properties: {
                  requestCount: { type: "number" },
                  taskDistribution:       { type: "object" },
                  inputSizeDistribution:  { type: "object" },
                  complexityDistribution: { type: "object" },
                  burstPattern:           { type: "object" },
                  randomSeed:             { type: "number" },
                  requestIdPrefix:        { type: "string" },
                },
              },
              sourceTag: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                data:    { type: "object", additionalProperties: true },
                meta: {
                  type: "object",
                  properties: {
                    requestId: { type: "string" },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const input = experimentRunHttpSchema.parse(request.body);
        const result = await service.run(request.ctx, input);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
