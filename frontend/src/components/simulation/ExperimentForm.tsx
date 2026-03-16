/**
 * components/simulation/ExperimentForm.tsx
 *
 * Form panel for a multi-policy experiment run.
 * Core fields always visible; advanced workload distribution fields are
 * shown/hidden with a local toggle.
 */

import { useState } from 'react'
import { FlaskConical, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Panel, PanelHeader } from '../ui/Panel'
import type { ExperimentFormValues } from '../../hooks/useSimulationPage'

interface Props {
  form:       ExperimentFormValues
  setForm:    (patch: Partial<ExperimentFormValues>) => void
  submitting: boolean
  error:      string | null
  onSubmit:   () => void
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const label: React.CSSProperties = {
  display:       'block',
  fontFamily:    'var(--font-mono)',
  fontSize:      10,
  fontWeight:    600,
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  color:         'var(--color-text-muted)',
  marginBottom:  6,
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
  fontFamily: 'var(--font-body)',
  fontSize:   11,
  color:      'var(--color-text-muted)',
  marginTop:  4,
  lineHeight: 1.4,
}

// ─── Mini distribution row ────────────────────────────────────────────────────

function DistRow({
  label: rowLabel,
  keys,
  values,
  onChange,
  disabled,
}: {
  label:    string
  keys:     string[]
  values:   Record<string, string>
  onChange: (key: string, val: string) => void
  disabled: boolean
}) {
  return (
    <div>
      <span
        style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      10,
          fontWeight:    600,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
          color:         'var(--color-text-muted)',
          display:       'block',
          marginBottom:  6,
        }}
      >
        {rowLabel}
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${keys.length}, 1fr)`, gap: 6 }}>
        {keys.map(k => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              {k}
            </span>
            <input
              style={{ ...input, padding: '5px 8px' }}
              type="number"
              min={0}
              step={0.1}
              placeholder="—"
              value={values[k] ?? ''}
              onChange={e => onChange(k, e.target.value)}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      <span style={{ ...hint, marginTop: 4 }}>Relative weights — leave blank for uniform.</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExperimentForm({ form, setForm, submitting, error, onSubmit }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const canSubmit = !submitting
    && form.experimentName.trim().length > 0
    && form.policiesRaw.trim().length > 0

  return (
    <Panel>
      <PanelHeader
        title="Experiment"
        subtitle="multi-policy · offline comparison"
      />

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Experiment Name */}
        <div>
          <label style={label}>Experiment Name</label>
          <input
            style={input}
            type="text"
            placeholder="e.g. cost-vs-latency-q2-2026"
            value={form.experimentName}
            onChange={e => setForm({ experimentName: e.target.value })}
            disabled={submitting}
          />
        </div>

        {/* Policies */}
        <div>
          <label style={label}>Policies</label>
          <textarea
            style={{
              ...input,
              height:     88,
              resize:     'vertical',
              lineHeight: 1.55,
            }}
            placeholder={'cost-optimised\nleast-loaded\nlatency-optimised'}
            value={form.policiesRaw}
            onChange={e => setForm({ policiesRaw: e.target.value })}
            disabled={submitting}
          />
          <span style={hint}>One policy ID or name per line (or comma-separated). Each policy runs independently against the same workload.</span>
        </div>

        {/* Request Count */}
        <div>
          <label style={label}>Request Count</label>
          <input
            style={input}
            type="number"
            min={1}
            max={10000}
            value={form.requestCount}
            onChange={e => setForm({ requestCount: Math.min(10_000, Math.max(1, Number(e.target.value) || 1)) })}
            disabled={submitting}
          />
          <span style={hint}>Requests generated once and routed through every policy. 1 – 10,000.</span>
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{
            display:        'flex',
            alignItems:     'center',
            gap:            6,
            padding:        '7px 10px',
            borderRadius:   'var(--radius-md)',
            backgroundColor:'var(--color-bg-elevated)',
            border:         '1px solid var(--color-border)',
            fontFamily:     'var(--font-mono)',
            fontSize:       10,
            fontWeight:     600,
            letterSpacing:  '0.5px',
            textTransform:  'uppercase',
            color:          'var(--color-text-muted)',
            cursor:         'pointer',
            alignSelf:      'flex-start',
          }}
        >
          {showAdvanced ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />}
          Advanced Workload
        </button>

        {/* Advanced section */}
        {showAdvanced && (
          <div
            style={{
              display:         'flex',
              flexDirection:   'column',
              gap:             14,
              padding:         '14px',
              backgroundColor: 'var(--color-bg-elevated)',
              borderRadius:    'var(--radius-md)',
              border:          '1px solid var(--color-border)',
            }}
          >

            {/* Task distribution */}
            <DistRow
              label="Task Distribution"
              keys={['chat', 'analysis', 'reasoning']}
              values={form.taskDist}
              onChange={(k, v) => setForm({ taskDist: { ...form.taskDist, [k]: v } })}
              disabled={submitting}
            />

            {/* Input size */}
            <DistRow
              label="Input Size Distribution"
              keys={['small', 'medium', 'large']}
              values={form.sizeDist}
              onChange={(k, v) => setForm({ sizeDist: { ...form.sizeDist, [k]: v } })}
              disabled={submitting}
            />

            {/* Complexity */}
            <DistRow
              label="Complexity Distribution"
              keys={['low', 'medium', 'high']}
              values={form.complexityDist}
              onChange={(k, v) => setForm({ complexityDist: { ...form.complexityDist, [k]: v } })}
              disabled={submitting}
            />

            {/* Burst toggle */}
            <div>
              <label style={label}>Burst Pattern</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <label
                  style={{
                    display:    'flex',
                    alignItems: 'center',
                    gap:        7,
                    cursor:     'pointer',
                    fontFamily: 'var(--font-body)',
                    fontSize:   12,
                    color:      'var(--color-text-secondary)',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.burstEnabled}
                    onChange={e => setForm({ burstEnabled: e.target.checked })}
                    disabled={submitting}
                    style={{ accentColor: 'var(--color-blue)', width: 13, height: 13 }}
                  />
                  Enable periodic burst spike
                </label>
              </div>
              {form.burstEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                      Burst Interval
                    </span>
                    <input
                      style={input}
                      type="number"
                      min={1}
                      value={form.burstInterval}
                      onChange={e => setForm({ burstInterval: Math.max(1, Number(e.target.value) || 1) })}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                      Burst Size
                    </span>
                    <input
                      style={input}
                      type="number"
                      min={1}
                      value={form.burstSize}
                      onChange={e => setForm({ burstSize: Math.max(1, Number(e.target.value) || 1) })}
                      disabled={submitting}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Random Seed */}
            <div>
              <label style={label}>Random Seed <span style={{ opacity: 0.5 }}>(optional)</span></label>
              <input
                style={input}
                type="number"
                placeholder="e.g. 42"
                value={form.randomSeed}
                onChange={e => setForm({ randomSeed: e.target.value })}
                disabled={submitting}
              />
              <span style={hint}>Same seed produces a deterministic, reproducible workload.</span>
            </div>

            {/* Source Tag */}
            <div>
              <label style={label}>Source Tag <span style={{ opacity: 0.5 }}>(optional)</span></label>
              <input
                style={input}
                type="text"
                placeholder="e.g. nightly-benchmark"
                value={form.sourceTag}
                onChange={e => setForm({ sourceTag: e.target.value })}
                disabled={submitting}
              />
            </div>

          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              padding:         '8px 10px',
              borderRadius:    'var(--radius-md)',
              backgroundColor: 'rgba(239,68,68,0.07)',
              border:          '1px solid rgba(239,68,68,0.18)',
              fontFamily:      'var(--font-body)',
              fontSize:        12,
              color:           'var(--color-red)',
              lineHeight:      1.4,
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
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            7,
            padding:        '9px 16px',
            borderRadius:   'var(--radius-md)',
            backgroundColor: canSubmit ? 'var(--color-blue)' : 'var(--color-bg-elevated)',
            border:         `1px solid ${canSubmit ? 'var(--color-blue)' : 'var(--color-border)'}`,
            color:          canSubmit ? '#fff' : 'var(--color-text-muted)',
            fontFamily:     'var(--font-mono)',
            fontSize:       12,
            fontWeight:     600,
            letterSpacing:  '0.3px',
            cursor:         canSubmit ? 'pointer' : 'not-allowed',
            opacity:        canSubmit ? 1 : 0.5,
          }}
        >
          {submitting ? (
            <>
              <Loader2 size={13} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
              Running Experiment…
            </>
          ) : (
            <>
              <FlaskConical size={13} strokeWidth={2} />
              Run Experiment
            </>
          )}
        </button>

      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Panel>
  )
}
