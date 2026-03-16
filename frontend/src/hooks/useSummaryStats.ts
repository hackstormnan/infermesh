/**
 * hooks/useSummaryStats.ts
 *
 * Fetches GET /api/v1/stats/summary and auto-refreshes every 30 s.
 * Returns a StatsViewModel ready for the Overview stat cards.
 *
 * Stale-data behaviour: if a background refresh fails while data already exists,
 * we keep the last-good data and set isStale=true rather than flashing an error
 * over a working display. isStale clears on the next successful fetch.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import { mapSummaryStats, type StatsViewModel } from '../api/mappers/stats.mapper'
import type { SummaryStatsDto } from '../api/types/stats'

const REFRESH_MS = 30_000

export interface UseSummaryStatsResult {
  data:          StatsViewModel | null
  /** True only on the very first fetch (before any data is available) */
  loading:       boolean
  error:         string | null
  /** True when a background refresh failed but last-known-good data is shown */
  isStale:       boolean
  lastUpdatedAt: Date | null
  refetch:       () => void
}

export function useSummaryStats(): UseSummaryStatsResult {
  const [data,          setData]          = useState<StatsViewModel | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [isStale,       setIsStale]       = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  // Track whether we've ever received data so background refreshes don't flash
  // the loading skeleton
  const hasDataRef = useRef(false)

  const fetchStats = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const dto = await apiClient.get<SummaryStatsDto>('/stats/summary')
      hasDataRef.current = true
      setIsStale(false)
      setLastUpdatedAt(new Date())
      setData(mapSummaryStats(dto))
    } catch (e) {
      if (hasDataRef.current) {
        // Background refresh failure — keep existing data, mark stale
        setIsStale(true)
      } else {
        // First load failure — no data to fall back on, show the error
        setError(e instanceof ApiClientError ? e.message : 'Failed to load stats')
      }
    } finally {
      setLoading(false)
    }
  }, []) // apiClient & mapSummaryStats are stable module-level references

  useEffect(() => {
    fetchStats()
    const id = setInterval(fetchStats, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchStats])

  return { data, loading, error, isStale, lastUpdatedAt, refetch: fetchStats }
}
