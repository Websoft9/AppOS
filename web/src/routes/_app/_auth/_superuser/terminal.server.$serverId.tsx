import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

type TerminalServerSearch = {
  panel?: 'files' | 'docker'
  path?: string
  lockedRoot?: string
}

const LazyConnectServerPage = lazy(() =>
  import('@/pages/connect/ConnectServerPage').then(module => ({
    default: module.ConnectServerPage,
  }))
)

export const Route = createFileRoute('/_app/_auth/_superuser/terminal/server/$serverId')({
  validateSearch: (search: Record<string, unknown>): TerminalServerSearch => ({
    panel: search.panel === 'files' || search.panel === 'docker' ? search.panel : undefined,
    path: typeof search.path === 'string' && search.path.trim() ? search.path : undefined,
    lockedRoot:
      typeof search.lockedRoot === 'string' && search.lockedRoot.trim()
        ? search.lockedRoot
        : undefined,
  }),
  component: ConnectServerRoute,
})

function ConnectServerRoute() {
  const { serverId } = Route.useParams()
  const search = Route.useSearch()

  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          Loading terminal...
        </div>
      }
    >
      <LazyConnectServerPage
        serverId={serverId}
        initialSidePanel={search.panel}
        initialFilePath={search.path}
        initialLockedRootPath={search.lockedRoot}
      />
    </Suspense>
  )
}
