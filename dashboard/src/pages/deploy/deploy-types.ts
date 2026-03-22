import type { Product } from '@/lib/store-types'

export type ServerEntry = {
  id: string
  label: string
  host: string
  status: 'online' | 'offline'
}

export type DeploymentStep = {
  key: string
  label: string
  status: string
  detail?: string
  started_at?: string
  finished_at?: string
}

export type DeploymentLifecycleStep = {
  key: string
  label: string
  status: 'pending' | 'active' | 'completed' | 'terminal' | string
  detail?: string
}

export type DeploymentRecord = {
  id: string
  server_id: string
  server_label?: string
  server_host?: string
  source: string
  status: string
  adapter: string
  compose_project_name: string
  project_dir: string
  rendered_compose: string
  error_summary: string
  created: string
  updated: string
  user_id?: string
  user_email?: string
  started_at?: string
  finished_at?: string
  lifecycle?: DeploymentLifecycleStep[]
  steps?: DeploymentStep[]
}

export type DeploymentLogsResponse = {
  id: string
  status: string
  execution_log: string
  execution_log_truncated: boolean
  updated: string
}

export type DeploymentStreamMessage = {
  type: 'snapshot' | 'append' | 'status' | 'error'
  status?: string
  updated?: string
  content?: string
  execution_log_truncated?: boolean
  message?: string
}

export type Notice = {
  variant: 'default' | 'destructive'
  message: string
}

export type SortField = 'compose_project_name' | 'created' | 'started_at' | 'finished_at'
export type SortDir = 'asc' | 'desc'
export type ManualEntryMode = 'compose' | 'docker-command' | 'install-script' | 'store-prefill' | 'installed-prefill'
export type StoreShortcut = Pick<Product, 'key' | 'trademark' | 'logo'>

export type DeploymentListSearch = {
  q?: string
  sortField?: SortField
  sortDir?: SortDir
  page?: number
  pageSize?: 15 | 30 | 60 | 90
  excludeStatus?: string
  excludeSource?: string
  excludeServer?: string
}

export type DeploymentDetailSearch = DeploymentListSearch & {
  returnTo?: 'list'
}

export type ActiveFilterChip = {
  key: string
  label: string
}

export type ManualDialogCopy = {
  title: string
  description: string
  helper: string
}