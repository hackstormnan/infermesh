/**
 * components/ui/RefreshButton.tsx
 *
 * Shared "Refresh" button used in page headers for REST-polled pages.
 * Shows a spinning icon while loading is true.
 * Relies on the global @keyframes spin defined in index.css.
 */

import { RefreshCw } from 'lucide-react'

interface RefreshButtonProps {
  onClick:   () => void
  loading?:  boolean
}

export function RefreshButton({ onClick, loading = false }: RefreshButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             6,
        padding:         '5px 12px',
        borderRadius:    'var(--radius-md)',
        backgroundColor: 'var(--color-bg-elevated)',
        border:          '1px solid var(--color-border-strong)',
        fontFamily:      'var(--font-mono)',
        fontSize:        11,
        color:           'var(--color-text-muted)',
        cursor:          loading ? 'not-allowed' : 'pointer',
        opacity:         loading ? 0.5 : 1,
      }}
    >
      <RefreshCw
        size={11}
        strokeWidth={2}
        style={loading ? { animation: 'spin 1s linear infinite' } : undefined}
      />
      Refresh
    </button>
  )
}
