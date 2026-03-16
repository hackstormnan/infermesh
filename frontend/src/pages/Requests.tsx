import { StatCard } from '../components/ui/StatCard'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { SkeletonBlock } from '../components/ui/LoadingState'
import { ErrorState } from '../components/ui/ErrorState'
import { ConnectionStatusBadge } from '../components/ui/ConnectionStatusBadge'
import { RequestsFilterBar } from '../components/requests/RequestsFilterBar'
import { RequestsTable } from '../components/requests/RequestsTable'
import { useSummaryStats } from '../hooks/useSummaryStats'
import { useRequestsPage } from '../hooks/useRequestsPage'
import type { StatCardData } from '../types'

// ─── Export handler (shell — no backend endpoint yet) ─────────────────────────

function handleExport() {
  // eslint-disable-next-line no-alert
  alert('Export is not yet available. The backend endpoint will be connected in a future release.')
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Requests() {
  const {
    data:    stats,
    loading: statsLoading,
    error:   statsError,
    refetch: refetchStats,
  } = useSummaryStats()

  const {
    requests,
    total,
    page,
    limit,
    loading,
    error,
    connectionState,
    search,
    statusFilter,
    setSearch,
    setStatusFilter,
    setPage,
    refetch,
  } = useRequestsPage()

  // ── Stat cards derived from summary stats ─────────────────────────────────
  const statCards: StatCardData[] = stats
    ? [
        {
          label:         'Total Requests',
          value:         stats.totalRequests,
          delta:         stats.changes.totalRequests.formatted,
          deltaPositive: stats.changes.totalRequests.direction === 'up',
        },
        {
          label:         'Success Rate',
          value:         stats.successRatePct,
          delta:         stats.requestsPerSecond,
          deltaPositive: true,
          deltaIsPolicy: true,
        },
        {
          label:         'Avg Latency',
          value:         stats.avgLatencyMs,
          delta:         stats.changes.avgLatency.formatted,
          deltaPositive: stats.changes.avgLatency.direction === 'down',
        },
        {
          label:         'Active Workers',
          value:         String(stats.activeWorkers),
          delta:         stats.changes.requestsPerSecond.formatted,
          deltaPositive: stats.changes.requestsPerSecond.direction === 'up',
        },
      ]
    : []

  return (
    <div
      style={{
        padding:       '20px 24px',
        display:       'flex',
        flexDirection: 'column',
        gap:           20,
        minHeight:     '100%',
        boxSizing:     'border-box',
      }}
    >
      {/* ── Stat cards ── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:                 12,
        }}
      >
        {statsError ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <ErrorState
              title="Stats unavailable"
              message={statsError}
              onRetry={refetchStats}
              compact
            />
          </div>
        ) : statsLoading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              style={{
                backgroundColor: 'var(--color-bg-surface)',
                border:          '1px solid var(--color-border)',
                borderRadius:    'var(--radius-lg)',
                padding:         '18px 20px 16px',
                display:         'flex',
                flexDirection:   'column',
                gap:             12,
              }}
            >
              <SkeletonBlock width="50%" height={10} />
              <SkeletonBlock width="70%" height={28} />
              <SkeletonBlock width="40%" height={10} />
            </div>
          ))
        ) : (
          statCards.map(card => <StatCard key={card.label} data={card} />)
        )}
      </div>

      {/* ── Request log panel ── */}
      <Panel style={{ display: 'flex', flexDirection: 'column' }}>
        <PanelHeader
          title="Request Log"
          subtitle={loading || error ? undefined : `${total.toLocaleString()} total`}
          right={<ConnectionStatusBadge state={connectionState} />}
        />

        <RequestsFilterBar
          search={search}
          statusFilter={statusFilter}
          total={total}
          loading={loading}
          error={error}
          onSearchChange={setSearch}
          onStatusChange={setStatusFilter}
          onExport={handleExport}
        />

        <RequestsTable
          requests={requests}
          total={total}
          page={page}
          limit={limit}
          loading={loading}
          error={error}
          onPageChange={setPage}
          onRetry={refetch}
        />
      </Panel>
    </div>
  )
}
