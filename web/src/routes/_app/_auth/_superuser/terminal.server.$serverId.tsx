import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { RestoreWorkspaceSession } from '@/lib/connect-session'

type TerminalServerSearch = {
  sessionId?: string
  activeSessionId?: string
  restoreSessions?: RestoreWorkspaceSession[]
  panel?: 'files'
  path?: string
  lockedRoot?: string
  split?: number
}

function normalizeRestoreSessions(
  value: unknown
): TerminalServerSearch['restoreSessions'] | undefined {
  if (!Array.isArray(value)) return undefined

  const items = value.flatMap<RestoreWorkspaceSession>(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const sessionId =
      typeof record.sessionId === 'string' && record.sessionId.trim() ? record.sessionId : undefined
    const serverId =
      typeof record.serverId === 'string' && record.serverId.trim() ? record.serverId : undefined
    if (!sessionId || !serverId) return []

    const title = typeof record.title === 'string' && record.title.trim() ? record.title : serverId

    return [
      {
        sessionId,
        serverId,
        title,
        panel: record.panel === 'files' ? record.panel : undefined,
        path: typeof record.path === 'string' && record.path.trim() ? record.path : undefined,
        lockedRoot:
          typeof record.lockedRoot === 'string' && record.lockedRoot.trim()
            ? record.lockedRoot
            : undefined,
        split:
          typeof record.split === 'number' && Number.isFinite(record.split)
            ? record.split
            : typeof record.split === 'string' && Number.isFinite(Number(record.split))
              ? Number(record.split)
              : undefined,
      },
    ]
  })

  return items.length > 0 ? items : undefined
}

const LazyConnectServerPage = lazy(() =>
  import('@/pages/connect/ConnectServerPage').then(module => ({
    default: module.ConnectServerPage,
  }))
)

export const Route = createFileRoute('/_app/_auth/_superuser/terminal/server/$serverId')({
  validateSearch: (search: Record<string, unknown>): TerminalServerSearch => ({
    sessionId:
      typeof search.sessionId === 'string' && search.sessionId.trim()
        ? search.sessionId
        : undefined,
    activeSessionId:
      typeof search.activeSessionId === 'string' && search.activeSessionId.trim()
        ? search.activeSessionId
        : undefined,
    restoreSessions: normalizeRestoreSessions(search.restoreSessions),
    panel: search.panel === 'files' ? search.panel : undefined,
    path: typeof search.path === 'string' && search.path.trim() ? search.path : undefined,
    lockedRoot:
      typeof search.lockedRoot === 'string' && search.lockedRoot.trim()
        ? search.lockedRoot
        : undefined,
    split:
      typeof search.split === 'number' && Number.isFinite(search.split)
        ? search.split
        : typeof search.split === 'string' && Number.isFinite(Number(search.split))
          ? Number(search.split)
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
        initialSessionId={search.sessionId}
        initialRestoreSessions={search.restoreSessions}
        initialActiveRestoreSessionId={search.activeSessionId}
        initialSidePanel={search.panel}
        initialFilePath={search.path}
        initialLockedRootPath={search.lockedRoot}
        initialSplitRatio={search.split}
      />
    </Suspense>
  )
}
