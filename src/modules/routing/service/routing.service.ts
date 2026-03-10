/**
 * modules/routing/service/routing.service.ts
 *
 * Service layer for the routing module.
 *
 * Route handlers call this service — they never access repositories directly.
 * The service owns all business logic: ID generation, name uniqueness checks,
 * default policy management, and the evaluate() stub for the placement engine.
 *
 * ─── Policy operations ────────────────────────────────────────────────────────
 *   createPolicy   — persist a new routing policy; enforces name uniqueness
 *   updatePolicy   — patch status or description; version is bumped atomically
 *   getPolicy      — fetch by ID or name with NotFoundError guard
 *   listPolicies   — paginated, filtered catalog
 *
 * ─── Decision operations ──────────────────────────────────────────────────────
 *   getDecision    — fetch a single decision by ID
 *   listDecisions  — paginated, filtered audit log
 *   recordDecision — persist a completed decision (called by the routing engine)
 *
 * ─── Routing engine stub (Ticket 8) ──────────────────────────────────────────
 *   evaluate()     — the placement algorithm lives here.
 *                    Currently a typed stub; Ticket 8 will implement:
 *                    1. Resolve model by name → Model entity
 *                    2. Collect eligible workers from the workers module
 *                    3. Apply hard constraints (region, cost, latency, labels)
 *                    4. Score remaining candidates via the policy strategy
 *                    5. Select winner; apply fallback if primary yields nothing
 *                    6. Record and return the RoutingDecision
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import { ConflictError, NotFoundError } from "../../../core/errors";
import type {
  CreateRoutingPolicyDto,
  RoutingDecision,
  RoutingPolicy,
  UpdateRoutingPolicyDto,
} from "../../../shared/contracts/routing";
import {
  DecisionSource,
  RoutingPolicyStatus,
} from "../../../shared/contracts/routing";
import type {
  DecisionId,
  PaginatedResponse,
  PolicyId,
} from "../../../shared/primitives";
import { toIsoTimestamp } from "../../../shared/primitives";
import type { IDecisionRepository } from "../repository/IDecisionRepository";
import type { IPolicyRepository } from "../repository/IPolicyRepository";
import type { ListDecisionsQuery, ListPoliciesQuery } from "../queries";

// ─── Response DTOs ────────────────────────────────────────────────────────────

/**
 * Public-facing routing policy shape.
 * Identical to the internal entity for now; a dedicated DTO would omit
 * internal-only fields if they were introduced (e.g. internal audit fields).
 */
export type RoutingPolicyDto = RoutingPolicy;

/**
 * Public-facing routing decision shape.
 * Identical to the internal entity — decisions are already the
 * canonical audit record with no internal-only fields.
 */
export type RoutingDecisionDto = RoutingDecision;

// ─── Service ──────────────────────────────────────────────────────────────────

export class RoutingService {
  constructor(
    private readonly policies: IPolicyRepository,
    private readonly decisions: IDecisionRepository,
  ) {}

  // ─── Policy write operations ───────────────────────────────────────────────

  /**
   * Create and persist a new routing policy.
   * Rejects if the name is already taken — policy names must be unique across
   * all statuses so that routing hints referencing them are unambiguous.
   */
  async createPolicy(
    ctx: RequestContext,
    dto: CreateRoutingPolicyDto,
  ): Promise<RoutingPolicyDto> {
    const existing = await this.policies.findByName(dto.name);
    if (existing) {
      throw new ConflictError(
        `Routing policy "${dto.name}" already exists`,
        { conflictingId: existing.id },
      );
    }

    const now = toIsoTimestamp();
    const policy: RoutingPolicy = {
      id: randomUUID() as PolicyId,
      name: dto.name,
      description: dto.description,
      strategy: dto.strategy,
      constraints: dto.constraints,
      weights: dto.weights,
      canaryWeights: dto.canaryWeights,
      allowFallback: dto.allowFallback,
      fallbackStrategy: dto.fallbackStrategy,
      priority: dto.priority,
      version: 1,
      status: RoutingPolicyStatus.Inactive, // operators must explicitly activate
      createdAt: now,
      updatedAt: now,
    };

    ctx.log.info(
      { policyId: policy.id, name: policy.name, strategy: policy.strategy },
      "Creating routing policy",
    );

    return this.policies.create(policy);
  }

  /**
   * Update an existing policy's status or description.
   * Immutable fields (name, strategy, weights, constraints) cannot be changed
   * post-creation — create a new policy version instead.
   */
  async updatePolicy(
    ctx: RequestContext,
    id: string,
    dto: UpdateRoutingPolicyDto,
  ): Promise<RoutingPolicyDto> {
    ctx.log.info({ policyId: id, patch: dto }, "Updating routing policy");

    const updated = await this.policies.update(id as PolicyId, dto);
    if (!updated) {
      throw new NotFoundError(`Routing policy ${id}`);
    }

    return updated;
  }

  // ─── Policy read operations ────────────────────────────────────────────────

  async getPolicyById(ctx: RequestContext, id: string): Promise<RoutingPolicyDto> {
    ctx.log.debug({ policyId: id }, "Fetching routing policy by ID");

    const policy = await this.policies.findById(id as PolicyId);
    if (!policy) {
      throw new NotFoundError(`Routing policy ${id}`);
    }

    return policy;
  }

  async getPolicyByName(ctx: RequestContext, name: string): Promise<RoutingPolicyDto> {
    ctx.log.debug({ name }, "Fetching routing policy by name");

    const policy = await this.policies.findByName(name);
    if (!policy) {
      throw new NotFoundError(`Routing policy "${name}"`);
    }

    return policy;
  }

  async listPolicies(
    ctx: RequestContext,
    query: ListPoliciesQuery,
  ): Promise<PaginatedResponse<RoutingPolicyDto>> {
    ctx.log.debug({ query }, "Listing routing policies");
    return this.policies.list(query);
  }

  // ─── Decision read operations ──────────────────────────────────────────────

  async getDecision(ctx: RequestContext, id: string): Promise<RoutingDecisionDto> {
    ctx.log.debug({ decisionId: id }, "Fetching routing decision by ID");

    const decision = await this.decisions.findById(id as DecisionId);
    if (!decision) {
      throw new NotFoundError(`Routing decision ${id}`);
    }

    return decision;
  }

  async listDecisions(
    ctx: RequestContext,
    query: ListDecisionsQuery,
  ): Promise<PaginatedResponse<RoutingDecisionDto>> {
    ctx.log.debug({ query }, "Listing routing decisions");
    return this.decisions.list(query);
  }

  /**
   * Persist a completed routing decision.
   * Called by the routing engine after evaluation finishes.
   * External callers (simulation module) pass DecisionSource.Simulation.
   */
  async recordDecision(
    ctx: RequestContext,
    decision: RoutingDecision,
  ): Promise<RoutingDecisionDto> {
    ctx.log.info(
      {
        decisionId: decision.id,
        requestId: decision.requestId,
        outcome: decision.outcome,
        policyId: decision.policyId,
        decisionSource: decision.decisionSource,
        evaluationMs: decision.evaluationMs,
      },
      "Recording routing decision",
    );

    return this.decisions.save(decision);
  }

  // ─── Routing engine stub ───────────────────────────────────────────────────

  /**
   * Evaluate the best (model, worker) placement for an inference request.
   *
   * This stub returns a typed placeholder. Ticket 8 will implement:
   *   1. Resolve model by name via modelsService.getByName()
   *   2. Collect eligible workers via workersService.list({ status: Idle })
   *   3. Apply hard constraints (region, cost limit, latency limit, labels)
   *   4. Score remaining candidates by strategy (weights × normalised dimensions)
   *   5. Select the highest-scoring candidate; apply fallback if none pass
   *   6. Persist via recordDecision(); return the decision
   *
   * @param _requestId - The InferenceRequest being routed
   * @param _policyName - Name of the policy to apply (or "default")
   * @param _source - Live traffic or simulation
   */
  async evaluate(
    _ctx: RequestContext,
    _requestId: string,
    _policyName: string,
    _source: DecisionSource = DecisionSource.Live,
  ): Promise<RoutingDecisionDto> {
    throw new Error(
      "RoutingService.evaluate() is not yet implemented — see Ticket 8",
    );
  }
}
