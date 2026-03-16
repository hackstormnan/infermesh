interface ProgressBarProps {
  /** 0–1 fraction */
  value: number
  height?: number
  /** Auto-colors red ≥0.9, amber ≥0.6, blue otherwise */
  autoColor?: boolean
  color?: string
  showLabel?: boolean
}

export function ProgressBar({
  value,
  height = 3,
  autoColor = true,
  color,
  showLabel = false,
}: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value))
  const pct = Math.round(clamped * 100)

  const resolvedColor = color ?? (
    autoColor
      ? clamped >= 0.9 ? 'var(--color-red)'
        : clamped >= 0.6 ? 'var(--color-amber)'
        : 'var(--color-blue)'
      : 'var(--color-blue)'
  )

  return (
    <div>
      {showLabel && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 3,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: resolvedColor,
          }}
        >
          {pct}%
        </div>
      )}
      <div
        style={{
          height,
          borderRadius: height,
          backgroundColor: 'var(--color-bg-elevated)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: height,
            backgroundColor: resolvedColor,
            transition: 'width 0.35s ease, background-color 0.2s',
          }}
        />
      </div>
    </div>
  )
}
