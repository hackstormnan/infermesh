/**
 * modules/workers/queries.ts
 *
 * Query and filter contracts for the workers list endpoint.
 *
 * Extends the shared PaginationQuery with worker-specific filter fields.
 * The Zod schema is used at the route boundary for query string parsing
 * and is typed through to the service and repository layers.
 */

import { z } from "zod";
import { paginationQuerySchema } from "../../shared/primitives";
import { WorkerStatus } from "../../shared/contracts/worker";

export const listWorkersQuerySchema = paginationQuerySchema.extend({
  /**
   * Filter by lifecycle status.
   * e.g. ?status=idle returns only workers currently available for dispatch.
   */
  status: z.nativeEnum(WorkerStatus).optional(),

  /**
   * Filter by geographic or logical region (exact match).
   * e.g. ?region=us-east-1
   */
  region: z.string().optional(),

  /**
   * Prefix search on worker name.
   * e.g. ?name=gpu-worker returns gpu-worker-01, gpu-worker-02, …
   */
  name: z.string().optional(),

  /**
   * Prefix search on worker ID.
   * Useful for lookups when only the first characters of the UUID are known.
   */
  id: z.string().optional(),
});

export type ListWorkersQuery = z.infer<typeof listWorkersQuerySchema>;
