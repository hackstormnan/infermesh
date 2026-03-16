import { StatCard } from '../components/ui/StatCard'
import { Panel, PanelHeader } from '../components/ui/Panel'
import { ChartPlaceholder, LineChartPlaceholder } from '../components/ui/ChartPlaceholder'
import { RequestStreamPanel } from '../components/overview/RequestStreamPanel'
import { RoutingDecisionPanel } from '../components/overview/RoutingDecisionPanel'
import { WorkerStatusPanel } from '../components/overview/WorkerStatusPanel'
import { mockStatCards } from '../mock/data'

export function Overview() {
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
        {mockStatCards.map(card => (
          <StatCard key={card.label} data={card} />
        ))}
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
          <RequestStreamPanel />

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
                  }}
                >
                  48.3
                  <span
                    style={{
                      marginLeft: 8,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'var(--color-green)',
                    }}
                  >
                    ↑ 12%
                  </span>
                </div>
                <ChartPlaceholder height={72} />
              </div>
            </Panel>

            {/* Latency chart */}
            <Panel>
              <PanelHeader title="P95 Latency" subtitle="ms · 1h" />
              <div style={{ padding: '12px 16px 14px' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    fontWeight: 700,
                    color: 'var(--color-text-primary)',
                    marginBottom: 12,
                  }}
                >
                  214
                  <span
                    style={{
                      marginLeft: 8,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'var(--color-green)',
                    }}
                  >
                    ↓ 8%
                  </span>
                </div>
                <LineChartPlaceholder height={72} />
              </div>
            </Panel>

          </div>
        </div>

        {/* ── Right column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <RoutingDecisionPanel />
          <WorkerStatusPanel />
        </div>
      </div>
    </div>
  )
}
