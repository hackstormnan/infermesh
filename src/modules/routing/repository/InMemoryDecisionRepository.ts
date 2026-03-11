/**
 * modules/routing/repository/InMemoryDecisionRepository.ts
 *
 * In-memory, append-only implementation of IDecisionRepository.
 *
 * Secondary indexes for efficient lookups:
 *   - `byId`               — Map<DecisionId, RoutingDecision>  for findById (O(1))
 *   - `byRequestId`        — Map<RequestId, DecisionId[]>       for requestId filter (O(k))
 *   - `byJobId`            — Map<JobId, DecisionId[]>           for jobId filter (O(k))
 *   - `bySelectedModelId`  — Map<ModelId, DecisionId[]>         for selectedModelId filter (O(k))
 *   - `bySelectedWorkerId` — Map<WorkerId, DecisionId[]>        for selectedWorkerId filter (O(k))
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

  /**
   * Secondary index: jobId → list of decisionIds.
   * A job may produce more than one decision (primary + fallback routing attempt).
   */
  private readonly byJobId = new Map<string, string[]>();

  /**
   * Secondary index: selectedModelId → list of decisionIds.
   * Supports auditing all traffic routed to a specific model.
   */
  private readonly bySelectedModelId = new Map<string, string[]>();

  /**
   * Secondary index: selectedWorkerId → list of decisionIds.
   * Supports auditing all decisions assigned to a specific worker.
   */
  private readonly bySelectedWorkerId = new Map<string, string[]>();

  async save(decision: RoutingDecision): Promise<RoutingDecision> {
    this.byId.set(decision.id, decision);

    this.appendIndex(this.byRequestId, decision.requestId, decision.id);

    if (decision.jobId) {
      this.appendIndex(this.byJobId, decision.jobId, decision.id);
    }
    if (decision.selectedModelId) {
      this.appendIndex(this.bySelectedModelId, decision.selectedModelId, decision.id);
    }
    if (decision.selectedWorkerId) {
      this.appendIndex(this.bySelectedWorkerId, decision.selectedWorkerId, decision.id);
    }

    return decision;
  }

  async findById(id: DecisionId): Promise<RoutingDecision | null> {
    return this.byId.get(id) ?? null;
  }

  async list(query: ListDecisionsQuery): Promise<PaginatedResponse<RoutingDecision>> {
    let items: RoutingDecision[];

    // Use a secondary index when exactly one indexed field is the only filter —
    // avoids a full scan for the most common single-field lookup patterns.
    const singleIndex = this.resolveSingleIndex(query);
    if (singleIndex !== null) {
      items = singleIndex.map((id) => this.byId.get(id)!).filter(Boolean);
    } else {
      items = Array.from(this.byId.values());
    }

    // ── Filters ──────────────────────────────────────────────────────────────

    if (query.requestId !== undefined) {
      items = items.filter((d) => d.requestId === query.requestId);
    }
    if (query.jobId !== undefined) {
      items = items.filter((d) => d.jobId === query.jobId);
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
    if (query.selectedModelId !== undefined) {
      items = items.filter((d) => d.selectedModelId === query.selectedModelId);
    }
    if (query.selectedWorkerId !== undefined) {
      items = items.filter((d) => d.selectedWorkerId === query.selectedWorkerId);
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

  // ─── Private helpers ───────────────────────────────────────────────────────

  private appendIndex(index: Map<string, string[]>, key: string, id: string): void {
    const existing = index.get(key) ?? [];
    index.set(key, [...existing, id]);
  }

  /**
   * Returns the DecisionId list from a secondary index when exactly one
   * indexed field is set and no non-indexed filters (outcome, from, to) are
   * present alongside it. Falls through to a full scan otherwise.
   */
  private resolveSingleIndex(query: ListDecisionsQuery): string[] | null {
    const hasNonIndexedFilter =
      query.outcome !== undefined ||
      query.from !== undefined ||
      query.to !== undefined;

    const indexedCount =
      (query.requestId !== undefined ? 1 : 0) +
      (query.jobId !== undefined ? 1 : 0) +
      (query.selectedModelId !== undefined ? 1 : 0) +
      (query.selectedWorkerId !== undefined ? 1 : 0) +
      (query.policyId !== undefined ? 1 : 0);

    if (hasNonIndexedFilter || indexedCount !== 1) return null;

    if (query.requestId !== undefined) {
      return this.byRequestId.get(query.requestId) ?? [];
    }
    if (query.jobId !== undefined) {
      return this.byJobId.get(query.jobId) ?? [];
    }
    if (query.selectedModelId !== undefined) {
      return this.bySelectedModelId.get(query.selectedModelId) ?? [];
    }
    if (query.selectedWorkerId !== undefined) {
      return this.bySelectedWorkerId.get(query.selectedWorkerId) ?? [];
    }
    // policyId has no dedicated index — fall through to full scan
    return null;
  }
}
