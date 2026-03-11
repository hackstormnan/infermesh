/**
 * modules/stats/routes/stats.route.ts
 *
 * Route handler for the stats module.
 *
 * Routes registered:
 *   GET /stats/summary  — aggregated system overview (requests, latency, cost, workers)
 *
 * Register in app/routes.ts:
 *   fastify.register(statsRoute, { prefix: "/api/v1" });
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { SummaryStatsService } from "../stats.service";

export function buildStatsRoute(service: SummaryStatsService): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /stats/summary ─────────────────────────────────────────────────────

    fastify.get(
      "/stats/summary",
      {
        schema: {
          response: {
            200: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                data: { type: "object" },
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
        const dto = await service.getSummary(request.ctx);
        return successResponse(dto, buildMeta(request.id as string));
      },
    );
  };
}
