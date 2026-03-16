import type { ReactNode } from 'react'

interface SectionHeaderProps {
  title: string
  right?: ReactNode
  /** Adds a bottom border rule */
  divider?: boolean
}

export function SectionHeader({ title, right, divider = false }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: divider ? 10 : 0,
        marginBottom: divider ? 14 : 10,
        borderBottom: divider ? '1px solid var(--color-border)' : 'none',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.9px',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </span>
      {right && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {right}
        </div>
      )}
    </div>
  )
}
