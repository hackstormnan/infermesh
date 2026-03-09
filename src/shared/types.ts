/**
 * shared/types.ts
 *
 * Canonical API response envelope types used across all routes.
 * Every response — success or error — uses these shapes.
 */

// ─── Response Envelope ────────────────────────────────────────────────────────

export interface ResponseMeta {
  /** Correlation ID for tracing this request end-to-end */
  requestId: string;
  /** ISO-8601 timestamp of the response */
  timestamp: string;
}

export interface ApiSuccessBody<T = unknown> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ApiErrorShape {
  /** Machine-readable error code (e.g. "NOT_FOUND", "VALIDATION_ERROR") */
  code: string;
  /** Human-readable description */
  message: string;
  /** Optional structured error context (validation failures, field errors, etc.) */
  details?: unknown;
}

export interface ApiErrorBody {
  success: false;
  error: ApiErrorShape;
  meta: ResponseMeta;
}

export type ApiBody<T = unknown> = ApiSuccessBody<T> | ApiErrorBody;
