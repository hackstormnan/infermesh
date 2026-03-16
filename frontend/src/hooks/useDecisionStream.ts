/**
 * hooks/useDecisionStream.ts
 *
 * Combines a REST seed load (GET /api/v1/routing/decisions?limit=20) with
 * a WebSocket subscription to the "decisions" channel.
 *
 * New "routing.decision_made" events are prepended; the list is capped at
 * MAX_ITEMS.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import {
  mapRoutingDecisions,
  type RoutingDecisionViewModel,
} from '../api/mappers/routing.mapper'
import type { RoutingDecisionDto, RoutingOutcome } from '../api/types/routing'
import type { PaginatedData } from '../api/types/common'
import type { InferMeshStreamEvent } from '../api/types/stream'
import { useStreamSocket, type ConnectionState } from './useStreamSocket'

const MAX_ITEMS = 30

export interface UseDecisionStreamResult {
  decisions: RoutingDecisionViewModel[]
  loading: boolean
  error: string | null
  connectionState: ConnectionState
}

export function useDecisionStream(): UseDecisionStreamResult {
  const [decisions, setDecisions] = useState<RoutingDecisionViewModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── WebSocket event handler ──────────────────────────────────────────────────

  const handleEvent = useCallback((event: InferMeshStreamEvent) => {
    // 'routing' channel carries RoutingOutcomeSummaryPayload which has all
    // the fields needed for the decision list view (requestId, outcome, etc.)
    if (event.type !== 'routing') return
    const payload = event.data  // RoutingOutcomeSummaryPayload

    const outcome = payload.outcome as RoutingOutcome
    const newItem: RoutingDecisionViewModel = {
      id: payload.decisionId,
      shortId: payload.decisionId.slice(0, 8),
      requestId: payload.requestId,
      policyId: '',  // not included in the stream summary payload
      outcome,
      health: payload.usedFallback ? 'fallback' : outcome === 'routed' ? 'success' : 'failed',
      selectedModelId: payload.selectedModelId,
      selectedWorkerId: payload.selectedWorkerId,
      evaluationMs: payload.evaluationMs,
      evalDisplay: `${payload.evaluationMs}ms`,
      usedFallback: payload.usedFallback,
      candidateCount: 0,
      excludedCount: 0,
      reason: '',
      decisionSource: 'live',
      age: 'just now',
      decidedAt: new Date(payload.decidedAt),
    }

    setDecisions(prev => [newItem, ...prev].slice(0, MAX_ITEMS))
  }, [])

  const connectionState = useStreamSocket(['routing'], handleEvent)

  // ── Initial REST seed ────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiClient
      .get<PaginatedData<RoutingDecisionDto>>('/routing/decisions?limit=20')
      .then(result => setDecisions(mapRoutingDecisions(result.items)))
      .catch(e =>
        setError(e instanceof ApiClientError ? e.message : 'Failed to load decisions'),
      )
      .finally(() => setLoading(false))
  }, [])

  return { decisions, loading, error, connectionState }
}
