export type MonitorOverviewItem = {
  targetType?: string
  targetId: string
  displayName: string
  status: string
  reason: string | null
  lastTransitionAt: string
  detailHref?: string
  summary?: Record<string, unknown>
}

export type MonitorOverviewResponse = {
  counts: Record<string, number>
  unhealthyItems: MonitorOverviewItem[]
  platformItems: MonitorOverviewItem[]
}

export const COUNT_KEYS = [
  'healthy',
  'degraded',
  'offline',
  'unreachable',
  'credential_invalid',
  'unknown',
] as const

export function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let current = value / 1024
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatTimestamp(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function formatSummaryValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    if (key.endsWith('_bytes')) return formatBytes(value)
    if (key.endsWith('_seconds')) {
      if (value < 60) return `${Math.round(value)}s`
      if (value < 3600) return `${Math.round(value / 60)}m`
      if (value < 86400) return `${(value / 3600).toFixed(value >= 36000 ? 0 : 1)}h`
      return `${(value / 86400).toFixed(value >= 864000 ? 0 : 1)}d`
    }
    return String(Number.isInteger(value) ? value : Number(value).toFixed(2))
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value.includes('T') ? formatTimestamp(value) : value
  return JSON.stringify(value)
}

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'healthy':
      return 'default'
    case 'offline':
    case 'unreachable':
    case 'credential_invalid':
      return 'destructive'
    case 'degraded':
      return 'outline'
    default:
      return 'secondary'
  }
}

export function normalizeOverviewResponse(
  input: MonitorOverviewResponse | null | undefined
): MonitorOverviewResponse {
  return {
    counts: input?.counts ?? {},
    unhealthyItems: Array.isArray(input?.unhealthyItems) ? input.unhealthyItems : [],
    platformItems: Array.isArray(input?.platformItems) ? input.platformItems : [],
  }
}

export function preferredPlatformTargetId(items: MonitorOverviewItem[]): string {
  const apposCore = items.find(item => item.targetId === 'appos-core')
  return apposCore?.targetId ?? items[0]?.targetId ?? ''
}
