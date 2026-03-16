import type { ConnectionState } from '../../hooks/useStreamSocket'

interface ConnectionStatusBadgeProps {
  state?: ConnectionState
}

const STATE_CONFIG: Record<ConnectionState, { label: string; color: string; pulse: boolean }> = {
  connected:    { label: 'Connected',     color: 'var(--color-green)',      pulse: true  },
  connecting:   { label: 'Connecting…',   color: 'var(--color-amber)',      pulse: true  },
  reconnecting: { label: 'Reconnecting…', color: 'var(--color-amber)',      pulse: true  },
  disconnected: { label: 'Disconnected',  color: 'var(--color-text-muted)', pulse: false },
  error:        { label: 'Error',         color: 'var(--color-red)',        pulse: false },
}

export function ConnectionStatusBadge({ state = 'connected' }: ConnectionStatusBadgeProps) {
  const cfg = STATE_CONFIG[state]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width:           6,
          height:          6,
          borderRadius:    '50%',
          backgroundColor: cfg.color,
          flexShrink:      0,
          boxShadow:       cfg.pulse ? `0 0 5px ${cfg.color}` : 'none',
          animation:       cfg.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   11,
          fontWeight: 500,
          color:      cfg.color,
        }}
      >
        {cfg.label}
      </span>
    </div>
  )
}
