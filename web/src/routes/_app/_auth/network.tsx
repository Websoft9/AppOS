import { createFileRoute } from '@tanstack/react-router'
import { NetworkPlaceholderPage } from '@/pages/system/NetworkPlaceholderPage'

function NetworkPage() {
  return (
    <NetworkPlaceholderPage
      title="Network"
      description="Manage network-facing services, tunnels, and traffic visibility from one place."
      emptyTitle="Network dashboard"
      emptyDescription="This landing page is reserved for future network summaries and traffic monitors."
    />
  )
}

export const Route = createFileRoute('/_app/_auth/network' as never)({
  component: NetworkPage,
})