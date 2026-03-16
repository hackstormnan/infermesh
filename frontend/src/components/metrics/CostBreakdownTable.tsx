/**
 * components/metrics/CostBreakdownTable.tsx
 *
 * Per-model cost breakdown rendered inside a Panel.
 * Shows model name, request count, cost, percentage share,
 * and a proportional bar for quick visual comparison.
 */

import { Panel, PanelHeader } from '../ui/Panel'
import { LoadingState } from '../ui/LoadingState'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import {
  mapCostBreakdown,
  type CostBreakdownEntryViewModel,
} from '../../api/mappers/metrics.mapper'
import type { CostBreakdown, MetricPeriod } from '../../api/types/metrics'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<MetricPeriod, string> = {
  '1h':  '1h',
  '24h': '24h',
  '7d':  '7d',
  '30d': '30d',
}

// Bar colour from the accent palette — cycles across entries
const BAR_COLORS = [
  'var(--color-blue)',
  'var(--color-purple)',
  'var(--color-green)',
  'var(--color-amber)',
  'var(--color-red)',
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface CostBreakdownTableProps {
  data:    CostBreakdown | null
  period:  MetricPeriod
  loading: boolean
  error:   string | null
  onRetry: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CostBreakdownTable({
  data,
  period,
  loading,
  error,
  onRetry,
}: CostBreakdownTableProps) {
  const vm = data ? mapCostBreakdown(data) : null

  const subtitle = vm
    ? `${PERIOD_LABELS[period]} · ${vm.totalCostUsd} total`
    : PERIOD_LABELS[period]

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Cost Breakdown" subtitle={loading ? undefined : subtitle} />

      <div>
        {error ? (
          <div style={{ padding: 16 }}>
            <ErrorState title="Data unavailable" message={error} onRetry={onRetry} compact />
          </div>
        ) : loading ? (
          <LoadingState rows={4} compact />
        ) : !vm?.hasData ? (
          <EmptyState
            title="No cost data"
            description="Cost allocation will appear once requests with token usage complete."
            compact
          />
        ) : (
          <>
            {/* Column headers */}
            <div
              style={{
                display:      'grid',
                gridTemplateColumns: '1fr 80px 80px 60px',
                gap:          8,
                padding:      '8px 16px 6px',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              {['Model', 'Requests', 'Cost', 'Share'].map(h => (
                <span
                  key={h}
                  style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      10,
                    fontWeight:    600,
                    color:         'var(--color-text-muted)',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    textAlign:     h === 'Model' ? 'left' : 'right',
                  }}
                >
                  {h}
                </span>
              ))}
            </div>

            {/* Rows */}
            {vm.entries.map((entry, i) => (
              <CostRow
                key={entry.modelId}
                entry={entry}
                color={BAR_COLORS[i % BAR_COLORS.length]}
                isLast={i === vm.entries.length - 1}
              />
            ))}
          </>
        )}
      </div>
    </Panel>
  )
}

// ─── CostRow ──────────────────────────────────────────────────────────────────

function CostRow({
  entry,
  color,
  isLast,
}: {
  entry:  CostBreakdownEntryViewModel
  color:  string
  isLast: boolean
}) {
  return (
    <div
      style={{
        padding:      '10px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
        display:      'flex',
        flexDirection: 'column',
        gap:           6,
      }}
    >
      {/* Data row */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: '1fr 80px 80px 60px',
          gap:                 8,
          alignItems:          'baseline',
        }}
      >
        {/* Model name */}
        <span
          style={{
            fontFamily:   'var(--font-mono)',
            fontSize:     12,
            color:        'var(--color-text-secondary)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
        >
          {entry.modelName}
        </span>

        {/* Request count */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   11,
            color:      'var(--color-text-muted)',
            textAlign:  'right',
          }}
        >
          {entry.requestCount}
        </span>

        {/* Cost */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   12,
            fontWeight: 600,
            color:      'var(--color-text-primary)',
            textAlign:  'right',
          }}
        >
          {entry.costUsd}
        </span>

        {/* Percentage */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   11,
            color:      'var(--color-text-muted)',
            textAlign:  'right',
          }}
        >
          {entry.percentage.toFixed(1)}%
        </span>
      </div>

      {/* Share bar */}
      <div
        style={{
          height:          3,
          borderRadius:    2,
          backgroundColor: 'var(--color-bg-elevated)',
          overflow:        'hidden',
        }}
      >
        <div
          style={{
            height:          '100%',
            width:           `${entry.percentage.toFixed(1)}%`,
            borderRadius:    2,
            backgroundColor: color,
            opacity:         0.7,
            transition:      'width 0.4s ease',
          }}
        />
      </div>
    </div>
  )
}
