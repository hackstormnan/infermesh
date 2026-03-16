/**
 * hooks/useRequestStream.ts
 *
 * Combines a REST seed load (GET /api/v1/requests?limit=20) with
 * a WebSocket subscription to the "requests" channel.
 *
 * New "request.created" events are prepended; "request.updated" events
 * update the status of an existing row in-place.
 * The list is capped at MAX_ITEMS to keep memory bounded.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { mapRequests, type RequestViewModel } from '../api/mappers/request.mapper'
import type { InferenceRequestDto, RequestStatus } from '../api/types/requests'
import type { PaginatedData } from '../api/types/common'
import type { InferMeshStreamEvent, RequestStreamEvent } from '../api/types/stream'
import { useStreamSocket, type ConnectionState } from './useStreamSocket'

const MAX_ITEMS = 50

export interface UseRequestStreamResult {
  requests: RequestViewModel[]
  loading: boolean
  error: string | null
  connectionState: ConnectionState
}

export function useRequestStream(): UseRequestStreamResult {
  const [requests, setRequests] = useState<RequestViewModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── WebSocket event handler ──────────────────────────────────────────────────

  const handleEvent = useCallback((event: InferMeshStreamEvent) => {
    if (event.channel !== 'requests') return
    const e = event as RequestStreamEvent

    if (e.type === 'request.created') {
      const newItem: RequestViewModel = {
        id: e.requestId,
        shortId: e.requestId.slice(0, 8),
        modelId: e.modelId,
        status: e.status as RequestStatus,
        taskType: 'chat',
        age: 'just now',
        createdAt: new Date(e.timestamp),
        hasRouted: false,
      }
      setRequests(prev => [newItem, ...prev].slice(0, MAX_ITEMS))
      return
    }

    if (e.type === 'request.updated') {
      setRequests(prev =>
        prev.map(r =>
          r.id === e.requestId
            ? { ...r, status: e.status as RequestStatus }
            : r,
        ),
      )
    }
  }, [])

  const connectionState = useStreamSocket(['requests'], handleEvent)

  // ── Initial REST seed ────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiClient
      .get<PaginatedData<InferenceRequestDto>>('/requests?limit=20')
      .then(result => setRequests(mapRequests(result.items)))
      .catch(e =>
        setError(e instanceof ApiClientError ? e.message : 'Failed to load requests'),
      )
      .finally(() => setLoading(false))
  }, [])

  return { requests, loading, error, connectionState }
}
