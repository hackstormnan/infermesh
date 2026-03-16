import { GitBranch } from 'lucide-react'
import { StubPage } from '../components/ui/StubPage'

export function Routing() {
  return (
    <StubPage
      icon={GitBranch}
      title="Routing"
      description="Policy management and decision history. Create cost, latency, affinity, and canary strategies. Inspect per-decision candidate score breakdowns."
    />
  )
}
