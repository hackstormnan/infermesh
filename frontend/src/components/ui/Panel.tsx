import type { ReactNode, CSSProperties } from 'react'

interface PanelProps {
  children: ReactNode
  style?: CSSProperties
}

export function Panel({ children, style }: PanelProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

interface PanelHeaderProps {
  title: string
  subtitle?: string
  right?: ReactNode
}

export function PanelHeader({ title, subtitle, right }: PanelHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '0.2px',
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            style={{
              marginLeft: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-muted)',
            }}
          >
            {subtitle}
          </span>
        )}
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>}
    </div>
  )
}
