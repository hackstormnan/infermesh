/**
 * api/mappers/routing.mapper.ts
 *
 * Adapts RoutingDecisionDto → RoutingDecisionViewModel for decision panels,
 * and RoutingPolicyDto → RoutingPolicyViewModel for the Routing page.
 */

import type {
  RoutingDecisionDto,
  RoutingOutcome,
  RoutingPolicyDto,
  RoutingStrategy,
  RoutingPolicyStatus,
  RoutingConstraints,
  StrategyWeights,
} from '../types/routing'

// ─── Decision view model ──────────────────────────────────────────────────────

export type DecisionHealth = 'success' | 'fallback' | 'failed'

export interface RoutingDecisionViewModel {
  id: string
  shortId: string
  requestId: string
  policyId: string
  outcome: RoutingOutcome
  health: DecisionHealth
  selectedModelId?: string
  selectedWorkerId?: string
  evaluationMs: number
  evalDisplay: string
  usedFallback: boolean
  candidateCount: number
  excludedCount: number
  reason: string
  decisionSource: 'live' | 'simulation'
  age: string
  decidedAt: Date
}

function relativeAge(epochMs: number): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function deriveHealth(dto: RoutingDecisionDto): DecisionHealth {
  if (dto.outcome === 'routed' && !dto.usedFallback) return 'success'
  if (dto.outcome === 'routed' && dto.usedFallback) return 'fallback'
  return 'failed'
}

export function mapRoutingDecision(dto: RoutingDecisionDto): RoutingDecisionViewModel {
  return {
    id: dto.id,
    shortId: dto.id.slice(0, 8),
    requestId: dto.requestId,
    policyId: dto.policyId,
    outcome: dto.outcome,
    health: deriveHealth(dto),
    selectedModelId: dto.selectedModelId,
    selectedWorkerId: dto.selectedWorkerId,
    evaluationMs: dto.evaluationMs,
    evalDisplay: `${dto.evaluationMs}ms`,
    usedFallback: dto.usedFallback,
    candidateCount: dto.candidates.length,
    excludedCount: dto.candidates.filter(c => c.excluded).length,
    reason: dto.reason,
    decisionSource: dto.decisionSource,
    age: relativeAge(dto.decidedAt),
    decidedAt: new Date(dto.decidedAt),
  }
}

export function mapRoutingDecisions(dtos: RoutingDecisionDto[]): RoutingDecisionViewModel[] {
  return dtos.map(mapRoutingDecision)
}

// ─── Policy view model ────────────────────────────────────────────────────────

export const STRATEGY_LABEL: Record<RoutingStrategy, string> = {
  round_robin:       'Round Robin',
  least_loaded:      'Least Loaded',
  cost_optimised:    'Cost Optimised',
  latency_optimised: 'Latency Optimised',
  affinity:          'Affinity',
  canary:            'Canary',
}

export interface RoutingPolicyViewModel {
  id: string
  shortId: string
  name: string
  description?: string
  strategy: RoutingStrategy
  strategyLabel: string
  status: RoutingPolicyStatus
  priority: number
  version: number
  allowFallback: boolean
  fallbackStrategy?: RoutingStrategy
  fallbackStrategyLabel?: string
  constraints: RoutingConstraints
  weights: StrategyWeights
  /** True if any constraint field is non-empty */
  hasConstraints: boolean
  /** Human-readable summary of active constraints */
  constraintSummary: string
  createdAt: Date
  updatedAt: Date
}

function buildConstraintSummary(c: RoutingConstraints): string {
  const parts: string[] = []
  if (c.region) parts.push(`region: ${c.region}`)
  if (c.maxCostUsd != null) parts.push(`cost ≤ $${c.maxCostUsd}`)
  if (c.maxLatencyMs != null) parts.push(`latency ≤ ${c.maxLatencyMs}ms`)
  if (c.requiredCapabilities?.length) parts.push(c.requiredCapabilities.join(', '))
  return parts.join(' · ') || 'No constraints'
}

export function mapRoutingPolicy(dto: RoutingPolicyDto): RoutingPolicyViewModel {
  return {
    id:                   dto.id,
    shortId:              dto.id.slice(0, 8),
    name:                 dto.name,
    description:          dto.description,
    strategy:             dto.strategy,
    strategyLabel:        STRATEGY_LABEL[dto.strategy] ?? dto.strategy,
    status:               dto.status,
    priority:             dto.priority,
    version:              dto.version,
    allowFallback:        dto.allowFallback,
    fallbackStrategy:     dto.fallbackStrategy,
    fallbackStrategyLabel: dto.fallbackStrategy ? STRATEGY_LABEL[dto.fallbackStrategy] : undefined,
    constraints:          dto.constraints,
    weights:              dto.weights,
    hasConstraints: !!(
      dto.constraints.region ||
      dto.constraints.maxCostUsd != null ||
      dto.constraints.maxLatencyMs != null ||
      dto.constraints.requiredCapabilities?.length
    ),
    constraintSummary: buildConstraintSummary(dto.constraints),
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
  }
}

export function mapRoutingPolicies(dtos: RoutingPolicyDto[]): RoutingPolicyViewModel[] {
  return dtos.map(mapRoutingPolicy).sort((a, b) => a.priority - b.priority)
}
