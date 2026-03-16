import type { ReactNode, CSSProperties } from 'react'

// ─── Column definition ────────────────────────────────────────────────────────

export interface ColumnDef<T> {
  key: string
  header: string
  width?: number | string
  align?: 'left' | 'right' | 'center'
  render: (row: T, index: number) => ReactNode
}

// ─── TableShell ───────────────────────────────────────────────────────────────

interface TableShellProps<T> {
  columns: ColumnDef<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  onRowClick?: (row: T) => void
  emptyState?: ReactNode
  /** Compact mode reduces row padding */
  compact?: boolean
}

const HEADER_CELL: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  padding: '8px 12px',
  textAlign: 'left',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}

export function TableShell<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  compact = false,
}: TableShellProps<T>) {
  const rowPad = compact ? '7px 12px' : '10px 12px'

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{
                  ...HEADER_CELL,
                  width: col.width,
                  textAlign: col.align ?? 'left',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyState ? (
            <tr>
              <td colSpan={columns.length}>{emptyState}</td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  borderBottom: i < rows.length - 1 ? '1px solid var(--color-border)' : 'none',
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={e => {
                  if (onRowClick) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(59,130,246,0.03)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                }}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    style={{
                      padding: rowPad,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      textAlign: col.align ?? 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
