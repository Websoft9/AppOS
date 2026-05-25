import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyPlatformComponentsPage = lazy(() =>
  import('@/pages/platform-components/PlatformComponentsPage').then(module => ({
    default: module.PlatformComponentsPage,
  }))
)

function PlatformComponentsRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading Platform Components...</div>
      }
    >
      <LazyPlatformComponentsPage />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/platform-components')({
  component: PlatformComponentsRoutePage,
})