import { StatCard } from '../components/ui/StatCard'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ChartPlaceholder, LineChartPlaceholder } from '../components/ui/ChartPlaceholder'
import { SkeletonBlock } from '../components/ui/LoadingState'
import { ErrorState } from '../components/ui/ErrorState'
import { StaleBadge } from '../components/ui/StaleBadge'
import { RequestStreamPanel } from '../components/overview/RequestStreamPanel'
import { RoutingDecisionPanel } from '../components/overview/RoutingDecisionPanel'
import { WorkerStatusPanel } from '../components/overview/WorkerStatusPanel'
import { useSummaryStats } from '../hooks/useSummaryStats'
import { useTimeSeriesMetrics } from '../hooks/useTimeSeriesMetrics'
import { useRequestStream } from '../hooks/useRequestStream'
import { useDecisionStream } from '../hooks/useDecisionStream'
import { useWorkerStream } from '../hooks/useWorkerStream'
import type { StatCardData } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive req/min from the most recent time-series bucket */
function latestReqPerMin(
  points: { requests: number }[],
  granularityMs: number,
): number {
  if (points.length === 0) return 0
  const last = points[points.length - 1]
  const perMin = last.requests / (granularityMs / 60_000)
  return Math.round(perMin * 10) / 10
}

/** Compare first-half vs second-half average to derive a trend string */
function halfTrend(
  points: { value: number }[],
): { formatted: string; direction: 'up' | 'down' | 'flat' } {
  if (points.length < 4) return { formatted: '—', direction: 'flat' }
  const mid = Math.floor(points.length / 2)
  const avg = (arr: { value: number }[]) =>
    arr.reduce((s, p) => s + p.value, 0) / arr.length
  const first = avg(points.slice(0, mid))
  const second = avg(points.slice(mid))
  if (first === 0) return { formatted: '—', direction: 'flat' }
  const pct = ((second - first) / first) * 100
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(pct) < 1 ? 'flat' : pct > 0 ? 'up' : 'down'
  const sign = pct >= 0 ? '+' : ''
  return { formatted: `${sign}${pct.toFixed(1)}%`, direction }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Overview() {
  const {
    data:          stats,
    loading:       statsLoading,
    error:         statsError,
    isStale:       statsStale,
    lastUpdatedAt: statsUpdatedAt,
    refetch:       refetchStats,
  } = useSummaryStats()
  const { data: timeSeries } = useTimeSeriesMetrics('1h')
  const { requests, loading: reqLoading, connectionState: reqConn } = useRequestStream()
  const { decisions, loading: decLoading, connectionState: decConn } = useDecisionStream()
  const { workers, loading: wrkLoading, connectionState: wrkConn } = useWorkerStream()

  // ── Build stat card data from live backend stats ───────────────────────────
  const statCards: StatCardData[] = stats
    ? [
        {
          label: 'Total Requests',
          value: stats.totalRequests,
          delta: stats.changes.totalRequests.formatted,
          deltaPositive: stats.changes.totalRequests.direction === 'up',
        },
        {
          label: 'Active Workers',
          value: String(stats.activeWorkers),
          delta: stats.requestsPerSecond,
          deltaPositive: true,
          deltaIsPolicy: true,
        },
        {
          label: 'Avg Latency',
          value: stats.avgLatencyMs,
          delta: stats.changes.avgLatency.formatted,
          // Lower latency is better for the user
          deltaPositive: stats.changes.avgLatency.direction === 'down',
        },
        {
          label: 'Routing Success',
          value: stats.successRatePct,
          delta: stats.changes.requestsPerSecond.formatted,
          deltaPositive: true,
          deltaIsPolicy: true,
        },
      ]
    : []

  // ── Derive chart values from time-series data ─────────────────────────────
  const reqPerMin = timeSeries
    ? latestReqPerMin(timeSeries.points, timeSeries.granularityMs)
    : null

  const reqTrend = timeSeries
    ? halfTrend(timeSeries.points.map(p => ({ value: p.requests })))
    : null

  const latencyAvg =
    timeSeries && timeSeries.points.length > 0
      ? Math.round(
          timeSeries.points.reduce((s, p) => s + p.avgLatencyMs, 0) /
            timeSeries.points.length,
        )
      : null

  const latencyTrend = timeSeries
    ? halfTrend(timeSeries.points.map(p => ({ value: p.avgLatencyMs })))
    : null

  return (
    <div
      style={{
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Stat cards row ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        {statsStale && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <StaleBadge isStale={statsStale} lastUpdatedAt={statsUpdatedAt} />
          </div>
        )}
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
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '18px 20px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
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

      {/* ── Main content: left col + right col ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: 16,
          flex: 1,
          minHeight: 0,
          alignItems: 'start',
        }}
      >
        {/* ── Left column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Request Stream */}
          <RequestStreamPanel
            requests={requests}
            loading={reqLoading}
            connectionState={reqConn}
          />

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

            {/* Throughput chart */}
            <Panel>
              <PanelHeader title="Throughput" subtitle="req/min · 1h" />
              <div style={{ padding: '12px 16px 14px' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    fontWeight: 700,
                    color: 'var(--color-text-primary)',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                  }}
                >
                  {reqPerMin !== null ? reqPerMin : '—'}
                  {reqTrend && reqTrend.direction !== 'flat' && (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        fontWeight: 400,
                        color:
                          reqTrend.direction === 'up'
                            ? 'var(--color-green)'
                            : 'var(--color-red)',
                      }}
                    >
                      {reqTrend.direction === 'up' ? '↑' : '↓'} {reqTrend.formatted}
                    </span>
                  )}
                </div>
                <ChartPlaceholder height={72} />
              </div>
            </Panel>

            {/* Latency chart */}
            <Panel>
              <PanelHeader title="Avg Latency" subtitle="ms · 1h" />
              <div style={{ padding: '12px 16px 14px' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    fontWeight: 700,
                    color: 'var(--color-text-primary)',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                  }}
                >
                  {latencyAvg !== null ? `${latencyAvg} ms` : '—'}
                  {latencyTrend && latencyTrend.direction !== 'flat' && (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        fontWeight: 400,
                        // Latency: down = good (green), up = bad (red)
                        color:
                          latencyTrend.direction === 'down'
                            ? 'var(--color-green)'
                            : 'var(--color-red)',
                      }}
                    >
                      {latencyTrend.direction === 'up' ? '↑' : '↓'} {latencyTrend.formatted}
                    </span>
                  )}
                </div>
                <LineChartPlaceholder height={72} />
              </div>
            </Panel>

          </div>
        </div>

        {/* ── Right column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <RoutingDecisionPanel
            decisions={decisions}
            loading={decLoading}
            connectionState={decConn}
          />
          <WorkerStatusPanel
            workers={workers}
            loading={wrkLoading}
            connectionState={wrkConn}
          />
        </div>
      </div>
    </div>
  )
}
