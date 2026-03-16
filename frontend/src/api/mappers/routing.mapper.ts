/**
 * api/mappers/routing.mapper.ts
 *
 * Adapts RoutingDecisionDto → RoutingDecisionViewModel for decision panels.
 */

import type { RoutingDecisionDto, RoutingOutcome } from '../types/routing'

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
