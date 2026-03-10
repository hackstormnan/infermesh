/**
 * modules/metrics/routes/metrics.route.ts
 *
 * Read-only route handlers for the metrics module.
 *
 * Routes registered (all under /api/v1 prefix):
 *   GET /metrics/summary              — system-wide summary with trend indicators
 *   GET /metrics/time-series          — bucketed time-series (volume/latency/cost/errors)
 *   GET /metrics/latency-percentiles  — p50/p75/p95/p99 breakdown
 *   GET /metrics/cost-breakdown       — per-model cost share
 *
 * All routes accept a single `period` query parameter (default: "24h").
 * See queries.ts for the full set of valid values.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import { metricsQuerySchema } from "../queries";
import type {
  CostBreakdown,
  LatencyPercentilesReport,
  MetricsSummary,
  TimeSeriesData,
} from "../service/metrics.service";
import type { MetricsService } from "../service/metrics.service";

/** Shared querystring JSON Schema fragment used by all four routes */
const periodQuerySchema = {
  type: "object",
  properties: {
    period: {
      type: "string",
      enum: ["1h", "24h", "7d", "30d"],
      default: "24h",
    },
  },
} as const;

/**
 * Factory that creates a Fastify plugin for metrics routes.
 * Accepts the service as a dependency for testability.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildMetricsRoute(metricsService), { prefix: "/api/v1" });
 */
export function buildMetricsRoute(service: MetricsService): FastifyPluginAsync {
  return async (fastify) => {
    // ── GET /metrics/summary ──────────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<MetricsSummary>>;
    }>(
      "/metrics/summary",
      {
        schema: {
          querystring: periodQuerySchema,
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
        const query = metricsQuerySchema.parse(request.query);
        const data = await service.getSummary(request.ctx, query);
        return successResponse(data, buildMeta(request.id as string));
      },
    );

    // ── GET /metrics/time-series ──────────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<TimeSeriesData>>;
    }>(
      "/metrics/time-series",
      {
        schema: {
          querystring: periodQuerySchema,
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
        const query = metricsQuerySchema.parse(request.query);
        const data = await service.getTimeSeries(request.ctx, query);
        return successResponse(data, buildMeta(request.id as string));
      },
    );

    // ── GET /metrics/latency-percentiles ──────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<LatencyPercentilesReport>>;
    }>(
      "/metrics/latency-percentiles",
      {
        schema: {
          querystring: periodQuerySchema,
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
        const query = metricsQuerySchema.parse(request.query);
        const data = await service.getLatencyPercentiles(request.ctx, query);
        return successResponse(data, buildMeta(request.id as string));
      },
    );

    // ── GET /metrics/cost-breakdown ───────────────────────────────────────────

    fastify.get<{
      Querystring: Record<string, string | undefined>;
      Reply: ReturnType<typeof successResponse<CostBreakdown>>;
    }>(
      "/metrics/cost-breakdown",
      {
        schema: {
          querystring: periodQuerySchema,
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
        const query = metricsQuerySchema.parse(request.query);
        const data = await service.getCostBreakdown(request.ctx, query);
        return successResponse(data, buildMeta(request.id as string));
      },
    );
  };
}
