import { Panel, PanelHeader } from '../ui/Panel'
import { StatusBadge } from '../ui/StatusBadge'
import { LoadingState } from '../ui/LoadingState'
import { EmptyState } from '../ui/EmptyState'
import { ConnectionStatusBadge } from '../ui/ConnectionStatusBadge'
import type { RequestViewModel } from '../../api/mappers/request.mapper'
import type { ConnectionState } from '../../hooks/useStreamSocket'

interface RequestStreamPanelProps {
  requests: RequestViewModel[]
  loading?: boolean
  connectionState?: ConnectionState
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'completed':   return 'var(--color-green)'
    case 'streaming':   return 'var(--color-purple)'
    case 'dispatched':  return 'var(--color-blue)'
    case 'failed':      return 'var(--color-red)'
    case 'cancelled':   return 'var(--color-text-muted)'
    default:            return 'var(--color-amber)' // queued
  }
}

export function RequestStreamPanel({
  requests,
  loading = false,
  connectionState = 'disconnected',
}: RequestStreamPanelProps) {
  return (
    <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <PanelHeader
        title="Request Stream"
        subtitle={loading ? undefined : `${requests.length} recent`}
        right={<ConnectionStatusBadge state={connectionState} />}
      />

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <LoadingState rows={5} compact />
        ) : requests.length === 0 ? (
          <EmptyState
            title="No requests yet"
            description="Requests will appear here as they flow through the gateway."
            compact
          />
        ) : (
          requests.map((req, i) => (
            <div
              key={req.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 16px',
                borderBottom:
                  i < requests.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              {/* Status dot */}
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  flexShrink: 0,
                  backgroundColor: statusDotColor(req.status),
                }}
              />

              {/* Short ID */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  width: 72,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {req.shortId}
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
                {req.modelId}
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

              <StatusBadge status={req.status} />

              {/* Age */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  width: 48,
                  flexShrink: 0,
                  textAlign: 'right',
                }}
              >
                {req.age}
              </span>
            </div>
          ))
        )}
      </div>
    </Panel>
  )
}
