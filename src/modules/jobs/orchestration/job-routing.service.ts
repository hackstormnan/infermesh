/**
 * modules/jobs/orchestration/job-routing.service.ts
 *
 * Orchestrates the full routing lifecycle for a single queued job.
 *
 * This service is the integration point between the job lifecycle (T9/T11)
 * and the routing decision engine (T16). It does not implement routing logic —
 * it sequences existing services into a single atomic unit of work.
 *
 * ─── Call flow ────────────────────────────────────────────────────────────────
 *
 *  1. jobsService.getById()           — load + validate Queued state
 *  2. jobLifecycle.moveToRouting()    — Queued → Routing
 *  3. routingDecision.decideRoute()   — resolve policy, score candidates, select
 *       └── on failure: failJob()    — Routing → Failed, then re-throw
 *  4. jobLifecycle.assignJob()        — Routing → Assigned (stamps ids)
 *  5. return RouteJobResult           — assigned job + full decision detail
 *
 * ─── Failure behavior ─────────────────────────────────────────────────────────
 *
 *   If the routing decision engine throws (NoEligibleModel, NoEligibleWorker,
 *   NoActivePolicy, NotFoundError), this service:
 *     1. Moves the job to Failed (Routing → Failed is a valid transition)
 *     2. Re-throws the original error for the HTTP layer to handle
 *
 *   Failed jobs are inspectable. The caller may subsequently invoke
 *   jobLifecycle.retryJob() to attempt routing again if desired.
 *
 * ─── Reusability ──────────────────────────────────────────────────────────────
 *
 *   The service is stateless. Pass DecisionSource.Simulation and a
 *   policyOverride to replay routing for offline analysis without
 *   changing any live job state.
 *
 * ─── Error handling ───────────────────────────────────────────────────────────
 *
 *   JobNotRoutableError  (409) — job exists but is not in Queued status
 *   NotFoundError        (404) — jobId does not exist (from jobsService)
 *   NoActivePolicyError  (503) — no routing policy active, no override given
 *   NotFoundError        (404) — policyOverride name/ID does not exist
 *   NoEligibleModelError (422) — no model passes the filter + hard constraints
 *   NoEligibleWorkerError(422) — no worker supports the selected model
 */

import type { RequestContext } from "../../../core/context";
import { JobStatus } from "../../../shared/contracts/job";
import { DecisionSource } from "../../../shared/contracts/routing";
import type { JobsService } from "../service/jobs.service";
import type { JobLifecycleService } from "../lifecycle/job-lifecycle.service";
import type { RoutingDecisionService } from "../../routing/decision/routing-decision.service";
import type { RouteJobInput, RouteJobResult } from "./job-routing.contract";
import { JobNotRoutableError } from "./job-routing.contract";

// ─── Service ──────────────────────────────────────────────────────────────────

export class JobRoutingService {
  constructor(
    private readonly jobsService: JobsService,
    private readonly jobLifecycle: JobLifecycleService,
    private readonly routingDecision: RoutingDecisionService,
  ) {}

  /**
   * Route a queued job to the best available (model, worker) pair.
   *
   * @throws {JobNotRoutableError}    — job is not in Queued status
   * @throws {NotFoundError}          — jobId or policyOverride does not exist
   * @throws {NoActivePolicyError}    — no active routing policy found
   * @throws {NoEligibleModelError}   — no eligible model candidate available
   * @throws {NoEligibleWorkerError}  — no eligible worker candidate available
   */
  async routeJob(ctx: RequestContext, input: RouteJobInput): Promise<RouteJobResult> {
    // ── 1. Load job and validate state ────────────────────────────────────────
    const job = await this.jobsService.getById(ctx, input.jobId);

    if (job.status !== JobStatus.Queued) {
      throw new JobNotRoutableError(job.id, job.status);
    }

    ctx.log.info(
      { jobId: job.id, requestId: job.requestId },
      "Beginning job routing",
    );

    // ── 2. Transition to Routing ───────────────────────────────────────────────
    await this.jobLifecycle.moveToRouting(ctx, job.id, {
      source: "job_routing_service",
    });

    // ── 3. Invoke the routing decision engine ─────────────────────────────────
    let decisionResult;
    try {
      decisionResult = await this.routingDecision.decideRoute(ctx, {
        requestId: job.requestId,
        jobId: job.id,
        decisionSource: input.decisionSource ?? DecisionSource.Live,
        policyOverride: input.policyOverride,
      });
    } catch (err) {
      // Routing failed — move to Failed so the job is not stuck in Routing.
      // The caller can inspect the failureCode and call retryJob() if appropriate.
      ctx.log.warn(
        { jobId: job.id, err },
        "Routing decision failed — transitioning job to Failed",
      );

      await this.jobLifecycle.failJob(
        ctx,
        job.id,
        {
          code: toFailureCode(err),
          reason: err instanceof Error ? err.message : "Routing decision failed",
        },
        { source: "job_routing_service" },
      );

      throw err;
    }

    // ── 4. Transition to Assigned ──────────────────────────────────────────────
    // selectedModelId/selectedWorkerId are always set for a Routed outcome,
    // but the RoutingDecision contract types them as optional for other outcomes.
    const { selectedModelId, selectedWorkerId } = decisionResult.decision;
    if (!selectedModelId || !selectedWorkerId) {
      throw new Error("Routing decision returned without model or worker selection");
    }

    const assigned = await this.jobLifecycle.assignJob(
      ctx,
      job.id,
      selectedModelId,
      selectedWorkerId,
      decisionResult.decision.id,
      { source: "job_routing_service" },
    );

    ctx.log.info(
      {
        jobId: job.id,
        selectedModelId,
        selectedWorkerId,
        decisionId: decisionResult.decision.id,
        evaluationMs: decisionResult.evaluationMs,
      },
      "Job successfully routed and assigned",
    );

    return {
      job: assigned,
      decision: decisionResult.decision,
      modelSummary: decisionResult.modelSummary,
      workerSummary: decisionResult.workerSummary,
      evaluationMs: decisionResult.evaluationMs,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a routing-layer error to a short, structured failure code stamped onto
 * the job record. These codes are inspectable without parsing error messages.
 */
function toFailureCode(err: unknown): string {
  if (err instanceof Error) {
    switch (err.name) {
      case "NoActivePolicyError":
        return "NO_ACTIVE_POLICY";
      case "NoEligibleModelError":
        return "NO_ELIGIBLE_MODEL";
      case "NoEligibleWorkerError":
        return "NO_ELIGIBLE_WORKER";
      case "NotFoundError":
        return "POLICY_NOT_FOUND";
    }
  }
  return "ROUTING_FAILED";
}
