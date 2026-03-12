/**
 * modules/simulation/service/simulation-engine.service.ts
 *
 * Offline routing simulation engine.
 *
 * Runs synthetic workloads through the routing decision logic without touching
 * live requests, jobs, worker state, or the live decision log. Each run gets
 * an isolated in-memory decision repository and no stream broker, so results
 * never pollute the live system.
 *
 * ─── Isolation guarantees ────────────────────────────────────────────────────
 *   - A fresh InMemoryDecisionRepository is created per run (discarded after)
 *   - All decisions carry DecisionSource.Simulation for audit traceability
 *   - The live policyRepo is used read-only — no policy mutations
 *   - Live model/worker registries are used by default; pass modelOverrides or
 *     workerOverrides to use a fixed candidate list instead
 *   - No IStreamBroker is injected — no WebSocket events are published
 *
 * ─── Reuse ───────────────────────────────────────────────────────────────────
 *   RoutingDecisionService.decideRoute() is called for every simulated request.
 *   All existing routing logic (policy resolution, candidate evaluation, fallback
 *   scoring) runs unchanged — this engine is purely an orchestration layer.
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import { DecisionSource } from "../../../shared/contracts/routing";
import type { PolicyId } from "../../../shared/primitives";
import type { ModelCapability, ModelTask } from "../../../shared/contracts/model";
import type { DecideRouteResult } from "../../routing/decision/routing-decision.contract";
import type { ModelEvaluationProfile } from "../../routing/evaluation/evaluation.contract";
import { RoutingDecisionService } from "../../routing/decision/routing-decision.service";
import { InMemoryDecisionRepository } from "../../routing/repository/InMemoryDecisionRepository";
import type { CandidateEvaluatorService } from "../../routing/evaluation/candidate-evaluator.service";
import type { IPolicyRepository } from "../../routing/repository/IPolicyRepository";
import type { ModelRegistryService } from "../../models/registry/model-registry.service";
import type { WorkerRegistryService } from "../../workers/registry/worker-registry.service";
import type { ModelCandidate } from "../../models/registry/model-registry.contract";
import type { WorkerCandidate } from "../../workers/registry/worker-registry.contract";
import type { SyntheticRequestProfile } from "../workload/workload-generator.contract";
import { TASK_TYPE_MAP } from "../workload/workload-generator.contract";
import type {
  SimulationRunInput,
  SimulationRunResult,
  SimulationError,
} from "../contract";

// ─── Service ──────────────────────────────────────────────────────────────────

export class SimulationEngineService {
  constructor(
    /** Live policy repository — used read-only to resolve policies by name/ID */
    private readonly policyRepo: IPolicyRepository,
    /** Live model registry — used when no modelOverrides are provided */
    private readonly modelRegistryService: ModelRegistryService,
    /** Live worker registry — used when no workerOverrides are provided */
    private readonly workerRegistryService: WorkerRegistryService,
    /** Shared stateless candidate evaluator — reused from the live routing path */
    private readonly evaluator: CandidateEvaluatorService,
  ) {}

  /**
   * Execute a simulation run.
   *
   * Iterates `input.requestCount` times, routing each synthetic request through
   * an isolated RoutingDecisionService instance. Errors are captured per-request
   * and do not abort the run. The aggregate result is returned when all iterations
   * complete.
   *
   * @throws Never — individual routing failures are captured in result.errors.
   */
  async run(ctx: RequestContext, input: SimulationRunInput): Promise<SimulationRunResult> {
    const runId = randomUUID();
    const startMs = Date.now();

    ctx.log.info(
      {
        runId,
        scenarioName: input.scenarioName,
        requestCount: input.requestCount,
        policyId: input.policyId,
        hasModelOverrides: Boolean(input.modelOverrides?.length),
        hasWorkerOverrides: Boolean(input.workerOverrides?.length),
      },
      "Starting simulation run",
    );

    // ── Build isolated routing service ────────────────────────────────────────
    //
    // A fresh decision repo is created for this run so simulation records never
    // enter the live decision log. The policyRepo is shared (read-only lookups
    // only). Model and worker registries are replaced with fixed-candidate
    // implementations when overrides are provided.

    const simDecisionRepo = new InMemoryDecisionRepository();

    const modelReg = input.modelOverrides?.length
      ? makeFixedModelRegistry(input.modelOverrides)
      : this.modelRegistryService;

    const workerReg = input.workerOverrides?.length
      ? makeFixedWorkerRegistry(input.workerOverrides)
      : this.workerRegistryService;

    const decisionSvc = new RoutingDecisionService(
      this.policyRepo,
      simDecisionRepo,
      modelReg,
      workerReg,
      this.evaluator,
      null,       // no evaluation store — simulation doesn't need the history layer
      undefined,  // no stream broker — simulation events are not published
    );

    // ── Run iterations ────────────────────────────────────────────────────────

    const prefix = input.workload?.requestIdPrefix ?? "sim";
    const successes: DecideRouteResult[] = [];
    const errors: SimulationError[] = [];
    let fallbackCount = 0;

    for (let i = 0; i < input.requestCount; i++) {
      const requestId = `${prefix}-${runId.substring(0, 8)}-${i}`;
      const profile = input.workloadProfiles?.[i];
      try {
        const result = await decisionSvc.decideRoute(ctx, {
          requestId,
          decisionSource: DecisionSource.Simulation,
          policyOverride: input.policyId,
          modelFilter: input.workload?.modelFilter,
          workerFilter: input.workload?.workerFilter,
          modelProfile: profile ? toModelProfile(profile) : undefined,
        });
        successes.push(result);
        if (result.decision.usedFallback) fallbackCount++;
      } catch (err) {
        errors.push({
          requestIndex: i,
          requestId,
          errorType: err instanceof Error ? err.constructor.name : "UnknownError",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const completedMs = Date.now();

    ctx.log.info(
      {
        runId,
        successCount: successes.length,
        failureCount: errors.length,
        fallbackCount,
        durationMs: completedMs - startMs,
      },
      "Simulation run complete",
    );

    // ── Resolve policy metadata for the result summary ─────────────────────────
    //
    // The routing engine already resolved the policy for each request; here we
    // do one more lookup only to surface a human-readable name in the result.

    let resolvedPolicyId = input.policyId ?? "";
    let policyName = input.policyId ?? "(active)";

    if (successes.length > 0) {
      resolvedPolicyId = successes[0].decision.policyId;
      try {
        const p = await this.policyRepo.findById(resolvedPolicyId as PolicyId);
        if (p) policyName = p.name;
      } catch {
        // Leave policyName as fallback — result is still valid
      }
    }

    return buildRunResult(
      runId,
      input,
      successes,
      errors,
      fallbackCount,
      resolvedPolicyId,
      policyName,
      startMs,
      completedMs,
    );
  }
}

// ─── Profile mapper ───────────────────────────────────────────────────────────
//
// Converts a SyntheticRequestProfile (workload generator vocabulary) into a
// ModelEvaluationProfile (routing evaluation vocabulary). Only the fields that
// influence model selection are mapped; worker evaluation profiles are left
// unset so the engine applies its defaults.

function toModelProfile(profile: SyntheticRequestProfile): ModelEvaluationProfile {
  return {
    taskType:             TASK_TYPE_MAP[profile.taskType] as ModelTask,
    requiredCapabilities: profile.requiredCapabilities as ModelCapability[],
    estimatedInputTokens: profile.estimatedTokenCount,
  };
}

// ─── Fixed-candidate registry helpers ────────────────────────────────────────
//
// When model or worker overrides are provided, these lightweight shims replace
// the live registry services. They implement only findEligible() — the only
// method called by RoutingDecisionService — and return the fixed candidate list
// regardless of any filter. TypeScript structural typing allows the cast.

function makeFixedModelRegistry(candidates: ModelCandidate[]): ModelRegistryService {
  return {
    findEligible: async () => candidates,
  } as unknown as ModelRegistryService;
}

function makeFixedWorkerRegistry(candidates: WorkerCandidate[]): WorkerRegistryService {
  return {
    findEligible: async () => candidates,
  } as unknown as WorkerRegistryService;
}

// ─── Result builder ───────────────────────────────────────────────────────────

function buildRunResult(
  runId: string,
  input: SimulationRunInput,
  successes: DecideRouteResult[],
  errors: SimulationError[],
  fallbackCount: number,
  policyId: string,
  policyName: string,
  startMs: number,
  completedMs: number,
): SimulationRunResult {
  const perModelSelections: Record<string, number> = {};
  const perWorkerAssignments: Record<string, number> = {};
  let totalEvalMs = 0;

  for (const r of successes) {
    const modelId = r.decision.selectedModelId ?? "(none)";
    perModelSelections[modelId] = (perModelSelections[modelId] ?? 0) + 1;

    const workerId = r.decision.selectedWorkerId ?? "(none)";
    perWorkerAssignments[workerId] = (perWorkerAssignments[workerId] ?? 0) + 1;

    totalEvalMs += r.evaluationMs;
  }

  return {
    runId,
    scenarioName: input.scenarioName,
    policyId,
    policyName,
    sourceTag: input.sourceTag,
    startedAt: new Date(startMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    durationMs: completedMs - startMs,
    totalRequests: input.requestCount,
    successCount: successes.length,
    failureCount: errors.length,
    fallbackCount,
    averageEvaluationMs:
      successes.length > 0 ? totalEvalMs / successes.length : 0,
    perModelSelections,
    perWorkerAssignments,
    errors,
  };
}
