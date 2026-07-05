import { createFileRoute } from '@tanstack/react-router'
import { NetworkPlaceholderPage } from '@/pages/system/NetworkPlaceholderPage'

function TrafficPage() {
  return (
    <NetworkPlaceholderPage
      title="Traffic"
      description="Monitor HTTP proxy and gateway traffic from a dedicated network operations surface."
      emptyTitle="Traffic monitor"
      emptyDescription="Traffic dashboards and flow summaries will be added here in a future slice."
    />
  )
}

export const Route = createFileRoute('/_app/_auth/traffic' as never)({
  component: TrafficPage,
})
