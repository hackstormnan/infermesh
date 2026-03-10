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
 * - Intake module: calls jobsService.createJob() to initialize a new job
 * - Routing engine (future): calls jobLifecycleService.moveToRouting() then
 *   jobLifecycleService.assignJob() as part of the evaluate() dispatch flow
 * - Execution layer (future): calls jobLifecycleService.startJob(),
 *   jobLifecycleService.completeJob(), jobLifecycleService.failJob()
 * - Dashboard / monitoring clients: call the /jobs/* REST endpoints
 *
 * ─── Job lifecycle ────────────────────────────────────────────────────────────
 *   Queued → Routing → Assigned → Running → Succeeded
 *                    ↘          ↘ Failed → Retrying → Assigned (retry)
 *                              → Cancelled (at any pre-terminal state)
 *
 * ─── Services ────────────────────────────────────────────────────────────────
 *   jobsService          — CRUD + read operations (createJob, getById, list)
 *   jobLifecycleService  — All status transitions with validation + history
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
import { JobLifecycleService } from "./lifecycle/job-lifecycle.service";

// ─── Module composition ───────────────────────────────────────────────────────

const jobsRepo = new InMemoryJobRepository();

/** Singleton CRUD service — createJob, getById, list */
export const jobsService = new JobsService(jobsRepo);

/**
 * Singleton lifecycle service — all validated status transitions + history.
 * Shares the same repository instance as jobsService.
 */
export const jobLifecycleService = new JobLifecycleService(jobsRepo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const jobsRoute = buildJobsRoute(jobsService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export type {
  Job,
  JobTransitionRecord,
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

export { JobLifecycleService } from "./lifecycle/job-lifecycle.service";
export type { TransitionMeta, FailureInfo } from "./lifecycle/job-lifecycle.service";
export { InvalidTransitionError, canTransition, isTerminal, ALLOWED_TRANSITIONS } from "./lifecycle/transitions";
