/**
 * modules/requests/queries.ts
 *
 * Query and filter contracts for the requests list endpoint.
 *
 * Extends the shared PaginationQuery with request-specific filter fields.
 * The Zod schema is used both for route-level query string parsing and
 * for typing the service layer — a single source of truth.
 */

import { z } from "zod";
import { paginationQuerySchema } from "../../shared/primitives";
import { RequestStatus } from "../../shared/contracts/request";

export const listRequestsQuerySchema = paginationQuerySchema.extend({
  /**
   * Filter by lifecycle status.
   * e.g. ?status=queued returns only queued requests.
   */
  status: z.nativeEnum(RequestStatus).optional(),

  /**
   * Exact match on model ID.
   * e.g. ?modelId=claude-sonnet
   */
  modelId: z.string().optional(),

  /**
   * Prefix search on request ID.
   * Useful for looking up a request when you only have the first few characters.
   * e.g. ?id=3fa85f
   */
  id: z.string().optional(),
});

export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;
