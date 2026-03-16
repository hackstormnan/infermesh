/**
 * modules/models/routes/models.route.ts
 *
 * Route handlers for the models module.
 *
 * Routes registered:
 *   GET /models/candidates  — routing-ready ModelCandidate list (registry filter)
 *   GET /models/:id         — fetch a single model by UUID
 *   GET /models             — paginated, filtered list of registered models
 *
 * Write operations (POST /models, PATCH /models/:id) are intentionally deferred
 * to a later ticket that will add the admin API surface and auth guards.
 * The service methods (register, update) are already implemented and ready to wire.
 *
 * The /models/candidates endpoint is intended for the routing engine and internal
 * dev/debug use. It returns the lean ModelCandidate projection (no metadata or
 * admin fields) and accepts the registry's multi-dimensional filter criteria.
 *
 * NOTE: /models/candidates is registered BEFORE /models/:id so Fastify does not
 * match the literal path segment "candidates" as a dynamic :id value.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { ModelDto } from "../../../shared/contracts/model";
import type { PaginatedResponse } from "../../../shared/primitives";
import { listModelsQuerySchema, modelCandidatesQuerySchema } from "../queries";
import type { ModelsService } from "../service/models.service";
import type { ModelRegistryService } from "../registry/model-registry.service";
import type { ModelCandidate } from "../registry/model-registry.contract";

/**
 * Factory that creates a Fastify plugin for models routes.
 * Accepts the CRUD service and the registry service as dependencies.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildModelsRoute(modelsService, modelRegistryService), { prefix: "/api/v1" });
 */
export function buildModelsRoute(
  service: ModelsService,
  registry: ModelRegistryService,
): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /models/candidates ─────────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<ModelCandidate[]>>;
    }>(
      "/models/candidates",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              taskType:         { type: "string" },
              capability:       { type: "string" },
              provider:         { type: "string" },
              minQualityTier:   { type: "string" },
              minContextWindow: { type: "string" },
              status:           { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                data:    { type: "array", items: { type: "object" } },
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
        const q = modelCandidatesQuerySchema.parse(request.query);
        const filter = {
          taskType:             q.taskType,
          requiredCapabilities: q.capability ? [q.capability] : undefined,
          provider:             q.provider,
          minQualityTier:       q.minQualityTier,
          minContextWindow:     q.minContextWindow,
          status:               q.status,
        };
        const candidates = await registry.findEligible(request.ctx, filter);
        return successResponse(candidates, buildMeta(request.id as string));
      },
    );

    // ── GET /models/:id ────────────────────────────────────────────────────────

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

    // ── GET /models ────────────────────────────────────────────────────────────

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
              page:        { type: "string" },
              limit:       { type: "string" },
              status:      { type: "string" },
              provider:    { type: "string" },
              capability:  { type: "string" },
              qualityTier: { type: "string" },
              name:        { type: "string" },
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
        const query = listModelsQuerySchema.parse(request.query);
        const result = await service.list(request.ctx, query);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
