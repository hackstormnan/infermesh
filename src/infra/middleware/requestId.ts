/**
 * infra/middleware/requestId.ts
 *
 * Request ID / correlation ID strategy for InferMesh.
 *
 * Fastify handles request IDs natively — no separate middleware needed.
 * This module documents the approach and exports configuration used in
 * app/server.ts so the strategy is defined in one place.
 *
 * Behavior:
 *   1. If the incoming request carries an `x-request-id` header, that value
 *      is adopted as the request ID (enables distributed tracing across services).
 *   2. Otherwise, a new UUID v4 is generated per request.
 *   3. The resolved ID is attached to every Pino log line for that request.
 *   4. The ID is echoed back in the `x-request-id` response header so callers
 *      can correlate responses with their outbound request.
 */

import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";

export const REQUEST_ID_HEADER = "x-request-id";

/** Fastify `genReqId` function — derives ID from inbound header or generates one */
export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === "string" && incoming.length > 0) {
    return incoming;
  }
  return randomUUID();
}

/** Fastify onSend hook — echoes the request ID back in the response header */
export async function echoRequestIdHook(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.addHook("onSend", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
