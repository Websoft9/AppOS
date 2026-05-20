import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const LazyActionDetailPage = lazy(() =>
  import('@/pages/deploy/actions/ActionDetailPage').then(module => ({
    default: module.ActionDetailPage,
  }))
)

function ActionDetailRoutePage() {
  const { actionId } = Route.useParams() as { actionId: string }
  const search = Route.useSearch()
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading Execution Detail...</div>
      }
    >
      <LazyActionDetailPage actionId={actionId} search={search} />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/actions/$actionId' as never)({
  component: ActionDetailRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    appId: typeof search.appId === 'string' && search.appId.trim() ? search.appId : undefined,
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
    sortField:
      search.sortField === 'compose_project_name' ||
      search.sortField === 'created' ||
      search.sortField === 'started_at' ||
      search.sortField === 'finished_at'
        ? search.sortField
        : undefined,
    sortDir: search.sortDir === 'asc' || search.sortDir === 'desc' ? search.sortDir : undefined,
    page:
      typeof search.page === 'string' && Number.parseInt(search.page, 10) > 0
        ? Number.parseInt(search.page, 10)
        : undefined,
    pageSize:
      search.pageSize === '15' ||
      search.pageSize === '30' ||
      search.pageSize === '60' ||
      search.pageSize === '90'
        ? Number.parseInt(search.pageSize, 10)
        : undefined,
    excludeStatus: typeof search.excludeStatus === 'string' ? search.excludeStatus : undefined,
    excludeSource: typeof search.excludeSource === 'string' ? search.excludeSource : undefined,
    excludeServer: typeof search.excludeServer === 'string' ? search.excludeServer : undefined,
    returnTo: search.returnTo === 'list' ? 'list' : undefined,
  }),
})
