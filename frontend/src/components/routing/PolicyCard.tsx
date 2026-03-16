/**
 * components/routing/PolicyCard.tsx
 *
 * Selectable card for a routing policy (rule) on the Routing page.
 *
 * Shows: priority · name · status · strategy · constraints · fallback · weights
 * Selected state: highlighted border + subtle left accent bar.
 */

import { StatusBadge } from '../ui/StatusBadge'
import { STRATEGY_LABEL, type RoutingPolicyViewModel } from '../../api/mappers/routing.mapper'
import type { RoutingStrategy } from '../../api/types/routing'

// ─── Strategy chip ────────────────────────────────────────────────────────────

const STRATEGY_COLOR: Record<RoutingStrategy, string> = {
  round_robin:       'var(--color-blue)',
  least_loaded:      'var(--color-green)',
  cost_optimised:    'var(--color-amber)',
  latency_optimised: 'var(--color-purple)',
  affinity:          'var(--color-blue)',
  canary:            'var(--color-red)',
}

function StrategyChip({ strategy }: { strategy: RoutingStrategy }) {
  const color = STRATEGY_COLOR[strategy] ?? 'var(--color-text-muted)'
  return (
    <span
      style={{
        display:         'inline-flex',
        alignItems:      'center',
        padding:         '2px 7px',
        borderRadius:    'var(--radius-sm)',
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
        border:          `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        fontFamily:      'var(--font-mono)',
        fontSize:        10,
        fontWeight:      600,
        color,
        letterSpacing:   '0.3px',
        whiteSpace:      'nowrap',
      }}
    >
      {STRATEGY_LABEL[strategy] ?? strategy}
    </span>
  )
}

// ─── Weight bar ───────────────────────────────────────────────────────────────

function WeightBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      9,
            color:         'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   9,
            color:      'var(--color-text-secondary)',
          }}
        >
          {pct}%
        </span>
      </div>
      <div
        style={{
          height:          3,
          borderRadius:    2,
          backgroundColor: 'var(--color-bg-elevated)',
          overflow:        'hidden',
        }}
      >
        <div
          style={{
            height:          '100%',
            width:           `${pct}%`,
            borderRadius:    2,
            backgroundColor: 'var(--color-blue)',
            opacity:         0.7,
          }}
        />
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PolicyCardProps {
  policy:   RoutingPolicyViewModel
  selected: boolean
  onClick:  () => void
  /** Flash pulse for live stream activity matching this strategy */
  pulsing?: boolean
}

export function PolicyCard({ policy, selected, onClick, pulsing }: PolicyCardProps) {
  const isInactive = policy.status !== 'active'

  return (
    <div
      onClick={onClick}
      style={{
        position:        'relative',
        backgroundColor: selected
          ? 'rgba(59,130,246,0.06)'
          : 'var(--color-bg-surface)',
        border:          selected
          ? '1px solid rgba(59,130,246,0.40)'
          : '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        overflow:        'hidden',
        cursor:          'pointer',
        opacity:         isInactive ? 0.55 : 1,
        transition:      'border-color 0.15s ease, background-color 0.15s ease',
        outline:         pulsing ? '1px solid rgba(59,130,246,0.5)' : undefined,
      }}
    >
      {/* Selected accent bar */}
      {selected && (
        <div
          style={{
            position:        'absolute',
            left:            0,
            top:             0,
            bottom:          0,
            width:           3,
            backgroundColor: 'var(--color-blue)',
          }}
        />
      )}

      {/* Live activity pulse ring */}
      {pulsing && (
        <div
          style={{
            position:     'absolute',
            top:          10,
            right:        10,
            width:        6,
            height:       6,
            borderRadius: '50%',
            backgroundColor: 'var(--color-green)',
            boxShadow:    '0 0 6px var(--color-green)',
            animation:    'pulse 1.5s ease-in-out infinite',
          }}
        />
      )}

      {/* ── Header ── */}
      <div
        style={{
          padding:      selected ? '10px 14px 8px 18px' : '10px 14px 8px',
          borderBottom: '1px solid var(--color-border)',
          display:      'flex',
          flexDirection:'column',
          gap:          6,
        }}
      >
        {/* Priority + name + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily:      'var(--font-mono)',
              fontSize:        10,
              fontWeight:      700,
              color:           'var(--color-text-muted)',
              backgroundColor: 'var(--color-bg-elevated)',
              border:          '1px solid var(--color-border)',
              borderRadius:    3,
              padding:         '1px 5px',
              flexShrink:      0,
            }}
          >
            P{policy.priority}
          </span>
          <span
            style={{
              fontFamily:   'var(--font-display)',
              fontSize:     13,
              fontWeight:   600,
              color:        'var(--color-text-primary)',
              flex:         1,
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
            }}
          >
            {policy.name}
          </span>
          <StatusBadge status={policy.status} />
        </div>

        {/* Strategy + fallback */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StrategyChip strategy={policy.strategy} />
          {policy.fallbackStrategy && (
            <>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   9,
                  color:      'var(--color-text-muted)',
                }}
              >
                fallback →
              </span>
              <StrategyChip strategy={policy.fallbackStrategy} />
            </>
          )}
        </div>
      </div>

      {/* ── Constraints ── */}
      {policy.hasConstraints && (
        <div
          style={{
            padding:      '7px 14px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   10,
              color:      'var(--color-text-muted)',
              lineHeight: 1.4,
            }}
          >
            {policy.constraintSummary}
          </span>
        </div>
      )}

      {/* ── Weights ── */}
      <div
        style={{
          padding: '8px 14px 10px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
        }}
      >
        <WeightBar label="Quality" value={policy.weights.quality} />
        <WeightBar label="Cost"    value={policy.weights.cost}    />
        <WeightBar label="Latency" value={policy.weights.latency} />
        <WeightBar label="Load"    value={policy.weights.load}    />
      </div>

      {/* ── Footer: version ── */}
      <div
        style={{
          padding:   '4px 14px 8px',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   9,
            color:      'var(--color-text-muted)',
          }}
        >
          v{policy.version} · {policy.shortId}
        </span>
        {policy.description && (
          <span
            style={{
              fontFamily:   'var(--font-mono)',
              fontSize:     9,
              color:        'var(--color-text-muted)',
              marginLeft:   10,
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
            }}
          >
            {policy.description}
          </span>
        )}
      </div>
    </div>
  )
}
