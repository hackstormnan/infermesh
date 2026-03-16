/**
 * components/simulation/ExperimentResultPanel.tsx
 *
 * Renders the comparison output of a completed policy experiment.
 * Shows a comparison table, winner badge, and pre-computed rankings.
 */

import { FlaskConical, RotateCcw, Trophy, Zap } from 'lucide-react'
import { Panel, PanelHeader } from '../ui/Panel'
import { EmptyState } from '../ui/EmptyState'
import type { ExperimentViewModel, PolicyComparisonViewModel } from '../../api/mappers/simulation.mapper'
import type { ExperimentResult } from '../../api/types/simulation'

interface Props {
  result:    ExperimentViewModel | null
  raw:       ExperimentResult | null
  loading:   boolean
  onClear:   () => void
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const monoMuted: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      10,
  fontWeight:    600,
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  color:         'var(--color-text-muted)',
}

const th: React.CSSProperties = {
  ...monoMuted,
  padding:   '6px 10px',
  textAlign: 'left',
  backgroundColor: 'var(--color-bg-elevated)',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace:   'nowrap',
}

const td: React.CSSProperties = {
  padding:     '8px 10px',
  fontFamily:  'var(--font-mono)',
  fontSize:    11,
  color:       'var(--color-text-secondary)',
  borderBottom:'1px solid var(--color-border)',
  verticalAlign:'middle',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
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
      }}
    >
      <span style={monoMuted}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize:   20,
          fontWeight: 700,
          color:      accent ?? 'var(--color-text-primary)',
          lineHeight: 1,
          wordBreak:  'break-all',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const colors: Record<number, { bg: string; text: string; border: string }> = {
    1: { bg: 'rgba(245,158,11,0.10)', text: 'var(--color-amber)', border: 'rgba(245,158,11,0.25)' },
    2: { bg: 'rgba(148,163,184,0.08)', text: '#94A3B8', border: 'rgba(148,163,184,0.18)' },
    3: { bg: 'rgba(180,139,100,0.08)', text: '#B48B64', border: 'rgba(180,139,100,0.18)' },
  }
  const c = colors[rank] ?? { bg: 'var(--color-bg-elevated)', text: 'var(--color-text-muted)', border: 'var(--color-border)' }

  return (
    <span
      style={{
        display:         'inline-flex',
        alignItems:      'center',
        justifyContent:  'center',
        width:           22,
        height:          22,
        borderRadius:    'var(--radius-sm)',
        backgroundColor: c.bg,
        border:          `1px solid ${c.border}`,
        fontFamily:      'var(--font-mono)',
        fontSize:        10,
        fontWeight:      700,
        color:           c.text,
      }}
    >
      {rank}
    </span>
  )
}

function RankingRow({ label, policyIds, nameMap }: { label: string; policyIds: string[]; nameMap: Map<string, string> }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ ...monoMuted, flexShrink: 0, paddingTop: 2, minWidth: 120 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {policyIds.map((id, i) => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <RankBadge rank={i + 1} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {nameMap.get(id) ?? id.slice(0, 12)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ComparisonRow({
  row, isWinner, isLast,
}: {
  row: PolicyComparisonViewModel; isWinner: boolean; isLast: boolean
}) {
  const successColor =
    row.successCount === row.totalRequests
      ? 'var(--color-green)'
      : parseFloat(row.successRatePct) >= 80
        ? 'var(--color-text-secondary)'
        : 'var(--color-red)'

  return (
    <tr
      style={{
        backgroundColor: isWinner ? 'rgba(59,130,246,0.04)' : 'transparent',
      }}
    >
      <td style={{ ...td, borderBottom: isLast ? 'none' : td.borderBottom }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RankBadge rank={row.rank} />
          {isWinner && <Trophy size={11} strokeWidth={2} style={{ color: 'var(--color-amber)' }} />}
        </div>
      </td>
      <td style={{ ...td, borderBottom: isLast ? 'none' : td.borderBottom, color: 'var(--color-text-primary)' }}>
        {row.policyName}
        {isWinner && (
          <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-blue)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            winner
          </span>
        )}
      </td>
      <td style={{ ...td, borderBottom: isLast ? 'none' : td.borderBottom, color: successColor }}>
        {row.successRatePct}
        <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--color-text-muted)' }}>
          ({row.successCount}/{row.totalRequests})
        </span>
      </td>
      <td style={{ ...td, borderBottom: isLast ? 'none' : td.borderBottom }}>
        {row.fallbackRatePct}
      </td>
      <td style={{ ...td, borderBottom: isLast ? 'none' : td.borderBottom }}>
        {row.avgEvalDisplay}
      </td>
      <td style={{ ...td, borderBottom: isLast ? 'none' : td.borderBottom, color: 'var(--color-text-muted)' }}>
        {row.failureCount > 0 ? (
          <span style={{ color: 'var(--color-red)' }}>{row.failureCount}</span>
        ) : '—'}
      </td>
    </tr>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExperimentResultPanel({ result, raw, loading, onClear }: Props) {
  if (loading) {
    return (
      <Panel style={{ minHeight: 280 }}>
        <PanelHeader title="Experiment Results" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 24px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Running experiment…
          </span>
        </div>
      </Panel>
    )
  }

  if (!result || !raw) {
    return (
      <Panel style={{ minHeight: 280 }}>
        <PanelHeader title="Experiment Results" />
        <EmptyState
          icon={FlaskConical}
          title="No experiment results yet"
          description="Configure policies and a workload, then run the experiment to compare routing performance side by side."
          compact
        />
      </Panel>
    )
  }

  const nameMap = new Map(result.results.map(r => [r.policyId, r.policyName]))
  const sorted  = [...result.results].sort((a, b) => a.rank - b.rank)

  return (
    <Panel>
      <PanelHeader
        title="Experiment Results"
        subtitle={`${result.experimentName} · ${result.durationDisplay}`}
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
            New Experiment
          </button>
        }
      />

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <SummaryCard label="Policies" value={String(result.results.length)} />
          <SummaryCard label="Requests / Policy" value={result.workloadRequestCount.toLocaleString()} />
          <SummaryCard label="Duration" value={result.durationDisplay} />
          <SummaryCard
            label="Winner"
            value={result.winnerName}
            accent="var(--color-amber)"
          />
        </div>

        {/* Comparison table */}
        <div
          style={{
            borderRadius: 'var(--radius-md)',
            border:       '1px solid var(--color-border)',
            overflow:     'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 40 }}>Rank</th>
                <th style={th}>Policy</th>
                <th style={{ ...th, textAlign: 'right' }}>Success Rate</th>
                <th style={{ ...th, textAlign: 'right' }}>Fallback Rate</th>
                <th style={{ ...th, textAlign: 'right' }}>Avg Eval</th>
                <th style={{ ...th, textAlign: 'right' }}>Failures</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <ComparisonRow
                  key={row.policyId}
                  row={row}
                  isWinner={row.policyId === result.winnerId}
                  isLast={i === sorted.length - 1}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Rankings */}
        <div
          style={{
            padding:         '12px 14px',
            backgroundColor: 'var(--color-bg-elevated)',
            border:          '1px solid var(--color-border)',
            borderRadius:    'var(--radius-md)',
            display:         'flex',
            flexDirection:   'column',
            gap:             10,
          }}
        >
          <span style={monoMuted}>Rankings</span>
          <RankingRow label="By Success Rate"   policyIds={raw.rankings.bySuccessRate}     nameMap={nameMap} />
          <RankingRow label="By Fallback Rate"  policyIds={raw.rankings.byFallbackRate}    nameMap={nameMap} />
          <RankingRow label="By Eval Speed"     policyIds={raw.rankings.byEvaluationSpeed} nameMap={nameMap} />
        </div>

        {/* Experiment metadata */}
        <div
          style={{
            display:    'flex',
            gap:        16,
            flexWrap:   'wrap',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
            exp {result.experimentId.slice(0, 8)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
            started {result.startedAt.toLocaleTimeString()}
          </span>
        </div>

      </div>
    </Panel>
  )
}

// ─── Loading spinner placeholder ─────────────────────────────────────────────

export function ExperimentLoadingPanel() {
  return (
    <Panel style={{ minHeight: 280 }}>
      <PanelHeader title="Experiment Results" />
      <EmptyState icon={Zap} title="Running…" description="Routing synthetic workload through each policy." compact />
    </Panel>
  )
}
