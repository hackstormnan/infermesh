/**
 * components/metrics/MetricsPeriodSelector.tsx
 *
 * Tab-style time-range selector used at the top of the Metrics page.
 * Changing the period drives all chart and card refetches.
 */

import type { MetricPeriod } from '../../api/types/metrics'

const PERIODS: { label: string; value: MetricPeriod }[] = [
  { label: '1h',  value: '1h'  },
  { label: '24h', value: '24h' },
  { label: '7d',  value: '7d'  },
  { label: '30d', value: '30d' },
]

interface MetricsPeriodSelectorProps {
  period:   MetricPeriod
  onChange: (p: MetricPeriod) => void
}

export function MetricsPeriodSelector({ period, onChange }: MetricsPeriodSelectorProps) {
  return (
    <div
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             4,
        backgroundColor: 'var(--color-bg-elevated)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        padding:         3,
        width:           'fit-content',
      }}
    >
      {PERIODS.map(opt => {
        const active = opt.value === period
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              fontFamily:      'var(--font-mono)',
              fontSize:        12,
              fontWeight:      active ? 600 : 400,
              padding:         '5px 16px',
              borderRadius:    'var(--radius-md)',
              border:          'none',
              backgroundColor: active ? 'var(--color-bg-surface)' : 'transparent',
              color:           active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              cursor:          'pointer',
              transition:      'all 0.15s',
              boxShadow:       active ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
              outline:         'none',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
