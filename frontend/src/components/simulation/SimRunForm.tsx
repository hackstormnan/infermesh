/**
 * components/simulation/SimRunForm.tsx
 *
 * Form panel for a single simulation run.
 * Controlled inputs — all field state lives in the parent hook.
 */

import { PlayCircle, Loader2 } from 'lucide-react'
import { Panel, PanelHeader } from '../ui/Panel'
import type { SimRunFormValues } from '../../hooks/useSimulationPage'

interface Props {
  form:        SimRunFormValues
  setForm:     (patch: Partial<SimRunFormValues>) => void
  submitting:  boolean
  error:       string | null
  onSubmit:    () => void
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const label: React.CSSProperties = {
  display:        'block',
  fontFamily:     'var(--font-mono)',
  fontSize:       10,
  fontWeight:     600,
  letterSpacing:  '0.8px',
  textTransform:  'uppercase',
  color:          'var(--color-text-muted)',
  marginBottom:   6,
}

const input: React.CSSProperties = {
  width:           '100%',
  backgroundColor: 'var(--color-bg-elevated)',
  border:          '1px solid var(--color-border-strong)',
  borderRadius:    'var(--radius-md)',
  padding:         '7px 10px',
  fontSize:        12,
  fontFamily:      'var(--font-mono)',
  color:           'var(--color-text-primary)',
  outline:         'none',
  boxSizing:       'border-box',
}

const hint: React.CSSProperties = {
  fontFamily:  'var(--font-body)',
  fontSize:    11,
  color:       'var(--color-text-muted)',
  marginTop:   4,
  lineHeight:  1.4,
}

const field: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SimRunForm({ form, setForm, submitting, error, onSubmit }: Props) {
  const canSubmit = !submitting && form.scenarioName.trim().length > 0

  return (
    <Panel>
      <PanelHeader
        title="Simulation Run"
        subtitle="single policy · offline"
      />

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Scenario Name */}
        <div style={field}>
          <label style={label}>Scenario Name</label>
          <input
            style={input}
            type="text"
            placeholder="e.g. cost-policy-peak-load"
            value={form.scenarioName}
            onChange={e => setForm({ scenarioName: e.target.value })}
            disabled={submitting}
          />
        </div>

        {/* Policy */}
        <div style={field}>
          <label style={label}>Policy <span style={{ opacity: 0.5 }}>(optional)</span></label>
          <input
            style={input}
            type="text"
            placeholder="policy ID or name"
            value={form.policyId}
            onChange={e => setForm({ policyId: e.target.value })}
            disabled={submitting}
          />
          <span style={hint}>Leave blank to use the highest-priority active policy.</span>
        </div>

        {/* Request Count */}
        <div style={field}>
          <label style={label}>Request Count</label>
          <input
            style={input}
            type="number"
            min={1}
            max={1000}
            value={form.requestCount}
            onChange={e => setForm({ requestCount: Math.min(1000, Math.max(1, Number(e.target.value) || 1)) })}
            disabled={submitting}
          />
          <span style={hint}>1 – 1,000 synthetic requests per run.</span>
        </div>

        {/* Source Tag */}
        <div style={field}>
          <label style={label}>Source Tag <span style={{ opacity: 0.5 }}>(optional)</span></label>
          <input
            style={input}
            type="text"
            placeholder="e.g. q1-baseline"
            value={form.sourceTag}
            onChange={e => setForm({ sourceTag: e.target.value })}
            disabled={submitting}
          />
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding:      '8px 10px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(239,68,68,0.07)',
              border:       '1px solid rgba(239,68,68,0.18)',
              fontFamily:   'var(--font-body)',
              fontSize:     12,
              color:        'var(--color-red)',
              lineHeight:   1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             7,
            padding:         '9px 16px',
            borderRadius:    'var(--radius-md)',
            backgroundColor: canSubmit ? 'var(--color-blue)' : 'var(--color-bg-elevated)',
            border:          `1px solid ${canSubmit ? 'var(--color-blue)' : 'var(--color-border)'}`,
            color:           canSubmit ? '#fff' : 'var(--color-text-muted)',
            fontFamily:      'var(--font-mono)',
            fontSize:        12,
            fontWeight:      600,
            letterSpacing:   '0.3px',
            cursor:          canSubmit ? 'pointer' : 'not-allowed',
            transition:      'opacity 0.1s',
            opacity:         canSubmit ? 1 : 0.5,
          }}
        >
          {submitting ? (
            <>
              <Loader2 size={13} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
              Running…
            </>
          ) : (
            <>
              <PlayCircle size={13} strokeWidth={2} />
              Run Simulation
            </>
          )}
        </button>

      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Panel>
  )
}
