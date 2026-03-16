import { Zap } from 'lucide-react'
import { StubPage } from '../components/ui/StubPage'

export function Requests() {
  return (
    <StubPage
      icon={Zap}
      title="Requests"
      description="Paginated inference request log with status filtering, model breakdown, and per-request detail views."
    />
  )
}
