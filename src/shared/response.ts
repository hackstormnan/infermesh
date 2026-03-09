/**
 * shared/response.ts
 *
 * Reusable helpers for building consistent API response envelopes.
 * Route handlers call these instead of constructing raw objects,
 * ensuring the envelope shape never drifts.
 */

import type { ApiSuccessBody, ResponseMeta } from "./types";

export function successResponse<T>(
  data: T,
  meta: ResponseMeta,
): ApiSuccessBody<T> {
  return { success: true, data, meta };
}

export function buildMeta(requestId: string): ResponseMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
  };
}
