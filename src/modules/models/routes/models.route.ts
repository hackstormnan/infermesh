/**
 * modules/models/routes/models.route.ts
 *
 * Read-only route handlers for the models module.
 *
 * Routes registered:
 *   GET /models/:id   — fetch a single model by UUID
 *   GET /models       — paginated, filtered list of registered models
 *
 * Write operations (POST /models, PATCH /models/:id) are intentionally deferred
 * to a later ticket that will add the admin API surface and auth guards.
 * The service methods (register, update) are already implemented and ready to wire.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { ModelDto } from "../../../shared/contracts/model";
import type { PaginatedResponse } from "../../../shared/primitives";
import { listModelsQuerySchema } from "../queries";
import type { ModelsService } from "../service/models.service";

/**
 * Factory that creates a Fastify plugin for models routes.
 * Accepts the service as a dependency for testability.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildModelsRoute(modelsService), { prefix: "/api/v1" });
 */
export function buildModelsRoute(service: ModelsService): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /models/:id ────────────────────────────────────────────────────

    fastify.get<{
      Params: { id: string };
      Reply: ReturnType<typeof successResponse<ModelDto>>;
    }>(
      "/models/:id",
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

    // ── GET /models ────────────────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<PaginatedResponse<ModelDto>>>;
    }>(
      "/models",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              page: { type: "string" },
              limit: { type: "string" },
              status: { type: "string" },
              provider: { type: "string" },
              capability: { type: "string" },
              qualityTier: { type: "string" },
              name: { type: "string" },
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
        const query = listModelsQuerySchema.parse(request.query);
        const result = await service.list(request.ctx, query);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
