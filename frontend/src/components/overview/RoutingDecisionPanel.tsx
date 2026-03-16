import { Panel, PanelHeader } from '../ui/Panel'
import { StatusBadge } from '../ui/StatusBadge'
import { LoadingState } from '../ui/LoadingState'
import { EmptyState } from '../ui/EmptyState'
import { ConnectionStatusBadge } from '../ui/ConnectionStatusBadge'
import type { RoutingDecisionViewModel } from '../../api/mappers/routing.mapper'
import type { ConnectionState } from '../../hooks/useStreamSocket'

interface RoutingDecisionPanelProps {
  decisions: RoutingDecisionViewModel[]
  loading?: boolean
  connectionState?: ConnectionState
}

export function RoutingDecisionPanel({
  decisions,
  loading = false,
  connectionState = 'disconnected',
}: RoutingDecisionPanelProps) {
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHeader
        title="Routing Decisions"
        subtitle={loading ? undefined : `${decisions.length} recent`}
        right={<ConnectionStatusBadge state={connectionState} />}
      />

      <div>
        {loading ? (
          <LoadingState rows={4} compact />
        ) : decisions.length === 0 ? (
          <EmptyState
            title="No decisions yet"
            description="Routing decisions will appear as requests are dispatched."
            compact
          />
        ) : (
          decisions.map((d, i) => (
            <div
              key={d.id}
              style={{
                padding: '10px 16px',
                borderBottom:
                  i < decisions.length - 1 ? '1px solid var(--color-border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {/* Top row: policy short-id + outcome badge + eval time */}
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
                  policy/{d.policyId.slice(0, 8)}
                </span>
                <StatusBadge status={d.outcome} />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d.evalDisplay}
                </span>
              </div>

              {/* Bottom row: model → worker + age */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 100,
                  }}
                >
                  {d.selectedModelId ?? '—'}
                </span>
                <span
                  style={{ color: 'var(--color-text-muted)', fontSize: 10, flexShrink: 0 }}
                >
                  →
                </span>
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
                  {d.selectedWorkerId ?? '—'}
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
          ))
        )}
      </div>
    </Panel>
  )
}
