type BadgeVariant = 'green' | 'amber' | 'blue' | 'red' | 'purple' | 'dim'

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; border: string; color: string }> = {
  green:  { bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.2)',   color: 'var(--color-green)'  },
  amber:  { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  color: 'var(--color-amber)'  },
  blue:   { bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.2)',  color: 'var(--color-blue)'   },
  red:    { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   color: 'var(--color-red)'    },
  purple: { bg: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.2)',  color: 'var(--color-purple)' },
  dim:    { bg: 'rgba(69,72,89,0.12)',    border: 'rgba(69,72,89,0.25)',   color: 'var(--color-text-muted)' },
}

interface BadgeProps {
  label: string
  variant: BadgeVariant
}

export function Badge({ label, variant }: BadgeProps) {
  const s = VARIANT_STYLES[variant]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 7px',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: s.bg,
        border: `1px solid ${s.border}`,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        color: s.color,
        letterSpacing: '0.4px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}
