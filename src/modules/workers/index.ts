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
import type { IStreamBroker } from "../../stream/broker/IStreamBroker";

// ─── Module composition ───────────────────────────────────────────────────────

// Shared repository — all service instances share this so CRUD and registry
// operations see consistent state within the same process.
const repo = new InMemoryWorkerRepository();

/** Singleton CRUD service (no broker) — shared across the process lifetime.
 *  For live streaming use buildWorkersModule(broker) in app/routes.ts. */
export const workersService = new WorkersService(repo);

/**
 * Singleton registry service — used by the routing / assignment engine to
 * query eligible worker candidates at selection time.
 *
 * Shares the same repo instance as workersService so both views of the
 * worker pool are always consistent.
 */
export const workerRegistryService = new WorkerRegistryService(repo);

// ─── Module factory ───────────────────────────────────────────────────────────

/**
 * Build the workers Fastify plugin with an injected stream broker.
 *
 * Passing the broker causes worker state changes (register, heartbeat,
 * deregister) to publish a WorkerStatusPayload to the "workers" WebSocket
 * channel after each successful write.
 *
 * The broker is optional so the factory can be used in tests and environments
 * that don't need streaming. The shared repo ensures the broker-injected
 * WorkersService instance and the exported workersService singleton stay
 * consistent — both see the same underlying worker pool.
 *
 * Usage in app/routes.ts:
 *   import { buildWorkersModule } from "../modules/workers";
 *   fastify.register(buildWorkersModule(broker), { prefix: "/api/v1" });
 */
export function buildWorkersModule(broker?: IStreamBroker) {
  const svc = new WorkersService(repo, broker);
  return buildWorkersRoute(svc, workerRegistryService);
}

/** Fastify plugin — pre-built without a broker (no streaming).
 *  Prefer buildWorkersModule(broker) in app/routes.ts so worker events
 *  emit over the WebSocket gateway. */
export const workersRoute = buildWorkersModule();

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
