/**
 * TrendBadge — displays a delta change with directional color.
 *
 * Accepts a TrendIndicator or StatChange from the backend
 * or a simple formatted string + direction.
 */

type Direction = 'up' | 'down' | 'flat' | 'neutral'

interface TrendBadgeProps {
  /** Formatted string, e.g. "+12%", "-15ms", "+$0.002" */
  formatted: string
  direction: Direction
  /**
   * When true, "up" is bad (e.g. error rate, latency).
   * Inverts the color mapping so higher = red.
   */
  invertColors?: boolean
}

export function TrendBadge({ formatted, direction, invertColors = false }: TrendBadgeProps) {
  let color: string

  if (direction === 'flat' || direction === 'neutral') {
    color = 'var(--color-text-muted)'
  } else if (direction === 'up') {
    color = invertColors ? 'var(--color-red)' : 'var(--color-green)'
  } else {
    color = invertColors ? 'var(--color-green)' : 'var(--color-red)'
  }

  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '—'

  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 500,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {arrow} {formatted}
    </span>
  )
}
