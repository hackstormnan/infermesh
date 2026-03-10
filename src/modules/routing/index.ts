/**
 * modules/routing — Policy-Driven Placement Engine
 *
 * Owns routing policy management (CRUD, versioning, activation) and the
 * immutable decision audit log. The placement algorithm (evaluate()) will
 * be implemented in Ticket 8.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repositories, service, routes) are not re-exported.
 * Cross-module access goes through the public service instance or DTO types.
 *
 * ─── Key consumers ───────────────────────────────────────────────────────────
 * - Request intake (Ticket 8): calls routingService.evaluate() on each request
 * - Simulation (Ticket 11): calls routingService.evaluate() with DecisionSource.Simulation
 *   and routingService.listDecisions() to compare policy performance
 *
 * ─── Two-repository design ───────────────────────────────────────────────────
 * IPolicyRepository   — mutable CRUD for routing policies (operators manage these)
 * IDecisionRepository — append-only log of every routing evaluation (never mutated)
 * This split makes the immutability of decisions explicit and enables independent
 * scaling: policies are small and rarely updated; decisions can be high-volume.
 *
 * ─── API surface ─────────────────────────────────────────────────────────────
 *   GET  /api/v1/routing/policies/:id   — fetch a policy by UUID
 *   GET  /api/v1/routing/policies       — paginated list with status/strategy/name filters
 *   GET  /api/v1/routing/decisions/:id  — fetch a decision by UUID
 *   GET  /api/v1/routing/decisions      — paginated list with outcome/source/time filters
 *   POST /api/v1/routing/policies       — create a policy (Ticket 8)
 *   PATCH /api/v1/routing/policies/:id  — activate/deactivate (Ticket 8)
 *
 * ─── Wiring ──────────────────────────────────────────────────────────────────
 * Register routes in app/routes.ts:
 *   import { routingRoute } from "../modules/routing";
 *   fastify.register(routingRoute, { prefix: "/api/v1" });
 */

import { InMemoryDecisionRepository } from "./repository/InMemoryDecisionRepository";
import { InMemoryPolicyRepository } from "./repository/InMemoryPolicyRepository";
import { RoutingService } from "./service/routing.service";
import { buildRoutingRoute } from "./routes/routing.route";

// ─── Module composition ───────────────────────────────────────────────────────

const policyRepo = new InMemoryPolicyRepository();
const decisionRepo = new InMemoryDecisionRepository();

/** Singleton service instance — shared across the process lifetime */
export const routingService = new RoutingService(policyRepo, decisionRepo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const routingRoute = buildRoutingRoute(routingService);

// ─── Public type re-exports ───────────────────────────────────────────────────

export type {
  RoutingPolicy,
  RoutingDecision,
  RoutingCandidate,
  RoutingConstraints,
  ScoreBreakdown,
  StrategyWeights,
  CreateRoutingPolicyDto,
  UpdateRoutingPolicyDto,
} from "../../shared/contracts/routing";

export {
  RoutingStrategy,
  RoutingOutcome,
  RoutingPolicyStatus,
  DecisionSource,
  createRoutingPolicySchema,
  updateRoutingPolicySchema,
  routingPolicySchema,
} from "../../shared/contracts/routing";

export type { ListPoliciesQuery, ListDecisionsQuery } from "./queries";
export { listPoliciesQuerySchema, listDecisionsQuerySchema } from "./queries";

export type { IPolicyRepository } from "./repository/IPolicyRepository";
export type { IDecisionRepository } from "./repository/IDecisionRepository";

export type {
  RoutingPolicyDto,
  RoutingDecisionDto,
} from "./service/routing.service";
