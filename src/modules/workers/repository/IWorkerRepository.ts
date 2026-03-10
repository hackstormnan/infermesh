/**
 * modules/workers/repository/IWorkerRepository.ts
 *
 * Repository interface (port) for Worker persistence.
 *
 * The service layer depends only on this interface. The in-memory adapter
 * is used during development and tests; swapping in a database-backed adapter
 * (Redis, Postgres) requires only changing the binding in index.ts.
 *
 * ─── Lookup semantics ────────────────────────────────────────────────────────
 *   findById   — exact match on the branded WorkerId (UUID)
 *   findByName — case-insensitive match on the worker's display name
 *   list       — paginated, filtered, sorted by name ascending
 *
 * ─── Mutation semantics ──────────────────────────────────────────────────────
 *   create — caller supplies a fully-constructed Worker entity
 *   update — applies a partial patch to mutable fields
 *             (status, capacity, lastHeartbeatAt, runtimeMetrics, labels)
 */

import type { Worker, WorkerUpdate } from "../../../shared/contracts/worker";
import type { WorkerId, PaginatedResponse } from "../../../shared/primitives";
import type { ListWorkersQuery } from "../queries";

export interface IWorkerRepository {
  /** Persist a new worker. The caller must supply a fully-constructed entity. */
  create(worker: Worker): Promise<Worker>;

  /** Retrieve a worker by its UUID. Returns null if not found. */
  findById(id: WorkerId): Promise<Worker | null>;

  /**
   * Retrieve a worker by its display name (case-insensitive).
   * Returns null if no worker matches.
   */
  findByName(name: string): Promise<Worker | null>;

  /**
   * Paginated, filtered list of workers.
   * Results are sorted alphabetically by name.
   */
  list(query: ListWorkersQuery): Promise<PaginatedResponse<Worker>>;

  /**
   * Apply a partial update to a registered worker.
   * Called by the service on every heartbeat, status change, or deregistration.
   * Returns the updated entity, or null if the worker ID is not found.
   */
  update(id: WorkerId, patch: WorkerUpdate): Promise<Worker | null>;
}
