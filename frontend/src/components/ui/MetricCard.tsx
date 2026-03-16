import type { ReactNode } from 'react'

interface MetricCardProps {
  label: string
  value: string | number
  /** Small text rendered below the value */
  sub?: string
  /** Colour accent for the value text — defaults to primary */
  valueColor?: string
  /** Optional icon rendered to the left of the value */
  icon?: ReactNode
  /** Click handler — gives the card a pointer cursor */
  onClick?: () => void
}

export function MetricCard({ label, value, sub, valueColor, icon, onClick }: MetricCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.7px',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && (
          <span style={{ color: valueColor ?? 'var(--color-text-primary)', flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            fontWeight: 700,
            color: valueColor ?? 'var(--color-text-primary)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
      </div>

      {sub && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-text-muted)',
          }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}
