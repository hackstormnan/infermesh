import { PlayCircle } from 'lucide-react'
import { StubPage } from '../components/ui/StubPage'

export function Simulation() {
  return (
    <StubPage
      icon={PlayCircle}
      title="Simulation"
      description="Offline policy evaluation. Run synthetic workloads against one or more routing policies, compare success rates, fallback rates, and evaluation speed without affecting live state."
    />
  )
}
