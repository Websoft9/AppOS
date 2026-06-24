import { createFileRoute } from '@tanstack/react-router'
import { NetworkPlaceholderPage } from '@/pages/system/NetworkPlaceholderPage'

function GatewayPage() {
  return (
    <NetworkPlaceholderPage
      title="Gateway"
      description="Administer ingress, published endpoints, and gateway-facing controls here."
      emptyTitle="Gateway console"
      emptyDescription="Gateway administration surfaces will be added here in a future slice."
    />
  )
}

export const Route = createFileRoute('/_app/_auth/gateway' as never)({
  component: GatewayPage,
})