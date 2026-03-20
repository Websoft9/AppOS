// Shared types for the Tunnel operations page.

export interface TunnelService {
  service_name: string
  local_port: number
  tunnel_port: number
}

export interface TunnelForward {
  service_name: string
  local_port: number
}

export interface TunnelLogItem {
  id: string
  at?: string
  action?: string
  label?: string
  reason?: string
  reason_label?: string
  remote_addr?: string
  pause_until?: string
}

export interface TunnelItem {
  id: string
  name: string
  description?: string
  status: 'online' | 'offline' | 'paused' | string
  created?: string
  connected_at?: string
  remote_addr?: string
  disconnect_at?: string
  disconnect_reason?: string
  disconnect_reason_label?: string
  pause_until?: string
  is_paused?: boolean
  connection_duration_label?: string
  session_duration_label?: string
  last_reconnect_at?: string
  recent_reconnect_count_24h?: number
  services: TunnelService[]
  group_names: string[]
  waiting_for_first_connect?: boolean
}

export interface TunnelOverviewResponse {
  summary: {
    total: number
    online: number
    offline: number
    waiting_for_first_connect: number
  }
  items: TunnelItem[]
}

export type ConfirmAction = 'disconnect' | 'rotate' | 'resume'
export type StatusFilter = 'all' | 'online' | 'offline' | 'paused' | 'waiting'
export type SortField = 'name' | 'status' | 'connected_at' | 'remote_addr'
export type SortDir = 'asc' | 'desc'

export interface TunnelsPageQueryState {
  q: string
  status: StatusFilter
  sort: SortField
  dir: SortDir
  page: number
  pageSize: (typeof PAGE_SIZE_OPTIONS)[number]
}

export interface ConfirmTarget {
  action: ConfirmAction
  item: TunnelItem
}

export interface LogState {
  loading: boolean
  error: string
  items: TunnelLogItem[]
}

export type PendingStatusKind = 'restarting' | 'reconnecting'

export const PAGE_SIZE_OPTIONS = [15, 30, 60, 90] as const

export const DEFAULT_QUERY_STATE: TunnelsPageQueryState = {
  q: '',
  status: 'all',
  sort: 'connected_at',
  dir: 'desc',
  page: 1,
  pageSize: 15,
}
