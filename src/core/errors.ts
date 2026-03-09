/**
 * core/errors.ts
 *
 * Application error taxonomy and Fastify global error + not-found handlers.
 *
 * ─── Design ──────────────────────────────────────────────────────────────────
 * All domain modules should throw ApiError (or a named subclass) to produce
 * consistent, machine-readable error responses. The global error handler
 * distinguishes between two error kinds:
 *
 *   Operational (ApiError subclasses) — thrown intentionally by business logic.
 *     Their code, message, and details are safe to return to the caller.
 *
 *   Unexpected (plain Error, unhandled Fastify errors) — bugs or infrastructure
 *     failures. In production only a generic message is sent to the client;
 *     the full error + stack is always logged internally.
 *
 * ─── Error classes ────────────────────────────────────────────────────────────
 *   ApiError              — base; construct directly for one-off cases
 *   BadRequestError       — 400  malformed request structure
 *   UnauthorizedError     — 401  missing or invalid credentials (placeholder)
 *   ForbiddenError        — 403  authenticated but not permitted (placeholder)
 *   NotFoundError         — 404  resource does not exist
 *   ConflictError         — 409  resource already exists / state conflict
 *   ValidationError       — 422  field-level semantic validation failures
 *   TooManyRequestsError  — 429  rate limit exceeded
 *   GatewayError          — 502  upstream model/worker returned an error
 *   ServiceUnavailableError—503  service temporarily unavailable
 *   TimeoutError          — 504  upstream model/worker timed out
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config";
import type { ApiErrorBody } from "../shared/types";

// ─── Base error ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  /**
   * Marks this as an expected operational error — its message is safe to
   * surface to clients. Unexpected errors (bugs) should leave this false.
   */
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
  }
}

// ─── Named subclasses ─────────────────────────────────────────────────────────

/** 400 — Malformed request (missing fields, wrong types) */
export class BadRequestError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, "BAD_REQUEST", message, details);
    this.name = "BadRequestError";
  }
}

/** 401 — No valid credentials supplied (auth not yet implemented) */
export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication required") {
    super(401, "UNAUTHORIZED", message);
    this.name = "UnauthorizedError";
  }
}

/** 403 — Credentials valid but caller lacks permission */
export class ForbiddenError extends ApiError {
  constructor(message = "You do not have permission to perform this action") {
    super(403, "FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

/** 404 — Requested resource does not exist */
export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(404, "NOT_FOUND", `${resource} not found`);
    this.name = "NotFoundError";
  }
}

/** 409 — Resource already exists or state conflict prevents the operation */
export class ConflictError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(409, "CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

/**
 * 422 — Input is structurally valid but fails semantic/business rules.
 * Pass field-level details for form validation UIs.
 */
export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(422, "VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

/** 429 — Caller has exceeded their rate limit */
export class TooManyRequestsError extends ApiError {
  constructor(message = "Too many requests — please slow down") {
    super(429, "TOO_MANY_REQUESTS", message);
    this.name = "TooManyRequestsError";
  }
}

/**
 * 502 — An upstream model provider or worker returned an unexpected error.
 * The caller can typically retry with a different model/worker.
 */
export class GatewayError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(502, "BAD_GATEWAY", message, details);
    this.name = "GatewayError";
  }
}

/** 503 — The service is temporarily unavailable (e.g. during graceful drain) */
export class ServiceUnavailableError extends ApiError {
  constructor(message = "Service temporarily unavailable") {
    super(503, "SERVICE_UNAVAILABLE", message);
    this.name = "ServiceUnavailableError";
  }
}

/** 504 — An upstream model provider or worker did not respond in time */
export class TimeoutError extends ApiError {
  constructor(message = "Upstream request timed out") {
    super(504, "GATEWAY_TIMEOUT", message);
    this.name = "TimeoutError";
  }
}

// ─── Global error handler ─────────────────────────────────────────────────────

const INTERNAL_MSG = "An unexpected error occurred";

export function errorHandler(
  error: FastifyError | ApiError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const isApiError = error instanceof ApiError;

  // Fastify schema validation failures surface with statusCode 400 + validation key
  const isFastifyValidation =
    (error as FastifyError).statusCode === 400 && "validation" in error;

  const statusCode = isApiError
    ? error.statusCode
    : ((error as FastifyError).statusCode ?? 500);

  const isUnexpected = statusCode >= 500 && !isApiError;

  // Operational errors expose their message; unexpected errors in production
  // return a generic message so internal details never reach the client.
  const clientMessage =
    isApiError || isFastifyValidation
      ? error.message
      : config.env === "production"
        ? INTERNAL_MSG
        : (error.message ?? INTERNAL_MSG);

  const body: ApiErrorBody = {
    success: false,
    error: {
      code: isApiError
        ? error.code
        : isFastifyValidation
          ? "VALIDATION_ERROR"
          : "INTERNAL_ERROR",
      message: clientMessage,
      details: isApiError ? error.details : undefined,
    },
    meta: {
      requestId: request.id as string,
      timestamp: new Date().toISOString(),
    },
  };

  if (isUnexpected) {
    // Always log full error + stack for unexpected failures
    request.log.error(
      { err: error, statusCode, requestId: request.id },
      "Unhandled server error",
    );
  } else if (statusCode >= 500) {
    request.log.error({ err: error, statusCode }, "Server error");
  } else {
    request.log.warn({ err: error, statusCode }, "Request error");
  }

  reply.status(statusCode).send(body);
}

// ─── Not-found handler ────────────────────────────────────────────────────────

export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `Route ${request.method} ${request.url} not found`,
    },
    meta: {
      requestId: request.id as string,
      timestamp: new Date().toISOString(),
    },
  };
  reply.status(404).send(body);
}
