import { pb } from '@/lib/pb'
import type { DeploymentDetailSearch, DeploymentListSearch } from '@/pages/deploy/deploy-types'

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'success': return 'default'
    case 'failed':
    case 'timeout':
    case 'cancelled':
    case 'manual_intervention_required':
    case 'rolled_back': return 'destructive'
    case 'running':
    case 'validating':
    case 'preparing':
    case 'verifying':
    case 'rolling_back': return 'secondary'
    default: return 'outline'
  }
}

export function isActiveStatus(status: string): boolean {
  return ['queued', 'validating', 'preparing', 'running', 'verifying', 'rolling_back'].includes(status)
}

export function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function buildDeploymentWebSocketUrl(id: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${proto}//${window.location.host}/api/deployments/${id}/stream`)
  if (pb.authStore.token) url.searchParams.set('token', pb.authStore.token)
  return url.toString()
}

export function stripDetailReturnTo(search?: DeploymentDetailSearch): DeploymentListSearch | undefined {
  if (!search) return undefined
  const next: DeploymentListSearch = {}
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

export function buildDeploymentDetailSearch(search?: DeploymentListSearch, returnToList = false): DeploymentDetailSearch | undefined {
  const next: DeploymentDetailSearch = {
    ...(search || {}),
    ...(returnToList ? { returnTo: 'list' as const } : {}),
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function buildDeploymentListHref(search?: DeploymentDetailSearch): string {
  const listSearch = stripDetailReturnTo(search)
  if (!listSearch) return '/deployments'

  const params = new URLSearchParams()
  if (listSearch.q) params.set('q', listSearch.q)
  if (listSearch.sortField) params.set('sortField', listSearch.sortField)
  if (listSearch.sortDir) params.set('sortDir', listSearch.sortDir)
  if (listSearch.page) params.set('page', String(listSearch.page))
  if (listSearch.pageSize) params.set('pageSize', String(listSearch.pageSize))
  if (listSearch.excludeStatus) params.set('excludeStatus', listSearch.excludeStatus)
  if (listSearch.excludeSource) params.set('excludeSource', listSearch.excludeSource)
  if (listSearch.excludeServer) params.set('excludeServer', listSearch.excludeServer)

  const query = params.toString()
  return query ? `/deployments?${query}` : '/deployments'
}