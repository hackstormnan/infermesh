/**
 * modules/routing — Policy-Driven Placement Engine
 *
 * Owns routing policy management (CRUD, versioning, activation), the immutable
 * decision audit log, and the routing decision engine that selects the best
 * (model, worker) pair for each inference request.
 *
 * ─── Module boundaries ───────────────────────────────────────────────────────
 * Internal layers (repositories, service, routes) are not re-exported.
 * Cross-module access goes through the public service instances or DTO types.
 *
 * ─── Key consumers ───────────────────────────────────────────────────────────
 * - Request intake: calls routingDecisionService.decideRoute() on each request
 * - Simulation: calls routingDecisionService.decideRoute() with DecisionSource.Simulation
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
 *   POST /api/v1/routing/policies       — create a policy
 *   PATCH /api/v1/routing/policies/:id  — activate/deactivate
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
import { CandidateEvaluatorService } from "./evaluation/candidate-evaluator.service";
import { RoutingDecisionService } from "./decision/routing-decision.service";
import { modelRegistryService } from "../models";
import { workerRegistryService } from "../workers";

// ─── Module composition ───────────────────────────────────────────────────────

const policyRepo = new InMemoryPolicyRepository();
const decisionRepo = new InMemoryDecisionRepository();

/** Singleton service instance — shared across the process lifetime */
export const routingService = new RoutingService(policyRepo, decisionRepo);

/** Fastify plugin — register under /api/v1 prefix in app/routes.ts */
export const routingRoute = buildRoutingRoute(routingService);

/**
 * Stateless candidate evaluation service — scores ModelCandidate[] and
 * WorkerCandidate[] with structured per-dimension breakdowns.
 * Used by the routing engine and simulation.
 */
export const candidateEvaluatorService = new CandidateEvaluatorService();

/**
 * Routing decision engine — resolves the active policy, evaluates candidates,
 * selects the best (model, worker) pair, and records an immutable RoutingDecision.
 *
 * Primary entry point for live routing and simulation replay.
 *
 * Usage:
 *   const result = await routingDecisionService.decideRoute(ctx, {
 *     requestId: "req-123",
 *     jobId: "job-456",
 *     decisionSource: DecisionSource.Live,
 *   });
 *   // result.decision — persisted RoutingDecision record
 *   // result.modelScores / result.workerScores — full evaluation detail
 */
export const routingDecisionService = new RoutingDecisionService(
  policyRepo,
  decisionRepo,
  modelRegistryService,
  workerRegistryService,
  candidateEvaluatorService,
);

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

// ─── Candidate evaluation exports ────────────────────────────────────────────

export { CandidateEvaluatorService } from "./evaluation/candidate-evaluator.service";

export type {
  ModelEvaluationProfile,
  WorkerEvaluationProfile,
  ModelScoringWeights,
  WorkerScoringWeights,
  ModelRawDimensions,
  WorkerRawDimensions,
  ModelDimensionScores,
  WorkerDimensionScores,
  ModelScoreResult,
  WorkerScoreResult,
  CandidateScoreResult,
} from "./evaluation/evaluation.contract";

export {
  DEFAULT_MODEL_SCORING_WEIGHTS,
  DEFAULT_WORKER_SCORING_WEIGHTS,
} from "./evaluation/evaluation.contract";

// ─── Routing decision exports ─────────────────────────────────────────────────

export { RoutingDecisionService } from "./decision/routing-decision.service";

export type {
  DecideRouteInput,
  DecideRouteResult,
  ModelSelectionSummary,
  WorkerSelectionSummary,
} from "./decision/routing-decision.contract";

export {
  NoActivePolicyError,
  NoEligibleModelError,
  NoEligibleWorkerError,
} from "./decision/routing-decision.contract";
