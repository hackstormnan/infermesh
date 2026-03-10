/**
 * modules/jobs — Job Lifecycle & Execution Tracking
 *
 * Owns the domain model and API surface for inference job lifecycle tracking.
 * A Job is the internal execution unit that bridges an InferenceRequest to a
 * specific model + worker assignment made by the routing engine.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repositories, service, routes) are not re-exported.
 * Cross-module access goes through the public service instance or DTO types.
 *
 * ─── Key consumers ───────────────────────────────────────────────────────────
 * - Routing engine (future ticket): calls jobsService.createJob() then
 *   jobsService.assignJob() as part of the evaluate() dispatch flow
 * - Execution layer (future ticket): calls jobsService.recordFailure() and
 *   jobsService.incrementRetryCount() during the retry loop
 * - Dashboard / monitoring clients: call the /jobs/* REST endpoints
 *
 * ─── Job lifecycle ────────────────────────────────────────────────────────────
 *   Queued → Routing → Assigned → Running → Succeeded
 *                                          ↘ Failed → Retrying → Assigned (retry)
 *                              → Cancelled (at any pre-terminal state)
 *
 * ─── Repository design ───────────────────────────────────────────────────────
 * IJobRepository exposes granular update methods (updateStatus, updateAssignment,
 * recordFailure, incrementRetryCount) rather than a single generic patch.
 * This makes each lifecycle transition explicit at the type level.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET /api/v1/jobs/:id   — fetch a single job by UUID
 *   GET /api/v1/jobs       — paginated list with status/worker/model/request filters
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { jobsRoute } from "../modules/jobs";
 *   fastify.register(jobsRoute, { prefix: "/api/v1" });
 */

import { InMemoryJobRepository } from "./repository/InMemoryJobRepository";
import { JobsService } from "./service/jobs.service";
import { buildJobsRoute } from "./routes/jobs.route";

// ─── Module composition ───────────────────────────────────────────────────────

const jobsRepo = new InMemoryJobRepository();

/** Singleton service instance — shared across the process lifetime */
export const jobsService = new JobsService(jobsRepo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const jobsRoute = buildJobsRoute(jobsService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export type {
  Job,
  JobDispatchedEvent,
  JobCompletedEvent,
  JobEvent,
} from "../../shared/contracts/job";

export {
  JobStatus,
  JobPriority,
  JobSourceType,
} from "../../shared/contracts/job";

export type { ListJobsQuery } from "./queries";
export { listJobsQuerySchema } from "./queries";

export type { IJobRepository, JobStatusUpdate, JobAssignmentUpdate, JobFailureUpdate } from "./repository/IJobRepository";

export type { JobDto, CreateJobDto } from "./service/jobs.service";
