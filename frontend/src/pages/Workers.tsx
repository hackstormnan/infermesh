import { Cpu } from 'lucide-react'
import { StubPage } from '../components/ui/StubPage'

export function Workers() {
  return (
    <StubPage
      icon={Cpu}
      title="Workers"
      description="Live worker registry with heartbeat status, capability matrix, capacity utilisation, and health eviction events."
    />
  )
}
