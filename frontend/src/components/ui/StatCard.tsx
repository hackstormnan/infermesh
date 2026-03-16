import type { StatCardData } from '../../types'

interface StatCardProps {
  data: StatCardData
}

export function StatCard({ data }: StatCardProps) {
  const { label, value, delta, deltaPositive, deltaIsPolicy } = data

  const deltaColor = deltaIsPolicy
    ? 'var(--color-blue)'
    : deltaPositive
      ? 'var(--color-green)'
      : 'var(--color-red)'

  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '18px 20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>

      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 700,
          color: 'var(--color-text-primary)',
          lineHeight: 1,
        }}
      >
        {value}
      </span>

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: deltaColor,
        }}
      >
        {delta}
      </span>
    </div>
  )
}
