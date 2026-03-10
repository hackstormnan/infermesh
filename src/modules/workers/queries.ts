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

// ─── Registry / candidates query ──────────────────────────────────────────────

/**
 * Query parameters for GET /workers/candidates.
 *
 * Maps directly onto WorkerAssignmentFilter for the HTTP boundary.
 * `status` accepts a single value (maps to `statuses: [status]` internally).
 * `gpuRequired` is a boolean string ("true"/"false") because query strings
 * are always text.
 */
export const workerCandidatesQuerySchema = z.object({
  /**
   * Worker must support this model ID.
   * e.g. ?modelId=claude-sonnet-4-6
   */
  modelId: z.string().optional(),

  /**
   * Restrict to workers in this region.
   * e.g. ?region=us-east-1
   */
  region: z.string().optional(),

  /**
   * Restrict by a single lifecycle status.
   * Defaults to Idle + Busy in the registry service when omitted.
   * e.g. ?status=idle
   */
  status: z.nativeEnum(WorkerStatus).optional(),

  /**
   * Worker's queued jobs must be ≤ this value.
   * e.g. ?maxQueueSize=3
   */
  maxQueueSize: z.coerce.number().int().nonnegative().optional(),

  /**
   * Worker's load score must be ≤ this value (0.0–1.0).
   * Workers without a reported load score always pass.
   * e.g. ?maxLoadScore=0.7
   */
  maxLoadScore: z.coerce.number().min(0).max(1).optional(),

  /**
   * Worker must have sent a heartbeat within this many seconds.
   * e.g. ?minHeartbeatFreshnessSecs=30
   */
  minHeartbeatFreshnessSecs: z.coerce.number().int().positive().optional(),

  /**
   * When "true", only GPU-accelerated workers are returned.
   * e.g. ?gpuRequired=true
   */
  gpuRequired: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),

  /**
   * Restrict by exact instance type.
   * e.g. ?instanceType=g4dn.xlarge
   */
  instanceType: z.string().optional(),
});

export type WorkerCandidatesQuery = z.infer<typeof workerCandidatesQuerySchema>;
