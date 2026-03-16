/**
 * components/workers/WorkerCard.tsx
 *
 * Full worker card for the Workers page resource grid.
 * Shows: name/status/region, hardware, model support, utilisation bar,
 * runtime metrics (CPU, MEM, TPS, TTFT, queue), and heartbeat age.
 */

import { StatusBadge } from '../ui/StatusBadge'
import type { WorkerViewModel } from '../../api/mappers/worker.mapper'

// ─── Shared styles ────────────────────────────────────────────────────────────

const mono10: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      10,
  color:         'var(--color-text-muted)',
  letterSpacing: '0.3px',
}

const metricLabel: React.CSSProperties = {
  ...mono10,
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  marginBottom:  3,
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={metricLabel}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   12,
          fontWeight: 600,
          color:      valueColor ?? 'var(--color-text-secondary)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function UtilBar({ utilization }: { utilization: number }) {
  const pct = Math.round(utilization * 100)
  const color =
    pct >= 90 ? 'var(--color-red)'
    : pct >= 60 ? 'var(--color-amber)'
    : 'var(--color-blue)'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={mono10}>Utilization</span>
        <span style={{ ...mono10, color }}>{pct}%</span>
      </div>
      <div
        style={{
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
            backgroundColor: color,
            transition:      'width 0.4s ease',
          }}
        />
      </div>
    </div>
  )
}

// ─── Health dot ───────────────────────────────────────────────────────────────

const HEALTH_COLOR: Record<string, string> = {
  healthy:   'var(--color-green)',
  degraded:  'var(--color-amber)',
  unhealthy: 'var(--color-red)',
  offline:   'var(--color-text-muted)',
}

// ─── Component ────────────────────────────────────────────────────────────────

interface WorkerCardProps {
  worker: WorkerViewModel
}

export function WorkerCard({ worker }: WorkerCardProps) {
  const healthColor = HEALTH_COLOR[worker.health] ?? 'var(--color-text-muted)'

  const uptimeDisplay = (() => {
    const s = worker.uptimeSeconds
    if (s == null) return null
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86400)}d`
  })()

  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        overflow:        'hidden',
        display:         'flex',
        flexDirection:   'column',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding:      '12px 14px 10px',
          borderBottom: '1px solid var(--color-border)',
          display:      'flex',
          flexDirection:'column',
          gap:          6,
        }}
      >
        {/* Name + health dot + status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width:           8,
              height:          8,
              borderRadius:    '50%',
              backgroundColor: healthColor,
              flexShrink:      0,
              boxShadow:       worker.health === 'healthy' ? `0 0 5px ${healthColor}` : 'none',
            }}
          />
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
            {worker.name}
          </span>
          <StatusBadge status={worker.status} />
        </div>

        {/* Region · hardware */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={mono10}>{worker.region}</span>
          <span style={{ ...mono10, color: 'var(--color-border-strong)' }}>·</span>
          <span style={mono10}>{worker.instanceType}</span>
          {worker.gpuModel && (
            <>
              <span style={{ ...mono10, color: 'var(--color-border-strong)' }}>·</span>
              <span style={{ ...mono10, color: 'var(--color-purple)' }}>{worker.gpuModel}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Supported models ── */}
      {worker.supportedModelIds.length > 0 && (
        <div
          style={{
            padding:    '8px 14px',
            borderBottom: '1px solid var(--color-border)',
            display:    'flex',
            gap:        4,
            flexWrap:   'wrap',
          }}
        >
          {worker.supportedModelIds.map(m => (
            <span
              key={m}
              style={{
                fontFamily:      'var(--font-mono)',
                fontSize:        9,
                color:           'var(--color-text-muted)',
                padding:         '2px 6px',
                borderRadius:    3,
                backgroundColor: 'var(--color-bg-elevated)',
                border:          '1px solid var(--color-border)',
                whiteSpace:      'nowrap',
              }}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      {/* ── Utilization bar ── */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
        <UtilBar utilization={worker.utilization} />
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          <span style={mono10}>{worker.activeJobs} / {worker.maxConcurrentJobs} jobs</span>
          {worker.queuedJobs > 0 && (
            <span style={{ ...mono10, color: 'var(--color-amber)' }}>
              {worker.queuedJobs} queued
            </span>
          )}
        </div>
      </div>

      {/* ── Runtime metrics grid ── */}
      <div
        style={{
          padding:             '10px 14px',
          display:             'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:                 10,
        }}
      >
        <MetricCell
          label="CPU"
          value={worker.cpuUsagePercent != null ? `${Math.round(worker.cpuUsagePercent)}%` : '—'}
          valueColor={
            worker.cpuUsagePercent != null && worker.cpuUsagePercent >= 90
              ? 'var(--color-red)'
              : worker.cpuUsagePercent != null && worker.cpuUsagePercent >= 70
                ? 'var(--color-amber)'
                : undefined
          }
        />
        <MetricCell
          label="MEM"
          value={worker.memoryUsagePercent != null ? `${Math.round(worker.memoryUsagePercent)}%` : '—'}
          valueColor={
            worker.memoryUsagePercent != null && worker.memoryUsagePercent >= 90
              ? 'var(--color-red)'
              : worker.memoryUsagePercent != null && worker.memoryUsagePercent >= 75
                ? 'var(--color-amber)'
                : undefined
          }
        />
        <MetricCell
          label="TPS"
          value={worker.tokensPerSecond != null ? `${worker.tokensPerSecond.toFixed(0)}` : '—'}
        />
        <MetricCell
          label="TTFT"
          value={worker.ttftMs != null ? `${worker.ttftMs}ms` : '—'}
        />
      </div>

      {/* ── Footer: heartbeat + uptime ── */}
      <div
        style={{
          padding:         '6px 14px 10px',
          borderTop:       '1px solid var(--color-border)',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'space-between',
        }}
      >
        <span style={mono10}>heartbeat {worker.lastHeartbeatAge}</span>
        {uptimeDisplay && (
          <span style={mono10}>up {uptimeDisplay}</span>
        )}
      </div>
    </div>
  )
}
