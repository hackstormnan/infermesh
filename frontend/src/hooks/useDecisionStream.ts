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
import type { InferMeshStreamEvent, RoutingStreamEvent } from '../api/types/stream'
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
    if (event.channel !== 'routing' && event.channel !== 'decisions') return
    if (event.type !== 'routing.decision_made') return
    const e = event as RoutingStreamEvent

    const outcome = e.outcome as RoutingOutcome
    const newItem: RoutingDecisionViewModel = {
      id: e.decisionId,
      shortId: e.decisionId.slice(0, 8),
      requestId: e.requestId,
      policyId: e.policyId,
      outcome,
      health: outcome === 'routed' ? 'success' : 'failed',
      selectedModelId: e.selectedModelId,
      selectedWorkerId: e.selectedWorkerId,
      evaluationMs: e.evaluationMs,
      evalDisplay: `${e.evaluationMs}ms`,
      usedFallback: false,
      candidateCount: 0,
      excludedCount: 0,
      reason: '',
      decisionSource: 'live',
      age: 'just now',
      decidedAt: new Date(e.timestamp),
    }

    setDecisions(prev => [newItem, ...prev].slice(0, MAX_ITEMS))
  }, [])

  const connectionState = useStreamSocket(['decisions'], handleEvent)

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
