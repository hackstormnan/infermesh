/**
 * modules/workers — Worker Registry & Health
 *
 * Owns the registry of inference workers and their real-time health state.
 *
 * Depends on shared contracts:
 *   Worker, WorkerStatus, RegisterWorkerDto, WorkerHeartbeatDto
 *
 * Will expose (future tickets):
 *   POST   /api/v1/workers                 — worker self-registration
 *   POST   /api/v1/workers/:id/heartbeat   — capacity and health report
 *   GET    /api/v1/workers                 — list all registered workers
 *   GET    /api/v1/workers/:id             — single worker detail
 *   DELETE /api/v1/workers/:id             — deregister a worker
 */

export type {
  Worker,
  WorkerDto,
  RegisterWorkerDto,
  WorkerHeartbeatDto,
  WorkerCapacity,
} from "../../shared/contracts/worker";

export {
  WorkerStatus,
  registerWorkerSchema,
  workerHeartbeatSchema,
} from "../../shared/contracts/worker";
