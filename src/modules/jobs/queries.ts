/**
 * modules/jobs/queries.ts
 *
 * Query schemas for the jobs list endpoint.
 */

import { z } from "zod";
import { paginationQuerySchema } from "../../shared/primitives";
import { JobStatus } from "../../shared/contracts/job";

export const listJobsQuerySchema = paginationQuerySchema.extend({
  /** Prefix search on job ID (e.g. the first 8 chars of the UUID) */
  jobId: z.string().optional(),
  /** Exact match on the originating InferenceRequest ID */
  requestId: z.string().optional(),
  /** Filter by current lifecycle status */
  status: z.nativeEnum(JobStatus).optional(),
  /** Exact match on assigned worker ID */
  workerId: z.string().optional(),
  /** Exact match on selected model ID */
  modelId: z.string().optional(),
});

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;
