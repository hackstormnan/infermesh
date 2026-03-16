import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? '24px 16px' : '48px 24px',
        gap: compact ? 10 : 14,
        textAlign: 'center',
      }}
    >
      {Icon && (
        <div
          style={{
            width: compact ? 36 : 44,
            height: compact ? 36 : 44,
            borderRadius: 'var(--radius-lg)',
            backgroundColor: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted)',
          }}
        >
          <Icon size={compact ? 16 : 20} strokeWidth={1.5} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: compact ? 13 : 14,
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
          }}
        >
          {title}
        </span>
        {description && (
          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--color-text-muted)',
              maxWidth: 260,
              lineHeight: 1.55,
            }}
          >
            {description}
          </span>
        )}
      </div>
      {action}
    </div>
  )
}
