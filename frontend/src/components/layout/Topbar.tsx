import { Search, Bell } from 'lucide-react'
import { useLocation } from 'react-router-dom'

const PAGE_LABELS: Record<string, string> = {
  '/overview':   'OVERVIEW',
  '/requests':   'REQUESTS',
  '/workers':    'WORKERS',
  '/models':     'MODELS',
  '/routing':    'ROUTING',
  '/metrics':    'METRICS',
  '/simulation': 'SIMULATION',
}

export function Topbar() {
  const { pathname } = useLocation()
  const pageLabel = PAGE_LABELS[pathname] ?? 'OVERVIEW'

  return (
    <header
      style={{
        height: 52,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        backgroundColor: 'var(--color-bg-base)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* ── Left: page section label ── */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          letterSpacing: '1px',
        }}
      >
        // {pageLabel}
      </span>

      {/* ── Right: status + env badge + search + bell ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* Connection status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'var(--color-green)',
              boxShadow: '0 0 5px rgba(34,197,94,0.6)',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 500,
              color: 'var(--color-green)',
            }}
          >
            Connected
          </span>
        </div>

        {/* Environment badge */}
        <div
          style={{
            padding: '3px 7px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(245,158,11,0.07)',
            border: '1px solid rgba(245,158,11,0.22)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--color-amber)',
              letterSpacing: '0.6px',
            }}
          >
            PRODUCTION
          </span>
        </div>

        {/* Search placeholder */}
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          <Search size={12} strokeWidth={1.5} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            Search...
          </span>
          <span
            style={{
              marginLeft: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'rgba(69,72,89,0.55)',
            }}
          >
            ⌘K
          </span>
        </button>

        {/* Notifications */}
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          <Bell size={14} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  )
}
