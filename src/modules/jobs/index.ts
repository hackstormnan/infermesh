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
 * - Job routing: calls jobRoutingService.routeJob() to route a Queued job
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
 *   jobRoutingService    — Orchestrates routing: Queued → Routing → Assigned
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET  /api/v1/jobs/:id        — fetch a single job by UUID
 *   GET  /api/v1/jobs            — paginated list with status/worker/model/request filters
 *   POST /api/v1/jobs/:id/route  — route a queued job to the best (model, worker) pair
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
import { JobRoutingService } from "./orchestration/job-routing.service";
import { routingDecisionService } from "../routing";

// ─── Module composition ───────────────────────────────────────────────────────

const jobsRepo = new InMemoryJobRepository();

/** Singleton CRUD service — createJob, getById, list */
export const jobsService = new JobsService(jobsRepo);

/**
 * Singleton lifecycle service — all validated status transitions + history.
 * Shares the same repository instance as jobsService.
 */
export const jobLifecycleService = new JobLifecycleService(jobsRepo);

/**
 * Singleton routing orchestrator — routes a Queued job through the decision
 * engine and transitions it to Assigned with model/worker/decision stamped.
 *
 * Usage:
 *   const result = await jobRoutingService.routeJob(ctx, { jobId: "job-123" });
 *   // result.job — now Assigned; result.decision — persisted routing decision
 */
export const jobRoutingService = new JobRoutingService(
  jobsService,
  jobLifecycleService,
  routingDecisionService,
);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const jobsRoute = buildJobsRoute(jobsService, jobRoutingService);

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

// ─── Job routing orchestration exports ───────────────────────────────────────

export { JobRoutingService } from "./orchestration/job-routing.service";

export type {
  RouteJobInput,
  RouteJobResult,
} from "./orchestration/job-routing.contract";

export { JobNotRoutableError } from "./orchestration/job-routing.contract";
