import type { CSSProperties } from 'react'

// ─── Skeleton block ───────────────────────────────────────────────────────────

interface SkeletonBlockProps {
  width?: number | string
  height?: number | string
  borderRadius?: number | string
  style?: CSSProperties
}

export function SkeletonBlock({ width = '100%', height = 16, borderRadius = 4, style }: SkeletonBlockProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: 'var(--color-bg-elevated)',
        backgroundImage: 'linear-gradient(90deg, var(--color-bg-elevated) 0%, var(--color-border) 50%, var(--color-bg-elevated) 100%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.4s ease-in-out infinite',
        flexShrink: 0,
        ...style,
      }}
    />
  )
}

// ─── Inline CSS for the shimmer animation ─────────────────────────────────────
// Injected once as a style tag. Avoids adding to index.css.
let _injected = false
function injectSkeletonStyles() {
  if (_injected || typeof document === 'undefined') return
  _injected = true
  const style = document.createElement('style')
  style.textContent = `
    @keyframes skeleton-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `
  document.head.appendChild(style)
}
injectSkeletonStyles()

// ─── Panel skeleton (rows of blocks matching a table or list) ─────────────────

interface LoadingStateProps {
  rows?: number
  compact?: boolean
}

export function LoadingState({ rows = 4, compact = false }: LoadingStateProps) {
  return (
    <div
      style={{
        padding: compact ? '8px 16px' : '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 10 : 14,
      }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SkeletonBlock width={8} height={8} borderRadius="50%" style={{ flexShrink: 0 }} />
          <SkeletonBlock width="30%" height={10} />
          <SkeletonBlock width="25%" height={10} />
          <SkeletonBlock width="20%" height={10} style={{ marginLeft: 'auto' }} />
          <SkeletonBlock width={52} height={20} borderRadius={4} />
        </div>
      ))}
    </div>
  )
}
