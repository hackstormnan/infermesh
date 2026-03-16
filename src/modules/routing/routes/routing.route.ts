/**
 * modules/routing/routes/routing.route.ts
 *
 * Read-only route handlers for the routing module.
 *
 * Routes registered:
 *   GET /routing/policies/:id    — fetch a single routing policy by UUID
 *   GET /routing/policies        — paginated, filtered policy catalog
 *   GET /routing/decisions/:id   — fetch a single decision by UUID
 *   GET /routing/decisions       — paginated, filtered decision audit log
 *
 * Write routes (POST /routing/policies, PATCH /routing/policies/:id,
 * POST /routing/evaluate) are deferred to later tickets that will add
 * the admin API surface, auth guards, and the live routing engine.
 * The service methods (createPolicy, updatePolicy, evaluate) are
 * implemented and ready to connect.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import type { PaginatedResponse } from "../../../shared/primitives";
import {
  listDecisionsQuerySchema,
  listPoliciesQuerySchema,
} from "../queries";
import type {
  RoutingPolicyDto,
  RoutingService,
} from "../service/routing.service";
import type { DecisionHistoryService } from "../decision/decision-history.service";
import type { DecisionDetailDto } from "../decision/decision-history.contract";

/**
 * Factory that creates a Fastify plugin for routing routes.
 *
 * @param service         — routing service (policies + basic decision reads)
 * @param historyService  — optional decision history service; when provided,
 *                          GET /routing/decisions routes return explanation-rich
 *                          DecisionDetailDto responses instead of bare entities.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildRoutingRoute(routingService, decisionHistoryService), { prefix: "/api/v1" });
 */
export function buildRoutingRoute(
  service: RoutingService,
  historyService?: DecisionHistoryService,
): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /routing/policies/:id ──────────────────────────────────────────

    fastify.get<{
      Params: { id: string };
      Reply: ReturnType<typeof successResponse<RoutingPolicyDto>>;
    }>(
      "/routing/policies/:id",
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
        const dto = await service.getPolicyById(request.ctx, request.params.id);
        return successResponse(dto, buildMeta(request.id as string));
      },
    );

    // ── GET /routing/policies ──────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<PaginatedResponse<RoutingPolicyDto>>>;
    }>(
      "/routing/policies",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              page: { type: "string" },
              limit: { type: "string" },
              status: { type: "string" },
              strategy: { type: "string" },
              name: { type: "string" },
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
        const query = listPoliciesQuerySchema.parse(request.query);
        const result = await service.listPolicies(request.ctx, query);
        return successResponse(result, buildMeta(request.id as string));
      },
    );

    // ── GET /routing/decisions/:id ─────────────────────────────────────────
    // Returns DecisionDetailDto (explanation-rich) when historyService is wired,
    // falls back to bare RoutingDecision when it is not.

    fastify.get<{
      Params: { id: string };
      Reply: ReturnType<typeof successResponse<DecisionDetailDto>>;
    }>(
      "/routing/decisions/:id",
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
        const dto = historyService
          ? await historyService.getDecisionDetail(request.ctx, request.params.id)
          : await service.getDecision(request.ctx, request.params.id);
        return successResponse(dto as DecisionDetailDto, buildMeta(request.id as string));
      },
    );

    // ── GET /routing/decisions ─────────────────────────────────────────────
    // Returns paginated DecisionDetailDto list when historyService is wired.

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<PaginatedResponse<DecisionDetailDto>>>;
    }>(
      "/routing/decisions",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              page: { type: "string" },
              limit: { type: "string" },
              requestId: { type: "string" },
              jobId: { type: "string" },
              outcome: { type: "string" },
              policyId: { type: "string" },
              decisionSource: { type: "string" },
              selectedModelId: { type: "string" },
              selectedWorkerId: { type: "string" },
              from: { type: "string" },
              to: { type: "string" },
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
        const query = listDecisionsQuerySchema.parse(request.query);
        const result = historyService
          ? await historyService.listDecisionDetails(request.ctx, query)
          : await service.listDecisions(request.ctx, query);
        return successResponse(
          result as PaginatedResponse<DecisionDetailDto>,
          buildMeta(request.id as string),
        );
      },
    );
  };
}
