/**
 * modules/routing — Policy-Driven Request Routing
 *
 * The core placement engine. Given an InferenceRequest, evaluates all eligible
 * (model, worker) pairs against the active RoutingPolicy and returns a
 * RoutingDecision.
 *
 * Depends on shared contracts:
 *   RoutingPolicy, RoutingDecision, RoutingStrategy, RoutingConstraints, RoutingCandidate
 *   Model, Worker (read-only, from models and workers modules)
 *
 * Will expose (future tickets):
 *   POST /api/v1/routing/policies       — create a routing policy
 *   GET  /api/v1/routing/policies       — list policies
 *   GET  /api/v1/routing/policies/:name — single policy detail
 *   POST /api/v1/routing/evaluate       — dry-run: evaluate placement without dispatching
 */

export type {
  RoutingPolicy,
  RoutingDecision,
  RoutingCandidate,
  RoutingConstraints,
  CreateRoutingPolicyDto,
} from "../../shared/contracts/routing";

export {
  RoutingStrategy,
  RoutingOutcome,
  routingPolicySchema,
} from "../../shared/contracts/routing";
