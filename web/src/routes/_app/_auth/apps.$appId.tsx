import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyAppDetailPage = lazy(() =>
  import('@/pages/apps/AppDetailPage').then(module => ({ default: module.AppDetailPage }))
)

function AppDetailRoutePage() {
  const { appId } = Route.useParams()
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-muted-foreground">Loading App Detail...</div>}
    >
      <LazyAppDetailPage appId={appId} />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/apps/$appId')({
  component: AppDetailRoutePage,
})
