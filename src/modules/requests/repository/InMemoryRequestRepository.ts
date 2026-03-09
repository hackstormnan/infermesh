/**
 * modules/requests/repository/InMemoryRequestRepository.ts
 *
 * In-memory implementation of IRequestRepository.
 *
 * Backed by a plain Map — no external dependencies, no I/O.
 * Suitable for local development and integration tests; state is lost on restart.
 *
 * To swap in a database-backed repository, implement IRequestRepository
 * and update the binding in modules/requests/index.ts.
 */

import type {
  InferenceRequest,
  RequestStatus,
} from "../../../shared/contracts/request";
import type { RequestId, PaginatedResponse } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { ListRequestsQuery } from "../queries";
import type { IRequestRepository, StatusUpdate } from "./IRequestRepository";

export class InMemoryRequestRepository implements IRequestRepository {
  private readonly store = new Map<string, InferenceRequest>();

  async create(request: InferenceRequest): Promise<InferenceRequest> {
    this.store.set(request.id, request);
    return request;
  }

  async findById(id: RequestId): Promise<InferenceRequest | null> {
    return this.store.get(id) ?? null;
  }

  async list(
    query: ListRequestsQuery,
  ): Promise<PaginatedResponse<InferenceRequest>> {
    let items = Array.from(this.store.values());

    // ── Filters ─────────────────────────────────────────────────────────────

    if (query.status !== undefined) {
      items = items.filter((r) => r.status === query.status);
    }

    if (query.modelId !== undefined) {
      items = items.filter((r) => r.modelId === query.modelId);
    }

    if (query.id !== undefined) {
      const prefix = query.id.toLowerCase();
      items = items.filter((r) => r.id.toLowerCase().startsWith(prefix));
    }

    // ── Sort: newest first ───────────────────────────────────────────────────

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // ── Pagination ───────────────────────────────────────────────────────────

    const total = items.length;
    const { page, limit } = query;
    const offset = (page - 1) * limit;
    const slice = items.slice(offset, offset + limit);

    return {
      items: slice,
      total,
      page,
      limit,
      hasMore: offset + slice.length < total,
    };
  }

  async updateStatus(
    id: RequestId,
    status: RequestStatus,
    updates: StatusUpdate = {},
  ): Promise<InferenceRequest | null> {
    const existing = this.store.get(id);
    if (!existing) return null;

    const updated: InferenceRequest = {
      ...existing,
      ...updates,
      status,
      updatedAt: toIsoTimestamp(),
    };

    this.store.set(id, updated);
    return updated;
  }
}
