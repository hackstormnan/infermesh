/**
 * StatusBadge — domain-aware status badge.
 *
 * Accepts string values from any backend status enum and maps them
 * to the correct visual variant automatically.
 */

type BadgeVariant = 'green' | 'amber' | 'blue' | 'red' | 'purple' | 'dim'

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; border: string; color: string }> = {
  green:  { bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.22)',   color: 'var(--color-green)'  },
  amber:  { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.22)',  color: 'var(--color-amber)'  },
  blue:   { bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.22)',  color: 'var(--color-blue)'   },
  red:    { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.22)',   color: 'var(--color-red)'    },
  purple: { bg: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.22)',  color: 'var(--color-purple)' },
  dim:    { bg: 'rgba(69,72,89,0.10)',    border: 'rgba(69,72,89,0.22)',    color: 'var(--color-text-muted)' },
}

// ─── Domain-to-variant maps ───────────────────────────────────────────────────

const REQUEST_STATUS: Record<string, BadgeVariant> = {
  queued:     'amber',
  dispatched: 'blue',
  streaming:  'purple',
  completed:  'green',
  failed:     'red',
  cancelled:  'dim',
}

const WORKER_STATUS: Record<string, BadgeVariant> = {
  idle:      'green',
  busy:      'blue',
  draining:  'amber',
  unhealthy: 'red',
  offline:   'dim',
}

const ROUTING_OUTCOME: Record<string, BadgeVariant> = {
  routed:               'green',
  no_workers_available: 'red',
  constraints_not_met:  'amber',
  model_unavailable:    'red',
}

const POLICY_STATUS: Record<string, BadgeVariant> = {
  active:   'green',
  inactive: 'dim',
  archived: 'dim',
}

const SIMULATION_STATUS: Record<string, BadgeVariant> = {
  pending:   'amber',
  running:   'blue',
  completed: 'green',
  cancelled: 'dim',
  failed:    'red',
}

function resolveVariant(status: string): BadgeVariant {
  return (
    REQUEST_STATUS[status]    ??
    WORKER_STATUS[status]     ??
    ROUTING_OUTCOME[status]   ??
    POLICY_STATUS[status]     ??
    SIMULATION_STATUS[status] ??
    'dim'
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  /** Backend status string — automatically resolved to the correct variant */
  status: string
  /** Override the display label (defaults to the status string) */
  label?: string
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const variant = resolveVariant(status)
  const s = VARIANT_STYLES[variant]
  const display = label ?? status.replace(/_/g, ' ').toUpperCase()

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
      {display}
    </span>
  )
}
