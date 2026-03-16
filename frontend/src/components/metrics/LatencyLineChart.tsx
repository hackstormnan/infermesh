/**
 * components/metrics/LatencyLineChart.tsx
 *
 * Average latency line chart driven by TimeSeriesData.avgLatencyMs values.
 * Shares the same data fetch as ThroughputChart — no extra network call.
 */

import { ChartContainer } from '../ui/ChartContainer'
import { SkeletonBlock } from '../ui/LoadingState'
import { ErrorState } from '../ui/ErrorState'
import {
  mapMetricsSummary,
  trendArrow,
} from '../../api/mappers/metrics.mapper'
import type { TimeSeriesData, MetricsSummary, MetricPeriod } from '../../api/types/metrics'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<MetricPeriod, string> = {
  '1h':  'Last 1 hour',
  '24h': 'Last 24 hours',
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)} ms`
}

// ─── SVG line chart ───────────────────────────────────────────────────────────

const GRAD_ID = 'latency-area-fill'

function LineChart({ values, height }: { values: number[]; height: number }) {
  if (values.length < 2) return null
  const max  = Math.max(...values, 1)
  const w    = 300
  const n    = values.length

  const coords = values.map((v, i) => {
    const x = (i / (n - 1)) * w
    const y = height - 4 - ((v / max) * (height - 8))
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const polyline = coords.join(' ')

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(34,197,94,0.25)" />
          <stop offset="100%" stopColor="rgba(34,197,94,0)"    />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${polyline} ${w},${height}`}
        fill={`url(#${GRAD_ID})`}
      />
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(34,197,94,0.75)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LatencyLineChartProps {
  /** Time-series data (shared with ThroughputChart — same fetch) */
  data:         TimeSeriesData | null
  /** Summary data used to derive a trend badge */
  summaryData:  MetricsSummary | null
  period:       MetricPeriod
  loading:      boolean
  error:        string | null
  onRetry:      () => void
  height?:      number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LatencyLineChart({
  data,
  summaryData,
  period,
  loading,
  error,
  onRetry,
  height = 80,
}: LatencyLineChartProps) {
  const points  = data?.points ?? []
  const values  = points.map(p => p.avgLatencyMs)
  const hasData = values.some(v => v > 0)

  // Latest avg latency value for the header
  const latestMs = hasData
    ? values.filter(v => v > 0).at(-1) ?? 0
    : 0

  // Trend badge derived from MetricsSummary if available
  const vm    = summaryData ? mapMetricsSummary(summaryData) : null
  const trend = vm
    ? {
        formatted:    `${trendArrow(vm.latencyTrend.direction)} ${vm.latencyTrend.formatted}`,
        direction:    vm.latencyTrend.direction,
        invertColors: true,
      }
    : undefined

  const subtitle = PERIOD_LABELS[period]

  if (error) {
    return (
      <div
        style={{
          backgroundColor: 'var(--color-bg-surface)',
          border:          '1px solid var(--color-border)',
          borderRadius:    'var(--radius-lg)',
          overflow:        'hidden',
        }}
      >
        <ErrorState title="Chart unavailable" message={error} onRetry={onRetry} compact />
      </div>
    )
  }

  return (
    <ChartContainer
      title="Avg Latency"
      subtitle={subtitle}
      value={loading ? '—' : hasData ? formatMs(latestMs) : '—'}
      trend={trend}
      height={height}
    >
      {loading ? (
        <SkeletonBlock width="100%" height={height} />
      ) : hasData ? (
        <LineChart values={values} height={height} />
      ) : (
        <div
          style={{
            height,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   11,
              color:      'var(--color-text-muted)',
            }}
          >
            No latency data in this period
          </span>
        </div>
      )}
    </ChartContainer>
  )
}
