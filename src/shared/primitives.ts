/**
 * shared/primitives.ts
 *
 * Foundational primitive types shared across every module.
 *
 * ─── Branded ID types ────────────────────────────────────────────────────────
 * Plain `string` IDs are easy to mix up (e.g. passing a WorkerId where a
 * RequestId is expected). Branded types make these errors compile-time errors
 * at zero runtime cost — the brand is erased by TypeScript, never emitted to JS.
 *
 * ─── Pagination ──────────────────────────────────────────────────────────────
 * All list endpoints use the same PaginationQuery / PaginatedResponse shapes
 * so clients have a predictable contract regardless of which resource they query.
 */

import { z } from "zod";

// ─── Brand utility ────────────────────────────────────────────────────────────

/** Type-level brand that prevents accidentally substituting one ID for another */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ─── Domain ID types ──────────────────────────────────────────────────────────

export type RequestId = Brand<string, "RequestId">;
export type JobId = Brand<string, "JobId">;
export type ModelId = Brand<string, "ModelId">;
export type WorkerId = Brand<string, "WorkerId">;
export type SimulationId = Brand<string, "SimulationId">;
export type MetricId = Brand<string, "MetricId">;

/** Any domain entity ID — use when the specific kind is unknown at the call site */
export type AnyEntityId =
  | RequestId
  | JobId
  | ModelId
  | WorkerId
  | SimulationId
  | MetricId;

// ─── Timestamp ────────────────────────────────────────────────────────────────

/** ISO-8601 UTC timestamp string, e.g. "2026-03-09T15:00:00.000Z" */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

export function toIsoTimestamp(date: Date = new Date()): IsoTimestamp {
  return date.toISOString() as IsoTimestamp;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export const paginationQuerySchema = z.object({
  /** 1-based page number (cursor-based APIs may ignore this) */
  page: z.coerce.number().int().positive().default(1),
  /** Items per page, capped at 100 */
  limit: z.coerce.number().int().positive().max(100).default(20),
  /** Opaque cursor token for cursor-based pagination */
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginatedResponse<T> {
  items: T[];
  /** Total number of matching records (may be approximate for large datasets) */
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  /** Present when the backend supports cursor-based pagination */
  nextCursor?: string;
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

export type SortOrder = "asc" | "desc";

// ─── Common base entity ───────────────────────────────────────────────────────

/**
 * Every persisted domain entity extends this shape.
 * Keeps creation/update timestamps consistent across the domain model.
 */
export interface BaseEntity {
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
