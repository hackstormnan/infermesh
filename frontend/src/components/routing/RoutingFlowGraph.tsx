/**
 * components/routing/RoutingFlowGraph.tsx
 *
 * Routing topology visualization for the Routing page.
 *
 * Renders active policies as flow nodes, grouped by strategy, with
 * connecting arrows illustrating the priority-ordered routing path.
 *
 * Live routing events (via the "routing" WebSocket channel) highlight
 * the matching strategy row with a pulse indicator.
 *
 * No external graph library — built with CSS flexbox + inline SVG dividers.
 */

import type { RoutingPolicyViewModel } from '../../api/mappers/routing.mapper'
import type { RoutingStrategy } from '../../api/types/routing'

// ─── Strategy colour map ──────────────────────────────────────────────────────

const STRATEGY_COLOR: Record<RoutingStrategy, string> = {
  round_robin:       'var(--color-blue)',
  least_loaded:      'var(--color-green)',
  cost_optimised:    'var(--color-amber)',
  latency_optimised: 'var(--color-purple)',
  affinity:          'var(--color-blue)',
  canary:            'var(--color-red)',
}

const STRATEGY_DESC: Record<RoutingStrategy, string> = {
  round_robin:       'Rotates evenly across eligible workers',
  least_loaded:      'Selects the worker with lowest utilisation',
  cost_optimised:    'Minimises token spend per request',
  latency_optimised: 'Minimises time-to-first-token',
  affinity:          'Sticks to workers matching label selectors',
  canary:            'Splits traffic by configured weights',
}

// ─── Flow row ─────────────────────────────────────────────────────────────────

interface FlowRowProps {
  policy:  RoutingPolicyViewModel
  /** True when this strategy recently appeared in the live "routing" stream */
  active:  boolean
}

function FlowRow({ policy, active }: FlowRowProps) {
  const color = STRATEGY_COLOR[policy.strategy] ?? 'var(--color-text-muted)'

  return (
    <div
      style={{
        display:     'flex',
        alignItems:  'center',
        gap:         0,
        padding:     '8px 16px',
        borderBottom:'1px solid var(--color-border)',
        opacity:     policy.status === 'active' ? 1 : 0.45,
        transition:  'background-color 0.3s ease',
        backgroundColor: active ? 'rgba(59,130,246,0.05)' : 'transparent',
      }}
    >
      {/* Priority badge */}
      <div
        style={{
          width:           24,
          height:          24,
          borderRadius:    '50%',
          backgroundColor: active ? color : 'var(--color-bg-elevated)',
          border:          `1px solid ${active ? color : 'var(--color-border)'}`,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          flexShrink:      0,
          transition:      'background-color 0.3s ease, border-color 0.3s ease',
          boxShadow:       active ? `0 0 8px color-mix(in srgb, ${color} 40%, transparent)` : 'none',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   9,
            fontWeight: 700,
            color:      active ? 'var(--color-bg-base)' : 'var(--color-text-muted)',
          }}
        >
          {policy.priority}
        </span>
      </div>

      {/* Connector line */}
      <div
        style={{
          width:           28,
          height:          1,
          backgroundColor: 'var(--color-border)',
          flexShrink:      0,
        }}
      />

      {/* Policy node */}
      <div
        style={{
          flex:            1,
          minWidth:        0,
          backgroundColor: 'var(--color-bg-elevated)',
          border:          `1px solid ${active ? color : 'var(--color-border)'}`,
          borderRadius:    'var(--radius-md)',
          padding:         '5px 10px',
          transition:      'border-color 0.3s ease',
        }}
      >
        <div
          style={{
            fontFamily:   'var(--font-display)',
            fontSize:     12,
            fontWeight:   600,
            color:        'var(--color-text-primary)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
        >
          {policy.name}
        </div>
        {policy.hasConstraints && (
          <div
            style={{
              fontFamily:   'var(--font-mono)',
              fontSize:     9,
              color:        'var(--color-text-muted)',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
              marginTop:    2,
            }}
          >
            {policy.constraintSummary}
          </div>
        )}
      </div>

      {/* Arrow */}
      <div
        style={{
          width:           28,
          height:          1,
          backgroundColor: 'var(--color-border)',
          flexShrink:      0,
          position:        'relative',
        }}
      >
        <div
          style={{
            position:    'absolute',
            right:       -4,
            top:         -3,
            width:       0,
            height:      0,
            borderTop:   '4px solid transparent',
            borderBottom:'4px solid transparent',
            borderLeft:  `6px solid var(--color-border)`,
          }}
        />
      </div>

      {/* Strategy node */}
      <div
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
          border:          `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
          borderRadius:    'var(--radius-md)',
          padding:         '5px 10px',
          flexShrink:      0,
          minWidth:        120,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   10,
            fontWeight: 600,
            color,
            whiteSpace: 'nowrap',
          }}
        >
          {policy.strategyLabel}
        </div>
        <div
          style={{
            fontFamily:   'var(--font-mono)',
            fontSize:     9,
            color:        'var(--color-text-muted)',
            marginTop:    2,
            whiteSpace:   'nowrap',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            maxWidth:     130,
          }}
        >
          {STRATEGY_DESC[policy.strategy]}
        </div>
      </div>

      {/* Fallback chain */}
      {policy.fallbackStrategy && (
        <>
          <div
            style={{
              width:           20,
              height:          1,
              backgroundColor: 'var(--color-border)',
              flexShrink:      0,
              position:        'relative',
              marginLeft:      4,
            }}
          >
            <div
              style={{
                position:    'absolute',
                right:       -4,
                top:         -3,
                width:       0,
                height:      0,
                borderTop:   '4px solid transparent',
                borderBottom:'4px solid transparent',
                borderLeft:  '6px solid var(--color-border)',
              }}
            />
          </div>
          <div
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              border:          '1px solid var(--color-border)',
              borderRadius:    'var(--radius-md)',
              padding:         '3px 8px',
              flexShrink:      0,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize:   9,
                color:      'var(--color-text-muted)',
              }}
            >
              ↳ {policy.fallbackStrategyLabel}
            </span>
          </div>
        </>
      )}

      {/* Live indicator */}
      {active && (
        <div
          style={{
            marginLeft:      8,
            width:           6,
            height:          6,
            borderRadius:    '50%',
            backgroundColor: 'var(--color-green)',
            boxShadow:       '0 0 6px var(--color-green)',
            flexShrink:      0,
            animation:       'pulse 1.5s ease-in-out infinite',
          }}
        />
      )}
    </div>
  )
}

// ─── Empty graph ──────────────────────────────────────────────────────────────

function EmptyGraph() {
  return (
    <div
      style={{
        padding:        '32px 16px',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        gap:            8,
        color:          'var(--color-text-muted)',
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.4 }}
      >
        <circle cx="5"  cy="6" r="2" />
        <circle cx="19" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <line x1="7"  y1="6"  x2="17" y2="6"  />
        <line x1="6"  y1="8"  x2="11" y2="16" />
        <line x1="18" y1="8"  x2="13" y2="16" />
      </svg>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        No active policies
      </span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RoutingFlowGraphProps {
  policies:          RoutingPolicyViewModel[]
  /** Set of strategy strings seen in recent live stream events */
  activeStrategies:  Set<string>
}

export function RoutingFlowGraph({ policies, activeStrategies }: RoutingFlowGraphProps) {
  // Show active policies first, then inactive — all sorted by priority within each group
  const active   = policies.filter(p => p.status === 'active')
  const inactive = policies.filter(p => p.status !== 'active')
  const ordered  = [...active, ...inactive]

  return (
    <div>
      {ordered.length === 0 ? (
        <EmptyGraph />
      ) : (
        ordered.map(policy => (
          <FlowRow
            key={policy.id}
            policy={policy}
            active={activeStrategies.has(policy.strategy)}
          />
        ))
      )}
    </div>
  )
}
