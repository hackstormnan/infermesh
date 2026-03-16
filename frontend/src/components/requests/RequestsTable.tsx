/**
 * components/requests/RequestsTable.tsx
 *
 * TableShell wrapper for RequestViewModel rows, plus pagination controls.
 * Handles loading, error, and empty states inline.
 */

import { TableShell, type ColumnDef } from '../ui/TableShell'
import { StatusBadge } from '../ui/StatusBadge'
import { LoadingState } from '../ui/LoadingState'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import type { RequestViewModel } from '../../api/mappers/request.mapper'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: ColumnDef<RequestViewModel>[] = [
  {
    key: 'id',
    header: 'Request ID',
    width: 100,
    render: row => (
      <span style={{ color: 'var(--color-text-muted)', letterSpacing: '0.3px' }}>
        {row.shortId}
      </span>
    ),
  },
  {
    key: 'model',
    header: 'Model',
    width: '25%',
    render: row => (
      <span
        style={{
          color:        'var(--color-text-secondary)',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
          display:      'block',
        }}
      >
        {row.modelId}
      </span>
    ),
  },
  {
    key: 'taskType',
    header: 'Task',
    width: 110,
    render: row => (
      <span style={{ color: 'var(--color-text-muted)' }}>{row.taskType}</span>
    ),
  },
  {
    key: 'tokens',
    header: 'Tokens',
    width: 80,
    align: 'right',
    render: row => (
      <span style={{ color: 'var(--color-text-muted)' }}>
        {formatTokens(row.totalTokens)}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 100,
    render: row => <StatusBadge status={row.status} />,
  },
  {
    key: 'age',
    header: 'Age',
    width: 80,
    align: 'right',
    render: row => (
      <span style={{ color: 'var(--color-text-muted)' }}>{row.age}</span>
    ),
  },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface RequestsTableProps {
  requests:    RequestViewModel[]
  total:       number
  page:        number
  limit:       number
  loading:     boolean
  error:       string | null
  onPageChange: (p: number) => void
  onRetry:     () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RequestsTable({
  requests,
  total,
  page,
  limit,
  loading,
  error,
  onPageChange,
  onRetry,
}: RequestsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1
  const rangeEnd   = Math.min(page * limit, total)

  if (error) {
    return (
      <ErrorState
        title="Failed to load requests"
        message={error}
        onRetry={onRetry}
        compact
      />
    )
  }

  if (loading) {
    return <LoadingState rows={8} compact />
  }

  return (
    <div>
      {/* Table */}
      <TableShell
        columns={COLUMNS}
        rows={requests}
        rowKey={row => row.id}
        compact
        emptyState={
          <EmptyState
            title="No requests found"
            description="Try adjusting your search or filter to find matching requests."
            compact
          />
        }
      />

      {/* Pagination controls */}
      {total > 0 && (
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '10px 16px',
            borderTop:      '1px solid var(--color-border)',
          }}
        >
          {/* Range label */}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   11,
              color:      'var(--color-text-muted)',
            }}
          >
            {rangeStart}–{rangeEnd} of {total.toLocaleString()}
          </span>

          {/* Prev / page indicator / Next */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PaginationButton
              label="← Prev"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            />

            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize:   11,
                color:      'var(--color-text-muted)',
                padding:    '0 4px',
                minWidth:   60,
                textAlign:  'center',
              }}
            >
              {page} / {totalPages}
            </span>

            <PaginationButton
              label="Next →"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PaginationButton ─────────────────────────────────────────────────────────

function PaginationButton({
  label,
  disabled,
  onClick,
}: {
  label:    string
  disabled: boolean
  onClick:  () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        fontFamily:      'var(--font-mono)',
        fontSize:        11,
        color:           disabled ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
        backgroundColor: 'transparent',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-md)',
        padding:         '4px 10px',
        cursor:          disabled ? 'default' : 'pointer',
        opacity:         disabled ? 0.4 : 1,
        transition:      'opacity 0.15s',
      }}
    >
      {label}
    </button>
  )
}
