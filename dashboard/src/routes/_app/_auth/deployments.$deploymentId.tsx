import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyDeploymentDetailPage = lazy(() =>
  import('@/pages/deploy/DeploymentDetailPage').then(module => ({ default: module.DeploymentDetailPage }))
)

function DeploymentDetailRoutePage() {
  const { deploymentId } = Route.useParams() as { deploymentId: string }
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Deployment Detail...</div>}>
      <LazyDeploymentDetailPage deploymentId={deploymentId} />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/deployments/$deploymentId' as never)({
  component: DeploymentDetailRoutePage,
})