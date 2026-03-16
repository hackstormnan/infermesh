/**
 * hooks/useRequestsPage.ts
 *
 * Drives the paginated Requests page with debounced ID search,
 * status filtering, pagination, and live WebSocket updates
 * injected on page 1.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { mapRequests, type RequestViewModel } from '../api/mappers/request.mapper'
import type { InferenceRequestDto, RequestStatus } from '../api/types/requests'
import type { PaginatedData } from '../api/types/common'
import type { InferMeshStreamEvent } from '../api/types/stream'
import { useStreamSocket, type ConnectionState } from './useStreamSocket'

// ─── Public types ─────────────────────────────────────────────────────────────

export type RequestStatusFilter = RequestStatus | 'all'

export interface UseRequestsPageResult {
  requests:       RequestViewModel[]
  total:          number
  page:           number
  limit:          number
  hasMore:        boolean
  loading:        boolean
  error:          string | null
  connectionState: ConnectionState
  search:          string
  statusFilter:    RequestStatusFilter
  setSearch:       (v: string) => void
  setStatusFilter: (v: RequestStatusFilter) => void
  setPage:         (p: number) => void
  refetch:         () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_LIMIT   = 20
const DEBOUNCE_MS  = 300

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRequestsPage(): UseRequestsPageResult {
  const [requests,     setRequests]     = useState<RequestViewModel[]>([])
  const [total,        setTotal]        = useState(0)
  const [page,         setPage]         = useState(1)
  const [search,       setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilterState] = useState<RequestStatusFilter>('all')
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [refetchKey,   setRefetchKey]   = useState(0)

  // Stable refs for WS handler — avoids stale closures without recreating the socket
  const pageRef         = useRef(page)
  const statusFilterRef = useRef(statusFilter)
  useEffect(() => { pageRef.current = page },           [page])
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])

  // ── Debounce search → also resets to page 1 ────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  // ── Filter change → reset page ──────────────────────────────────────────────
  const setStatusFilter = useCallback((v: RequestStatusFilter) => {
    setStatusFilterState(v)
    setPage(1)
  }, [])

  const refetch = useCallback(() => setRefetchKey(k => k + 1), [])

  // ── Paginated REST fetch ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      page:  String(page),
      limit: String(PAGE_LIMIT),
    })
    if (debouncedSearch) params.set('id', debouncedSearch)
    if (statusFilter !== 'all') params.set('status', statusFilter)

    apiClient
      .get<PaginatedData<InferenceRequestDto>>(`/requests?${params.toString()}`)
      .then(result => {
        if (cancelled) return
        setRequests(mapRequests(result.items))
        setTotal(result.total)
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof ApiClientError ? e.message : 'Failed to load requests')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [page, debouncedSearch, statusFilter, refetchKey])

  // ── WebSocket live updates ──────────────────────────────────────────────────
  //
  // The backend sends StreamEnvelope<RequestAcceptedPayload> on the "requests"
  // channel. Each event represents a newly accepted intake — inject it at the
  // top of page 1 when filters permit.
  //
  // RequestStreamStatus ('pending'|'processing'|'completed'|'failed') is
  // deliberately decoupled from the internal RequestStatus enum. Map the stream
  // status to the closest RequestStatus for display:
  //   pending    → queued       (request accepted, not yet routed)
  //   processing → dispatched   (worker assigned, execution in flight)
  //   completed  → completed
  //   failed     → failed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleEvent = useCallback((event: InferMeshStreamEvent) => {
    if (event.type !== 'requests') return

    // Only inject on page 1 — deeper pages are unaffected by new arrivals
    if (pageRef.current !== 1) return

    const payload = event.data
    const reqStatus: RequestStatus =
      payload.status === 'pending'    ? 'queued'      :
      payload.status === 'processing' ? 'dispatched'  :
      payload.status as RequestStatus  // 'completed' | 'failed' match directly

    // Respect active status filter
    if (statusFilterRef.current !== 'all' && statusFilterRef.current !== reqStatus) return

    const newItem: RequestViewModel = {
      id:        payload.id,
      shortId:   payload.id.slice(0, 8),
      modelId:   payload.model,
      status:    reqStatus,
      taskType:  'chat',
      age:       'just now',
      createdAt: new Date(payload.timestamp),
      hasRouted: false,
    }
    setRequests(prev => [newItem, ...prev].slice(0, PAGE_LIMIT))
    setTotal(t => t + 1)
  }, []) // stable — reads page/filter via refs

  const connectionState = useStreamSocket(['requests'], handleEvent)

  return {
    requests,
    total,
    page,
    limit:           PAGE_LIMIT,
    hasMore:         page * PAGE_LIMIT < total,
    loading,
    error,
    connectionState,
    search,
    statusFilter,
    setSearch,
    setStatusFilter,
    setPage,
    refetch,
  }
}
