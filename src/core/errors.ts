/**
 * core/errors.ts
 *
 * Shared error taxonomy and Fastify global error handler.
 *
 * All domain modules should throw ApiError (or a subclass) to produce
 * consistent, machine-readable error responses across the API surface.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { ApiErrorBody } from "../shared/types";

// ─── Error Class ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  // Convenience factories for common error types
  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static notFound(resource: string) {
    return new ApiError(404, "NOT_FOUND", `${resource} not found`);
  }

  static internal(message = "An unexpected error occurred") {
    return new ApiError(500, "INTERNAL_ERROR", message);
  }

  static serviceUnavailable(message: string) {
    return new ApiError(503, "SERVICE_UNAVAILABLE", message);
  }
}

// ─── Global Error Handler ─────────────────────────────────────────────────────

export function errorHandler(
  error: FastifyError | ApiError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const isApiError = error instanceof ApiError;

  // Fastify validation errors (JSON schema / Zod) surface as 400
  const isFastifyValidation =
    (error as FastifyError).statusCode === 400 && "validation" in error;

  const statusCode = isApiError
    ? error.statusCode
    : (error as FastifyError).statusCode ?? 500;

  const body: ApiErrorBody = {
    success: false,
    error: {
      code: isApiError
        ? error.code
        : isFastifyValidation
          ? "VALIDATION_ERROR"
          : "INTERNAL_ERROR",
      message: error.message ?? "An unexpected error occurred",
      details: isApiError ? error.details : undefined,
    },
    meta: {
      requestId: request.id as string,
      timestamp: new Date().toISOString(),
    },
  };

  // Log 5xx errors as errors; 4xx as warnings
  if (statusCode >= 500) {
    request.log.error({ err: error, statusCode }, "Unhandled server error");
  } else {
    request.log.warn({ err: error, statusCode }, "Request error");
  }

  reply.status(statusCode).send(body);
}
