/**
 * modules/jobs/routes/jobs.route.ts
 *
 * Read-only route handlers for the jobs module.
 *
 * Routes registered (all under /api/v1 prefix):
 *   GET /jobs/:id   — fetch a single job by UUID
 *   GET /jobs       — paginated, filtered job list
 *
 * Write operations (create, assign, record failure, retry) are internal
 * service calls made by the routing and execution engines — they are not
 * exposed as REST endpoints in this ticket.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { PaginatedResponse } from "../../../shared/primitives";
import { listJobsQuerySchema } from "../queries";
import type { JobDto, JobsService } from "../service/jobs.service";

/**
 * Factory that creates a Fastify plugin for jobs routes.
 * Accepts the service as a dependency for testability.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildJobsRoute(jobsService), { prefix: "/api/v1" });
 */
export function buildJobsRoute(service: JobsService): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /jobs/:id ─────────────────────────────────────────────────────────

    fastify.get<{
      Params: { id: string };
      Reply: ReturnType<typeof successResponse<JobDto>>;
    }>(
      "/jobs/:id",
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

    // ── GET /jobs ─────────────────────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<PaginatedResponse<JobDto>>>;
    }>(
      "/jobs",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              page: { type: "string" },
              limit: { type: "string" },
              jobId: { type: "string" },
              requestId: { type: "string" },
              status: { type: "string" },
              workerId: { type: "string" },
              modelId: { type: "string" },
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
        const query = listJobsQuerySchema.parse(request.query);
        const result = await service.list(request.ctx, query);
        return successResponse(result, buildMeta(request.id as string));
      },
    );
  };
}
