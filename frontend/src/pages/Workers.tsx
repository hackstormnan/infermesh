/**
 * pages/Workers.tsx
 *
 * Live worker registry page.
 *
 * Data: REST seed (GET /api/v1/workers) + WebSocket "workers" channel via
 *       useWorkerStream — heartbeat events update cards in-place.
 *
 * Layout:
 *   - Page header + connection badge
 *   - 4 summary cards (Total / Healthy / Degraded / Offline)
 *   - Responsive 2-column worker card grid
 */

import { Cpu } from 'lucide-react'
import { useWorkerStream } from '../hooks/useWorkerStream'
import { WorkerCard } from '../components/workers/WorkerCard'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { SkeletonBlock } from '../components/ui/LoadingState'
import { MiniStatCard } from '../components/ui/MiniStatCard'
import { ConnectionStatusBadge } from '../components/ui/ConnectionStatusBadge'
import type { WorkerViewModel } from '../api/mappers/worker.mapper'

// ─── Worker skeleton card ─────────────────────────────────────────────────────

function WorkerCardSkeleton() {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border:          '1px solid var(--color-border)',
        borderRadius:    'var(--radius-lg)',
        padding:         '14px',
        display:         'flex',
        flexDirection:   'column',
        gap:             10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SkeletonBlock width={8} height={8} borderRadius="50%" />
        <SkeletonBlock width="55%" height={13} />
        <SkeletonBlock width={52} height={20} style={{ marginLeft: 'auto' }} />
      </div>
      <SkeletonBlock width="75%" height={10} />
      <SkeletonBlock width="100%" height={4} borderRadius={2} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} width="100%" height={28} />
        ))}
      </div>
    </div>
  )
}

// ─── Summary counters ─────────────────────────────────────────────────────────

function countByHealth(workers: WorkerViewModel[]) {
  return {
    total:    workers.length,
    healthy:  workers.filter(w => w.health === 'healthy').length,
    degraded: workers.filter(w => w.health === 'degraded' || w.health === 'unhealthy').length,
    offline:  workers.filter(w => w.health === 'offline').length,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Workers() {
  const { workers, loading, error, connectionState } = useWorkerStream()
  const counts = countByHealth(workers)

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
      {/* ── Page header ── */}
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
            Workers
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize:   13,
              color:      'var(--color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            Live worker registry. Heartbeat status, capacity, and runtime metrics updated in real-time.
          </p>
        </div>
        <ConnectionStatusBadge state={connectionState} />
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MiniStatCard label="Total"    value={String(counts.total)}    loading={loading} />
        <MiniStatCard label="Healthy"  value={String(counts.healthy)}  loading={loading} accent={counts.healthy  > 0 ? 'var(--color-green)' : undefined} />
        <MiniStatCard label="Degraded" value={String(counts.degraded)} loading={loading} accent={counts.degraded > 0 ? 'var(--color-amber)' : undefined} />
        <MiniStatCard label="Offline"  value={String(counts.offline)}  loading={loading} accent={counts.offline  > 0 ? 'var(--color-red)'   : undefined} />
      </div>

      {/* ── Worker grid ── */}
      {error ? (
        <ErrorState
          title="Failed to load workers"
          message={error}
          compact
        />
      ) : loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {Array.from({ length: 4 }, (_, i) => <WorkerCardSkeleton key={i} />)}
        </div>
      ) : workers.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No workers registered"
          description="Workers appear here once they connect to the gateway. Check that your worker processes are running and have a valid gateway endpoint configured."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {workers.map(w => (
            <WorkerCard key={w.id} worker={w} />
          ))}
        </div>
      )}
    </div>
  )
}
