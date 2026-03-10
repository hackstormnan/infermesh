/**
 * modules/routing/repository/InMemoryDecisionRepository.ts
 *
 * In-memory, append-only implementation of IDecisionRepository.
 *
 * Uses two indexes for efficient lookups:
 *   - `byId`        — Map<DecisionId, RoutingDecision>  for findById (O(1))
 *   - `byRequestId` — Map<RequestId, DecisionId[]>       for requestId filter (O(k))
 *
 * Decisions are never mutated after save() — the update path does not exist.
 * State is lost on restart. Not suitable for production deployments.
 */

import type { RoutingDecision } from "../../../shared/contracts/routing";
import type { DecisionId, PaginatedResponse } from "../../../shared/primitives";
import type { ListDecisionsQuery } from "../queries";
import type { IDecisionRepository } from "./IDecisionRepository";

export class InMemoryDecisionRepository implements IDecisionRepository {
  private readonly byId = new Map<string, RoutingDecision>();

  /**
   * Secondary index: requestId → list of decisionIds.
   * A single inference request can produce multiple decisions if retried or
   * evaluated through multiple policies (e.g. simulation runs).
   */
  private readonly byRequestId = new Map<string, string[]>();

  async save(decision: RoutingDecision): Promise<RoutingDecision> {
    this.byId.set(decision.id, decision);

    const existing = this.byRequestId.get(decision.requestId) ?? [];
    this.byRequestId.set(decision.requestId, [...existing, decision.id]);

    return decision;
  }

  async findById(id: DecisionId): Promise<RoutingDecision | null> {
    return this.byId.get(id) ?? null;
  }

  async list(query: ListDecisionsQuery): Promise<PaginatedResponse<RoutingDecision>> {
    let items: RoutingDecision[];

    // Use the requestId index when that filter is the only one — avoids full scan
    if (query.requestId !== undefined && !this.hasOtherFilters(query)) {
      const ids = this.byRequestId.get(query.requestId) ?? [];
      items = ids.map((id) => this.byId.get(id)!).filter(Boolean);
    } else {
      items = Array.from(this.byId.values());
    }

    // ── Filters ─────────────────────────────────────────────────────────────

    if (query.requestId !== undefined) {
      items = items.filter((d) => d.requestId === query.requestId);
    }

    if (query.outcome !== undefined) {
      items = items.filter((d) => d.outcome === query.outcome);
    }

    if (query.policyId !== undefined) {
      items = items.filter((d) => d.policyId === query.policyId);
    }

    if (query.decisionSource !== undefined) {
      items = items.filter((d) => d.decisionSource === query.decisionSource);
    }

    if (query.from !== undefined) {
      items = items.filter((d) => d.decidedAt >= query.from!);
    }

    if (query.to !== undefined) {
      items = items.filter((d) => d.decidedAt <= query.to!);
    }

    // ── Sort: most recent first ──────────────────────────────────────────────

    items.sort((a, b) => b.decidedAt - a.decidedAt);

    // ── Pagination ───────────────────────────────────────────────────────────

    const total = items.length;
    const { page, limit } = query;
    const offset = (page - 1) * limit;
    const slice = items.slice(offset, offset + limit);

    return { items: slice, total, page, limit, hasMore: offset + slice.length < total };
  }

  /**
   * Returns true if the query uses filters beyond requestId.
   * Used to decide whether to short-circuit with the requestId index.
   */
  private hasOtherFilters(query: ListDecisionsQuery): boolean {
    return (
      query.outcome !== undefined ||
      query.policyId !== undefined ||
      query.decisionSource !== undefined ||
      query.from !== undefined ||
      query.to !== undefined
    );
  }
}
