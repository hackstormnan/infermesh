/**
 * api/types/routing.ts
 *
 * Frontend contracts for routing policy and decision endpoints.
 */

export type RoutingStrategy =
  | 'round_robin'
  | 'least_loaded'
  | 'cost_optimised'
  | 'latency_optimised'
  | 'affinity'
  | 'canary'

export type RoutingOutcome =
  | 'routed'
  | 'no_workers_available'
  | 'constraints_not_met'
  | 'model_unavailable'

export type RoutingPolicyStatus = 'active' | 'inactive' | 'archived'

export type DecisionSource = 'live' | 'simulation'

export interface RoutingConstraints {
  region?: string
  maxCostUsd?: number
  maxLatencyMs?: number
  requiredLabels?: Record<string, string>
  requiredCapabilities?: string[]
}

export interface StrategyWeights {
  quality: number
  cost: number
  latency: number
  load: number
}

export interface ScoreBreakdown {
  quality: number
  cost: number
  latency: number
  load: number
  total: number
  rationale: string
}

export interface RoutingCandidate {
  modelId: string
  workerId: string
  estimatedCostUsd?: number
  estimatedLatencyMs?: number
  scoreBreakdown?: ScoreBreakdown
  excluded: boolean
  exclusionReason?: string
}

/** GET /api/v1/routing/decisions */
export interface RoutingDecisionDto {
  id: string
  requestId: string
  jobId?: string
  policyId: string
  outcome: RoutingOutcome
  selectedModelId?: string
  selectedWorkerId?: string
  strategy: RoutingStrategy
  usedFallback: boolean
  fallbackReason?: string
  candidates: RoutingCandidate[]
  reason: string
  decisionSource: DecisionSource
  /** Unix epoch ms */
  decidedAt: number
  /** Duration in ms */
  evaluationMs: number
  createdAt: string
  updatedAt: string
}

/** GET /api/v1/routing/policies */
export interface RoutingPolicyDto {
  id: string
  name: string
  description?: string
  strategy: RoutingStrategy
  constraints: RoutingConstraints
  weights: StrategyWeights
  canaryWeights?: Record<string, number>
  allowFallback: boolean
  fallbackStrategy?: RoutingStrategy
  priority: number
  version: number
  status: RoutingPolicyStatus
  createdAt: string
  updatedAt: string
}
