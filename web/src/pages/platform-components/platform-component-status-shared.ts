import { pb } from '@/lib/pb'

export type ComponentItem = {
  id: string
  name: string
  criticality: string
  runtime_kind: string
  role: string
  owned_capability: string
  version: string
  available: boolean
  updated_at: string
}

export type ServiceItem = {
  name: string
  lifecycle: string
  visibility: string
  state: string
  pid: number
  uptime: number
  cpu: number
  memory: number
  last_detected_at: string
  log_available: boolean
}

export type ServiceLogResponse = {
  name: string
  stream: 'stdout' | 'stderr'
  content: string
  truncated: boolean
  last_detected_at: string
}

export async function fetchInstalledComponents(force = false): Promise<ComponentItem[]> {
  const url = force ? '/api/software/local?force=1' : '/api/software/local'
  const data: unknown = await pb.send(url, { method: 'GET' })
  if (Array.isArray(data)) return data.map(coerceComponentItem)
  if (
    data &&
    typeof data === 'object' &&
    'items' in data &&
    Array.isArray((data as { items?: unknown }).items)
  ) {
    return (data as { items: unknown[] }).items.map(coerceComponentItem)
  }
  return []
}

function coerceComponentItem(input: unknown): ComponentItem {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    id: readString(value.id),
    name: readString(value.name),
    criticality: readString(value.criticality),
    runtime_kind: readString(value.runtime_kind),
    role: readString(value.role),
    owned_capability: readString(value.owned_capability),
    version: readString(value.version),
    available: readBoolean(value.available),
    updated_at: readString(value.updated_at),
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

export async function fetchActiveServices(): Promise<ServiceItem[]> {
  const data = await pb.send<ServiceItem[]>('/api/software/local/services', { method: 'GET' })
  return Array.isArray(data) ? data : []
}

export async function fetchServiceLogs(
  name: string,
  stream: 'stdout' | 'stderr' = 'stdout'
): Promise<ServiceLogResponse> {
  return pb.send<ServiceLogResponse>(
    `/api/software/local/services/${encodeURIComponent(name)}/logs?stream=${stream}&tail=200`,
    { method: 'GET' }
  )
}

export function formatComponentStatusTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function formatServiceUptime(seconds: number): string {
  if (seconds <= 0) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function formatServiceMemory(bytes: number): string {
  if (bytes <= 0) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function serviceVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'running':
      return 'default'
    case 'stopped':
    case 'missing':
      return 'secondary'
    case 'fatal':
    case 'exited':
    case 'unknown':
      return 'destructive'
    default:
      return 'outline'
  }
}