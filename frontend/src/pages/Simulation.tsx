/**
 * pages/Simulation.tsx
 *
 * Offline policy experimentation console.
 *
 * Two modes — switched via a segmented tab control:
 *   Single Run    — one policy, configurable request count, aggregate results
 *   Experiment    — multi-policy comparison, side-by-side metrics + rankings
 *
 * All state and submission logic lives in useSimulationPage. This component is
 * purely presentational: it lays out the two-column form + result panels and
 * renders the tab switcher.
 */

import { useSimulationPage } from '../hooks/useSimulationPage'
import { SimRunForm } from '../components/simulation/SimRunForm'
import { SimRunResultPanelFull } from '../components/simulation/SimRunResultPanel'
import { ExperimentForm } from '../components/simulation/ExperimentForm'
import { ExperimentResultPanel } from '../components/simulation/ExperimentResultPanel'
import type { SimTab } from '../hooks/useSimulationPage'

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: SimTab; onChange: (t: SimTab) => void }) {
  const tabs: { id: SimTab; label: string }[] = [
    { id: 'run',        label: 'Single Run' },
    { id: 'experiment', label: 'Experiment' },
  ]

  return (
    <div
      style={{
        display:         'inline-flex',
        padding:         2,
        backgroundColor: 'var(--color-bg-elevated)',
        borderRadius:    'var(--radius-md)',
        border:          '1px solid var(--color-border)',
        gap:             2,
      }}
    >
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            padding:         '5px 18px',
            borderRadius:    'var(--radius-sm)',
            fontFamily:      'var(--font-mono)',
            fontSize:        11,
            fontWeight:      600,
            letterSpacing:   '0.3px',
            color:           active === id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            backgroundColor: active === id ? 'var(--color-bg-surface)' : 'transparent',
            border:          active === id ? '1px solid var(--color-border-strong)' : '1px solid transparent',
            cursor:          'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const FORM_WIDTH = 360

export function Simulation() {
  const page = useSimulationPage()

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
      {/* ── Page header + tab switcher ── */}
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
            Simulation
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize:   13,
              color:      'var(--color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            Offline policy evaluation. Route synthetic workloads without affecting live state.
          </p>
        </div>

        <TabBar active={page.activeTab} onChange={page.setActiveTab} />
      </div>

      {/* ── Single Run ── */}
      {page.activeTab === 'run' && (
        <div
          style={{
            display:             'grid',
            gridTemplateColumns: `${FORM_WIDTH}px 1fr`,
            gap:                 16,
            alignItems:          'start',
          }}
        >
          <SimRunForm
            form={page.runForm}
            setForm={page.setRunForm}
            submitting={page.runSubmitting}
            error={page.runError}
            onSubmit={page.submitRun}
          />

          <SimRunResultPanelFull
            result={page.runResult}
            loading={page.runSubmitting}
            onClear={page.clearRun}
            perModelSelections={page.runRaw?.perModelSelections ?? {}}
            perWorkerAssignments={page.runRaw?.perWorkerAssignments ?? {}}
          />
        </div>
      )}

      {/* ── Experiment ── */}
      {page.activeTab === 'experiment' && (
        <div
          style={{
            display:             'grid',
            gridTemplateColumns: `${FORM_WIDTH}px 1fr`,
            gap:                 16,
            alignItems:          'start',
          }}
        >
          <ExperimentForm
            form={page.expForm}
            setForm={page.setExpForm}
            submitting={page.expSubmitting}
            error={page.expError}
            onSubmit={page.submitExperiment}
          />

          <ExperimentResultPanel
            result={page.expResult}
            raw={page.expRaw}
            loading={page.expSubmitting}
            onClear={page.clearExp}
          />
        </div>
      )}
    </div>
  )
}
