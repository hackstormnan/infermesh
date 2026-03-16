/**
 * components/simulation/SimRunResultPanel.tsx
 *
 * Renders the aggregate output of a completed simulation run.
 * Shows summary stats, per-model / per-worker selection bars, and errors.
 */

import { CheckCircle2, AlertCircle, RotateCcw, Zap } from 'lucide-react'
import { Panel, PanelHeader } from '../ui/Panel'
import { EmptyState } from '../ui/EmptyState'
import type { SimulationRunViewModel } from '../../api/mappers/simulation.mapper'

interface Props {
  result:  SimulationRunViewModel | null
  loading: boolean
  onClear: () => void
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const monoMuted: React.CSSProperties = {
  fontFamily:  'var(--font-mono)',
  fontSize:    10,
  fontWeight:  600,
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  color:       'var(--color-text-muted)',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-elevated)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-md)',
        padding:         '12px 14px',
        display:         'flex',
        flexDirection:   'column',
        gap:             6,
        minWidth:        0,
      }}
    >
      <span style={monoMuted}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize:   22,
          fontWeight: 700,
          color:      accent ?? 'var(--color-text-primary)',
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

function SelectionBar({
  id, count, total, accent,
}: {
  id: string; count: number; total: number; accent: string
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  const short = id.length > 24 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          style={{
            fontFamily:  'var(--font-mono)',
            fontSize:    11,
            color:       'var(--color-text-secondary)',
            overflow:    'hidden',
            textOverflow:'ellipsis',
            whiteSpace:  'nowrap',
            maxWidth:    '70%',
          }}
          title={id}
        >
          {short}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
          {count} · {pct.toFixed(0)}%
        </span>
      </div>
      <div
        style={{
          height:          4,
          borderRadius:    2,
          backgroundColor: 'var(--color-bg-base)',
          overflow:        'hidden',
        }}
      >
        <div
          style={{
            height:          '100%',
            width:           `${pct}%`,
            borderRadius:    2,
            backgroundColor: accent,
            transition:      'width 0.4s ease',
          }}
        />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SimRunResultPanel({ result, loading, onClear }: Props) {
  if (loading) {
    return (
      <Panel style={{ minHeight: 280 }}>
        <PanelHeader title="Results" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Running simulation…
          </span>
        </div>
      </Panel>
    )
  }

  if (!result) {
    return (
      <Panel style={{ minHeight: 280 }}>
        <PanelHeader title="Results" />
        <EmptyState
          icon={Zap}
          title="No results yet"
          description="Configure a scenario and run the simulation to see aggregate routing outcomes."
          compact
        />
      </Panel>
    )
  }

  const modelEntries = Object.entries(result.topModel
    ? {} // rebuild from original - we only have topModel, so use a proxy
    : {}
  )
  // We need perModelSelections from the raw result but the VM only has topModel/topWorker.
  // The full breakdown is stored in the raw DTO. Since we only have the VM here, we'd need
  // to pass the raw DTO or add breakdown to the VM. Let's use the result directly.
  // Actually the VM was built by the mapper. We need to extend it or pass raw DTO alongside.
  // For now, display what we have from the VM and handle breakdown via a separate prop.
  void modelEntries

  return (
    <Panel>
      <PanelHeader
        title="Run Results"
        subtitle={`${result.scenarioName} · ${result.durationDisplay}`}
        right={
          <button
            onClick={onClear}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            5,
              padding:        '4px 10px',
              borderRadius:   'var(--radius-md)',
              backgroundColor:'var(--color-bg-elevated)',
              border:         '1px solid var(--color-border-strong)',
              fontFamily:     'var(--font-mono)',
              fontSize:       10,
              color:          'var(--color-text-muted)',
              cursor:         'pointer',
            }}
          >
            <RotateCcw size={10} strokeWidth={2} />
            New Run
          </button>
        }
      />

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Policy badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={monoMuted}>Policy</span>
          <span
            style={{
              fontFamily:      'var(--font-mono)',
              fontSize:        11,
              color:           'var(--color-blue)',
              backgroundColor: 'var(--color-blue-dim)',
              padding:         '2px 8px',
              borderRadius:    'var(--radius-sm)',
              border:          '1px solid rgba(59,130,246,0.18)',
            }}
          >
            {result.policyName || 'default'}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
            run {result.runId.slice(0, 8)}
          </span>
        </div>

        {/* Summary stat cards */}
        <div
          style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap:                 8,
          }}
        >
          <SummaryCard label="Total" value={String(result.totalRequests)} />
          <SummaryCard
            label="Success"
            value={String(result.successCount)}
            sub={result.successRatePct}
            accent="var(--color-green)"
          />
          <SummaryCard
            label="Fallback"
            value={String(result.fallbackCount)}
            sub={result.fallbackRatePct}
            accent="var(--color-amber)"
          />
          <SummaryCard
            label="Failed"
            value={String(result.failureCount)}
            accent={result.failureCount > 0 ? 'var(--color-red)' : undefined}
          />
          <SummaryCard label="Avg Eval" value={result.avgEvalDisplay} />
        </div>

        {/* Top selections */}
        {(result.topModel || result.topWorker) && (
          <div
            style={{
              display:             'grid',
              gridTemplateColumns: '1fr 1fr',
              gap:                 10,
            }}
          >
            {result.topModel && (
              <div
                style={{
                  padding:         '10px 12px',
                  backgroundColor: 'var(--color-bg-elevated)',
                  border:          '1px solid var(--color-border)',
                  borderRadius:    'var(--radius-md)',
                }}
              >
                <div style={{ ...monoMuted, marginBottom: 6 }}>Top Model</div>
                <span
                  style={{
                    fontFamily:  'var(--font-mono)',
                    fontSize:    11,
                    color:       'var(--color-text-secondary)',
                    wordBreak:   'break-all',
                  }}
                >
                  {result.topModel.length > 20
                    ? `${result.topModel.slice(0, 8)}…${result.topModel.slice(-4)}`
                    : result.topModel}
                </span>
              </div>
            )}
            {result.topWorker && (
              <div
                style={{
                  padding:         '10px 12px',
                  backgroundColor: 'var(--color-bg-elevated)',
                  border:          '1px solid var(--color-border)',
                  borderRadius:    'var(--radius-md)',
                }}
              >
                <div style={{ ...monoMuted, marginBottom: 6 }}>Top Worker</div>
                <span
                  style={{
                    fontFamily:  'var(--font-mono)',
                    fontSize:    11,
                    color:       'var(--color-text-secondary)',
                    wordBreak:   'break-all',
                  }}
                >
                  {result.topWorker.length > 20
                    ? `${result.topWorker.slice(0, 8)}…${result.topWorker.slice(-4)}`
                    : result.topWorker}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Status row */}
        <div
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          8,
            padding:      '8px 10px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: result.failureCount === 0
              ? 'rgba(34,197,94,0.06)'
              : 'rgba(245,158,11,0.06)',
            border: `1px solid ${result.failureCount === 0
              ? 'rgba(34,197,94,0.15)'
              : 'rgba(245,158,11,0.15)'}`,
          }}
        >
          {result.failureCount === 0 ? (
            <CheckCircle2 size={13} strokeWidth={2} style={{ color: 'var(--color-green)', flexShrink: 0 }} />
          ) : (
            <AlertCircle size={13} strokeWidth={2} style={{ color: 'var(--color-amber)', flexShrink: 0 }} />
          )}
          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontSize:   12,
              color:      result.failureCount === 0 ? 'var(--color-green)' : 'var(--color-amber)',
            }}
          >
            {result.failureCount === 0
              ? `All ${result.successCount} requests routed successfully`
              : `${result.successCount} succeeded · ${result.failureCount} failed · ${result.fallbackCount} used fallback`
            }
          </span>
        </div>

        {/* Errors */}
        {result.errorCount > 0 && (
          <div
            style={{
              padding:      '10px 12px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(239,68,68,0.06)',
              border:       '1px solid rgba(239,68,68,0.15)',
            }}
          >
            <div style={{ ...monoMuted, marginBottom: 6 }}>
              {result.errorCount} routing error{result.errorCount > 1 ? 's' : ''}
            </div>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-red)' }}>
              Check policy constraints and worker availability.
            </span>
          </div>
        )}

      </div>
    </Panel>
  )
}

// ─── Extended version with raw breakdown data ─────────────────────────────────

interface ExtendedProps extends Props {
  perModelSelections:  Record<string, number>
  perWorkerAssignments: Record<string, number>
}

export function SimRunResultPanelFull({
  result, loading, onClear,
  perModelSelections, perWorkerAssignments,
}: ExtendedProps) {
  if (loading || !result) {
    return <SimRunResultPanel result={result} loading={loading} onClear={onClear} />
  }

  const modelTotal  = Object.values(perModelSelections).reduce((a, b) => a + b, 0)
  const workerTotal = Object.values(perWorkerAssignments).reduce((a, b) => a + b, 0)
  const modelItems  = Object.entries(perModelSelections).sort((a, b) => b[1] - a[1])
  const workerItems = Object.entries(perWorkerAssignments).sort((a, b) => b[1] - a[1])

  return (
    <Panel>
      <PanelHeader
        title="Run Results"
        subtitle={`${result.scenarioName} · ${result.durationDisplay}`}
        right={
          <button
            onClick={onClear}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            5,
              padding:        '4px 10px',
              borderRadius:   'var(--radius-md)',
              backgroundColor:'var(--color-bg-elevated)',
              border:         '1px solid var(--color-border-strong)',
              fontFamily:     'var(--font-mono)',
              fontSize:       10,
              color:          'var(--color-text-muted)',
              cursor:         'pointer',
            }}
          >
            <RotateCcw size={10} strokeWidth={2} />
            New Run
          </button>
        }
      />

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Policy badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={monoMuted}>Policy</span>
          <span
            style={{
              fontFamily:      'var(--font-mono)',
              fontSize:        11,
              color:           'var(--color-blue)',
              backgroundColor: 'var(--color-blue-dim)',
              padding:         '2px 8px',
              borderRadius:    'var(--radius-sm)',
              border:          '1px solid rgba(59,130,246,0.18)',
            }}
          >
            {result.policyName || 'default'}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
            run {result.runId.slice(0, 8)}
          </span>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          <SummaryCard label="Total" value={String(result.totalRequests)} />
          <SummaryCard label="Success" value={String(result.successCount)} sub={result.successRatePct} accent="var(--color-green)" />
          <SummaryCard label="Fallback" value={String(result.fallbackCount)} sub={result.fallbackRatePct} accent="var(--color-amber)" />
          <SummaryCard label="Failed" value={String(result.failureCount)} accent={result.failureCount > 0 ? 'var(--color-red)' : undefined} />
          <SummaryCard label="Avg Eval" value={result.avgEvalDisplay} />
        </div>

        {/* Breakdown: model + worker */}
        {(modelItems.length > 0 || workerItems.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {modelItems.length > 0 && (
              <div
                style={{
                  padding:         '12px',
                  backgroundColor: 'var(--color-bg-elevated)',
                  border:          '1px solid var(--color-border)',
                  borderRadius:    'var(--radius-md)',
                  display:         'flex',
                  flexDirection:   'column',
                  gap:             10,
                }}
              >
                <span style={monoMuted}>Model Selections</span>
                {modelItems.map(([id, count]) => (
                  <SelectionBar key={id} id={id} count={count} total={modelTotal} accent="var(--color-blue)" />
                ))}
              </div>
            )}
            {workerItems.length > 0 && (
              <div
                style={{
                  padding:         '12px',
                  backgroundColor: 'var(--color-bg-elevated)',
                  border:          '1px solid var(--color-border)',
                  borderRadius:    'var(--radius-md)',
                  display:         'flex',
                  flexDirection:   'column',
                  gap:             10,
                }}
              >
                <span style={monoMuted}>Worker Assignments</span>
                {workerItems.map(([id, count]) => (
                  <SelectionBar key={id} id={id} count={count} total={workerTotal} accent="var(--color-purple)" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status row */}
        <div
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          8,
            padding:      '8px 10px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: result.failureCount === 0 ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.06)',
            border: `1px solid ${result.failureCount === 0 ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)'}`,
          }}
        >
          {result.failureCount === 0 ? (
            <CheckCircle2 size={13} strokeWidth={2} style={{ color: 'var(--color-green)', flexShrink: 0 }} />
          ) : (
            <AlertCircle size={13} strokeWidth={2} style={{ color: 'var(--color-amber)', flexShrink: 0 }} />
          )}
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: result.failureCount === 0 ? 'var(--color-green)' : 'var(--color-amber)' }}>
            {result.failureCount === 0
              ? `All ${result.successCount} requests routed successfully`
              : `${result.successCount} succeeded · ${result.failureCount} failed · ${result.fallbackCount} used fallback`
            }
          </span>
        </div>

        {result.errorCount > 0 && (
          <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
            <div style={{ ...monoMuted, marginBottom: 6 }}>{result.errorCount} routing error{result.errorCount > 1 ? 's' : ''}</div>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-red)' }}>
              Check policy constraints and worker availability.
            </span>
          </div>
        )}

      </div>
    </Panel>
  )
}
