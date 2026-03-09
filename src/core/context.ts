/**
 * core/context.ts
 *
 * Request context propagation for InferMesh.
 *
 * ─── Problem ─────────────────────────────────────────────────────────────────
 * Domain service functions need per-request state (requestId, a request-scoped
 * logger) without importing Fastify types. Passing `FastifyRequest` directly
 * creates a framework dependency in the domain layer — bad for testability.
 *
 * ─── Solution ────────────────────────────────────────────────────────────────
 * `RequestContext` is a plain interface. Route handlers extract it from the
 * Fastify request and pass it to service functions. Services are framework-agnostic.
 *
 * ─── Usage pattern ───────────────────────────────────────────────────────────
 * In a route handler:
 *   const ctx = request.ctx;
 *   const result = await modelsService.create(ctx, dto);
 *
 * In a service function:
 *   async function create(ctx: RequestContext, dto: RegisterModelDto) {
 *     ctx.log.info({ name: dto.name }, 'Registering model');
 *     ...
 *   }
 *
 * In tests (no HTTP request needed):
 *   import { buildTestContext } from '../core/context';
 *   const ctx = buildTestContext();
 *   await service.create(ctx, dto);
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppLogger } from "./logger";
import { logger } from "./logger";

// ─── Type ─────────────────────────────────────────────────────────────────────

export interface RequestContext {
  /** Correlation ID for this request — present in every log line */
  readonly requestId: string;
  /** HTTP method of the originating request */
  readonly method: string;
  /** URL path of the originating request */
  readonly path: string;
  /** Unix epoch ms timestamp of when the request was received */
  readonly startedAt: number;
  /**
   * Pino child logger pre-bound with requestId.
   * Always use this inside service functions instead of importing the root logger.
   */
  readonly log: AppLogger;
}

// ─── Fastify module augmentation ──────────────────────────────────────────────

declare module "fastify" {
  interface FastifyRequest {
    /** Extracted request context — available after the onRequest hook fires */
    ctx: RequestContext;
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Fastify plugin that decorates every request with a `RequestContext`.
 * Register this early in the server lifecycle (before routes).
 *
 * After registration, handlers and services can access `request.ctx`.
 */
export async function contextPlugin(fastify: FastifyInstance): Promise<void> {
  // Declare the decorator with a null sentinel — required by Fastify before
  // the hook sets the real value, prevents accidental sharing between requests.
  // Declare the decorator — null initial value is the Fastify convention
  // for reference-type decorators (avoids prototype pollution between requests).
  // The type assertion is required because decorateRequest's overloads expect
  // a factory function for object/class types in strict mode.
  fastify.decorateRequest("ctx", null as unknown as RequestContext);

  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    request.ctx = {
      requestId: request.id as string,
      method: request.method,
      path: request.url,
      startedAt: Date.now(),
      // request.log is already a Pino child bound with requestId by Fastify
      log: request.log as AppLogger,
    };
  });
}

// ─── Test helper ─────────────────────────────────────────────────────────────

/**
 * Builds a minimal RequestContext for use in unit tests.
 * Avoids the need to spin up a full Fastify instance in service-layer tests.
 *
 * @example
 *   const ctx = buildTestContext({ requestId: 'test-123' });
 *   await service.create(ctx, dto);
 */
export function buildTestContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    requestId: "test-request-id",
    method: "GET",
    path: "/test",
    startedAt: Date.now(),
    log: logger.child({ module: "test" }),
    ...overrides,
  };
}
