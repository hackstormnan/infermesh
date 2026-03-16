import type { ReactNode } from 'react'
import { TrendBadge } from './TrendBadge'

interface ChartContainerProps {
  title: string
  subtitle?: string
  /** Primary value displayed prominently above the chart */
  value?: string | number
  /** Trend indicator from a backend TrendIndicator or StatChange */
  trend?: {
    formatted: string
    direction: 'up' | 'down' | 'flat' | 'neutral'
    invertColors?: boolean
  }
  height?: number
  children: ReactNode
}

export function ChartContainer({
  title,
  subtitle,
  value,
  trend,
  height = 80,
  children,
}: ChartContainerProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px 8px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              style={{
                marginLeft: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-muted)',
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
        {trend && (
          <TrendBadge
            formatted={trend.formatted}
            direction={trend.direction}
            invertColors={trend.invertColors}
          />
        )}
      </div>

      {/* Value + chart */}
      <div style={{ padding: '10px 16px 14px' }}>
        {value !== undefined && (
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 10,
              lineHeight: 1,
            }}
          >
            {value}
          </div>
        )}
        <div style={{ height }}>{children}</div>
      </div>
    </div>
  )
}
