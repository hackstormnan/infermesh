import { Panel, PanelHeader } from '../ui/Panel'
import { Badge } from '../ui/Badge'
import { mockWorkers } from '../../mock/data'
import type { WorkerStatusType } from '../../types'

function workerVariant(s: WorkerStatusType) {
  switch (s) {
    case 'IDLE':      return 'green'
    case 'BUSY':      return 'blue'
    case 'DRAINING':  return 'amber'
    case 'UNHEALTHY': return 'red'
  }
}

export function WorkerStatusPanel() {
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Worker Status" subtitle={`${mockWorkers.length} registered`} />
      <div style={{ padding: '8px 0' }}>
        {mockWorkers.map((w, i) => {
          const utilPct = Math.round((w.activeJobs / w.maxJobs) * 100)
          const barColor =
            utilPct >= 90 ? 'var(--color-red)'   :
            utilPct >= 60 ? 'var(--color-amber)'  :
            'var(--color-blue)'

          return (
            <div
              key={w.id}
              style={{
                padding: '10px 16px',
                borderBottom: i < mockWorkers.length - 1 ? '1px solid var(--color-border)' : 'none',
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
                  }}
                >
                  {w.name}
                </span>
                <Badge label={w.status} variant={workerVariant(w.status)} />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {w.region}
                </span>
              </div>

              {/* Models list */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {w.models.map(m => (
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
                    {w.activeJobs}/{w.maxJobs} jobs
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
        })}
      </div>
    </Panel>
  )
}
