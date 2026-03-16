import type { LucideIcon } from 'lucide-react'

interface StubPageProps {
  title: string
  description: string
  icon: LucideIcon
}

export function StubPage({ title, description, icon: Icon }: StubPageProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
        padding: 40,
        color: 'var(--color-text-muted)',
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: 'var(--color-text-muted)',
            maxWidth: 320,
            lineHeight: 1.6,
          }}
        >
          {description}
        </div>
      </div>
    </div>
  )
}
