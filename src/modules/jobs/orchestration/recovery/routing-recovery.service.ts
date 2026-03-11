/**
 * modules/jobs/orchestration/recovery/routing-recovery.service.ts
 *
 * Wraps RoutingDecisionService with a bounded fallback strategy.
 *
 * This service is stateless and concerns itself only with routing attempts —
 * it never touches the job lifecycle. All lifecycle transitions are the
 * caller's (JobRoutingService) responsibility.
 *
 * ─── Recovery strategy ────────────────────────────────────────────────────────
 *
 *  1. Primary attempt — call decideRoute() with the original input
 *
 *  2. On failure:
 *     a. Classify the error → RoutingFailureClass
 *     b. If NoEligibleWorker → fallback attempt:
 *        - Re-run decideRoute() with workerProfile stripped (remove soft
 *          placement preferences like preferredRegion / staleness threshold)
 *        - Mark the decision record as usedFallback=true for audit integrity
 *     c. All other failure classes → no fallback (hard constraints, policy errors)
 *
 *  3. Return RecoveryOutcome:
 *     - succeeded: the attempt that worked + recovery info (if fallback was used)
 *     - failed:    info + error + retryEligible flag for the caller
 *
 * ─── Retry eligibility ────────────────────────────────────────────────────────
 *   no_eligible_model / no_eligible_worker / temporary_capacity → retryable
 *   policy errors / assignment_conflict / non_retryable          → NOT retryable
 *
 * ─── Fallback strategy rationale ─────────────────────────────────────────────
 *   Worker placement preferences (preferredRegion, heartbeatStalenessThresholdMs)
 *   are soft hints. Stripping them widens the eligible worker pool without
 *   compromising hard model capability requirements. This is the only automatic
 *   fallback that is both safe and meaningful at the routing stage.
 *
 *   Model failures are not fallback-eligible because the model registry returns
 *   ALL registered candidates — if none pass, relaxing the workerProfile cannot
 *   help and model-level constraints are set by the caller intentionally.
 */

import type { RequestContext } from "../../../../core/context";
import { NotFoundError } from "../../../../core/errors";
import type { RoutingDecisionService } from "../../../routing/decision/routing-decision.service";
import type { DecideRouteInput } from "../../../routing/decision/routing-decision.contract";
import {
  NoActivePolicyError,
  NoEligibleModelError,
  NoEligibleWorkerError,
} from "../../../routing/decision/routing-decision.contract";
import { InvalidTransitionError } from "../../lifecycle/transitions";
import {
  RoutingFailureClass,
  type RecoveryOutcome,
  type RoutingRecoveryInfo,
} from "./routing-recovery.contract";

// ─── Classification helpers ───────────────────────────────────────────────────

/**
 * Maps a routing-layer error to a structured RoutingFailureClass.
 * Uses the error's `.name` property to match against known types without
 * importing the error classes across module boundaries.
 */
export function classifyRoutingFailure(err: unknown): RoutingFailureClass {
  if (err instanceof NoActivePolicyError) return RoutingFailureClass.PolicyBlocked;
  if (err instanceof NoEligibleModelError) return RoutingFailureClass.NoEligibleModel;
  if (err instanceof NoEligibleWorkerError) return RoutingFailureClass.NoEligibleWorker;
  if (err instanceof InvalidTransitionError) return RoutingFailureClass.AssignmentConflict;
  if (err instanceof NotFoundError) return RoutingFailureClass.PolicyNotFound;
  // TemporaryCapacity is intentionally not auto-classified here. It requires a
  // dedicated worker-side capacity error (e.g. WorkerCapacityError) that does
  // not yet exist in the error taxonomy. When introduced, add a branch above.
  return RoutingFailureClass.NonRetryable;
}

const RETRY_ELIGIBLE_CLASSES = new Set<RoutingFailureClass>([
  RoutingFailureClass.NoEligibleModel,
  RoutingFailureClass.NoEligibleWorker,
  RoutingFailureClass.TemporaryCapacity,
]);

const FALLBACK_ELIGIBLE_CLASSES = new Set<RoutingFailureClass>([
  RoutingFailureClass.NoEligibleWorker,
]);

function isRetryEligible(fc: RoutingFailureClass): boolean {
  return RETRY_ELIGIBLE_CLASSES.has(fc);
}

function isFallbackEligible(fc: RoutingFailureClass): boolean {
  return FALLBACK_ELIGIBLE_CLASSES.has(fc);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class RoutingRecoveryService {
  constructor(private readonly routingDecision: RoutingDecisionService) {}

  /**
   * Attempt routing with an automatic fallback on NoEligibleWorker failures.
   *
   * Returns a `RecoveryOutcome` describing whether routing succeeded (possibly
   * via fallback) and what was tried. The caller decides how to handle the
   * lifecycle after receiving the outcome.
   */
  async attemptWithRecovery(
    ctx: RequestContext,
    input: DecideRouteInput,
  ): Promise<RecoveryOutcome> {
    // ── 1. Primary attempt ────────────────────────────────────────────────────
    try {
      const result = await this.routingDecision.decideRoute(ctx, input);
      // Primary succeeded — no recovery info needed
      return { status: "succeeded", result };
    } catch (primaryErr) {
      const primaryClass = classifyRoutingFailure(primaryErr);
      const primaryReason =
        primaryErr instanceof Error ? primaryErr.message : "Unknown routing failure";

      ctx.log.debug(
        { failureClass: primaryClass, reason: primaryReason },
        "Primary routing attempt failed — evaluating recovery options",
      );

      // ── 2. Fallback attempt (NoEligibleWorker only) ───────────────────────
      if (isFallbackEligible(primaryClass)) {
        const fallbackReason =
          "Primary routing failed with no eligible workers — retrying without placement preferences";

        const fallbackInput: DecideRouteInput = {
          ...input,
          // Strip soft placement preferences to widen the eligible worker pool.
          // Hard model constraints (modelFilter, modelProfile) are preserved.
          workerProfile: {},
          usedFallback: true,
          fallbackReason,
        };

        try {
          const fallbackResult = await this.routingDecision.decideRoute(
            ctx,
            fallbackInput,
          );

          ctx.log.info(
            { primaryFailureClass: primaryClass },
            "Fallback routing attempt succeeded",
          );

          const info: RoutingRecoveryInfo = {
            primaryFailureClass: primaryClass,
            primaryFailureReason: primaryReason,
            usedFallback: true,
            fallbackReason,
            totalAttempts: 2,
          };

          return { status: "succeeded", result: fallbackResult, info };
        } catch (fallbackErr) {
          const fallbackClass = classifyRoutingFailure(fallbackErr);
          const fallbackFailureReason =
            fallbackErr instanceof Error ? fallbackErr.message : "Fallback routing failed";

          ctx.log.debug(
            { primaryFailureClass: primaryClass, fallbackFailureClass: fallbackClass },
            "Fallback routing attempt also failed",
          );

          const info: RoutingRecoveryInfo = {
            primaryFailureClass: primaryClass,
            primaryFailureReason: primaryReason,
            usedFallback: true,
            fallbackReason,
            fallbackFailureClass: fallbackClass,
            fallbackFailureReason,
            totalAttempts: 2,
          };

          return {
            status: "failed",
            info,
            error: primaryErr instanceof Error ? primaryErr : new Error(primaryReason),
            retryEligible: isRetryEligible(primaryClass),
          };
        }
      }

      // ── 3. No fallback available ───────────────────────────────────────────
      const info: RoutingRecoveryInfo = {
        primaryFailureClass: primaryClass,
        primaryFailureReason: primaryReason,
        usedFallback: false,
        totalAttempts: 1,
      };

      return {
        status: "failed",
        info,
        error: primaryErr instanceof Error ? primaryErr : new Error(primaryReason),
        retryEligible: isRetryEligible(primaryClass),
      };
    }
  }
}
