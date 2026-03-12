/**
 * modules/simulation/experiment/experiment-runner.service.ts
 *
 * Policy experiment runner.
 *
 * Orchestrates the simulation engine and workload generator to compare multiple
 * routing policies under an identical synthetic workload. Each policy receives
 * an independent, isolated simulation run — no results bleed between runs and
 * no live records are created.
 *
 * ─── Execution model ─────────────────────────────────────────────────────────
 *   1. Generate one workload (SyntheticRequestProfile[]) via WorkloadGeneratorService
 *   2. For each policy (sequentially):
 *        SimulationEngineService.run(ctx, { policyId, workloadProfiles, … })
 *   3. Derive per-policy metrics and compute cross-policy rankings
 *   4. Return ExperimentResult
 *
 * ─── Isolation guarantees ────────────────────────────────────────────────────
 *   Inherited from SimulationEngineService — each policy run uses a fresh
 *   InMemoryDecisionRepository and carries DecisionSource.Simulation on all
 *   routing calls. No live decision log, request records, or WebSocket events
 *   are produced.
 *
 * ─── Determinism ─────────────────────────────────────────────────────────────
 *   Set workloadConfig.randomSeed to produce reproducible experiments.
 *   The workload is generated once and shared across all policy runs, so the
 *   only source of non-determinism is the routing engine itself (which is
 *   deterministic given a fixed policy and stable candidate pool).
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../../core/context";
import type { SimulationEngineService } from "../service/simulation-engine.service";
import type { WorkloadGeneratorService } from "../workload/workload-generator.service";
import type { WorkloadConfig } from "../workload/workload-generator.contract";
import type { SimulationRunResult } from "../contract";
import type {
  ExperimentRunInput,
  ExperimentResult,
  ExperimentRankings,
  PolicyComparisonResult,
} from "./experiment-runner.contract";

// ─── Service ──────────────────────────────────────────────────────────────────

export class ExperimentRunnerService {
  constructor(
    /** Simulation engine — executes one isolated policy run per call */
    private readonly simulationEngine: SimulationEngineService,
    /** Workload generator — produces the shared synthetic request profiles */
    private readonly workloadGenerator: WorkloadGeneratorService,
  ) {}

  /**
   * Run a policy comparison experiment.
   *
   * Generates one workload and routes it through each policy sequentially.
   * Per-policy metrics and cross-policy rankings are returned when all runs
   * complete.
   *
   * @throws Never — individual simulation failures are captured in the result.
   *   A policy run that throws is recorded with zero counts and 0.0 rates,
   *   and the experiment continues with the remaining policies.
   */
  async run(
    ctx: RequestContext,
    input: ExperimentRunInput,
  ): Promise<ExperimentResult> {
    const experimentId = randomUUID();
    const startMs = Date.now();

    ctx.log.info(
      {
        experimentId,
        experimentName: input.experimentName,
        policyCount: input.policies.length,
        requestCount: input.workloadConfig.requestCount,
      },
      "Starting policy experiment",
    );

    // ── Generate shared workload ───────────────────────────────────────────────
    //
    // The workload is generated once so every policy run operates on exactly
    // the same synthetic requests. This is the key invariant that makes the
    // comparison meaningful: any difference in metrics reflects the policy's
    // routing behaviour, not sampling variance.

    const profiles = this.workloadGenerator.generateWorkload(
      input.workloadConfig as WorkloadConfig,
    );

    // ── Run one simulation per policy ──────────────────────────────────────────

    const results: PolicyComparisonResult[] = [];

    for (const policyId of input.policies) {
      ctx.log.debug(
        { experimentId, policyId },
        "Running experiment policy simulation",
      );

      let simResult: SimulationRunResult | null = null;

      try {
        simResult = await this.simulationEngine.run(ctx, {
          scenarioName:    `${input.experimentName}:${policyId}`,
          policyId,
          requestCount:    profiles.length,
          workloadProfiles: profiles,
          modelOverrides:  input.modelOverrides,
          workerOverrides: input.workerOverrides,
          sourceTag:       input.sourceTag,
        });
      } catch (err) {
        // A simulation run should never throw (the engine catches per-request
        // errors internally), but we guard here for defensive correctness.
        ctx.log.warn(
          { experimentId, policyId, err },
          "Experiment policy simulation threw unexpectedly — recording zero result",
        );
      }

      results.push(
        simResult
          ? buildPolicyComparison(simResult)
          : buildZeroComparison(policyId, profiles.length),
      );
    }

    const completedMs = Date.now();

    ctx.log.info(
      {
        experimentId,
        policyCount: input.policies.length,
        durationMs: completedMs - startMs,
      },
      "Policy experiment complete",
    );

    return {
      experimentId,
      experimentName:      input.experimentName,
      workloadRequestCount: profiles.length,
      policies:            input.policies,
      startedAt:           new Date(startMs).toISOString(),
      completedAt:         new Date(completedMs).toISOString(),
      durationMs:          completedMs - startMs,
      results,
      rankings:            buildRankings(results),
    };
  }
}

// ─── Comparison builder ───────────────────────────────────────────────────────

/** Derive per-policy comparison metrics from a completed simulation run. */
function buildPolicyComparison(sim: SimulationRunResult): PolicyComparisonResult {
  return {
    policyId:   sim.policyId,
    policyName: sim.policyName,
    runId:      sim.runId,

    totalRequests: sim.totalRequests,
    successCount:  sim.successCount,
    failureCount:  sim.failureCount,
    fallbackCount: sim.fallbackCount,

    successRate:
      sim.totalRequests > 0
        ? sim.successCount / sim.totalRequests
        : 0,
    fallbackRate:
      sim.successCount > 0
        ? sim.fallbackCount / sim.successCount
        : 0,

    averageEvaluationMs: sim.averageEvaluationMs,
    perModelSelections:  sim.perModelSelections,
    perWorkerAssignments: sim.perWorkerAssignments,
  };
}

/**
 * Build a zero-valued comparison entry for a policy run that threw unexpectedly.
 * Keeps the results array aligned with the input policies array.
 */
function buildZeroComparison(
  policyId: string,
  totalRequests: number,
): PolicyComparisonResult {
  return {
    policyId,
    policyName:          policyId,
    runId:               "",
    totalRequests,
    successCount:        0,
    failureCount:        totalRequests,
    fallbackCount:       0,
    successRate:         0,
    fallbackRate:        0,
    averageEvaluationMs: 0,
    perModelSelections:  {},
    perWorkerAssignments: {},
  };
}

// ─── Rankings builder ─────────────────────────────────────────────────────────

/**
 * Compute cross-policy rankings for three metric dimensions.
 * Ties are broken by input order (stable sort is not guaranteed in all JS
 * engines below ES2019 — we sort a copy to be safe).
 */
function buildRankings(results: PolicyComparisonResult[]): ExperimentRankings {
  return {
    bySuccessRate: [...results]
      .sort((a, b) => b.successRate - a.successRate)
      .map((r) => r.policyId),

    byFallbackRate: [...results]
      .sort((a, b) => a.fallbackRate - b.fallbackRate)
      .map((r) => r.policyId),

    byEvaluationSpeed: [...results]
      .sort((a, b) => a.averageEvaluationMs - b.averageEvaluationMs)
      .map((r) => r.policyId),
  };
}
