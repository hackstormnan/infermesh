/**
 * modules/workers/routes/workers.route.ts
 *
 * Route handlers for the workers module.
 *
 * Routes registered:
 *   GET /workers/candidates  — assignment-ready WorkerCandidate list (registry filter)
 *   GET /workers/:id         — fetch a single worker by UUID
 *   GET /workers             — paginated, filtered list of registered workers
 *
 * Write routes (POST /workers, POST /workers/:id/heartbeat,
 * DELETE /workers/:id) are deferred to the ticket that wires the full
 * worker lifecycle alongside heartbeat eviction and dispatch integration.
 * The service methods (register, heartbeat, deregister) are implemented
 * and ready to connect.
 *
 * The /workers/candidates endpoint is intended for the routing / assignment
 * engine and internal dev/debug use. It returns the lean WorkerCandidate
 * projection (no endpoint URL, pre-computed availableSlots) and accepts the
 * registry's multi-dimensional filter criteria.
 *
 * NOTE: /workers/candidates is registered BEFORE /workers/:id so Fastify
 * does not match the literal path segment "candidates" as a dynamic :id value.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { WorkerDto } from "../../../shared/contracts/worker";
import type { PaginatedResponse } from "../../../shared/primitives";
import { listWorkersQuerySchema, workerCandidatesQuerySchema } from "../queries";
import type { WorkersService } from "../service/workers.service";
import type { WorkerRegistryService } from "../registry/worker-registry.service";
import type { WorkerCandidate } from "../registry/worker-registry.contract";
import type { WorkerStatus } from "../../../shared/contracts/worker";

/**
 * Factory that creates a Fastify plugin for workers routes.
 * Accepts both the CRUD service and the registry service as dependencies.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildWorkersRoute(workersService, workerRegistryService), { prefix: "/api/v1" });
 */
export function buildWorkersRoute(
  service: WorkersService,
  registry: WorkerRegistryService,
): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /workers/candidates ────────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<WorkerCandidate[]>>;
    }>(
      "/workers/candidates",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              modelId:                  { type: "string" },
              region:                   { type: "string" },
              status:                   { type: "string" },
              maxQueueSize:             { type: "string" },
              maxLoadScore:             { type: "string" },
              minHeartbeatFreshnessSecs: { type: "string" },
              gpuRequired:              { type: "string" },
              instanceType:             { type: "string" },
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
        const q = workerCandidatesQuerySchema.parse(request.query);
        const filter = {
          requiredModelId:       q.modelId,
          preferredRegion:       q.region,
          statuses:              q.status ? [q.status as WorkerStatus] : undefined,
          maxQueueSize:          q.maxQueueSize,
          maxLoadScore:          q.maxLoadScore,
          minHeartbeatFreshnessMs: q.minHeartbeatFreshnessSecs !== undefined
            ? q.minHeartbeatFreshnessSecs * 1000
            : undefined,
          gpuRequired:           q.gpuRequired,
          instanceType:          q.instanceType,
        };
        const candidates = await registry.findEligible(request.ctx, filter);
        return successResponse(candidates, buildMeta(request.id as string));
      },
    );

    // ── GET /workers/:id ───────────────────────────────────────────────────────

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

    // ── GET /workers ───────────────────────────────────────────────────────────

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
              page:   { type: "string" },
              limit:  { type: "string" },
              status: { type: "string" },
              region: { type: "string" },
              name:   { type: "string" },
              id:     { type: "string" },
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
        const query = listWorkersQuerySchema.parse(request.query);
        const result = await service.list(request.ctx, query);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
