import { useMetricsPage } from '../hooks/useMetricsPage'
import { MetricsPeriodSelector } from '../components/metrics/MetricsPeriodSelector'
import { MetricsSummaryCards } from '../components/metrics/MetricsSummaryCards'
import { ThroughputChart } from '../components/metrics/ThroughputChart'
import { LatencyLineChart } from '../components/metrics/LatencyLineChart'
import { LatencyPercentilesCard } from '../components/metrics/LatencyPercentilesCard'
import { CostBreakdownTable } from '../components/metrics/CostBreakdownTable'

// ─── Component ────────────────────────────────────────────────────────────────

export function Metrics() {
  const {
    period,
    setPeriod,
    summary,
    timeSeries,
    latencyPercentiles,
    costBreakdown,
  } = useMetricsPage()

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
      {/* ── Period selector ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <MetricsPeriodSelector period={period} onChange={setPeriod} />
      </div>

      {/* ── Summary stat cards ── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:                 12,
        }}
      >
        <MetricsSummaryCards
          data={summary.data}
          loading={summary.loading}
          error={summary.error}
          onRetry={summary.refetch}
        />
      </div>

      {/* ── Charts row: Throughput + Avg Latency ── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: '1fr 1fr',
          gap:                 16,
        }}
      >
        <ThroughputChart
          data={timeSeries.data}
          period={period}
          loading={timeSeries.loading}
          error={timeSeries.error}
          onRetry={timeSeries.refetch}
        />
        <LatencyLineChart
          data={timeSeries.data}
          summaryData={summary.data}
          period={period}
          loading={timeSeries.loading}
          error={timeSeries.error}
          onRetry={timeSeries.refetch}
        />
      </div>

      {/* ── Analytics row: Latency percentiles + Cost breakdown ── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: '1fr 1fr',
          gap:                 16,
        }}
      >
        <LatencyPercentilesCard
          data={latencyPercentiles.data}
          period={period}
          loading={latencyPercentiles.loading}
          error={latencyPercentiles.error}
          onRetry={latencyPercentiles.refetch}
        />
        <CostBreakdownTable
          data={costBreakdown.data}
          period={period}
          loading={costBreakdown.loading}
          error={costBreakdown.error}
          onRetry={costBreakdown.refetch}
        />
      </div>
    </div>
  )
}
