/**
 * modules/routing/repository/IPolicyRepository.ts
 *
 * Repository interface (port) for RoutingPolicy persistence.
 *
 * Policies are mutable entities: operators create them, activate/deactivate
 * them, and eventually archive them. The repository supports full CRUD.
 *
 * ─── Lookup semantics ────────────────────────────────────────────────────────
 *   findById   — exact match on PolicyId (UUID)
 *   findByName — case-insensitive match on the unique policy name
 *   list       — paginated, filtered; sorted by priority desc then name asc
 *
 * ─── Mutation semantics ──────────────────────────────────────────────────────
 *   create — caller supplies a fully-constructed RoutingPolicy entity
 *   update — applies a partial patch (status, description only — version bumped automatically)
 */

import type {
  RoutingPolicy,
  UpdateRoutingPolicyDto,
} from "../../../shared/contracts/routing";
import type { PolicyId, PaginatedResponse } from "../../../shared/primitives";
import type { ListPoliciesQuery } from "../queries";

export interface IPolicyRepository {
  /** Persist a new routing policy. */
  create(policy: RoutingPolicy): Promise<RoutingPolicy>;

  /** Retrieve a policy by its UUID. Returns null if not found. */
  findById(id: PolicyId): Promise<RoutingPolicy | null>;

  /**
   * Retrieve a policy by its unique name (case-insensitive).
   * Returns null if not found.
   */
  findByName(name: string): Promise<RoutingPolicy | null>;

  /**
   * Paginated, filtered list of policies.
   * Sorted by priority descending, then name ascending.
   */
  list(query: ListPoliciesQuery): Promise<PaginatedResponse<RoutingPolicy>>;

  /**
   * Apply a partial update to an existing policy.
   * The version field is bumped automatically by the repository on each update.
   * Returns the updated entity, or null if the policy ID is not found.
   */
  update(
    id: PolicyId,
    patch: UpdateRoutingPolicyDto,
  ): Promise<RoutingPolicy | null>;
}
