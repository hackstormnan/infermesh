import { BarChart2 } from 'lucide-react'
import { StubPage } from '../components/ui/StubPage'

export function Metrics() {
  return (
    <StubPage
      icon={BarChart2}
      title="Metrics"
      description="System-wide analytics: throughput trends, p50/p75/p95/p99 latency percentiles, per-model cost allocation, and period-over-period deltas."
    />
  )
}
