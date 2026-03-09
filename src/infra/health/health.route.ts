/**
 * infra/health/health.route.ts
 *
 * GET /health — liveness probe endpoint.
 *
 * Intentionally lightweight: no downstream pings, no dependency checks.
 * Readiness checks (model registry, worker registry reachable, etc.) will be
 * added as a separate GET /ready endpoint once those modules are implemented.
 */

import type { FastifyPluginAsync } from "fastify";
import { config } from "../../core/config";
import { buildMeta, successResponse } from "../../shared/response";

interface HealthData {
  status: "ok";
  service: string;
  version: string;
  environment: string;
  uptime: number;
}

export const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: ReturnType<typeof successResponse<HealthData>> }>(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  status: { type: "string" },
                  service: { type: "string" },
                  version: { type: "string" },
                  environment: { type: "string" },
                  uptime: { type: "number" },
                },
              },
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
    async (request, _reply) => {
      return successResponse<HealthData>(
        {
          status: "ok",
          service: config.service.name,
          version: config.service.version,
          environment: config.env,
          uptime: Math.floor(process.uptime()),
        },
        buildMeta(request.id as string),
      );
    },
  );
};
