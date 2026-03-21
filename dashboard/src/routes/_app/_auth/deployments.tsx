import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyDeployPage = lazy(() =>
  import('@/pages/deploy/DeployPage').then(module => ({ default: module.DeployPage }))
)

function DeploymentsRoutePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Deployments...</div>}>
      <LazyDeployPage view="list" />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/deployments' as never)({
  component: DeploymentsRoutePage,
})
