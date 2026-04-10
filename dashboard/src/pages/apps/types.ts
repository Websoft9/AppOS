export type AppPipeline = {
  id: string
  operation_id: string
  family: string
  family_internal?: string
  definition_key?: string
  version?: string
  status: string
  current_phase?: string
  selector?: {
    operation_type?: string
    source?: string
    adapter?: string
  }
}

export type AppRelease = {
  id: string
  app_id: string
  created_by_operation?: string
  release_role?: string
  version_label?: string
  source_type?: string
  source_ref?: string
  artifact_digest?: string
  notes?: string
  is_active: boolean
  is_last_known_good: boolean
  activated_at?: string
  updated: string
}

export type AppExposure = {
  id: string
  app_id: string
  release_id?: string
  exposure_type?: string
  is_primary: boolean
  domain?: string
  path?: string
  target_port?: number
  certificate_id?: string
  publication_state?: string
  health_state?: string
  last_verified_at?: string
  notes?: string
  updated: string
}

export type AppInstance = {
  id: string
  iac_path?: string
  server_id: string
  name: string
  project_dir: string
  source: string
  status: string
  runtime_status: string
  lifecycle_state?: string
  health_summary?: string
  publication_summary?: string
  access_username?: string
  access_secret_hint?: string
  access_retrieval_method?: string
  access_notes?: string
  last_operation?: string
  current_pipeline?: AppPipeline | null
  runtime_reason?: string
  installed_at?: string
  created: string
  updated: string
}

export type AppLogsResponse = {
  id: string
  name: string
  server_id: string
  project_dir: string
  runtime_status: string
  output: string
}

export type AppConfigResponse = {
  id: string
  server_id: string
  project_dir: string
  iac_path?: string
  content: string
  rollback_available?: boolean
  rollback_saved_at?: string
  rollback_source_action?: string
}

export type AppOperationResponse = {
  id: string
  status?: string
  project_dir?: string
  compose_project_name?: string
  source?: string
  enqueued?: boolean
}

export function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function runtimeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running':
      return 'default'
    case 'stopped':
      return 'secondary'
    case 'error':
      return 'destructive'
    default:
      return 'outline'
  }
}

const iconPalette = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
]

function hashValue(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

export function appIconClass(name: string): string {
  return iconPalette[hashValue(name) % iconPalette.length]
}

export function appInitials(name: string): string {
  const parts = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
  if (parts.length === 0) return 'AP'
  return parts.map(part => part[0]?.toUpperCase() || '').join('')
}

export function formatUptime(app: AppInstance): string {
  if (app.runtime_status !== 'running') return '-'
  const anchor = app.installed_at || app.created
  const startedAt = new Date(anchor)
  if (Number.isNaN(startedAt.getTime())) return '-'
  const diffMs = Math.max(0, Date.now() - startedAt.getTime())
  const totalMinutes = Math.floor(diffMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function buildUnifiedDiff(original: string, draft: string): string {
  if (original === draft) return 'No changes.'
  const before = original.split('\n')
  const after = draft.split('\n')
  const maxLength = Math.max(before.length, after.length)
  const lines: string[] = ['--- current/docker-compose.yml', '+++ draft/docker-compose.yml']
  for (let index = 0; index < maxLength; index += 1) {
    const left = before[index]
    const right = after[index]
    if (left === right) {
      if (left !== undefined) lines.push(`  ${left}`)
      continue
    }
    if (left !== undefined) lines.push(`- ${left}`)
    if (right !== undefined) lines.push(`+ ${right}`)
  }
  return lines.join('\n')
}
