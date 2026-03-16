/**
 * hooks/useMetricsPage.ts
 *
 * Drives the Metrics page. Manages a shared time period selector and
 * fetches all four analytics endpoints independently, so a failure in
 * one section doesn't block the rest of the page.
 *
 * Each sub-result auto-refreshes every 60 s and exposes a manual
 * refetch() for error-state retry buttons.
 *
 * Background auto-refreshes suppress the loading skeleton via hasDataRef,
 * but period changes always reset to a fresh skeleton.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, ApiClientError } from '../api/client'
import type {
  MetricPeriod,
  MetricsSummary,
  TimeSeriesData,
  LatencyPercentilesReport,
  CostBreakdown,
} from '../api/types/metrics'

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_MS = 60_000

// ─── Internal generic fetch hook ─────────────────────────────────────────────

export interface AsyncResult<T> {
  data:    T | null
  loading: boolean
  error:   string | null
  refetch: () => void
}

/**
 * Internal custom hook — not exported.
 * Re-fetches whenever `url` changes (period change) or `refetchTrigger`
 * increments (manual retry).
 */
function useMetricFetch<T>(url: string): AsyncResult<T> {
  const [data,    setData]    = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)
  // True once the first successful response has been received for this url.
  // Suppresses the loading skeleton during background auto-refreshes.
  const hasDataRef = useRef(false)

  const doFetch = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const result = await apiClient.get<T>(url)
      hasDataRef.current = true
      setData(result)
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }, [url, trigger]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Reset so the next doFetch() will show the loading skeleton.
    // This fires whenever url changes (period changed) or trigger increments.
    hasDataRef.current = false
    doFetch()
    const id = setInterval(doFetch, REFRESH_MS)
    return () => clearInterval(id)
  }, [doFetch])

  const refetch = useCallback(() => setTrigger(t => t + 1), [])

  return { data, loading, error, refetch }
}

// ─── Public hook ──────────────────────────────────────────────────────────────

export interface UseMetricsPageResult {
  period:              MetricPeriod
  setPeriod:           (p: MetricPeriod) => void
  summary:             AsyncResult<MetricsSummary>
  timeSeries:          AsyncResult<TimeSeriesData>
  latencyPercentiles:  AsyncResult<LatencyPercentilesReport>
  costBreakdown:       AsyncResult<CostBreakdown>
}

export function useMetricsPage(): UseMetricsPageResult {
  const [period, setPeriod] = useState<MetricPeriod>('24h')

  const summary            = useMetricFetch<MetricsSummary>(`/metrics/summary?period=${period}`)
  const timeSeries         = useMetricFetch<TimeSeriesData>(`/metrics/time-series?period=${period}`)
  const latencyPercentiles = useMetricFetch<LatencyPercentilesReport>(`/metrics/latency-percentiles?period=${period}`)
  const costBreakdown      = useMetricFetch<CostBreakdown>(`/metrics/cost-breakdown?period=${period}`)

  return {
    period,
    setPeriod,
    summary,
    timeSeries,
    latencyPercentiles,
    costBreakdown,
  }
}
