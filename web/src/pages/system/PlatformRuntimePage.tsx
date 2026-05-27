import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  type ActiveServicesController,
  ActiveServicesControls,
  ActiveServicesTableContent,
} from '@/pages/platform-components/PlatformComponentsPage'
import {
  fetchPlatformRuntime,
  fetchServiceLogs,
  formatComponentStatusTime,
  type ComponentItem,
  type PlatformRuntimeHostKernelFacts,
  type PlatformRuntimeLimits,
  type PlatformRuntimeSummary,
  type ServiceItem,
} from '@/pages/platform-components/platform-component-status-shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function componentSortWeight(component: ComponentItem): number {
  const id = String(component.id || '').toLowerCase()
  if (id === 'os') return 0
  if (id === 'appos') return 1
  return 2
}

function summarizeRuntimeShape(components: ComponentItem[]): string {
  if (components.length === 0) {
    return 'No built-in runtime components have been detected yet.'
  }

  const pendingCount = components.filter(component => component.probe_pending).length
  const knownComponents = components.filter(component => !component.probe_pending)
  const availableCount = knownComponents.filter(component => component.available).length
  const unavailableCount = knownComponents.length - availableCount

  if (pendingCount === components.length) {
    return `AppOS is still checking ${pendingCount} built-in component${pendingCount === 1 ? '' : 's'}.`
  }

  if (unavailableCount === 0 && pendingCount === 0) {
    return `AppOS currently exposes ${availableCount} built-in component${availableCount === 1 ? '' : 's'} in the local runtime.`
  }

  if (pendingCount > 0) {
    return `AppOS currently exposes ${availableCount} available built-in component${availableCount === 1 ? '' : 's'} with ${pendingCount} still checking.`
  }

  return `AppOS currently exposes ${availableCount} available built-in component${availableCount === 1 ? '' : 's'} with ${unavailableCount} unavailable.`
}

function formatComponentVersion(value: string, probePending: boolean): string {
  if (probePending && (!value || value === 'unknown')) return 'Checking...'
  return value || 'unknown'
}

function formatRuntimeLimitBytes(value: number | null): string {
  if (value === null || value <= 0) return 'Unrestricted'
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(0)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatVisibleCPUTopology(hostKernelFacts: PlatformRuntimeHostKernelFacts): string {
  const modelName = hostKernelFacts.cpu_topology_visible.model_name || 'Unknown CPU'
  const onlineCPUCount = hostKernelFacts.cpu_topology_visible.online_cpu_count
  return onlineCPUCount > 0 ? `${modelName} (${onlineCPUCount} online)` : modelName
}

function runtimeValue(value: string): string {
  return value || '-'
}

function formatCPUQuota(limits: PlatformRuntimeLimits): string {
  if (limits.cpu_quota.status === 'unknown') return 'Unknown'
  if (limits.cpu_quota.status === 'unrestricted') return 'Unrestricted'
  if (limits.cpu_quota.cores_equivalent !== null) {
    return `${limits.cpu_quota.cores_equivalent.toFixed(2)} CPU`
  }
  if (limits.cpu_quota.quota_us !== null && limits.cpu_quota.period_us !== null) {
    return `${limits.cpu_quota.quota_us}/${limits.cpu_quota.period_us} us`
  }
  return '-'
}

const PENDING_RUNTIME_REFRESH_MS = 1500
const PLATFORM_RUNTIME_REFRESH_MS = 5000

type PlatformRuntimeController = ActiveServicesController & {
  components: ComponentItem[]
  summary: PlatformRuntimeSummary
  hostKernelFacts: PlatformRuntimeHostKernelFacts
  runtimeLimits: PlatformRuntimeLimits
  refresh: () => Promise<void>
}

function usePlatformRuntimeController(): PlatformRuntimeController {
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [services, setServices] = useState<ServiceItem[]>([])
  const [summary, setSummary] = useState<PlatformRuntimeSummary>({
    runningComponents: 0,
    degradedComponents: 0,
    checkingComponents: 0,
    runtimeShape: '',
  })
  const [hostKernelFacts, setHostKernelFacts] = useState<PlatformRuntimeHostKernelFacts>({
    kernel_release: '',
    architecture: '',
    cpu_topology_visible: { model_name: '', online_cpu_count: 0 },
  })
  const [runtimeLimits, setRuntimeLimits] = useState<PlatformRuntimeLimits>({
    cpuset_effective: '',
    cpu_quota: {
      status: 'unknown',
      quota_us: null,
      period_us: null,
      cores_equivalent: null,
    },
    memory_limit_bytes: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [sortKey, setSortKey] = useState<'name' | 'state' | 'cpu' | 'memory' | 'uptime'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [logDialog, setLogDialog] = useState<ActiveServicesController['logDialog']>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchInFlightRef = useRef(false)
  const requestIdRef = useRef(0)

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  const handleSort = (key: 'name' | 'state' | 'cpu' | 'memory' | 'uptime') => {
    if (sortKey === key) setSortDir(direction => (direction === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const refresh = useCallback(
    async (background = false) => {
      if (fetchInFlightRef.current) return
      clearRefreshTimer()
      fetchInFlightRef.current = true
      const requestId = ++requestIdRef.current
      if (!background) {
        setLoading(true)
      }
      try {
        const nextRuntime = await fetchPlatformRuntime()
        if (requestIdRef.current !== requestId) {
          return
        }
        setComponents(nextRuntime.components)
        setServices(nextRuntime.processes)
        setSummary(nextRuntime.summary)
        setHostKernelFacts(nextRuntime.host_kernel_facts)
        setRuntimeLimits(nextRuntime.runtime_limits)
        setLastUpdatedAt(
          nextRuntime.processes.reduce((latest, service) => {
            if (!service.last_detected_at) return latest
            if (!latest) return service.last_detected_at
            return new Date(service.last_detected_at).getTime() > new Date(latest).getTime()
              ? service.last_detected_at
              : latest
          }, '')
        )
        setError('')
        if (nextRuntime.components.some(component => component.probe_pending)) {
          refreshTimerRef.current = setTimeout(() => {
            if (requestIdRef.current === requestId) {
              void refresh(true)
            }
          }, PENDING_RUNTIME_REFRESH_MS)
        }
      } catch (err) {
        if (requestIdRef.current !== requestId) {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load platform runtime')
      } finally {
        fetchInFlightRef.current = false
        if (requestIdRef.current === requestId && !background) {
          setLoading(false)
        }
      }
    },
    [clearRefreshTimer]
  )

  const openLogs = useCallback(async (name: string, stream: 'stdout' | 'stderr' = 'stdout') => {
    setLogDialog({ name, stream, content: '', loading: true, truncated: false, lastDetectedAt: '' })
    try {
      const data = await fetchServiceLogs(name, stream)
      setLogDialog({
        name,
        stream,
        content: data.content,
        loading: false,
        truncated: data.truncated,
        lastDetectedAt: data.last_detected_at,
      })
    } catch (err) {
      setLogDialog({
        name,
        stream,
        content: err instanceof Error ? err.message : 'Failed to load logs',
        loading: false,
        truncated: false,
        lastDetectedAt: '',
      })
    }
  }, [])

  useEffect(() => {
    void refresh(false)
    return () => {
      requestIdRef.current += 1
      clearRefreshTimer()
    }
  }, [clearRefreshTimer, refresh])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh(true)
    }, PLATFORM_RUNTIME_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  return {
    components,
    services,
    summary,
    hostKernelFacts,
    runtimeLimits,
    loading,
    error,
    lastUpdatedAt,
    sortKey,
    sortDir,
    handleSort,
    openLogs,
    logDialog,
    closeLogDialog: () => setLogDialog(null),
    refresh: () => refresh(false),
  }
}

function BundledComponentsDetailContent({
  components,
  loading,
  error,
}: {
  components: ComponentItem[]
  loading: boolean
  error: string
}) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">Loading built-in components...</p>
      </div>
    )
  }

  if (components.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No built-in components were detected.</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b-0 hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Availability</TableHead>
          <TableHead>Service</TableHead>
          <TableHead>Updated at</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {components.map(component => (
          <TableRow key={component.id} className="border-b-0 hover:bg-transparent">
            <TableCell className="font-medium text-foreground">{component.name || component.id}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatComponentVersion(component.version, component.probe_pending)}
            </TableCell>
            <TableCell>
              <Badge
                variant={
                  component.probe_pending ? 'outline' : component.available ? 'default' : 'destructive'
                }
              >
                {component.probe_pending
                  ? 'Checking...'
                  : component.available
                    ? 'Available'
                    : 'Unavailable'}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {component.runtime_kind === 'service' ? 'Yes' : 'No'}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatComponentStatusTime(component.updated_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PlatformRuntimePage() {
  const runtimeController = usePlatformRuntimeController()

  const sortedComponents = useMemo(
    () =>
      [...runtimeController.components].sort((a, b) => {
        const weightDiff = componentSortWeight(a) - componentSortWeight(b)
        if (weightDiff !== 0) return weightDiff
        return String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''))
      }),
    [runtimeController.components]
  )

  const activeServiceCount = runtimeController.services.length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Runtime</h1>
          <p className="mt-1 text-muted-foreground">
            Inspect active services and built-in tools that currently make up the AppOS runtime.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          title="Refresh runtime"
          aria-label="Refresh runtime"
          onClick={() => void runtimeController.refresh()}
          disabled={runtimeController.loading}
        >
          {runtimeController.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Runtime Summary</CardTitle>
          <CardDescription>
            {runtimeController.summary.runtimeShape || summarizeRuntimeShape(runtimeController.components)}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Built-in Components
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{runtimeController.components.length}</div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Available</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{runtimeController.summary.runningComponents}</div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Unavailable
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{runtimeController.summary.degradedComponents}</div>
          </div>
          {runtimeController.summary.checkingComponents > 0 ? (
            <div className="rounded-lg border bg-background px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Checking
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{runtimeController.summary.checkingComponents}</div>
            </div>
          ) : null}
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Active Services
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{activeServiceCount}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Host/Kernel Facts</CardTitle>
          <CardDescription>
            Runtime-visible system facts and limits exposed from inside the current AppOS runtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Kernel Release</div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {runtimeValue(runtimeController.hostKernelFacts.kernel_release)}
            </div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Architecture</div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {runtimeValue(runtimeController.hostKernelFacts.architecture)}
            </div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Visible CPU Topology
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {formatVisibleCPUTopology(runtimeController.hostKernelFacts)}
            </div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Effective CPU Set</div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {runtimeValue(runtimeController.runtimeLimits.cpuset_effective)}
            </div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">CPU Quota</div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {formatCPUQuota(runtimeController.runtimeLimits)}
            </div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Memory Limit</div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {formatRuntimeLimitBytes(runtimeController.runtimeLimits.memory_limit_bytes)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Active Services</CardTitle>
              <CardDescription>
                Runtime services currently detected for this AppOS instance, including diagnostic services.
              </CardDescription>
            </div>
            <ActiveServicesControls controller={runtimeController} />
          </div>
        </CardHeader>
        <CardContent>
          <ActiveServicesTableContent
            controller={runtimeController}
            hideControls
            emptyMessage="No active services are configured."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Built-in Components</CardTitle>
          <CardDescription>
            Built-in tools and embedded dependencies currently exposed inside the AppOS runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BundledComponentsDetailContent
            components={sortedComponents}
            loading={runtimeController.loading}
            error={runtimeController.error}
          />
        </CardContent>
      </Card>
    </div>
  )
}
