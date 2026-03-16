/**
 * pages/Models.tsx
 *
 * Model registry page.
 *
 * Data: REST poll (GET /api/v1/models) via useModelsPage — 60 s auto-refresh.
 *
 * Layout:
 *   - Page header with refresh button
 *   - 4 summary cards (Active / Providers / Frontier / Avg TTFT)
 *   - Model card grid (3-column)
 *   - Usage comparison panel — latency vs cost bars built from registry data
 */

import { Box, RefreshCw } from 'lucide-react'
import { useModelsPage } from '../hooks/useModelsPage'
import { ModelCard } from '../components/models/ModelCard'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { SkeletonBlock } from '../components/ui/LoadingState'
import type { ModelViewModel } from '../api/mappers/model.mapper'

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
        <SkeletonBlock width={56} height={24} />
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

// ─── Model card skeleton ──────────────────────────────────────────────────────

function ModelCardSkeleton() {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        padding:         '14px',
        display:         'flex',
        flexDirection:   'column',
        gap:             10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SkeletonBlock width="50%" height={13} />
        <SkeletonBlock width={52} height={20} style={{ marginLeft: 'auto' }} />
        <SkeletonBlock width={52} height={20} />
      </div>
      <SkeletonBlock width="65%" height={10} />
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: 3 }, (_, i) => <SkeletonBlock key={i} width={70} height={18} />)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 3 }, (_, i) => <SkeletonBlock key={i} width="100%" height={10} />)}
      </div>
    </div>
  )
}

// ─── Summary derivation ───────────────────────────────────────────────────────

function deriveStats(models: ModelViewModel[]) {
  const active    = models.filter(m => m.status === 'active').length
  const providers = new Set(models.map(m => m.provider)).size
  const frontier  = models.filter(m => m.qualityTier === 'frontier').length
  const avgTtft   = models.length > 0
    ? Math.round(models.reduce((s, m) => s + m.ttftMs, 0) / models.length)
    : 0
  return { active, providers, frontier, avgTtft }
}

// ─── Usage comparison panel ───────────────────────────────────────────────────
//
// Visualises latency (TTFT) and input cost across active models using registry
// profiles. A dedicated /models/usage-comparison endpoint would enrich this with
// live request telemetry; registry profiles are a useful baseline.

function UsageComparisonPanel({ models }: { models: ModelViewModel[] }) {
  const active = models.filter(m => m.status === 'active').slice(0, 8)
  if (active.length === 0) return null

  const maxTtft = Math.max(...active.map(m => m.ttftMs), 1)
  const maxCost = Math.max(...active.map(m => m.inputPer1kTokens), 0.001)

  return (
    <Panel>
      <PanelHeader
        title="Latency vs Cost Comparison"
        subtitle="active models · registry profiles"
      />
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 2 }}>
          {[
            { color: 'var(--color-blue)',   label: 'TTFT (ms)' },
            { color: 'var(--color-purple)', label: 'Input cost per 1k' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: color }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {active.map(m => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span
                style={{
                  fontFamily:   'var(--font-mono)',
                  fontSize:     10,
                  color:        'var(--color-text-secondary)',
                  flexShrink:   0,
                  minWidth:     140,
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                }}
              >
                {m.name}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                {m.ttftMs}ms
              </span>
            </div>

            {/* TTFT bar */}
            <div
              style={{
                height:          5,
                borderRadius:    3,
                backgroundColor: 'var(--color-bg-elevated)',
                overflow:        'hidden',
              }}
            >
              <div
                style={{
                  height:          '100%',
                  width:           `${(m.ttftMs / maxTtft) * 100}%`,
                  borderRadius:    3,
                  backgroundColor: 'var(--color-blue)',
                }}
              />
            </div>

            {/* Cost bar */}
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
                  width:           `${(m.inputPer1kTokens / maxCost) * 100}%`,
                  borderRadius:    2,
                  backgroundColor: 'var(--color-purple)',
                  opacity:         0.7,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Models() {
  const { models, loading, error, refetch } = useModelsPage()
  const stats = deriveStats(models)

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
            Models
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize:   13,
              color:      'var(--color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            AI model registry — capabilities, pricing, and latency profiles used by routing strategies.
          </p>
        </div>

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

      {/* ── Summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <SummaryCard label="Active"    value={String(stats.active)}    loading={loading} accent={stats.active   > 0 ? 'var(--color-green)'  : undefined} />
        <SummaryCard label="Providers" value={String(stats.providers)} loading={loading} />
        <SummaryCard label="Frontier"  value={String(stats.frontier)}  loading={loading} accent={stats.frontier > 0 ? 'var(--color-purple)' : undefined} />
        <SummaryCard label="Avg TTFT"  value={stats.avgTtft > 0 ? `${stats.avgTtft}ms` : '—'} loading={loading} />
      </div>

      {/* ── Model grid ── */}
      {error ? (
        <ErrorState
          title="Failed to load models"
          message={error}
          onRetry={refetch}
          compact
        />
      ) : loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {Array.from({ length: 6 }, (_, i) => <ModelCardSkeleton key={i} />)}
        </div>
      ) : models.length === 0 ? (
        <EmptyState
          icon={Box}
          title="No models registered"
          description="Register models via the admin API to make them available for routing. Each model needs a name, provider, capabilities, and pricing profile."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {models.map(m => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      )}

      {/* ── Usage comparison ── */}
      {!loading && !error && models.length > 0 && (
        <UsageComparisonPanel models={models} />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
