/**
 * modules/workers/routes/workers.route.ts
 *
 * Read-only route handlers for the workers module.
 *
 * Routes registered:
 *   GET /workers/:id   — fetch a single worker by UUID
 *   GET /workers       — paginated, filtered list of registered workers
 *
 * Write routes (POST /workers, POST /workers/:id/heartbeat,
 * DELETE /workers/:id) are deferred to the ticket that wires the full
 * worker lifecycle alongside heartbeat eviction and dispatch integration.
 * The service methods (register, heartbeat, deregister) are implemented
 * and ready to connect.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { WorkerDto } from "../../../shared/contracts/worker";
import type { PaginatedResponse } from "../../../shared/primitives";
import { listWorkersQuerySchema } from "../queries";
import type { WorkersService } from "../service/workers.service";

/**
 * Factory that creates a Fastify plugin for workers routes.
 * Accepts the service as a dependency for testability.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildWorkersRoute(workersService), { prefix: "/api/v1" });
 */
export function buildWorkersRoute(service: WorkersService): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /workers/:id ───────────────────────────────────────────────────

    fastify.get<{
      Params: { id: string };
      Reply: ReturnType<typeof successResponse<WorkerDto>>;
    }>(
      "/workers/:id",
      {
        schema: {
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
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
        const dto = await service.getById(request.ctx, request.params.id);
        return successResponse(dto, buildMeta(request.id as string));
      },
    );

    // ── GET /workers ───────────────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<PaginatedResponse<WorkerDto>>>;
    }>(
      "/workers",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              page: { type: "string" },
              limit: { type: "string" },
              status: { type: "string" },
              region: { type: "string" },
              name: { type: "string" },
              id: { type: "string" },
            },
          },
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
        const query = listWorkersQuerySchema.parse(request.query);
        const result = await service.list(request.ctx, query);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
