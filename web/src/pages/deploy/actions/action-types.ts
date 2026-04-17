import type { Product } from '@/lib/store-types'

export type ServerEntry = {
  id: string
  label: string
  host: string
  status: 'online' | 'offline'
}

export type ActionStep = {
  key: string
  label: string
  status: string
  detail?: string
  execution_log?: string
  execution_log_truncated?: boolean
  started_at?: string
  finished_at?: string
}

export type ActionLifecycleStep = {
  key: string
  label: string
  status: 'pending' | 'active' | 'completed' | 'terminal' | string
  detail?: string
}

export type PipelineSelector = {
  operation_type?: string
  source?: string
  adapter?: string
}

export type PipelineRecord = {
  id: string
  operation_id: string
  app_id?: string
  server_id?: string
  family: string
  family_internal?: string
  definition_key?: string
  version?: string
  status: string
  current_phase?: string
  node_count?: number
  completed_node_count?: number
  failed_node_key?: string
  selector?: PipelineSelector
  steps?: ActionStep[]
  created?: string
  updated?: string
  started_at?: string
  finished_at?: string
}

export type ActionRecord = {
  id: string
  app_id?: string
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
  pipeline?: PipelineRecord
  pipeline_family?: string
  pipeline_family_internal?: string
  pipeline_definition_key?: string
  pipeline_version?: string
  pipeline_selector?: PipelineSelector
  spec?: Record<string, unknown>
  lifecycle?: ActionLifecycleStep[]
  steps?: ActionStep[]
}

export type ActionLogsResponse = {
  id: string
  status: string
  execution_log: string
  execution_log_truncated: boolean
  updated: string
}

export type ActionStreamMessage = {
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
export type ManualEntryMode =
  | 'compose'
  | 'docker-command'
  | 'install-script'
  | 'store-prefill'
  | 'installed-prefill'
export type CreateDeploymentEntryMode =
  | 'compose'
  | 'git-compose'
  | 'docker-command'
  | 'install-script'
export type StoreShortcut = Pick<Product, 'key' | 'trademark' | 'logo'>

export type ActionListSearch = {
  appId?: string
  q?: string
  sortField?: SortField
  sortDir?: SortDir
  page?: number
  pageSize?: 15 | 30 | 60 | 90
  excludeStatus?: string
  excludeSource?: string
  excludeServer?: string
}

export type ActionDetailSearch = ActionListSearch & {
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
