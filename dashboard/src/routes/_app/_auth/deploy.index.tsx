import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyDeployPage = lazy(() =>
  import('@/pages/deploy/DeployPage').then(module => ({ default: module.DeployPage }))
)

function DeployIndexPage() {
  const search = Route.useSearch()
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Deploy...</div>}>
      <LazyDeployPage
        prefillMode={search.prefillMode}
        prefillSource={search.prefillSource}
        prefillAppId={search.prefillAppId}
        prefillAppKey={search.prefillAppKey}
        prefillAppName={search.prefillAppName}
        prefillServerId={search.prefillServerId}
      />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/deploy/')({
  component: DeployIndexPage,
  validateSearch: (search: Record<string, unknown>) => ({
    prefillMode: typeof search.prefillMode === 'string' ? search.prefillMode : undefined,
    prefillSource: typeof search.prefillSource === 'string' ? search.prefillSource : undefined,
    prefillAppId: typeof search.prefillAppId === 'string' ? search.prefillAppId : undefined,
    prefillAppKey: typeof search.prefillAppKey === 'string' ? search.prefillAppKey : undefined,
    prefillAppName: typeof search.prefillAppName === 'string' ? search.prefillAppName : undefined,
    prefillServerId:
      typeof search.prefillServerId === 'string' ? search.prefillServerId : undefined,
  }),
})
