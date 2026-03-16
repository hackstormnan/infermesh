import { Panel, PanelHeader } from '../ui/Panel'
import { Badge } from '../ui/Badge'
import { mockRequestStream as mockRequests } from '../../mock/data'
import type { RequestStatus } from '../../types'

function statusVariant(s: RequestStatus) {
  switch (s) {
    case 'ROUTED':   return 'green'
    case 'QUEUED':   return 'amber'
    case 'ASSIGNED': return 'blue'
    case 'FAILED':   return 'red'
  }
}

export function RequestStreamPanel() {
  return (
    <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <PanelHeader
        title="Request Stream"
        subtitle={`${mockRequests.length} recent`}
        right={
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-green)',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                backgroundColor: 'var(--color-green)',
                boxShadow: '0 0 4px rgba(34,197,94,0.6)',
              }}
            />
            Live
          </span>
        }
      />
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {mockRequests.map((req, i) => (
          <div
            key={req.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 16px',
              borderBottom: i < mockRequests.length - 1 ? '1px solid var(--color-border)' : 'none',
            }}
          >
            {/* Status dot */}
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor:
                  req.status === 'ROUTED'   ? 'var(--color-green)'  :
                  req.status === 'FAILED'   ? 'var(--color-red)'    :
                  req.status === 'ASSIGNED' ? 'var(--color-blue)'   :
                  'var(--color-amber)',
              }}
            />

            {/* ID */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-text-muted)',
                width: 80,
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {req.id}
            </span>

            {/* Model */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {req.model}
            </span>

            {/* Task type */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                width: 80,
                flexShrink: 0,
                textAlign: 'right',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {req.taskType}
            </span>

            <Badge label={req.status} variant={statusVariant(req.status)} />

            {/* Age */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                width: 32,
                flexShrink: 0,
                textAlign: 'right',
              }}
            >
              {req.age}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
