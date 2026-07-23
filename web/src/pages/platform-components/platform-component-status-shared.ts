import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '@/lib/i18n'
import { pb } from '@/lib/pb'

const noAutoCancel = { requestKey: null }
const COMPONENT_REFRESH_DELAY_MS = 1500

export type ComponentItem = {
  id: string
  name: string
  criticality: string
  runtime_kind: string
  role: string
  notes: string
  owned_capability: string
  version: string
  available: boolean
  probe_pending: boolean
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

export type PlatformRuntimeSummary = {
  runningComponents: number
  degradedComponents: number
  checkingComponents: number
  runtimeShape: string
}

export type PlatformRuntimeCPUQuotaStatus = 'unknown' | 'unrestricted' | 'constrained'

export type PlatformRuntimeHostKernelFacts = {
  kernel_release: string
  architecture: string
  cpu_topology_visible: {
    model_name: string
    online_cpu_count: number
  }
}

export type PlatformRuntimeLimits = {
  cpuset_effective: string
  cpu_quota: {
    status: PlatformRuntimeCPUQuotaStatus
    quota_us: number | null
    period_us: number | null
    cores_equivalent: number | null
  }
  memory_limit_bytes: number | null
}

export type PlatformRuntimePayload = {
  summary: PlatformRuntimeSummary
  components: ComponentItem[]
  processes: ServiceItem[]
  host_kernel_facts: PlatformRuntimeHostKernelFacts
  runtime_limits: PlatformRuntimeLimits
}

export function formatRuntimeKindLabel(value: string): string {
  const fallback = !value
    ? i18n.t('system:platformComponents.runtimeKinds.unknownRuntime', {
        defaultValue: 'Unknown runtime',
      })
    : value
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')

  return i18n.t(`system:platformComponents.runtimeKinds.${value || 'unknown'}`, {
    defaultValue: fallback,
  })
}

export function formatVisibilityLabel(value: string): string {
  return i18n.t(`system:platformComponents.visibility.${value || 'unknown'}`, {
    defaultValue: value || 'Unknown',
  })
}

export function formatLifecycleLabel(value: string): string {
  return i18n.t(`system:platformComponents.lifecycle.${value || 'unknown'}`, {
    defaultValue: value || 'Unknown',
  })
}

export function formatServiceStateLabel(value: string): string {
  return i18n.t(`system:platformComponents.serviceStates.${value || 'unknown'}`, {
    defaultValue: value || 'Unknown',
  })
}

export function formatComponentCriticalityLabel(value: string): string {
  return i18n.t(`system:platformComponents.criticality.${value || 'unknown'}`, {
    defaultValue: value || 'unknown',
  })
}

export async function fetchInstalledComponents(force = false): Promise<ComponentItem[]> {
  const url = force ? '/api/software/local?force=1' : '/api/software/local'
  const data: unknown = await pb.send(url, { method: 'GET', ...noAutoCancel })
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

export type InstalledComponentsController = {
  components: ComponentItem[]
  loading: boolean
  error: string
  refresh: (force?: boolean) => Promise<void>
}

export function useInstalledComponentsController(): InstalledComponentsController {
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const fetchInFlightRef = useRef(false)

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  const refresh = useCallback(
    async (force = false, background = false) => {
      if (fetchInFlightRef.current) return
      clearRefreshTimer()
      fetchInFlightRef.current = true
      const requestId = ++requestIdRef.current
      if (!background) {
        setLoading(true)
      }
      try {
        const nextComponents = await fetchInstalledComponents(force)
        if (requestIdRef.current !== requestId) {
          return
        }
        setComponents(nextComponents)
        setError('')
        if (nextComponents.some(component => component.probe_pending)) {
          refreshTimerRef.current = setTimeout(() => {
            if (requestIdRef.current === requestId) {
              void refresh(false, true)
            }
          }, COMPONENT_REFRESH_DELAY_MS)
        }
      } catch (err) {
        if (requestIdRef.current !== requestId) {
          return
        }
        setError(
          err instanceof Error
            ? err.message
            : i18n.t('system:platformComponents.errors.loadComponents', {
                defaultValue: 'Failed to load components',
              })
        )
      } finally {
        fetchInFlightRef.current = false
        if (requestIdRef.current === requestId && !background) {
          setLoading(false)
        }
      }
    },
    [clearRefreshTimer]
  )

  useEffect(() => {
    void refresh()
    return () => {
      requestIdRef.current += 1
      clearRefreshTimer()
    }
  }, [clearRefreshTimer, refresh])

  return { components, loading, error, refresh: (force = false) => refresh(force, false) }
}

function coerceComponentItem(input: unknown): ComponentItem {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    id: readString(value.id),
    name: readString(value.name),
    criticality: readString(value.criticality),
    runtime_kind: readString(value.runtime_kind),
    role: readString(value.role),
    notes: readString(value.notes),
    owned_capability: readString(value.owned_capability),
    version: readString(value.version),
    available: readBoolean(value.available),
    probe_pending: readBoolean(value.probe_pending),
    updated_at: readString(value.updated_at),
  }
}

function coerceServiceItem(input: unknown): ServiceItem {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    name: readString(value.name),
    lifecycle: readString(value.lifecycle),
    visibility: readString(value.visibility),
    state: readString(value.state),
    pid: readNumber(value.pid),
    uptime: readNumber(value.uptime),
    cpu: readNumber(value.cpu),
    memory: readNumber(value.memory),
    last_detected_at: readString(value.last_detected_at),
    log_available: readBoolean(value.log_available),
  }
}

function coercePlatformRuntimeSummary(input: unknown): PlatformRuntimeSummary {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    runningComponents: readNumber(value.runningComponents),
    degradedComponents: readNumber(value.degradedComponents),
    checkingComponents: readNumber(value.checkingComponents),
    runtimeShape: readString(value.runtimeShape),
  }
}

function coercePlatformRuntimeHostKernelFacts(input: unknown): PlatformRuntimeHostKernelFacts {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const cpuTopology =
    value.cpu_topology_visible && typeof value.cpu_topology_visible === 'object'
      ? (value.cpu_topology_visible as Record<string, unknown>)
      : {}
  return {
    kernel_release: readString(value.kernel_release),
    architecture: readString(value.architecture),
    cpu_topology_visible: {
      model_name: readString(cpuTopology.model_name),
      online_cpu_count: readNumber(cpuTopology.online_cpu_count),
    },
  }
}

function coercePlatformRuntimeLimits(input: unknown): PlatformRuntimeLimits {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const cpuQuota =
    value.cpu_quota && typeof value.cpu_quota === 'object'
      ? (value.cpu_quota as Record<string, unknown>)
      : {}
  return {
    cpuset_effective: readString(value.cpuset_effective),
    cpu_quota: {
      status: readCPUQuotaStatus(cpuQuota.status),
      quota_us:
        typeof cpuQuota.quota_us === 'number' && Number.isFinite(cpuQuota.quota_us)
          ? cpuQuota.quota_us
          : null,
      period_us:
        typeof cpuQuota.period_us === 'number' && Number.isFinite(cpuQuota.period_us)
          ? cpuQuota.period_us
          : null,
      cores_equivalent:
        typeof cpuQuota.cores_equivalent === 'number' && Number.isFinite(cpuQuota.cores_equivalent)
          ? cpuQuota.cores_equivalent
          : null,
    },
    memory_limit_bytes:
      typeof value.memory_limit_bytes === 'number' && Number.isFinite(value.memory_limit_bytes)
        ? value.memory_limit_bytes
        : null,
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function readCPUQuotaStatus(value: unknown): PlatformRuntimeCPUQuotaStatus {
  return value === 'unrestricted' || value === 'constrained' || value === 'unknown'
    ? value
    : 'unknown'
}

export async function fetchActiveServices(): Promise<ServiceItem[]> {
  const data = await pb.send<ServiceItem[]>('/api/software/local/services', {
    method: 'GET',
    ...noAutoCancel,
  })
  return Array.isArray(data) ? data : []
}

export async function fetchPlatformRuntime(): Promise<PlatformRuntimePayload> {
  const data: unknown = await pb.send('/api/system/runtime', {
    method: 'GET',
    ...noAutoCancel,
  })
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    summary: coercePlatformRuntimeSummary(value.summary),
    components: Array.isArray(value.components) ? value.components.map(coerceComponentItem) : [],
    processes: Array.isArray(value.processes) ? value.processes.map(coerceServiceItem) : [],
    host_kernel_facts: coercePlatformRuntimeHostKernelFacts(value.host_kernel_facts),
    runtime_limits: coercePlatformRuntimeLimits(value.runtime_limits),
  }
}

export async function fetchServiceLogs(
  name: string,
  stream: 'stdout' | 'stderr' = 'stdout'
): Promise<ServiceLogResponse> {
  return pb.send<ServiceLogResponse>(
    `/api/software/local/services/${encodeURIComponent(name)}/logs?stream=${stream}&tail=200`,
    { method: 'GET', ...noAutoCancel }
  )
}

export function formatComponentStatusTime(value?: string): string {
  if (!value) return i18n.t('system:shared.emptyShort', { defaultValue: '-' })
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function formatServiceUptime(seconds: number): string {
  if (seconds <= 0) return i18n.t('system:shared.emptyShort', { defaultValue: '-' })
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes === 0) return `${remainingSeconds}s`
  return `${minutes}m`
}

export function formatServiceMemory(bytes: number): string {
  if (bytes <= 0) return i18n.t('system:shared.emptyShort', { defaultValue: '-' })
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
