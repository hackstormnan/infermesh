/**
 * components/ui/StaleBadge.tsx
 *
 * Subtle indicator shown when a REST-polled section is displaying
 * last-known-good data after a background refresh failure.
 *
 * Shows an amber dot + "Stale · Xm ago" text. Renders nothing when
 * isStale is false or lastUpdatedAt is null.
 */

interface StaleBadgeProps {
  isStale:       boolean
  lastUpdatedAt: Date | null
}

export function StaleBadge({ isStale, lastUpdatedAt }: StaleBadgeProps) {
  if (!isStale || !lastUpdatedAt) return null

  const secs = Math.floor((Date.now() - lastUpdatedAt.getTime()) / 1_000)
  const label =
    secs < 60  ? `${secs}s ago`              :
    secs < 3600 ? `${Math.floor(secs / 60)}m ago` :
    `${Math.floor(secs / 3600)}h ago`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div
        style={{
          width:           5,
          height:          5,
          borderRadius:    '50%',
          backgroundColor: 'var(--color-amber)',
          opacity:         0.85,
          flexShrink:      0,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   10,
          color:      'var(--color-amber)',
          opacity:    0.85,
          whiteSpace: 'nowrap',
        }}
      >
        Stale · {label}
      </span>
    </div>
  )
}
