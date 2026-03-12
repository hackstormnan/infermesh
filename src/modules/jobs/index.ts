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
 * Register routes in app/routes.ts using the factory so routing decision events
 * are streamed over the WebSocket gateway:
 *   import { buildJobsModule } from "../modules/jobs";
 *   fastify.register(buildJobsModule(broker), { prefix: "/api/v1" });
 */

import { InMemoryJobRepository } from "./repository/InMemoryJobRepository";
import { JobsService } from "./service/jobs.service";
import { buildJobsRoute } from "./routes/jobs.route";
import { JobLifecycleService } from "./lifecycle/job-lifecycle.service";
import { JobRoutingService } from "./orchestration/job-routing.service";
import { RoutingRecoveryService } from "./orchestration/recovery/routing-recovery.service";
import { buildRoutingDecisionService } from "../routing";
import type { IStreamBroker } from "../../stream/broker/IStreamBroker";

// ─── Module composition ───────────────────────────────────────────────────────

// Shared repositories — all service instances share these so CRUD and routing
// operations see consistent state within the same process.
const jobsRepo = new InMemoryJobRepository();

/** Singleton CRUD service — createJob, getById, list */
export const jobsService = new JobsService(jobsRepo);

/**
 * Singleton lifecycle service — all validated status transitions + history.
 * Shares the same repository instance as jobsService.
 */
export const jobLifecycleService = new JobLifecycleService(jobsRepo);

// ─── Module factory ───────────────────────────────────────────────────────────

/**
 * Build the jobs Fastify plugin with an injected stream broker.
 *
 * Passing the broker causes routing decisions made through
 * POST /api/v1/jobs/:id/route to publish a RoutingDecisionPayload to the
 * "decisions" WebSocket channel on each successful route call.
 *
 * The broker is optional so the factory can be used in integration tests
 * that don't need stream coverage.
 *
 * Usage in app/routes.ts:
 *   import { buildJobsModule } from "../modules/jobs";
 *   fastify.register(buildJobsModule(broker), { prefix: "/api/v1" });
 */
export function buildJobsModule(broker?: IStreamBroker) {
  const decisionSvc     = buildRoutingDecisionService(broker);
  const recoverySvc     = new RoutingRecoveryService(decisionSvc);
  const jobRoutingSvc   = new JobRoutingService(jobsService, jobLifecycleService, recoverySvc);
  return buildJobsRoute(jobsService, jobRoutingSvc);
}

/** Fastify plugin — pre-built without a broker (no streaming).
 *  Prefer buildJobsModule(broker) in app/routes.ts so routing decisions
 *  emit "decisions" channel events over the WebSocket gateway. */
export const jobsRoute = buildJobsModule();

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
  AssignedJobOutcome,
  RetryingJobOutcome,
} from "./orchestration/job-routing.contract";

export { JobNotRoutableError } from "./orchestration/job-routing.contract";

// ─── Routing recovery exports ─────────────────────────────────────────────────

export { RoutingRecoveryService, classifyRoutingFailure } from "./orchestration/recovery/routing-recovery.service";

export { RoutingFailureClass } from "./orchestration/recovery/routing-recovery.contract";

export type {
  RoutingRecoveryInfo,
  RecoveryOutcome,
  RecoverySucceeded,
  RecoveryFailed,
} from "./orchestration/recovery/routing-recovery.contract";
