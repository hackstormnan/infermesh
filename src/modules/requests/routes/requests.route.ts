/**
 * modules/requests/routes/requests.route.ts
 *
 * Read-only route handlers for the requests module.
 *
 * Routes registered:
 *   GET /requests/:id   — fetch a single request by ID
 *   GET /requests       — paginated, filtered list of requests
 *
 * Route handlers are intentionally thin — they parse/validate input, call the
 * service, and serialize the response. Business logic stays in the service layer.
 *
 * POST /requests (request intake) is left for Ticket 6, which will wire in
 * queueing, routing, and worker dispatch. The service.create() method already
 * exists and is ready to be connected.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { InferenceRequestDto } from "../../../shared/contracts/request";
import type { PaginatedResponse } from "../../../shared/primitives";
import { listRequestsQuerySchema } from "../queries";
import type { RequestsService } from "../service/requests.service";

/**
 * Factory that creates a Fastify plugin for requests routes.
 * Accepts the service as a dependency so the plugin is testable without
 * a real server instance.
 *
 * Register with a prefix in app/routes.ts:
 *   fastify.register(buildRequestsRoute(requestsService), { prefix: "/api/v1" });
 */
export function buildRequestsRoute(
  service: RequestsService,
): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /requests/:id ──────────────────────────────────────────────────

    fastify.get<{
      Params: { id: string };
      Reply: ReturnType<typeof successResponse<InferenceRequestDto>>;
    }>(
      "/requests/:id",
      {
        schema: {
          params: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                data: { type: "object", additionalProperties: true },
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

    // ── GET /requests ──────────────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<
        typeof successResponse<PaginatedResponse<InferenceRequestDto>>
      >;
    }>(
      "/requests",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              page: { type: "string" },
              limit: { type: "string" },
              status: { type: "string" },
              modelId: { type: "string" },
              id: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                data: { type: "object", additionalProperties: true },
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
        // Parse and coerce query params through Zod (handles page/limit coercion,
        // unknown keys, and nativeEnum validation for status)
        const query = listRequestsQuerySchema.parse(request.query);
        const result = await service.list(request.ctx, query);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
