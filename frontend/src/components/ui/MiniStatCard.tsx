/**
 * components/ui/MiniStatCard.tsx
 *
 * Compact stat card used in page-level summary rows (Workers, Models, Routing).
 * Shows a label (uppercase mono) and a large value, with optional accent colour
 * and skeleton loading state.
 *
 * Distinct from StatCard (ui/StatCard.tsx) which is the larger overview card
 * with delta/trend rows.
 */

import { SkeletonBlock } from './LoadingState'

interface MiniStatCardProps {
  label:    string
  value:    string
  accent?:  string
  loading:  boolean
}

export function MiniStatCard({ label, value, accent, loading }: MiniStatCardProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        padding:         '14px 18px',
        display:         'flex',
        flexDirection:   'column',
        gap:             6,
      }}
    >
      <span
        style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      10,
          fontWeight:    600,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
          color:         'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
      {loading ? (
        <SkeletonBlock width={52} height={24} />
      ) : (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize:   24,
            fontWeight: 700,
            color:      accent ?? 'var(--color-text-primary)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
      )}
    </div>
  )
}
