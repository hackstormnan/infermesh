/**
 * api/mappers/simulation.mapper.ts
 *
 * Adapts SimulationRunResult and ExperimentResult → view models.
 */

import type { SimulationRunResult, ExperimentResult } from '../types/simulation'

export interface SimulationRunViewModel {
  runId: string
  scenarioName: string
  policyName: string
  durationMs: number
  durationDisplay: string
  totalRequests: number
  successCount: number
  failureCount: number
  fallbackCount: number
  successRatePct: string
  fallbackRatePct: string
  avgEvalDisplay: string
  errorCount: number
  topModel?: string
  topWorker?: string
  startedAt: Date
  completedAt: Date
}

export interface PolicyComparisonViewModel {
  policyId: string
  policyName: string
  successRatePct: string
  fallbackRatePct: string
  avgEvalDisplay: string
  successCount: number
  failureCount: number
  totalRequests: number
  rank: number
}

export interface ExperimentViewModel {
  experimentId: string
  experimentName: string
  workloadRequestCount: number
  durationMs: number
  durationDisplay: string
  winnerId: string
  winnerName: string
  results: PolicyComparisonViewModel[]
  startedAt: Date
  completedAt: Date
}

function topKey(map: Record<string, number>): string | undefined {
  const entries = Object.entries(map)
  if (entries.length === 0) return undefined
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}

function durationDisplay(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function mapSimulationRun(dto: SimulationRunResult): SimulationRunViewModel {
  return {
    runId: dto.runId,
    scenarioName: dto.scenarioName,
    policyName: dto.policyName,
    durationMs: dto.durationMs,
    durationDisplay: durationDisplay(dto.durationMs),
    totalRequests: dto.totalRequests,
    successCount: dto.successCount,
    failureCount: dto.failureCount,
    fallbackCount: dto.fallbackCount,
    successRatePct: `${(dto.successCount / Math.max(dto.totalRequests, 1) * 100).toFixed(1)}%`,
    fallbackRatePct: `${(dto.fallbackCount / Math.max(dto.successCount, 1) * 100).toFixed(1)}%`,
    avgEvalDisplay: `${dto.averageEvaluationMs.toFixed(1)}ms`,
    errorCount: dto.errors.length,
    topModel: topKey(dto.perModelSelections),
    topWorker: topKey(dto.perWorkerAssignments),
    startedAt: new Date(dto.startedAt),
    completedAt: new Date(dto.completedAt),
  }
}

export function mapExperiment(dto: ExperimentResult): ExperimentViewModel {
  const ranked = [...dto.results].sort((a, b) => b.successRate - a.successRate)
  const winner = ranked[0]

  const results: PolicyComparisonViewModel[] = dto.results.map(r => ({
    policyId: r.policyId,
    policyName: r.policyName,
    successRatePct: `${(r.successRate * 100).toFixed(1)}%`,
    fallbackRatePct: `${(r.fallbackRate * 100).toFixed(1)}%`,
    avgEvalDisplay: `${r.averageEvaluationMs.toFixed(1)}ms`,
    successCount: r.successCount,
    failureCount: r.failureCount,
    totalRequests: r.totalRequests,
    rank: ranked.indexOf(r) + 1,
  }))

  return {
    experimentId: dto.experimentId,
    experimentName: dto.experimentName,
    workloadRequestCount: dto.workloadRequestCount,
    durationMs: dto.durationMs,
    durationDisplay: durationDisplay(dto.durationMs),
    winnerId: winner?.policyId ?? '',
    winnerName: winner?.policyName ?? '—',
    results,
    startedAt: new Date(dto.startedAt),
    completedAt: new Date(dto.completedAt),
  }
}
