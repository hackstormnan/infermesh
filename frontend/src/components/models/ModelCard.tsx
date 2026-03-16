/**
 * components/models/ModelCard.tsx
 *
 * Registry card for a single AI model.
 * Shows: name/status/tier, provider/version, capabilities, tasks,
 * context/output token limits, pricing, and latency profile.
 */

import { StatusBadge } from '../ui/StatusBadge'
import type { ModelViewModel } from '../../api/mappers/model.mapper'
import type { QualityTier } from '../../api/types/models'

// ─── Quality tier badge ───────────────────────────────────────────────────────

const TIER_STYLE: Record<QualityTier, { bg: string; border: string; color: string }> = {
  frontier: { bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.25)', color: 'var(--color-purple)' },
  standard: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.22)', color: 'var(--color-blue)'   },
  economy:  { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.22)',  color: 'var(--color-green)'  },
}

function TierBadge({ tier, label }: { tier: QualityTier; label: string }) {
  const s = TIER_STYLE[tier]
  return (
    <span
      style={{
        display:         'inline-flex',
        alignItems:      'center',
        padding:         '2px 7px',
        borderRadius:    'var(--radius-sm)',
        backgroundColor: s.bg,
        border:          `1px solid ${s.border}`,
        fontFamily:      'var(--font-mono)',
        fontSize:        10,
        fontWeight:      600,
        color:           s.color,
        letterSpacing:   '0.4px',
        whiteSpace:      'nowrap',
      }}
    >
      {label}
    </span>
  )
}

// ─── Capability chip ──────────────────────────────────────────────────────────

function CapChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontFamily:      'var(--font-mono)',
        fontSize:        9,
        fontWeight:      600,
        color:           'var(--color-text-muted)',
        padding:         '2px 6px',
        borderRadius:    3,
        backgroundColor: 'var(--color-bg-elevated)',
        border:          '1px solid var(--color-border)',
        textTransform:   'uppercase',
        letterSpacing:   '0.4px',
        whiteSpace:      'nowrap',
      }}
    >
      {label.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const mono10: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      10,
  color:         'var(--color-text-muted)',
  letterSpacing: '0.3px',
}

const dataRow: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  gap:            8,
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ModelCardProps {
  model: ModelViewModel
}

export function ModelCard({ model }: ModelCardProps) {
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
        {/* Name + status + tier */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            {model.name}
          </span>
          <TierBadge tier={model.qualityTier} label={model.qualityTierLabel} />
          <StatusBadge status={model.status} />
        </div>

        {/* Provider · version */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...mono10, textTransform: 'capitalize' }}>{model.provider}</span>
          {model.version && (
            <>
              <span style={{ ...mono10, color: 'var(--color-border-strong)' }}>·</span>
              <span style={mono10}>v{model.version}</span>
            </>
          )}
          {model.aliases.length > 0 && (
            <>
              <span style={{ ...mono10, color: 'var(--color-border-strong)' }}>·</span>
              <span style={{ ...mono10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {model.aliases[0]}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Capabilities ── */}
      <div
        style={{
          padding:      '8px 14px',
          borderBottom: '1px solid var(--color-border)',
          display:      'flex',
          gap:          4,
          flexWrap:     'wrap',
        }}
      >
        {model.capabilities.map(c => (
          <CapChip key={c} label={c} />
        ))}
      </div>

      {/* ── Token limits + pricing ── */}
      <div
        style={{
          padding:      '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          display:      'flex',
          flexDirection:'column',
          gap:          6,
        }}
      >
        <div style={dataRow}>
          <span style={mono10}>Context window</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   11,
              fontWeight: 600,
              color:      'var(--color-text-secondary)',
            }}
          >
            {model.contextWindowDisplay}
          </span>
        </div>
        <div style={dataRow}>
          <span style={mono10}>Max output</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   11,
              fontWeight: 600,
              color:      'var(--color-text-secondary)',
            }}
          >
            {model.maxOutputDisplay}
          </span>
        </div>
        <div style={dataRow}>
          <span style={mono10}>Input / output per 1k</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   11,
              fontWeight: 600,
              color:      'var(--color-text-secondary)',
            }}
          >
            {model.pricingDisplay}
          </span>
        </div>
      </div>

      {/* ── Latency profile ── */}
      <div
        style={{
          padding: '8px 14px 10px',
          display: 'flex',
          gap:     16,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ ...mono10, textTransform: 'uppercase', letterSpacing: '0.6px' }}>TTFT</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            {model.ttftMs}ms
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ ...mono10, textTransform: 'uppercase', letterSpacing: '0.6px' }}>tok/s</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            {model.tokensPerSecond}
          </span>
        </div>
        {model.supportedTasks.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
            {model.supportedTasks.slice(0, 3).map(t => (
              <span
                key={t}
                style={{
                  fontFamily:    'var(--font-mono)',
                  fontSize:      9,
                  color:         'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                }}
              >
                {t}
              </span>
            ))}
            {model.supportedTasks.length > 3 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
                +{model.supportedTasks.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
