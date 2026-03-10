/**
 * modules/workers — Worker Registry & Real-Time Health
 *
 * Owns the full lifecycle of registered inference workers: registration,
 * heartbeat processing, runtime metrics, status management, deregistration,
 * and selection-time eligibility filtering.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repository, service, routes) are not re-exported.
 * All cross-module access goes through the public service instances or types.
 *
 * ─── Service instances ───────────────────────────────────────────────────────
 *   workersService        — CRUD + heartbeat (register, heartbeat, deregister,
 *                           getById, getByName, list)
 *   workerRegistryService — selection-time lookup, health/load-aware filtering,
 *                           candidate preparation (findEligible, listHealthy,
 *                           listAssignable)
 *
 * ─── Key consumer: routing / assignment engine (Ticket 15+) ──────────────────
 * The routing engine calls workerRegistryService.findEligible(ctx, filter) to
 * get a filtered WorkerCandidate[] at assignment time. Each candidate carries
 * the capacity, runtimeMetrics, region, and supportedModelIds needed to compute
 * a placement decision without loading the full Worker entity.
 *
 * ─── Heartbeat eviction (Ticket 15+) ─────────────────────────────────────────
 * A background task will mark workers Unhealthy when lastHeartbeatAt is stale.
 * The registry and service are already ready for this without any changes.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET    /api/v1/workers/candidates  — registry filter → WorkerCandidate[] (routing/debug)
 *   GET    /api/v1/workers             — paginated list with status/region/name filters
 *   GET    /api/v1/workers/:id         — fetch a worker by UUID
 *   POST   /api/v1/workers             — worker self-registration (Ticket 15+)
 *   POST   /api/v1/workers/:id/heartbeat — capacity and health report (Ticket 15+)
 *   DELETE /api/v1/workers/:id         — graceful deregistration (Ticket 15+)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { workersRoute } from "../modules/workers";
 *   fastify.register(workersRoute, { prefix: "/api/v1" });
 */

import { InMemoryWorkerRepository } from "./repository/InMemoryWorkerRepository";
import { WorkersService } from "./service/workers.service";
import { WorkerRegistryService } from "./registry/worker-registry.service";
import { buildWorkersRoute } from "./routes/workers.route";

// ─── Module composition ───────────────────────────────────────────────────────

const repo = new InMemoryWorkerRepository();

/** Singleton CRUD service — shared across the process lifetime */
export const workersService = new WorkersService(repo);

/**
 * Singleton registry service — used by the routing / assignment engine to
 * query eligible worker candidates at selection time.
 *
 * Shares the same repo instance as workersService so both views of the
 * worker pool are always consistent.
 */
export const workerRegistryService = new WorkerRegistryService(repo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const workersRoute = buildWorkersRoute(workersService, workerRegistryService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export type {
  Worker,
  WorkerDto,
  RegisterWorkerDto,
  WorkerHeartbeatDto,
  WorkerCapacity,
  WorkerHardware,
  WorkerRuntimeMetrics,
  WorkerUpdate,
} from "../../shared/contracts/worker";

export {
  WorkerStatus,
  registerWorkerSchema,
  workerHeartbeatSchema,
  workerRuntimeMetricsSchema,
} from "../../shared/contracts/worker";

export type { ListWorkersQuery, WorkerCandidatesQuery } from "./queries";
export { listWorkersQuerySchema, workerCandidatesQuerySchema } from "./queries";

export type { IWorkerRepository } from "./repository/IWorkerRepository";

export type { WorkerAssignmentFilter, WorkerCandidate } from "./registry/worker-registry.contract";
export { WorkerRegistryService } from "./registry/worker-registry.service";
