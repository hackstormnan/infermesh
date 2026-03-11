/**
 * modules/jobs/orchestration/recovery/routing-recovery.contract.ts
 *
 * Contracts for the routing recovery layer.
 *
 * The recovery layer wraps RoutingDecisionService with:
 *   1. Structured failure classification
 *   2. Optional fallback routing (primary fails → relax placement preferences)
 *   3. Retry eligibility assessment
 *
 * ─── Failure classification ───────────────────────────────────────────────────
 *
 *   no_eligible_model    — registry returned no models or all disqualified
 *   no_eligible_worker   — registry returned no workers or all disqualified
 *   policy_blocked       — no active routing policy exists
 *   policy_not_found     — named/ID policy override does not exist
 *   assignment_conflict  — lifecycle state conflict (e.g. job already assigned)
 *   temporary_capacity   — capacity issue expected to resolve (maps to worker error)
 *   non_retryable        — unexpected or unknown failure
 *
 * ─── Fallback eligibility ─────────────────────────────────────────────────────
 *
 *   NoEligibleWorker  → fallback: retry decideRoute() with no workerProfile
 *                       (removes soft placement preferences such as preferredRegion)
 *   All others        → not fallback-eligible (policy/model constraints are hard)
 *
 * ─── Retry eligibility ────────────────────────────────────────────────────────
 *
 *   no_eligible_model   → retryable (capacity may free up)
 *   no_eligible_worker  → retryable (workers may become available)
 *   temporary_capacity  → retryable
 *   policy_blocked      → NOT retryable (requires admin action)
 *   policy_not_found    → NOT retryable (configuration error)
 *   assignment_conflict → NOT retryable (state machine invariant)
 *   non_retryable       → NOT retryable
 */

import type { DecideRouteResult } from "../../../routing/decision/routing-decision.contract";

// ─── Failure classification ───────────────────────────────────────────────────

export enum RoutingFailureClass {
  /** Registry returned no model candidates or all were disqualified */
  NoEligibleModel = "no_eligible_model",
  /** Registry returned no worker candidates or all were disqualified */
  NoEligibleWorker = "no_eligible_worker",
  /** No active routing policy exists — administrative action required */
  PolicyBlocked = "policy_blocked",
  /** The named or UUID policy override does not exist */
  PolicyNotFound = "policy_not_found",
  /** Lifecycle state conflict (job already moved, race condition) */
  AssignmentConflict = "assignment_conflict",
  /** Temporary worker capacity constraint — may resolve without config change */
  TemporaryCapacity = "temporary_capacity_issue",
  /** Unexpected or unclassified failure */
  NonRetryable = "non_retryable_failure",
}

// ─── Recovery metadata ────────────────────────────────────────────────────────

/**
 * Audit record describing what the recovery layer attempted and why.
 * Attached to RouteJobResult so callers have full observability.
 */
export interface RoutingRecoveryInfo {
  /** Classification of the primary routing failure */
  primaryFailureClass: RoutingFailureClass;
  /** Human-readable reason from the primary failure */
  primaryFailureReason: string;
  /** True when a fallback routing attempt was made */
  usedFallback: boolean;
  /** Human-readable description of the fallback strategy attempted */
  fallbackReason?: string;
  /** Classification of the fallback failure, if fallback also failed */
  fallbackFailureClass?: RoutingFailureClass;
  /** Human-readable reason from the fallback failure */
  fallbackFailureReason?: string;
  /** Total number of routing attempts made (1 = primary only, 2 = + fallback) */
  totalAttempts: number;
}

// ─── Outcome types ────────────────────────────────────────────────────────────

export interface RecoverySucceeded {
  readonly status: "succeeded";
  /** The routing decision result from the attempt that succeeded */
  readonly result: DecideRouteResult;
  /** Recovery metadata; present when a fallback attempt was made */
  readonly info?: RoutingRecoveryInfo;
}

export interface RecoveryFailed {
  readonly status: "failed";
  readonly info: RoutingRecoveryInfo;
  /** The original primary error (re-throw if terminal) */
  readonly error: Error;
  /** True when the caller may schedule a retry for this job */
  readonly retryEligible: boolean;
}

export type RecoveryOutcome = RecoverySucceeded | RecoveryFailed;
