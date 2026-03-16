/**
 * hooks/useRoutingPage.ts
 *
 * Fetches routing policies (GET /api/v1/routing/policies) and recent decisions
 * (GET /api/v1/routing/decisions?limit=50) in parallel.
 *
 * Derives summary stats from the fetched data — the backend has no dedicated
 * /routing/stats endpoint, so we compute locally:
 *   - activePolicies  : count of policies with status === 'active'
 *   - totalPolicies   : total number of registered policies
 *   - successRate     : routed / total decisions × 100 (null if no decisions)
 *   - avgDecisionMs   : mean evaluationMs across recent decisions (null if empty)
 *
 * 30 s auto-refresh (faster than models because routing is operational data).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import {
  mapRoutingPolicies,
  mapRoutingDecisions,
  type RoutingPolicyViewModel,
  type RoutingDecisionViewModel,
} from '../api/mappers/routing.mapper'
import type { RoutingPolicyDto, RoutingDecisionDto } from '../api/types/routing'
import type { PaginatedData } from '../api/types/common'

export interface RoutingStats {
  activePolicies:  number
  totalPolicies:   number
  /** Null when there are no recent decisions to compute from */
  successRate:     number | null
  /** Mean evaluationMs; null when no recent decisions */
  avgDecisionMs:   number | null
}

export interface UseRoutingPageResult {
  policies:        RoutingPolicyViewModel[]
  recentDecisions: RoutingDecisionViewModel[]
  stats:           RoutingStats
  loading:         boolean
  error:           string | null
  refetch:         () => void
}

const REFRESH_MS = 30_000

function deriveStats(
  policies:  RoutingPolicyViewModel[],
  decisions: RoutingDecisionViewModel[],
): RoutingStats {
  const activePolicies = policies.filter(p => p.status === 'active').length
  const totalPolicies  = policies.length

  const successRate = decisions.length > 0
    ? Math.round((decisions.filter(d => d.health !== 'failed').length / decisions.length) * 100)
    : null

  const avgDecisionMs = decisions.length > 0
    ? Math.round(decisions.reduce((s, d) => s + d.evaluationMs, 0) / decisions.length)
    : null

  return { activePolicies, totalPolicies, successRate, avgDecisionMs }
}

export function useRoutingPage(): UseRoutingPageResult {
  const [policies,        setPolicies]        = useState<RoutingPolicyViewModel[]>([])
  const [recentDecisions, setRecentDecisions] = useState<RoutingDecisionViewModel[]>([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState<string | null>(null)
  const firstLoad = useRef(true)

  const load = useCallback((showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)

    Promise.all([
      apiClient.get<PaginatedData<RoutingPolicyDto>>('/routing/policies?limit=100'),
      apiClient.get<PaginatedData<RoutingDecisionDto>>('/routing/decisions?limit=50'),
    ])
      .then(([policiesResult, decisionsResult]) => {
        setPolicies(mapRoutingPolicies(policiesResult.items))
        setRecentDecisions(mapRoutingDecisions(decisionsResult.items))
        firstLoad.current = false
      })
      .catch(e =>
        setError(e instanceof ApiClientError ? e.message : 'Failed to load routing data'),
      )
      .finally(() => { if (showLoading) setLoading(false) })
  }, [])

  const refetch = useCallback(() => load(true), [load])

  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const stats = deriveStats(policies, recentDecisions)

  return { policies, recentDecisions, stats, loading, error, refetch }
}
