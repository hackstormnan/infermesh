/**
 * api/types/simulation.ts
 *
 * Frontend contracts for simulation run and experiment comparison endpoints.
 */

export interface SimulationError {
  requestIndex: number
  requestId: string
  errorType: string
  message: string
}

/** POST /api/v1/simulation/runs → data */
export interface SimulationRunResult {
  runId: string
  scenarioName: string
  policyId: string
  policyName: string
  sourceTag?: string
  startedAt: string
  completedAt: string
  durationMs: number
  totalRequests: number
  successCount: number
  failureCount: number
  fallbackCount: number
  /** Mean routing evaluation time across successful decisions in ms */
  averageEvaluationMs: number
  perModelSelections: Record<string, number>
  perWorkerAssignments: Record<string, number>
  errors: SimulationError[]
}

export interface PolicyComparisonResult {
  policyId: string
  policyName: string
  runId: string
  totalRequests: number
  successCount: number
  failureCount: number
  fallbackCount: number
  /** 0–1 */
  successRate: number
  /** 0–1 */
  fallbackRate: number
  averageEvaluationMs: number
  perModelSelections: Record<string, number>
  perWorkerAssignments: Record<string, number>
}

export interface ExperimentRankings {
  /** Policy IDs ordered best → worst by successRate */
  bySuccessRate: string[]
  /** Policy IDs ordered by fallbackRate ascending */
  byFallbackRate: string[]
  /** Policy IDs ordered by averageEvaluationMs ascending */
  byEvaluationSpeed: string[]
}

/** POST /api/v1/simulation/experiments → data */
export interface ExperimentResult {
  experimentId: string
  experimentName: string
  workloadRequestCount: number
  policies: string[]
  startedAt: string
  completedAt: string
  durationMs: number
  results: PolicyComparisonResult[]
  rankings: ExperimentRankings
}
