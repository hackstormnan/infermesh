import { Box } from 'lucide-react'
import { StubPage } from '../components/ui/StubPage'

export function Models() {
  return (
    <StubPage
      icon={Box}
      title="Models"
      description="Model registry with provider, tier, context window, cost-per-token, and capability tags. Register, update, and deactivate model entries."
    />
  )
}
