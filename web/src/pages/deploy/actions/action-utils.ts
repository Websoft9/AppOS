import i18n from '@/lib/i18n'
import { pb } from '@/lib/pb'
import type {
  ActionControlKind,
  ActionDetailSearch,
  ActionListSearch,
  ActionRecord,
} from '@/pages/deploy/actions/action-types'

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'success':
      return 'default'
    case 'failed':
    case 'timeout':
    case 'cancelled':
    case 'manual_intervention_required':
    case 'compensated':
      return 'destructive'
    case 'running':
    case 'executing':
    case 'validating':
    case 'preparing':
    case 'verifying':
    case 'rolling_back':
    case 'compensating':
    case 'waiting':
    case 'manual_gate':
      return 'secondary'
    default:
      return 'outline'
  }
}

export function actionStatusLabel(status: string): string {
  switch (status) {
    case 'success':
      return i18n.t('deploy:statuses.success', 'Success')
    case 'failed':
      return i18n.t('deploy:statuses.failed', 'Failed')
    case 'running':
    case 'executing':
      return i18n.t('deploy:statuses.executing', 'Executing')
    case 'queued':
      return i18n.t('deploy:statuses.queued', 'Queued')
    case 'validating':
      return i18n.t('deploy:statuses.validating', 'Validating')
    case 'preparing':
      return i18n.t('deploy:statuses.preparing', 'Preparing')
    case 'verifying':
      return i18n.t('deploy:statuses.verifying', 'Verifying')
    case 'rolling_back':
      return i18n.t('deploy:statuses.rollingBack', 'Rolling back')
    case 'compensating':
      return i18n.t('deploy:statuses.compensating', 'Compensating')
    case 'compensated':
      return i18n.t('deploy:statuses.compensated', 'Compensated')
    case 'waiting':
      return i18n.t('deploy:statuses.waiting', 'Waiting')
    case 'manual_gate':
      return i18n.t('deploy:statuses.manualGate', 'Manual gate')
    case 'timeout':
      return i18n.t('deploy:statuses.timedOut', 'Timed out')
    case 'cancelled':
      return i18n.t('deploy:statuses.cancelled', 'Cancelled')
    case 'manual_intervention_required':
      return i18n.t('deploy:statuses.attentionRequired', 'Attention required')
    default:
      return status || i18n.t('deploy:statuses.pending', 'Pending')
  }
}

export function isActiveStatus(status: string): boolean {
  return [
    'queued',
    'validating',
    'preparing',
    'running',
    'executing',
    'verifying',
    'rolling_back',
    'compensating',
    'waiting',
    'manual_gate',
  ].includes(status)
}

export function canCancelAction(action: Pick<ActionRecord, 'status'>): boolean {
  return action.status === 'queued'
}

export function canForceFailAction(action: Pick<ActionRecord, 'status'>): boolean {
  return action.status === 'running' || action.status === 'executing'
}

export function canResumeAction(action: Pick<ActionRecord, 'status'>): boolean {
  return action.status === 'waiting' || action.status === 'manual_gate'
}

export function actionControlLabel(kind: ActionControlKind): string {
  if (kind === 'cancel') return i18n.t('deploy:controlLabels.cancel', 'Cancel')
  if (kind === 'resume') return i18n.t('deploy:controlLabels.resume', 'Resume')
  return i18n.t('deploy:controlLabels.forceFail', 'Force Fail')
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
  if (!listSearch) return '/activity'

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
  return query ? `/activity?${query}` : '/activity'
}

export function buildActionListSearch(search?: ActionDetailSearch): ActionListSearch | undefined {
  return stripActionDetailReturnTo(search)
}
