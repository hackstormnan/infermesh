/**
 * modules/workers — Worker Registry & Real-Time Health
 *
 * Owns the full lifecycle of registered inference workers: registration,
 * heartbeat processing, runtime metrics, status management, and deregistration.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repository, service, routes) are not re-exported.
 * All cross-module access goes through the public service instance or DTO types.
 *
 * ─── Key consumer: routing engine (Ticket 8) ─────────────────────────────────
 * The routing engine calls workersService.list() with { status: Idle } to build
 * the candidate pool, then reads each WorkerDto's capacity, runtimeMetrics
 * (loadScore, ttftMs), region, and supportedModelIds for placement scoring.
 *
 * ─── Heartbeat eviction (Ticket 8) ───────────────────────────────────────────
 * A background task will call workersService.heartbeat() on behalf of the
 * eviction timer to mark workers Unhealthy when lastHeartbeatAt is too stale.
 * The repository and service are already ready for this without any changes.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET    /api/v1/workers              — paginated list with status/region/name filters
 *   GET    /api/v1/workers/:id          — fetch a worker by UUID
 *   POST   /api/v1/workers             — worker self-registration (Ticket 8)
 *   POST   /api/v1/workers/:id/heartbeat — capacity and health report (Ticket 8)
 *   DELETE /api/v1/workers/:id          — graceful deregistration (Ticket 8)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { workersRoute } from "../modules/workers";
 *   fastify.register(workersRoute, { prefix: "/api/v1" });
 */

import { InMemoryWorkerRepository } from "./repository/InMemoryWorkerRepository";
import { WorkersService } from "./service/workers.service";
import { buildWorkersRoute } from "./routes/workers.route";

// ─── Module composition ───────────────────────────────────────────────────────

const repo = new InMemoryWorkerRepository();

/** Singleton service instance — shared across the process lifetime */
export const workersService = new WorkersService(repo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const workersRoute = buildWorkersRoute(workersService);

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

export type { ListWorkersQuery } from "./queries";
export { listWorkersQuerySchema } from "./queries";

export type { IWorkerRepository } from "./repository/IWorkerRepository";
