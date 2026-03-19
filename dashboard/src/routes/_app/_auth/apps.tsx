import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyAppsPage = lazy(() => import('@/pages/apps/AppsPage').then(module => ({ default: module.AppsPage })))

function AppsRoutePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Apps...</div>}>
      <LazyAppsPage />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/apps')({
  component: AppsRoutePage,
})