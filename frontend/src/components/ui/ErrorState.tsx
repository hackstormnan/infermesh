import { AlertTriangle } from 'lucide-react'

interface ErrorStateProps {
  title?: string
  message: string
  code?: string
  onRetry?: () => void
  compact?: boolean
}

export function ErrorState({
  title = 'Failed to load',
  message,
  code,
  onRetry,
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? '20px 16px' : '40px 24px',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: compact ? 32 : 40,
          height: compact ? 32 : 40,
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-red)',
        }}
      >
        <AlertTriangle size={compact ? 16 : 18} strokeWidth={1.5} />
      </div>

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
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            maxWidth: 280,
            lineHeight: 1.55,
          }}
        >
          {message}
        </span>
        {code && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'rgba(239,68,68,0.55)',
              marginTop: 2,
            }}
          >
            {code}
          </span>
        )}
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 4,
            padding: '5px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-strong)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  )
}
