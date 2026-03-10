/**
 * modules/routing/queries.ts
 *
 * Query and filter contracts for the routing list endpoints.
 *
 * Two query shapes are defined:
 *   - ListPoliciesQuery  — filter/page the routing policy catalog
 *   - ListDecisionsQuery — filter/page the immutable decision log
 */

import { z } from "zod";
import { paginationQuerySchema } from "../../shared/primitives";
import {
  DecisionSource,
  RoutingOutcome,
  RoutingPolicyStatus,
  RoutingStrategy,
} from "../../shared/contracts/routing";

// ─── Policies ─────────────────────────────────────────────────────────────────

export const listPoliciesQuerySchema = paginationQuerySchema.extend({
  /**
   * Filter by policy lifecycle status.
   * e.g. ?status=active returns only policies currently applied to traffic.
   */
  status: z.nativeEnum(RoutingPolicyStatus).optional(),

  /**
   * Filter by routing strategy.
   * e.g. ?strategy=latency_optimised
   */
  strategy: z.nativeEnum(RoutingStrategy).optional(),

  /**
   * Prefix search on policy name.
   * e.g. ?name=prod returns prod-latency-optimised, prod-cost-optimised, …
   */
  name: z.string().optional(),
});

export type ListPoliciesQuery = z.infer<typeof listPoliciesQuerySchema>;

// ─── Decisions ────────────────────────────────────────────────────────────────

export const listDecisionsQuerySchema = paginationQuerySchema.extend({
  /**
   * Filter decisions produced for a specific inference request.
   * Useful for tracing the routing path of a single request.
   */
  requestId: z.string().optional(),

  /**
   * Filter by decision outcome.
   * e.g. ?outcome=constraints_not_met surfaces failures for alerting.
   */
  outcome: z.nativeEnum(RoutingOutcome).optional(),

  /**
   * Filter by the policy that produced the decision.
   */
  policyId: z.string().optional(),

  /**
   * Filter by decision source — live traffic or simulation runs.
   */
  decisionSource: z.nativeEnum(DecisionSource).optional(),

  /**
   * Start of time window (Unix epoch ms).
   * Only decisions recorded at or after this timestamp are returned.
   */
  from: z.coerce.number().int().optional(),

  /**
   * End of time window (Unix epoch ms).
   * Only decisions recorded before or at this timestamp are returned.
   */
  to: z.coerce.number().int().optional(),
});

export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;
