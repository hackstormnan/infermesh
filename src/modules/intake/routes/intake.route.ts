/**
 * modules/intake/routes/intake.route.ts
 *
 * Route handler for the inference intake endpoint.
 *
 * Routes registered (all under /api/v1 prefix):
 *   POST /inference/requests — submit a new inference request
 *
 * The handler is intentionally thin: parse → validate → delegate → respond.
 * All orchestration logic lives in IntakeService.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildMeta, successResponse } from "../../../shared/response";
import { intakeRequestSchema } from "../dto";
import type { IntakeRequestBody, IntakeResponseDto } from "../dto";
import type { IntakeService } from "../service/intake.service";

/**
 * Factory that creates a Fastify plugin for the intake route.
 * Accepts the service as a dependency for testability.
 *
 * Register in app/routes.ts:
 *   fastify.register(buildIntakeRoute(intakeService), { prefix: "/api/v1" });
 */
export function buildIntakeRoute(service: IntakeService): FastifyPluginAsync {
  return async (fastify) => {
    // ── POST /inference/requests ──────────────────────────────────────────────

    fastify.post<{
      Body: IntakeRequestBody;
      Reply: ReturnType<typeof successResponse<IntakeResponseDto>>;
    }>(
      "/inference/requests",
      {
        schema: {
          body: {
            type: "object",
            required: [
              "endpoint",
              "taskType",
              "input",
              "inputSize",
              "estimatedComplexity",
            ],
            properties: {
              endpoint:            { type: "string", minLength: 1 },
              taskType:            { type: "string", minLength: 1 },
              input:               { type: "object" },
              inputSize:           { type: "integer", minimum: 0 },
              estimatedComplexity: { type: "string", enum: ["low", "medium", "high"] },
              priority:            { type: "string", enum: ["low", "normal", "high"] },
              metadata:            { type: "object" },
            },
          },
          response: {
            201: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                data: {
                  type: "object",
                  properties: {
                    requestId: { type: "string" },
                    jobId:     { type: "string" },
                    status:    { type: "string" },
                    jobStatus: { type: "string" },
                    createdAt: { type: "string" },
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
      async (request, reply) => {
        const body = intakeRequestSchema.parse(request.body);
        const dto = await service.intake(request.ctx, body);
        return reply.status(201).send(successResponse(dto, buildMeta(request.id as string)));
      },
    );
  };
}
