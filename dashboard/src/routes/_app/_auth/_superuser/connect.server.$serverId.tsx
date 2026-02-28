import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyConnectServerPage = lazy(() =>
  import('@/pages/connect/ConnectServerPage').then((module) => ({ default: module.ConnectServerPage })),
)

export const Route = createFileRoute('/_app/_auth/_superuser/connect/server/$serverId')({
  component: ConnectServerRoute,
})

function ConnectServerRoute() {
  const { serverId } = Route.useParams()

  return (
    <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading connect page...</div>}>
      <LazyConnectServerPage serverId={serverId} />
    </Suspense>
  )
}
