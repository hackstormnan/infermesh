/**
 * hooks/useSummaryStats.ts
 *
 * Fetches GET /api/v1/stats/summary and auto-refreshes every 30 s.
 * Returns a StatsViewModel ready for the Overview stat cards.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { mapSummaryStats, type StatsViewModel } from '../api/mappers/stats.mapper'
import type { SummaryStatsDto } from '../api/types/stats'

const REFRESH_MS = 30_000

export interface UseSummaryStatsResult {
  data: StatsViewModel | null
  /** True only on the very first fetch (before any data is available) */
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useSummaryStats(): UseSummaryStatsResult {
  const [data, setData] = useState<StatsViewModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Track whether we've ever received data so background refreshes don't flash
  // the loading skeleton
  const hasDataRef = useRef(false)

  const fetchStats = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const dto = await apiClient.get<SummaryStatsDto>('/stats/summary')
      hasDataRef.current = true
      setData(mapSummaryStats(dto))
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, []) // apiClient & mapSummaryStats are stable module-level references

  useEffect(() => {
    fetchStats()
    const id = setInterval(fetchStats, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchStats])

  return { data, loading, error, refetch: fetchStats }
}
