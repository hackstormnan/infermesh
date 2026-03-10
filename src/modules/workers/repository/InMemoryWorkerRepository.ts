/**
 * modules/workers/repository/InMemoryWorkerRepository.ts
 *
 * In-memory implementation of IWorkerRepository.
 *
 * Uses two indexes:
 *   - `byId`   — Map<WorkerId, Worker>  for findById (O(1))
 *   - `byName` — Map<string, WorkerId>  for findByName (O(1), lowercase key)
 *
 * State is lost on restart. Not suitable for production or multi-process
 * deployments. Swap out by implementing IWorkerRepository and updating
 * the binding in modules/workers/index.ts.
 */

import type { Worker, WorkerUpdate } from "../../../shared/contracts/worker";
import type { WorkerId, PaginatedResponse } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { ListWorkersQuery } from "../queries";
import type { IWorkerRepository } from "./IWorkerRepository";

export class InMemoryWorkerRepository implements IWorkerRepository {
  private readonly byId = new Map<string, Worker>();
  private readonly byName = new Map<string, string>(); // lowercase name → WorkerId

  async create(worker: Worker): Promise<Worker> {
    this.byId.set(worker.id, worker);
    this.byName.set(worker.name.toLowerCase(), worker.id);
    return worker;
  }

  async findAll(): Promise<Worker[]> {
    return Array.from(this.byId.values());
  }

  async findById(id: WorkerId): Promise<Worker | null> {
    return this.byId.get(id) ?? null;
  }

  async findByName(name: string): Promise<Worker | null> {
    const id = this.byName.get(name.toLowerCase());
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  async list(query: ListWorkersQuery): Promise<PaginatedResponse<Worker>> {
    let items = Array.from(this.byId.values());

    // ── Filters ─────────────────────────────────────────────────────────────

    if (query.status !== undefined) {
      items = items.filter((w) => w.status === query.status);
    }

    if (query.region !== undefined) {
      const region = query.region.toLowerCase();
      items = items.filter((w) => w.region.toLowerCase() === region);
    }

    if (query.name !== undefined) {
      const prefix = query.name.toLowerCase();
      items = items.filter((w) => w.name.toLowerCase().startsWith(prefix));
    }

    if (query.id !== undefined) {
      const prefix = query.id.toLowerCase();
      items = items.filter((w) => w.id.toLowerCase().startsWith(prefix));
    }

    // ── Sort: alphabetical by name ───────────────────────────────────────────

    items.sort((a, b) => a.name.localeCompare(b.name));

    // ── Pagination ───────────────────────────────────────────────────────────

    const total = items.length;
    const { page, limit } = query;
    const offset = (page - 1) * limit;
    const slice = items.slice(offset, offset + limit);

    return { items: slice, total, page, limit, hasMore: offset + slice.length < total };
  }

  async update(id: WorkerId, patch: WorkerUpdate): Promise<Worker | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;

    const updated: Worker = {
      ...existing,
      ...patch,
      // Deep-merge runtimeMetrics so a partial heartbeat doesn't wipe previous values
      runtimeMetrics: patch.runtimeMetrics !== undefined
        ? { ...existing.runtimeMetrics, ...patch.runtimeMetrics }
        : existing.runtimeMetrics,
      updatedAt: toIsoTimestamp(),
    };

    this.byId.set(id, updated);
    // Name is readonly — no need to update the name index
    return updated;
  }
}
