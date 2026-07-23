import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

const LazyTunnelsPage = lazy(() =>
  import('@/pages/system/TunnelsPage').then(m => ({ default: m.TunnelsPage }))
)

const STATUS_FILTERS = new Set(['all', 'online', 'offline', 'paused', 'waiting'])
const SORT_FIELDS = new Set(['name', 'status', 'connected_at', 'remote_addr'])
const SORT_DIRS = new Set(['asc', 'desc'])

function normalizePositiveInt(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return fallback
}

function TunnelsRoutePage() {
  const { t } = useTranslation('common')
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          {t('loadingPage', { page: t('pages.tunnels') })}
        </div>
      }
    >
      <LazyTunnelsPage
        queryState={{
          q: search.q,
          status: search.status,
          sort: search.sort,
          dir: search.dir,
          page: search.page,
        }}
        onQueryStateChange={patch => {
          void navigate({
            to: '/tunnels',
            replace: true,
            search: prev => {
              const next = { ...prev, ...patch }
              return {
                q: next.q,
                status: next.status,
                sort: next.sort,
                dir: next.dir,
                page: next.page,
              }
            },
          })
        }}
        onOpenServerDetail={serverId => {
          void navigate({
            to: '/resources/servers',
            search: {
              create: undefined,
              returnGroup: undefined,
              returnType: undefined,
              edit: serverId,
              server: undefined,
              focusComponent: undefined,
              focusPanel: undefined,
              focusSource: undefined,
              focusIssue: undefined,
              tab: undefined,
            },
          })
        }}
      />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/tunnels')({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
    status:
      typeof search.status === 'string' && STATUS_FILTERS.has(search.status)
        ? (search.status as 'all' | 'online' | 'offline' | 'paused' | 'waiting')
        : 'all',
    sort:
      typeof search.sort === 'string' && SORT_FIELDS.has(search.sort)
        ? (search.sort as 'name' | 'status' | 'connected_at' | 'remote_addr')
        : 'connected_at',
    dir:
      typeof search.dir === 'string' && SORT_DIRS.has(search.dir)
        ? (search.dir as 'asc' | 'desc')
        : 'desc',
    page: normalizePositiveInt(search.page, 1),
  }),
  component: TunnelsRoutePage,
})
