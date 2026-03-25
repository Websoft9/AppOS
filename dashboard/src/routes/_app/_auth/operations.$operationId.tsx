import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyOperationDetailPage = lazy(() =>
  import('@/pages/deploy/operations/OperationDetailPage').then(module => ({ default: module.OperationDetailPage }))
)

function OperationDetailRoutePage() {
  const { operationId } = Route.useParams() as { operationId: string }
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Execution Detail...</div>}>
      <LazyOperationDetailPage operationId={operationId} />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/operations/$operationId' as never)({
  component: OperationDetailRoutePage,
})