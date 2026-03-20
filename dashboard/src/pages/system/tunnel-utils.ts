// Normalizers and formatters for tunnel data.

import type {
  TunnelItem,
  TunnelForward,
  TunnelLogItem,
  TunnelOverviewResponse,
  TunnelService,
  PendingStatusKind,
} from './tunnel-types'

export function normalizeTunnelItem(item: Partial<TunnelItem>): TunnelItem {
  return {
    id: item.id ?? '',
    name: item.name ?? 'Unnamed tunnel',
    description: item.description,
    status: item.status ?? 'offline',
    created: item.created,
    connected_at: item.connected_at,
    remote_addr: item.remote_addr,
    disconnect_at: item.disconnect_at,
    disconnect_reason: item.disconnect_reason,
    disconnect_reason_label: item.disconnect_reason_label,
    pause_until: item.pause_until,
    is_paused: Boolean(item.is_paused),
    connection_duration_label: item.connection_duration_label,
    session_duration_label: item.session_duration_label,
    last_reconnect_at: item.last_reconnect_at,
    recent_reconnect_count_24h: item.recent_reconnect_count_24h,
    services: Array.isArray(item.services) ? item.services : [],
    group_names: Array.isArray(item.group_names) ? item.group_names : [],
    waiting_for_first_connect: item.waiting_for_first_connect,
  }
}

export function normalizeTunnelOverviewResponse(
  response: TunnelOverviewResponse | null | undefined
): TunnelOverviewResponse {
  return {
    summary: {
      total: response?.summary?.total ?? 0,
      online: response?.summary?.online ?? 0,
      offline: response?.summary?.offline ?? 0,
      waiting_for_first_connect: response?.summary?.waiting_for_first_connect ?? 0,
    },
    items: Array.isArray(response?.items)
      ? response.items.map(item => normalizeTunnelItem(item))
      : [],
  }
}

export function normalizeTunnelForwardsResponse(
  response: { forwards?: TunnelForward[] } | null | undefined
) {
  if (!Array.isArray(response?.forwards)) {
    return [] as TunnelForward[]
  }
  return response.forwards
    .map(forward => ({
      service_name: String(forward.service_name ?? '').trim(),
      local_port: Number(forward.local_port ?? 0),
    }))
    .filter(forward => forward.service_name && Number.isInteger(forward.local_port) && forward.local_port > 0)
}

export function normalizeTunnelLogsResponse(response: { items?: TunnelLogItem[] } | null | undefined) {
  if (!Array.isArray(response?.items)) {
    return [] as TunnelLogItem[]
  }
  return response.items.map(item => ({
    id: String(item.id ?? ''),
    at: item.at,
    action: item.action,
    label: item.label,
    reason: item.reason,
    reason_label: item.reason_label,
    remote_addr: item.remote_addr,
    pause_until: item.pause_until,
  }))
}

export function formatDateTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function formatDisconnectReason(item?: TunnelItem | null) {
  if (!item?.disconnect_reason) return '—'
  return item.disconnect_reason_label || item.disconnect_reason.replaceAll('_', ' ')
}

export function formatLogReason(item?: TunnelLogItem) {
  if (!item?.reason && !item?.reason_label) return ''
  return item.reason_label || item.reason || ''
}

export function formatLastConnected(item: TunnelItem) {
  return formatDateTime(item.last_reconnect_at || item.connected_at)
}

export function formatCreated(item: TunnelItem) {
  return formatDateTime(item.created || item.connected_at)
}

export function formatSessionDuration(item: TunnelItem) {
  return item.session_duration_label || item.connection_duration_label || '—'
}

export function formatEffectiveMapping(service: TunnelService) {
  return `${service.service_name} localhost:${service.local_port} → ${service.tunnel_port}`
}

export function infoValue(value?: string) {
  return value && value !== '—' ? value : 'Not available'
}

export function resolvedStatus(item: TunnelItem, pendingStatus?: PendingStatusKind) {
  if (pendingStatus === 'restarting') {
    return 'restarting'
  }
  if (pendingStatus === 'reconnecting') {
    return 'reconnecting'
  }
  if (item.is_paused || item.status === 'paused') {
    return 'paused'
  }
  if (item.waiting_for_first_connect) {
    return 'waiting'
  }
  return item.status
}

export function statusTone(item: TunnelItem, pendingStatus?: PendingStatusKind) {
  const status = resolvedStatus(item, pendingStatus)

  if (status === 'online') {
    return 'text-emerald-600'
  }
  if (status === 'paused') {
    return 'text-amber-700'
  }
  if (status === 'waiting') {
    return 'text-amber-600'
  }
  if (status === 'restarting' || status === 'reconnecting') {
    return 'text-sky-700'
  }
  return 'text-slate-500'
}
