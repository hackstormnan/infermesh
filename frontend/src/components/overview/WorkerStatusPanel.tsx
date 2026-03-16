import { Panel, PanelHeader } from '../ui/Panel'
import { StatusBadge } from '../ui/StatusBadge'
import { LoadingState } from '../ui/LoadingState'
import { EmptyState } from '../ui/EmptyState'
import { ConnectionStatusBadge } from '../ui/ConnectionStatusBadge'
import type { WorkerViewModel } from '../../api/mappers/worker.mapper'
import type { ConnectionState } from '../../hooks/useStreamSocket'

interface WorkerStatusPanelProps {
  workers: WorkerViewModel[]
  loading?: boolean
  connectionState?: ConnectionState
}

export function WorkerStatusPanel({
  workers,
  loading = false,
  connectionState = 'disconnected',
}: WorkerStatusPanelProps) {
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHeader
        title="Worker Status"
        subtitle={loading ? undefined : `${workers.length} registered`}
        right={<ConnectionStatusBadge state={connectionState} />}
      />

      <div style={{ padding: '8px 0' }}>
        {loading ? (
          <LoadingState rows={3} compact />
        ) : workers.length === 0 ? (
          <EmptyState
            title="No workers registered"
            description="Workers will appear here once they connect to the gateway."
            compact
          />
        ) : (
          workers.map((w, i) => {
            const utilPct = Math.round(w.utilization * 100)
            const barColor =
              utilPct >= 90
                ? 'var(--color-red)'
                : utilPct >= 60
                  ? 'var(--color-amber)'
                  : 'var(--color-blue)'

            return (
              <div
                key={w.id}
                style={{
                  padding: '10px 16px',
                  borderBottom:
                    i < workers.length - 1 ? '1px solid var(--color-border)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {/* Name + status + region */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--color-text-primary)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {w.name}
                  </span>
                  <StatusBadge status={w.status} />
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--color-text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {w.region}
                  </span>
                </div>

                {/* Supported models */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {w.supportedModelIds.map(m => (
                    <span
                      key={m}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        color: 'var(--color-text-muted)',
                        padding: '1px 5px',
                        borderRadius: 3,
                        backgroundColor: 'var(--color-bg-elevated)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      {m}
                    </span>
                  ))}
                </div>

                {/* Capacity bar */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {w.activeJobs}/{w.maxConcurrentJobs} jobs
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: barColor,
                      }}
                    >
                      {utilPct}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: 'var(--color-bg-elevated)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${utilPct}%`,
                        borderRadius: 2,
                        backgroundColor: barColor,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </Panel>
  )
}
