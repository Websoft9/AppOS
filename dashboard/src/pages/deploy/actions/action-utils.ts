import { pb } from '@/lib/pb'
import type { ActionDetailSearch, ActionListSearch } from '@/pages/deploy/actions/action-types'

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'success':
      return 'default'
    case 'failed':
    case 'timeout':
    case 'cancelled':
    case 'manual_intervention_required':
    case 'rolled_back':
      return 'destructive'
    case 'running':
    case 'validating':
    case 'preparing':
    case 'verifying':
    case 'rolling_back':
      return 'secondary'
    default:
      return 'outline'
  }
}

export function isActiveStatus(status: string): boolean {
  return ['queued', 'validating', 'preparing', 'running', 'verifying', 'rolling_back'].includes(
    status
  )
}

export function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function formatDurationCompact(start?: string, finish?: string): string {
  if (!start) return '-'

  const startedAt = new Date(start)
  if (Number.isNaN(startedAt.getTime())) return '-'

  const finishedAt = finish ? new Date(finish) : new Date()
  if (Number.isNaN(finishedAt.getTime())) return '-'

  const totalSeconds = Math.max(0, Math.floor((finishedAt.getTime() - startedAt.getTime()) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function actionDurationLabel(action: {
  started_at?: string
  finished_at?: string
  pipeline?: { started_at?: string; finished_at?: string }
}): string {
  return formatDurationCompact(
    action.pipeline?.started_at || action.started_at,
    action.pipeline?.finished_at || action.finished_at
  )
}

export function buildActionWebSocketUrl(id: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${proto}//${window.location.host}/api/actions/${id}/stream`)
  if (pb.authStore.token) url.searchParams.set('token', pb.authStore.token)
  return url.toString()
}

export function stripActionDetailReturnTo(
  search?: ActionDetailSearch
): ActionListSearch | undefined {
  if (!search) return undefined
  const next: ActionListSearch = {}
  if (search.appId) next.appId = search.appId
  if (search.q) next.q = search.q
  if (search.sortField) next.sortField = search.sortField
  if (search.sortDir) next.sortDir = search.sortDir
  if (search.page) next.page = search.page
  if (search.pageSize) next.pageSize = search.pageSize
  if (search.excludeStatus) next.excludeStatus = search.excludeStatus
  if (search.excludeSource) next.excludeSource = search.excludeSource
  if (search.excludeServer) next.excludeServer = search.excludeServer
  return Object.keys(next).length > 0 ? next : undefined
}

export function buildActionDetailSearch(
  search?: ActionListSearch,
  returnToList = false
): ActionDetailSearch | undefined {
  const next: ActionDetailSearch = {
    ...(search || {}),
    ...(returnToList ? { returnTo: 'list' as const } : {}),
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function buildActionListHref(search?: ActionDetailSearch): string {
  const listSearch = stripActionDetailReturnTo(search)
  if (!listSearch) return '/actions'

  const params = new URLSearchParams()
  if (listSearch.appId) params.set('appId', listSearch.appId)
  if (listSearch.q) params.set('q', listSearch.q)
  if (listSearch.sortField) params.set('sortField', listSearch.sortField)
  if (listSearch.sortDir) params.set('sortDir', listSearch.sortDir)
  if (listSearch.page) params.set('page', String(listSearch.page))
  if (listSearch.pageSize) params.set('pageSize', String(listSearch.pageSize))
  if (listSearch.excludeStatus) params.set('excludeStatus', listSearch.excludeStatus)
  if (listSearch.excludeSource) params.set('excludeSource', listSearch.excludeSource)
  if (listSearch.excludeServer) params.set('excludeServer', listSearch.excludeServer)

  const query = params.toString()
  return query ? `/actions?${query}` : '/actions'
}
