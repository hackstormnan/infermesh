/**
 * components/metrics/ThroughputChart.tsx
 *
 * Request-volume bar chart driven by TimeSeriesData.
 * Renders real SVG bars scaled to the actual request counts in each bucket.
 */

import { ChartContainer } from '../ui/ChartContainer'
import { SkeletonBlock } from '../ui/LoadingState'
import { ErrorState } from '../ui/ErrorState'
import type { TimeSeriesData, MetricPeriod } from '../../api/types/metrics'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<MetricPeriod, string> = {
  '1h':  'Last 1 hour',
  '24h': 'Last 24 hours',
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
}

function granularityLabel(ms: number | undefined): string {
  if (!ms) return ''
  if (ms < 3_600_000)  return '5 min buckets'
  if (ms < 86_400_000) return '1 hr buckets'
  if (ms < 604_800_000) return '6 hr buckets'
  return '1 day buckets'
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ─── SVG bar chart ────────────────────────────────────────────────────────────

function BarChart({ values, height }: { values: number[]; height: number }) {
  if (values.length === 0) return null
  const max = Math.max(...values, 1)
  const barW = 6
  const gap  = 3
  const totalW = values.length * (barW + gap) - gap

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${totalW} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {values.map((v, i) => {
        const barH = Math.max((v / max) * (height - 4), v > 0 ? 2 : 0)
        const x    = i * (barW + gap)
        const y    = height - barH
        const ratio   = v / max
        const opacity = 0.18 + ratio * 0.72

        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={1}
            fill={`rgba(59,130,246,${opacity.toFixed(2)})`}
          />
        )
      })}
    </svg>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ThroughputChartProps {
  data:    TimeSeriesData | null
  period:  MetricPeriod
  loading: boolean
  error:   string | null
  onRetry: () => void
  height?: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ThroughputChart({
  data,
  period,
  loading,
  error,
  onRetry,
  height = 80,
}: ThroughputChartProps) {
  const points   = data?.points ?? []
  const values   = points.map(p => p.requests)
  const hasData  = values.some(v => v > 0)
  const latest   = values[values.length - 1] ?? 0

  const subtitle = `${PERIOD_LABELS[period]}${data ? ` · ${granularityLabel(data.granularityMs)}` : ''}`

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
      title="Request Volume"
      subtitle={subtitle}
      value={loading ? '—' : hasData ? formatCount(latest) : '0'}
      height={height}
    >
      {loading ? (
        <SkeletonBlock width="100%" height={height} />
      ) : hasData ? (
        <BarChart values={values} height={height} />
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
            No traffic in this period
          </span>
        </div>
      )}
    </ChartContainer>
  )
}
