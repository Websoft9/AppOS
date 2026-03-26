import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyActionDetailPage = lazy(() =>
  import('@/pages/deploy/actions/ActionDetailPage').then(module => ({ default: module.ActionDetailPage }))
)

function ActionDetailRoutePage() {
  const { actionId } = Route.useParams() as { actionId: string }
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Execution Detail...</div>}>
      <LazyActionDetailPage actionId={actionId} />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/actions/$actionId' as never)({
  component: ActionDetailRoutePage,
})