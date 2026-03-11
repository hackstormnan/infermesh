/**
 * modules/jobs/routes/jobs.route.ts
 *
 * Route handlers for the jobs module.
 *
 * Routes registered (all under /api/v1 prefix):
 *   GET  /jobs/:id        — fetch a single job by UUID
 *   GET  /jobs            — paginated, filtered job list
 *   POST /jobs/:id/route  — route a queued job to the best (model, worker) pair
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { PaginatedResponse } from "../../../shared/primitives";
import { listJobsQuerySchema } from "../queries";
import type { JobDto, JobsService } from "../service/jobs.service";
import type { JobRoutingService } from "../orchestration/job-routing.service";
import type { RouteJobResult } from "../orchestration/job-routing.contract";
import { DecisionSource } from "../../../shared/contracts/routing";

/**
 * Factory that creates a Fastify plugin for jobs routes.
 *
 * @param service          — CRUD + read service (required)
 * @param routingOrchestrator — job routing orchestrator; when provided, registers
 *                             POST /jobs/:id/route
 *
 * Register in app/routes.ts:
 *   fastify.register(buildJobsRoute(jobsService, jobRoutingService), { prefix: "/api/v1" });
 */
export function buildJobsRoute(
  service: JobsService,
  routingOrchestrator?: JobRoutingService,
): FastifyPluginAsync {
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

    // ── POST /jobs/:id/route ───────────────────────────────────────────────────
    // Registered only when the routing orchestrator is provided.

    if (routingOrchestrator) {
      fastify.post<{
        Params: { id: string };
        Body: { decisionSource?: string; policyOverride?: string };
        Reply: ReturnType<typeof successResponse<RouteJobResult>>;
      }>(
        "/jobs/:id/route",
        {
          schema: {
            params: {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string" } },
            },
            body: {
              type: "object",
              properties: {
                decisionSource: {
                  type: "string",
                  enum: [DecisionSource.Live, DecisionSource.Simulation],
                },
                policyOverride: { type: "string" },
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
          const { id } = request.params;
          const { decisionSource, policyOverride } = request.body ?? {};

          const result = await routingOrchestrator.routeJob(request.ctx, {
            jobId: id,
            decisionSource: decisionSource as DecisionSource | undefined,
            policyOverride,
          });

          return successResponse(result, buildMeta(request.id as string));
        },
      );
    }
  };
}
