import { Suspense, lazy } from 'react'
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import type { ActionListSearch, SortDir, SortField } from '@/pages/deploy/actions/action-types'

const LazyDeployPage = lazy(() =>
  import('@/pages/deploy/DeployPage').then(module => ({ default: module.DeployPage }))
)

const PAGE_SIZE_OPTIONS = new Set([15, 30, 60, 90])

function parseSortField(value: unknown): SortField | undefined {
  if (value === 'updated') return 'started_at'
  return value === 'compose_project_name' || value === 'created' || value === 'started_at' || value === 'finished_at'
    ? value
    : undefined
}

function parseSortDir(value: unknown): SortDir | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parsePageSize(value: unknown): 15 | 30 | 60 | 90 | undefined {
  const parsed = parsePositiveInt(value)
  return parsed && PAGE_SIZE_OPTIONS.has(parsed) ? (parsed as 15 | 30 | 60 | 90) : undefined
}

function parseCsv(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .sort()
    .join(',')
  return normalized || undefined
}

function ActionsRoutePage() {
  const location = useLocation()
  const search = Route.useSearch()
  const isListRoute = location.pathname === '/actions' || location.pathname === '/actions/'

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Actions...</div>}>
      {isListRoute ? <LazyDeployPage view="list" listSearch={search} /> : <Outlet />}
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/actions' as never)({
  component: ActionsRoutePage,
  validateSearch: (search: Record<string, unknown>): ActionListSearch => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
    sortField: parseSortField(search.sortField),
    sortDir: parseSortDir(search.sortDir),
    page: parsePositiveInt(search.page),
    pageSize: parsePageSize(search.pageSize),
    excludeStatus: parseCsv(search.excludeStatus),
    excludeSource: parseCsv(search.excludeSource),
    excludeServer: parseCsv(search.excludeServer),
  }),
})