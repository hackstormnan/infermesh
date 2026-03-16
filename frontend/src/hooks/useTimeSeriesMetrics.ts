/**
 * hooks/useTimeSeriesMetrics.ts
 *
 * Fetches GET /api/v1/metrics/time-series?period=<period> and refreshes
 * every 60 s. Used by the Overview charts to derive live throughput and
 * latency values.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import type { TimeSeriesData, MetricPeriod } from '../api/types/metrics'

const REFRESH_MS = 60_000

export interface UseTimeSeriesMetricsResult {
  data: TimeSeriesData | null
  loading: boolean
  error: string | null
}

export function useTimeSeriesMetrics(period: MetricPeriod = '1h'): UseTimeSeriesMetricsResult {
  const [data, setData] = useState<TimeSeriesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setError(null)
    try {
      const result = await apiClient.get<TimeSeriesData>(
        `/metrics/time-series?period=${period}`,
      )
      setData(result)
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    setLoading(true)
    fetchData()
    const id = setInterval(fetchData, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchData])

  return { data, loading, error }
}
