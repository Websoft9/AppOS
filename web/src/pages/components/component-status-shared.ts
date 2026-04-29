import { pb } from '@/lib/pb'

export type ComponentItem = {
  id: string
  name: string
  version: string
  available: boolean
  updated_at: string
}

export type ServiceItem = {
  name: string
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
  const url = force ? '/api/components?force=1' : '/api/components'
  const data = await pb.send<ComponentItem[]>(url, { method: 'GET' })
  return Array.isArray(data) ? data : []
}

export async function fetchActiveServices(): Promise<ServiceItem[]> {
  const data = await pb.send<ServiceItem[]>('/api/components/services', { method: 'GET' })
  return Array.isArray(data) ? data : []
}

export async function fetchServiceLogs(
  name: string,
  stream: 'stdout' | 'stderr' = 'stdout'
): Promise<ServiceLogResponse> {
  return pb.send<ServiceLogResponse>(
    `/api/components/services/${encodeURIComponent(name)}/logs?stream=${stream}&tail=200`,
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
