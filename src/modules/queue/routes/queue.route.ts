/**
 * modules/queue/routes/queue.route.ts
 *
 * Internal / development-only debug routes for queue inspection.
 *
 * ⚠  These endpoints are NOT intended for production use. They expose queue
 *    internals for local debugging and integration testing. In a production
 *    deployment they should be hidden behind an internal-only network policy,
 *    a feature flag (config.features.queueDebugRoutes), or removed entirely.
 *
 * Routes registered (all under /api/v1 prefix):
 *   GET /queue/items  — list pending queue messages (paginated, priority-sorted)
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { QueueService } from "../service/queue.service";

export function buildQueueRoute(service: QueueService): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /queue/items ───────────────────────────────────────────────────────

    fastify.get<{
      Querystring: { limit?: string };
    }>(
      "/queue/items",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              limit: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                success:   { type: "boolean" },
                data: {
                  type: "object",
                  properties: {
                    messages: { type: "array" },
                    total:    { type: "integer" },
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
      async (request) => {
        const rawLimit = request.query.limit;
        const limit = rawLimit !== undefined ? Math.min(parseInt(rawLimit, 10) || 100, 500) : 100;

        const [messages, total] = await Promise.all([
          service.listMessages(request.ctx, limit),
          service.queueSize(request.ctx),
        ]);

        return successResponse({ messages, total }, buildMeta(request.id as string));
      },
    );
  };
}
