/**
 * components/requests/RequestsFilterBar.tsx
 *
 * Search input, status dropdown, result count, and Export button shell.
 * Designed to sit inside the Panel above the requests table.
 */

import type { RequestStatusFilter } from '../../hooks/useRequestsPage'

// ─── Status options ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: { label: string; value: RequestStatusFilter }[] = [
  { label: 'All statuses',  value: 'all' },
  { label: 'Queued',        value: 'queued' },
  { label: 'Dispatched',    value: 'dispatched' },
  { label: 'Streaming',     value: 'streaming' },
  { label: 'Completed',     value: 'completed' },
  { label: 'Failed',        value: 'failed' },
  { label: 'Cancelled',     value: 'cancelled' },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface RequestsFilterBarProps {
  search:         string
  statusFilter:   RequestStatusFilter
  total:          number
  loading:        boolean
  onSearchChange: (v: string) => void
  onStatusChange: (v: RequestStatusFilter) => void
  onExport:       () => void
}

// ─── Shared input styles ──────────────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
  fontFamily:      'var(--font-mono)',
  fontSize:        12,
  color:           'var(--color-text-secondary)',
  backgroundColor: 'var(--color-bg-elevated)',
  border:          '1px solid var(--color-border)',
  borderRadius:    'var(--radius-md)',
  padding:         '6px 10px',
  outline:         'none',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RequestsFilterBar({
  search,
  statusFilter,
  total,
  loading,
  onSearchChange,
  onStatusChange,
  onExport,
}: RequestsFilterBarProps) {
  return (
    <div
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        padding:      '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        flexWrap:     'wrap',
      }}
    >
      {/* Search by request ID */}
      <input
        type="text"
        placeholder="Search by request ID…"
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        style={{ ...INPUT_BASE, width: 220 }}
      />

      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={e => onStatusChange(e.target.value as RequestStatusFilter)}
        style={{ ...INPUT_BASE, cursor: 'pointer', minWidth: 140 }}
      >
        {STATUS_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Result count */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   11,
          color:      'var(--color-text-muted)',
          flex:       1,
          minWidth:   80,
        }}
      >
        {loading ? 'Loading…' : `${total.toLocaleString()} result${total !== 1 ? 's' : ''}`}
      </span>

      {/* Export button (shell — backend endpoint not yet implemented) */}
      <button
        onClick={onExport}
        title="Export not yet available"
        style={{
          fontFamily:      'var(--font-mono)',
          fontSize:        11,
          color:           'var(--color-text-muted)',
          backgroundColor: 'transparent',
          border:          '1px solid var(--color-border)',
          borderRadius:    'var(--radius-md)',
          padding:         '5px 10px',
          cursor:          'not-allowed',
          opacity:         0.5,
          display:         'flex',
          alignItems:      'center',
          gap:             5,
          flexShrink:      0,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>↓</span>
        Export
      </button>
    </div>
  )
}
