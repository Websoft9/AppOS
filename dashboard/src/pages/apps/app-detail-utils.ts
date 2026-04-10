import { type ActionRecord } from '@/pages/deploy/actions/action-types'
import { getApiErrorMessage } from '@/lib/api-error'
import type { AppInstance } from '@/pages/apps/types'

export function formatActionType(value?: string): string {
  switch ((value || '').trim().toLowerCase()) {
    case 'start':
      return 'Start'
    case 'stop':
      return 'Stop'
    case 'restart':
      return 'Restart'
    case 'redeploy':
      return 'Redeploy'
    case 'upgrade':
      return 'Upgrade'
    case 'uninstall':
      return 'Uninstall'
    case 'install':
      return 'Install'
    case 'rollback':
      return 'Rollback'
    default:
      return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Action'
  }
}

export function getActionLabel(action: ActionRecord): string {
  return formatActionType(
    action.pipeline?.selector?.operation_type || action.pipeline_selector?.operation_type
  )
}

export function hasAccessHints(app: AppInstance | null): boolean {
  if (!app) return false
  return Boolean(
    app.access_username?.trim() ||
    app.access_secret_hint?.trim() ||
    app.access_retrieval_method?.trim() ||
    app.access_notes?.trim()
  )
}

export function displayValue(value?: string): string {
  return value?.trim() || '-'
}

export type ReleaseAttribution = {
  summaryNotes: string[]
  localImageRef?: string
  targetService?: string
  targetRef?: string
}

export type SourceBuildAttribution = {
  sourceKind?: string
  sourceRef?: string
  builderStrategy?: string
  publicationMode?: string
  localImageRef?: string
  targetService?: string
  targetRef?: string
}

function recordField(
  record: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = record?.[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringRecordField(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseActionSourceBuildAttribution(
  action?: ActionRecord | null
): SourceBuildAttribution | null {
  const spec = action?.spec
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null

  const sourceBuild = recordField(spec, 'source_build')
  if (!sourceBuild) return null

  const artifactPublication = recordField(sourceBuild, 'artifact_publication')
  const buildResult = recordField(sourceBuild, 'build_result')
  const publicationResult = recordField(sourceBuild, 'publication_result')
  const deployInputs = recordField(sourceBuild, 'deploy_inputs')

  return {
    sourceKind: stringRecordField(sourceBuild, 'source_kind'),
    sourceRef: stringRecordField(sourceBuild, 'source_ref'),
    builderStrategy: stringRecordField(sourceBuild, 'builder_strategy'),
    publicationMode:
      stringRecordField(artifactPublication, 'mode') ||
      stringRecordField(publicationResult, 'mode'),
    localImageRef:
      stringRecordField(publicationResult, 'local_image_ref') ||
      stringRecordField(buildResult, 'local_image_ref'),
    targetService: stringRecordField(deployInputs, 'service_name'),
    targetRef:
      stringRecordField(publicationResult, 'target_ref') ||
      stringRecordField(artifactPublication, 'target_ref'),
  }
}

export function parseReleaseAttribution(notes?: string): ReleaseAttribution {
  const result: ReleaseAttribution = { summaryNotes: [] }
  for (const rawPart of (notes || '').split('|')) {
    const part = rawPart.trim()
    if (!part) continue
    if (part.startsWith('image=')) {
      result.localImageRef = part.slice('image='.length).trim() || undefined
      continue
    }
    if (part.startsWith('service=')) {
      result.targetService = part.slice('service='.length).trim() || undefined
      continue
    }
    if (part.startsWith('target=')) {
      result.targetRef = part.slice('target='.length).trim() || undefined
      continue
    }
    result.summaryNotes.push(part)
  }
  return result
}

export type RuntimeContainer = {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
  Ports?: string
}

export type RuntimeContainerStats = {
  ID: string
  Name: string
  CPUPerc: string
  MemUsage: string
}

export type ResourceInstance = {
  id: string
  name: string
  kind: string
  template_id: string
  endpoint: string
  summary: string
  description: string
}

export type DockerVolume = {
  Name: string
  Driver: string
  Mountpoint: string
}

export type BackupItem = {
  name: string
  size: string
  updatedAt: string
}

export type BackupProjection = {
  status: 'available' | 'not-implemented' | 'error'
  items: BackupItem[]
  message: string
}

export type RuntimeContainerMount = {
  Type?: string
  Source?: string
  Destination?: string
  Name?: string
  RW?: boolean
}

export function parseDockerJsonLines<T>(output: string): T[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line) as T
      } catch {
        return null
      }
    })
    .filter(Boolean) as T[]
}

export function parseDockerInspect(output?: string): Record<string, unknown> | null {
  if (!output?.trim()) return null
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
      return parsed[0] as Record<string, unknown>
    }
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 1) return ''
  return segments.slice(0, -1).join('/')
}

export function parseResourceList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw))
    return raw.filter(item => item && typeof item === 'object') as Record<string, unknown>[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)) {
    return (raw as { items: unknown[] }).items.filter(
      item => item && typeof item === 'object'
    ) as Record<string, unknown>[]
  }
  return []
}

export function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

export function parseBackupProjection(raw: unknown): BackupProjection {
  if (!raw || typeof raw !== 'object') {
    return {
      status: 'error',
      items: [],
      message: 'Backup inventory is unavailable.',
    }
  }

  const response = raw as Record<string, unknown>
  const message = stringField(response, 'message')
  if (message.toLowerCase().includes('not implemented')) {
    return {
      status: 'not-implemented',
      items: [],
      message: 'Platform backup inventory is not connected yet.',
    }
  }

  const candidates = Array.isArray(response.items)
    ? response.items
    : Array.isArray(response.backups)
      ? response.backups
      : []
  const items = candidates
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const record = item as Record<string, unknown>
      return {
        name:
          stringField(record, 'name') ||
          stringField(record, 'filename') ||
          stringField(record, 'path') ||
          '-',
        size: stringField(record, 'size') || stringField(record, 'size_label') || '-',
        updatedAt:
          stringField(record, 'updated') ||
          stringField(record, 'updated_at') ||
          stringField(record, 'created') ||
          '',
      }
    })

  return {
    status: 'available',
    items,
    message:
      items.length > 0
        ? 'Available restore points detected.'
        : 'No backup snapshots were returned by the platform.',
  }
}

export function normalizeMatchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
}

export function parseCpuPercent(value?: string): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value.replace('%', '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function memoryTextToBytes(raw?: string): number {
  if (!raw) return 0
  const matched = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/)
  if (!matched) return 0
  const numeric = Number(matched[1])
  if (!Number.isFinite(numeric)) return 0
  const unit = String(matched[2] || 'B').toUpperCase()
  const base1024: Record<string, number> = {
    B: 1,
    KI: 1024,
    KIB: 1024,
    MI: 1024 ** 2,
    MIB: 1024 ** 2,
    GI: 1024 ** 3,
    GIB: 1024 ** 3,
    TI: 1024 ** 4,
    TIB: 1024 ** 4,
  }
  const base1000: Record<string, number> = {
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
  }
  if (base1024[unit]) return numeric * base1024[unit]
  if (base1000[unit]) return numeric * base1000[unit]
  return numeric
}

export function parseMemoryUsageBytes(value?: string): number {
  if (!value) return 0
  const used = value.split('/')[0]?.trim() || ''
  return memoryTextToBytes(used)
}

export function formatBytesCompact(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let current = bytes
  let index = 0
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index += 1
  }
  return `${current >= 10 || index === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`
}

export function summarizePorts(raw?: string): string {
  if (!raw?.trim()) return '-'
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .join(', ')
}

export function isPocketBaseAutoCancelled(err: unknown): boolean {
  const message = getApiErrorMessage(err, '').toLowerCase()
  return (
    message.includes('autocancelled') ||
    message.includes('auto-cancellation') ||
    message.includes('request was aborted')
  )
}
