import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyComponentsPage = lazy(() =>
  import('@/pages/components/ComponentsPage').then(module => ({ default: module.ComponentsPage }))
)

function ComponentsRoutePage() {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-muted-foreground">Loading Components...</div>}
    >
      <LazyComponentsPage />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/components')({
  component: ComponentsRoutePage,
})
