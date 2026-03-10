/**
 * modules/routing/repository/InMemoryPolicyRepository.ts
 *
 * In-memory implementation of IPolicyRepository.
 *
 * Uses two indexes:
 *   - `byId`   — Map<PolicyId, RoutingPolicy>  for findById (O(1))
 *   - `byName` — Map<string, PolicyId>          for findByName (O(1), lowercase)
 *
 * The version field is bumped automatically on every update.
 * State is lost on restart. Not suitable for production deployments.
 */

import type {
  RoutingPolicy,
  UpdateRoutingPolicyDto,
} from "../../../shared/contracts/routing";
import type { PolicyId, PaginatedResponse } from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { ListPoliciesQuery } from "../queries";
import type { IPolicyRepository } from "./IPolicyRepository";

export class InMemoryPolicyRepository implements IPolicyRepository {
  private readonly byId = new Map<string, RoutingPolicy>();
  private readonly byName = new Map<string, string>(); // lowercase → PolicyId

  async create(policy: RoutingPolicy): Promise<RoutingPolicy> {
    this.byId.set(policy.id, policy);
    this.byName.set(policy.name.toLowerCase(), policy.id);
    return policy;
  }

  async findById(id: PolicyId): Promise<RoutingPolicy | null> {
    return this.byId.get(id) ?? null;
  }

  async findByName(name: string): Promise<RoutingPolicy | null> {
    const id = this.byName.get(name.toLowerCase());
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  async list(query: ListPoliciesQuery): Promise<PaginatedResponse<RoutingPolicy>> {
    let items = Array.from(this.byId.values());

    // ── Filters ─────────────────────────────────────────────────────────────

    if (query.status !== undefined) {
      items = items.filter((p) => p.status === query.status);
    }

    if (query.strategy !== undefined) {
      items = items.filter((p) => p.strategy === query.strategy);
    }

    if (query.name !== undefined) {
      const prefix = query.name.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().startsWith(prefix));
    }

    // ── Sort: priority desc, then name asc ───────────────────────────────────

    items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.name.localeCompare(b.name);
    });

    // ── Pagination ───────────────────────────────────────────────────────────

    const total = items.length;
    const { page, limit } = query;
    const offset = (page - 1) * limit;
    const slice = items.slice(offset, offset + limit);

    return { items: slice, total, page, limit, hasMore: offset + slice.length < total };
  }

  async update(
    id: PolicyId,
    patch: UpdateRoutingPolicyDto,
  ): Promise<RoutingPolicy | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;

    const updated: RoutingPolicy = {
      ...existing,
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.description !== undefined && { description: patch.description }),
      // Bump version on every write so decisions can reference exact policy snapshots
      version: existing.version + 1,
      updatedAt: toIsoTimestamp(),
    };

    this.byId.set(id, updated);
    return updated;
  }
}
