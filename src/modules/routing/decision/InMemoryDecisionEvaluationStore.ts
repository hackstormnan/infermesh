/**
 * modules/routing/decision/InMemoryDecisionEvaluationStore.ts
 *
 * In-process store for routing decision evaluation records.
 *
 * Stores RoutingDecisionEvaluation objects keyed by DecisionId.
 * State is lost on restart — suitable for development and testing.
 *
 * A durable implementation (Redis, Postgres JSONB, etc.) can be introduced
 * by replacing this with a different IDecisionEvaluationStore implementation.
 */

import type { DecisionId } from "../../../shared/primitives";
import type {
  IDecisionEvaluationStore,
  RoutingDecisionEvaluation,
} from "./decision-history.contract";

export class InMemoryDecisionEvaluationStore implements IDecisionEvaluationStore {
  private readonly store = new Map<string, RoutingDecisionEvaluation>();

  async save(evaluation: RoutingDecisionEvaluation): Promise<void> {
    this.store.set(evaluation.decisionId, evaluation);
  }

  async findByDecisionId(id: DecisionId): Promise<RoutingDecisionEvaluation | null> {
    return this.store.get(id) ?? null;
  }

  /** Returns the total number of stored evaluations. Useful for testing. */
  size(): number {
    return this.store.size;
  }
}
