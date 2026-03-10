/**
 * modules/routing/repository/IDecisionRepository.ts
 *
 * Repository interface (port) for RoutingDecision persistence.
 *
 * Decisions are an immutable append-only audit log — once saved, they are
 * never mutated. This simplifies the interface: no update() method exists.
 *
 * ─── Design rationale ────────────────────────────────────────────────────────
 * Keeping decisions immutable enables:
 *   - Safe audit trails: operators can always trace exactly which policy
 *     version produced which placement decision for any historical request.
 *   - Simulation replay: the simulation module can replay recorded decisions
 *     against new policy configurations without corrupting real traffic data.
 *   - Simple concurrency: append-only stores are trivially safe under concurrent
 *     write from multiple routing evaluations.
 */

import type { RoutingDecision } from "../../../shared/contracts/routing";
import type { DecisionId, PaginatedResponse } from "../../../shared/primitives";
import type { ListDecisionsQuery } from "../queries";

export interface IDecisionRepository {
  /**
   * Persist a routing decision.
   * The caller supplies the fully-constructed, immutable entity.
   */
  save(decision: RoutingDecision): Promise<RoutingDecision>;

  /** Retrieve a decision by its UUID. Returns null if not found. */
  findById(id: DecisionId): Promise<RoutingDecision | null>;

  /**
   * Paginated, filtered list of decisions.
   * Sorted by decidedAt descending (most recent first).
   */
  list(query: ListDecisionsQuery): Promise<PaginatedResponse<RoutingDecision>>;
}
