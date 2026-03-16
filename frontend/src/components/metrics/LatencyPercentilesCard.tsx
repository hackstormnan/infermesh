/**
 * components/metrics/LatencyPercentilesCard.tsx
 *
 * Displays p50 / p75 / p95 / p99 latency percentiles as a horizontal
 * bar chart inside a Panel.  Color-codes each tier from green → red
 * to give instant visual intuition about tail latency distribution.
 */

import { Panel, PanelHeader } from '../ui/Panel'
import { LoadingState } from '../ui/LoadingState'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import type { LatencyPercentilesReport, MetricPeriod } from '../../api/types/metrics'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<MetricPeriod, string> = {
  '1h':  '1h',
  '24h': '24h',
  '7d':  '7d',
  '30d': '30d',
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)} ms`
}

// Per-percentile visual accents
const PERCENTILE_META = [
  { key: 'p50' as const, label: 'p50', color: 'var(--color-green)' },
  { key: 'p75' as const, label: 'p75', color: 'var(--color-blue)'  },
  { key: 'p95' as const, label: 'p95', color: 'var(--color-amber)' },
  { key: 'p99' as const, label: 'p99', color: 'var(--color-red)'   },
]

type PercentileKey = 'p50' | 'p75' | 'p95' | 'p99'

function rawValue(report: LatencyPercentilesReport, key: PercentileKey): number {
  return report[`${key}Ms`]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LatencyPercentilesCardProps {
  data:    LatencyPercentilesReport | null
  period:  MetricPeriod
  loading: boolean
  error:   string | null
  onRetry: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LatencyPercentilesCard({
  data,
  period,
  loading,
  error,
  onRetry,
}: LatencyPercentilesCardProps) {
  const hasData = data != null && data.sampleCount > 0

  const subtitle = data
    ? `${PERIOD_LABELS[period]} · ${data.sampleCount.toLocaleString()} samples`
    : PERIOD_LABELS[period]

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Latency Percentiles" subtitle={loading ? undefined : subtitle} />

      <div style={{ padding: '16px' }}>
        {error ? (
          <ErrorState title="Data unavailable" message={error} onRetry={onRetry} compact />
        ) : loading ? (
          <LoadingState rows={4} compact />
        ) : !hasData ? (
          <EmptyState
            title="No latency data"
            description="Latency samples will appear once requests complete in this period."
            compact
          />
        ) : (
          <PercentileBars report={data!} />
        )}
      </div>
    </Panel>
  )
}

// ─── PercentileBars ───────────────────────────────────────────────────────────

function PercentileBars({ report }: { report: LatencyPercentilesReport }) {
  const maxMs = Math.max(
    report.p50Ms, report.p75Ms, report.p95Ms, report.p99Ms, 1,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {PERCENTILE_META.map(({ key, label, color }) => {
        const ms  = rawValue(report, key)
        const pct = (ms / maxMs) * 100

        return (
          <div key={key}>
            {/* Label + value row */}
            <div
              style={{
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'baseline',
                marginBottom:   6,
              }}
            >
              <span
                style={{
                  fontFamily:  'var(--font-mono)',
                  fontSize:    11,
                  fontWeight:  600,
                  color,
                  letterSpacing: '0.3px',
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   13,
                  fontWeight: 600,
                  color:      'var(--color-text-primary)',
                }}
              >
                {formatMs(ms)}
              </span>
            </div>

            {/* Progress bar */}
            <div
              style={{
                height:          4,
                borderRadius:    2,
                backgroundColor: 'var(--color-bg-elevated)',
                overflow:        'hidden',
              }}
            >
              <div
                style={{
                  height:          '100%',
                  width:           `${pct.toFixed(1)}%`,
                  borderRadius:    2,
                  backgroundColor: color,
                  transition:      'width 0.4s ease',
                  opacity:         0.75,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
