import { Panel, PanelHeader } from '../ui/Panel'
import { Badge } from '../ui/Badge'
import { mockRoutingDecisions } from '../../mock/data'
import type { DecisionOutcome } from '../../types'

function outcomeVariant(o: DecisionOutcome) {
  switch (o) {
    case 'ROUTED':   return 'green'
    case 'FALLBACK': return 'amber'
    case 'FAILED':   return 'red'
  }
}

export function RoutingDecisionPanel() {
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Routing Decisions" subtitle={`${mockRoutingDecisions.length} recent`} />
      <div>
        {mockRoutingDecisions.map((d, i) => (
          <div
            key={d.id}
            style={{
              padding: '10px 16px',
              borderBottom: i < mockRoutingDecisions.length - 1 ? '1px solid var(--color-border)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {/* Top row: policy + outcome + eval time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-blue)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.policyName}
              </span>
              <Badge label={d.outcome} variant={outcomeVariant(d.outcome)} />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.evalMs}ms
              </span>
            </div>

            {/* Bottom row: model → worker + age */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                }}
              >
                {d.selectedModel}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>→</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.selectedWorker}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  flexShrink: 0,
                }}
              >
                {d.age}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
