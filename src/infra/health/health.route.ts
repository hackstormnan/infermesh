/**
 * infra/health/health.route.ts
 *
 * GET /health — liveness probe endpoint.
 *
 * Intentionally lightweight: no DB pings, no dependency checks.
 * Readiness checks (dependency health) will be added as a separate
 * endpoint once infrastructure modules are wired up.
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
          service: config.SERVICE_NAME,
          version: config.SERVICE_VERSION,
          environment: config.NODE_ENV,
          uptime: Math.floor(process.uptime()),
        },
        buildMeta(request.id as string),
      );
    },
  );
};
