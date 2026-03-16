/**
 * pages/Routing.tsx
 *
 * The routing control plane — the heart of InferMesh's intelligent dispatch.
 *
 * Data sources:
 *   - REST poll (30 s)   GET /api/v1/routing/policies  via useRoutingPage
 *   - REST poll (30 s)   GET /api/v1/routing/decisions via useRoutingPage
 *   - WebSocket stream   "routing" channel             via useDecisionStream
 *
 * Layout:
 *   - Page header + refresh button + WebSocket connection badge
 *   - 4 summary cards (Active Policies / Total Policies / Success Rate / Avg Decision Time)
 *   - Two-column body:
 *       Left  (55 %): scrollable policy list — click to select
 *       Right (45 %): routing topology graph + selected policy detail
 *   - Live decision feed (bottom full-width panel)
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { GitBranch, RefreshCw } from 'lucide-react'
import { useRoutingPage } from '../hooks/useRoutingPage'
import { useDecisionStream } from '../hooks/useDecisionStream'
import { PolicyCard } from '../components/routing/PolicyCard'
import { RoutingFlowGraph } from '../components/routing/RoutingFlowGraph'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { SkeletonBlock } from '../components/ui/LoadingState'
import { StatusBadge } from '../components/ui/StatusBadge'
import { ConnectionStatusBadge } from '../components/ui/ConnectionStatusBadge'
import { useStreamSocket } from '../hooks/useStreamSocket'
import type { RoutingPolicyViewModel } from '../api/mappers/routing.mapper'
import type { InferMeshStreamEvent, RoutingOutcomeSummaryPayload } from '../api/types/stream'

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
  loading,
}: {
  label:   string
  value:   string
  accent?: string
  loading: boolean
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        padding:         '14px 18px',
        display:         'flex',
        flexDirection:   'column',
        gap:             6,
      }}
    >
      <span
        style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      10,
          fontWeight:    600,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
          color:         'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
      {loading ? (
        <SkeletonBlock width={52} height={24} />
      ) : (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize:   24,
            fontWeight: 700,
            color:      accent ?? 'var(--color-text-primary)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
      )}
    </div>
  )
}

// ─── Policy list skeleton ─────────────────────────────────────────────────────

function PolicySkeleton() {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        padding:         '12px 14px',
        display:         'flex',
        flexDirection:   'column',
        gap:             8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SkeletonBlock width={24} height={24} borderRadius="50%" />
        <SkeletonBlock width="55%" height={13} />
        <SkeletonBlock width={52} height={20} style={{ marginLeft: 'auto' }} />
      </div>
      <SkeletonBlock width="40%" height={20} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} width="100%" height={18} />)}
      </div>
    </div>
  )
}

// ─── Selected policy detail panel ─────────────────────────────────────────────

function PolicyDetail({ policy }: { policy: RoutingPolicyViewModel }) {
  const { constraints, weights } = policy

  const constraintRows = [
    constraints.region       ? { label: 'Region',       value: constraints.region }       : null,
    constraints.maxCostUsd   != null ? { label: 'Max cost',   value: `$${constraints.maxCostUsd} USD` } : null,
    constraints.maxLatencyMs != null ? { label: 'Max latency', value: `${constraints.maxLatencyMs}ms` } : null,
  ].filter((r): r is { label: string; value: string } => r !== null)

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Strategy + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusBadge status={policy.strategy} label={policy.strategyLabel} />
        <StatusBadge status={policy.status} />
        {policy.allowFallback && policy.fallbackStrategy && (
          <StatusBadge status={policy.fallbackStrategy} label={`↳ ${policy.fallbackStrategyLabel}`} />
        )}
      </div>

      {/* Description */}
      {policy.description && (
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize:   12,
            color:      'var(--color-text-secondary)',
            lineHeight: 1.5,
            margin:     0,
          }}
        >
          {policy.description}
        </p>
      )}

      {/* Constraints */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      10,
            fontWeight:    600,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color:         'var(--color-text-muted)',
          }}
        >
          Constraints
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {constraintRows.map(row => (
            <div
              key={row.label}
              style={{
                display:        'flex',
                justifyContent: 'space-between',
                gap:            8,
                padding:        '5px 0',
                borderBottom:   '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
                {row.label}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {row.value}
              </span>
            </div>
          ))}
          {constraints.requiredCapabilities?.length ? (
            <div
              style={{
                display:        'flex',
                justifyContent: 'space-between',
                gap:            8,
                padding:        '5px 0',
                borderBottom:   '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
                Capabilities
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {constraints.requiredCapabilities.join(', ')}
              </span>
            </div>
          ) : null}
          {!policy.hasConstraints && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
              No constraints — all workers eligible
            </span>
          )}
        </div>
      </div>

      {/* Weights */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      10,
            fontWeight:    600,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color:         'var(--color-text-muted)',
          }}
        >
          Score Weights
        </span>
        {(['quality', 'cost', 'latency', 'load'] as const).map(key => {
          const pct = Math.round(weights[key] * 100)
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  fontFamily:    'var(--font-mono)',
                  fontSize:      10,
                  color:         'var(--color-text-muted)',
                  textTransform: 'capitalize',
                  minWidth:      52,
                }}
              >
                {key}
              </span>
              <div
                style={{
                  flex:            1,
                  height:          4,
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
                    opacity:         0.8,
                  }}
                />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-secondary)', minWidth: 30, textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
          )
        })}
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
          v{policy.version}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
          {policy.shortId}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
          updated {policy.updatedAt.toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}

// ─── Decision feed row ────────────────────────────────────────────────────────

const HEALTH_COLOR: Record<string, string> = {
  success:  'var(--color-green)',
  fallback: 'var(--color-amber)',
  failed:   'var(--color-red)',
}

type DecisionViewModel = ReturnType<typeof useDecisionStream>['decisions'][number]

function DecisionRow({ decision }: { decision: DecisionViewModel }) {
  return (
    <div
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          10,
        padding:      '7px 16px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          width:           6,
          height:          6,
          borderRadius:    '50%',
          backgroundColor: HEALTH_COLOR[decision.health] ?? 'var(--color-text-muted)',
          flexShrink:      0,
        }}
      />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0, minWidth: 70 }}>
        {decision.shortId}
      </span>
      <StatusBadge status={decision.outcome} />
      {decision.selectedModelId && (
        <span
          style={{
            fontFamily:   'var(--font-mono)',
            fontSize:     10,
            color:        'var(--color-text-secondary)',
            flex:         1,
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
        >
          {decision.selectedModelId}
          {decision.selectedWorkerId && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              {' → '}{decision.selectedWorkerId}
            </span>
          )}
        </span>
      )}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
        {decision.evalDisplay}
      </span>
      {decision.decisionSource === 'simulation' && (
        <span
          style={{
            fontFamily:      'var(--font-mono)',
            fontSize:        9,
            color:           'var(--color-purple)',
            backgroundColor: 'rgba(139,92,246,0.08)',
            border:          '1px solid rgba(139,92,246,0.22)',
            borderRadius:    3,
            padding:         '1px 5px',
            flexShrink:      0,
          }}
        >
          sim
        </span>
      )}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
        {decision.age}
      </span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Routing() {
  const { policies, recentDecisions, stats, loading, error, refetch } = useRoutingPage()

  const {
    decisions:   liveDecisions,
    loading:     decisionLoading,
    connectionState,
  } = useDecisionStream()

  // Track which strategies have seen recent live events (for graph pulsing)
  const [activeStrategies, setActiveStrategies] = useState<Set<string>>(new Set())
  const pulseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const handleRoutingEvent = useCallback((event: InferMeshStreamEvent) => {
    if (event.type !== 'routing') return
    const payload = event.data as RoutingOutcomeSummaryPayload
    const strategy = payload.strategy

    setActiveStrategies(prev => new Set(prev).add(strategy))

    const existing = pulseTimers.current.get(strategy)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      setActiveStrategies(prev => {
        const next = new Set(prev)
        next.delete(strategy)
        return next
      })
      pulseTimers.current.delete(strategy)
    }, 3000)
    pulseTimers.current.set(strategy, timer)
  }, [])

  useStreamSocket(['routing'], handleRoutingEvent)

  useEffect(() => {
    const timers = pulseTimers.current
    return () => { timers.forEach(t => clearTimeout(t)) }
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedPolicy = policies.find(p => p.id === selectedId) ?? null

  const pulsingPolicyIds = new Set(
    policies.filter(p => activeStrategies.has(p.strategy)).map(p => p.id)
  )

  // Merge live stream decisions with REST-seeded decisions (dedup by id)
  const allDecisions = (() => {
    const seen = new Set<string>()
    return [...liveDecisions, ...recentDecisions]
      .filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true })
      .slice(0, 40)
  })()

  return (
    <div
      style={{
        padding:       '20px 24px',
        display:       'flex',
        flexDirection: 'column',
        gap:           20,
        minHeight:     '100%',
        boxSizing:     'border-box',
        overflowY:     'auto',
      }}
    >
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1
            style={{
              fontFamily:    'var(--font-display)',
              fontSize:      20,
              fontWeight:    700,
              color:         'var(--color-text-primary)',
              letterSpacing: '-0.3px',
              lineHeight:    1.2,
            }}
          >
            Routing
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize:   13,
              color:      'var(--color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            Policy management and live routing topology — cost, latency, affinity, and canary strategies.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ConnectionStatusBadge state={connectionState} />
          <button
            onClick={refetch}
            disabled={loading}
            style={{
              display:         'flex',
              alignItems:      'center',
              gap:             6,
              padding:         '5px 12px',
              borderRadius:    'var(--radius-md)',
              backgroundColor: 'var(--color-bg-elevated)',
              border:          '1px solid var(--color-border-strong)',
              fontFamily:      'var(--font-mono)',
              fontSize:        11,
              color:           'var(--color-text-muted)',
              cursor:          loading ? 'not-allowed' : 'pointer',
              opacity:         loading ? 0.5 : 1,
            }}
          >
            <RefreshCw
              size={11}
              strokeWidth={2}
              style={loading ? { animation: 'spin 1s linear infinite' } : undefined}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <SummaryCard
          label="Active Policies"
          value={String(stats.activePolicies)}
          loading={loading}
          accent={stats.activePolicies > 0 ? 'var(--color-green)' : undefined}
        />
        <SummaryCard
          label="Total Policies"
          value={String(stats.totalPolicies)}
          loading={loading}
        />
        <SummaryCard
          label="Success Rate"
          value={stats.successRate != null ? `${stats.successRate}%` : '—'}
          loading={loading}
          accent={
            stats.successRate != null && stats.successRate >= 95 ? 'var(--color-green)'
            : stats.successRate != null && stats.successRate >= 80 ? 'var(--color-amber)'
            : stats.successRate != null ? 'var(--color-red)'
            : undefined
          }
        />
        <SummaryCard
          label="Avg Decision"
          value={stats.avgDecisionMs != null ? `${stats.avgDecisionMs}ms` : '—'}
          loading={loading}
        />
      </div>

      {/* ── Main body ── */}
      {error ? (
        <ErrorState
          title="Failed to load routing data"
          message={error}
          onRetry={refetch}
          compact
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '55% 1fr', gap: 16, alignItems: 'start' }}>

          {/* Left: policy list */}
          <Panel>
            <PanelHeader
              title="Policies"
              subtitle={loading ? undefined : `${policies.length} registered`}
            />
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                {Array.from({ length: 3 }, (_, i) => <PolicySkeleton key={i} />)}
              </div>
            ) : policies.length === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="No policies registered"
                description="Create routing policies via the admin API to control how requests are dispatched to workers."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                {policies.map(p => (
                  <PolicyCard
                    key={p.id}
                    policy={p}
                    selected={selectedId === p.id}
                    onClick={() => setSelectedId(prev => prev === p.id ? null : p.id)}
                    pulsing={pulsingPolicyIds.has(p.id)}
                  />
                ))}
              </div>
            )}
          </Panel>

          {/* Right: topology + selected detail */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Panel>
              <PanelHeader
                title="Routing Topology"
                subtitle="priority-ordered · live"
                right={<ConnectionStatusBadge state={connectionState} />}
              />
              {loading ? (
                <div>
                  {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
                      <SkeletonBlock width={24} height={24} borderRadius="50%" />
                      <SkeletonBlock width={28} height={2} />
                      <SkeletonBlock width="35%" height={32} />
                      <SkeletonBlock width={28} height={2} />
                      <SkeletonBlock width={120} height={32} />
                    </div>
                  ))}
                </div>
              ) : (
                <RoutingFlowGraph
                  policies={policies}
                  activeStrategies={activeStrategies}
                />
              )}
            </Panel>

            {selectedPolicy && (
              <Panel>
                <PanelHeader title={selectedPolicy.name} subtitle="policy detail" />
                <PolicyDetail policy={selectedPolicy} />
              </Panel>
            )}
          </div>
        </div>
      )}

      {/* ── Decision feed ── */}
      <Panel>
        <PanelHeader
          title="Decision Feed"
          subtitle={`${allDecisions.length} recent decisions · live`}
          right={<ConnectionStatusBadge state={connectionState} />}
        />
        {decisionLoading && allDecisions.length === 0 ? (
          <div>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: '1px solid var(--color-border)' }}>
                <SkeletonBlock width={6}  height={6}  borderRadius="50%" />
                <SkeletonBlock width={70} height={10} />
                <SkeletonBlock width={64} height={20} />
                <SkeletonBlock width="40%" height={10} />
                <SkeletonBlock width={40} height={10} style={{ marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        ) : allDecisions.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No decisions yet"
            description="Routing decisions will appear here as requests flow through the gateway."
          />
        ) : (
          <div>
            {allDecisions.map(d => (
              <DecisionRow key={d.id} decision={d} />
            ))}
          </div>
        )}
      </Panel>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  )
}
