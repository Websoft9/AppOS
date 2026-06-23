import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Loader2, FileText, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  fetchActiveServices,
  fetchServiceLogs,
  formatComponentStatusTime,
  formatServiceMemory,
  formatServiceUptime,
  serviceVariant,
  useInstalledComponentsController,
  type ServiceItem,
} from './platform-component-status-shared'

function titleizeRuntimeKind(value: string): string {
  if (!value) return 'Unknown runtime'
  return value
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function visibilityLabel(value: string): string {
  switch (value) {
    case 'default':
      return 'Default'
    case 'diagnostic':
      return 'Diagnostic'
    case 'hidden':
      return 'Hidden'
    default:
      return value || 'Unknown'
  }
}

function lifecycleLabel(value: string): string {
  switch (value) {
    case 'always_on':
      return 'Always on'
    case 'on_demand':
      return 'On demand'
    case 'ephemeral':
      return 'Ephemeral'
    default:
      return value || 'Unknown'
  }
}

function formatObservedAtTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatServiceCPU(state: string, cpu: number): string {
  if (state !== 'running' && cpu <= 0) return '-'
  if (cpu > 0 && cpu < 0.1) return '<0.1%'
  return `${cpu.toFixed(1)}%`
}

function formatComponentVersion(value: string, probePending: boolean): string {
  if (probePending && (!value || value === 'unknown')) return 'Checking...'
  return value || 'unknown'
}

const ACTIVE_SERVICES_REFRESH_MS = 5000

function defaultVisibilityService(service: ServiceItem): boolean {
  return service.visibility === 'default'
}

function nonDefaultVisibilityService(service: ServiceItem): boolean {
  return service.visibility !== 'default'
}

export function PlatformComponentsPage() {
  const [tab, setTab] = useState<'components' | 'services'>('services')
  const componentsController = useInstalledComponentsController()
  const servicesController = useActiveServicesController()

  return (
    <div className="space-y-4 p-4 cursor-default">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Components</h1>
          <p className="text-muted-foreground mt-1">
            Inspect built-in platform components and active internal services.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={value => setTab(value as 'components' | 'services')}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="services">Active Services</TabsTrigger>
            <TabsTrigger value="components">Built-in Components</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {tab === 'components' ? (
              <Button
                variant="outline"
                size="icon"
                title="Refresh"
                disabled={componentsController.loading}
                onClick={() => void componentsController.refresh(true)}
              >
                {componentsController.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            ) : null}
          </div>
        </div>

        <TabsContent value="services" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Services are grouped by operator visibility so the default surface stays focused while
            diagnostic dependencies remain accessible.
          </p>

          <div className="space-y-6">
            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Active Services</h2>
                <p className="text-sm text-muted-foreground">
                  Default operator-visible services for the current AppOS instance.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {servicesController.lastUpdatedAt
                    ? `Updated at ${formatObservedAtTime(servicesController.lastUpdatedAt)}`
                    : 'Awaiting runtime sample'}
                </p>
              </div>
              <ActiveServicesTableContent
                controller={servicesController}
                hideControls
                filter={defaultVisibilityService}
                emptyMessage="No default-visibility services are configured."
              />
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Diagnostic Services</h2>
                <p className="text-sm text-muted-foreground">
                  Background or diagnostic services that stay out of the default operator list.
                </p>
              </div>
              <ActiveServicesTableContent
                controller={servicesController}
                hideControls
                filter={nonDefaultVisibilityService}
                emptyMessage="No diagnostic-only services are configured."
              />
            </section>
          </div>
        </TabsContent>

        <TabsContent value="components" className="mt-4 space-y-4">
          {componentsController.error ? (
            <Alert variant="destructive">
              <AlertDescription>{componentsController.error}</AlertDescription>
            </Alert>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Read-only runtime inventory for quick awareness. No actions are required here.
          </p>

          {componentsController.loading ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">Loading built-in components...</p>
            </div>
          ) : componentsController.components.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">No built-in components were detected.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-gradient-to-br from-muted/40 via-background to-muted/20 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {componentsController.components.map(component => (
                  <article key={component.id} className="rounded-xl border bg-background/80 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-medium leading-6">{component.name}</p>
                      <Badge variant="outline">{titleizeRuntimeKind(component.runtime_kind)}</Badge>
                      <Badge variant="secondary">{component.criticality || 'unknown'}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {component.role || 'No role declared'}
                    </p>
                    {component.notes ? (
                      <p className="mt-1 text-xs text-muted-foreground">{component.notes}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-muted-foreground">
                      Version {formatComponentVersion(component.version, component.probe_pending)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Capability: {component.owned_capability || 'Not declared'}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Updated {formatComponentStatusTime(component.updated_at)}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SortBtn<K extends string>({
  label,
  field,
  sort,
  dir,
  onSort,
}: {
  label: string
  field: K
  sort: K
  dir: 'asc' | 'desc'
  onSort: (f: K) => void
}) {
  const active = sort === field
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )
}

export function InstalledComponentsContent() {
  const controller = useInstalledComponentsController()

  const sorted = useMemo(() => {
    return [...controller.components].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    )
  }, [controller.components])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="icon"
          title="Force refresh"
          disabled={controller.loading}
          onClick={() => void controller.refresh(true)}
        >
          {controller.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>
      {controller.error ? (
        <Alert variant="destructive">
          <AlertDescription>{controller.error}</AlertDescription>
        </Alert>
      ) : null}
      {controller.loading ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">Loading installed components...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">No installed components were detected.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed bg-gradient-to-br from-muted/40 via-background to-muted/20 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {sorted.map(component => (
              <article key={component.id} className="rounded-xl border bg-background/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-medium leading-6">{component.name}</p>
                  <Badge variant="outline">{titleizeRuntimeKind(component.runtime_kind)}</Badge>
                  <Badge variant="secondary">{component.criticality || 'unknown'}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {component.role || 'No role declared'}
                </p>
                {component.notes ? (
                  <p className="mt-1 text-xs text-muted-foreground">{component.notes}</p>
                ) : null}
                <p className="mt-1 text-sm text-muted-foreground">
                  Version {component.version || 'unknown'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Capability: {component.owned_capability || 'Not declared'}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Updated {formatComponentStatusTime(component.updated_at)}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type ActiveServicesSortKey = 'name' | 'state' | 'cpu' | 'memory' | 'uptime'

type ActiveServicesLogDialog = {
  name: string
  stream: 'stdout' | 'stderr'
  content: string
  loading: boolean
  truncated: boolean
  lastDetectedAt: string
}

export type ActiveServicesController = {
  services: ServiceItem[]
  loading: boolean
  error: string
  lastUpdatedAt: string
  sortKey: ActiveServicesSortKey
  sortDir: 'asc' | 'desc'
  handleSort: (key: ActiveServicesSortKey) => void
  openLogs: (name: string, stream?: 'stdout' | 'stderr') => Promise<void>
  logDialog: ActiveServicesLogDialog | null
  closeLogDialog: () => void
}

export function useActiveServicesController(): ActiveServicesController {
  const [services, setServices] = useState<ServiceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [logDialog, setLogDialog] = useState<ActiveServicesLogDialog | null>(null)
  const [sortKey, setSortKey] = useState<ActiveServicesSortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const fetchInFlightRef = useRef(false)

  const handleSort = (key: ActiveServicesSortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const fetchServices = useCallback(async () => {
    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true
    try {
      const nextServices = await fetchActiveServices()
      setServices(nextServices)
      setLastUpdatedAt(
        nextServices.reduce((latest, service) => {
          if (!service.last_detected_at) return latest
          if (!latest) return service.last_detected_at
          return new Date(service.last_detected_at).getTime() > new Date(latest).getTime()
            ? service.last_detected_at
            : latest
        }, '')
      )
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services')
    } finally {
      fetchInFlightRef.current = false
      setLoading(false)
    }
  }, [])

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
    void fetchServices()
  }, [fetchServices])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchServices()
    }, ACTIVE_SERVICES_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [fetchServices])

  return {
    services,
    loading,
    error,
    lastUpdatedAt,
    sortKey,
    sortDir,
    handleSort,
    openLogs,
    logDialog,
    closeLogDialog: () => setLogDialog(null),
  }
}

export function ActiveServicesControls({ controller }: { controller: ActiveServicesController }) {
  return (
    <div className="text-xs text-muted-foreground whitespace-nowrap">
      {controller.lastUpdatedAt
        ? `Updated at ${formatObservedAtTime(controller.lastUpdatedAt)}`
        : 'Awaiting runtime sample'}
    </div>
  )
}

export function ActiveServicesTableContent({
  controller,
  hideControls = false,
  filter,
  emptyMessage,
}: {
  controller: ActiveServicesController
  hideControls?: boolean
  filter?: (service: ServiceItem) => boolean
  emptyMessage?: string
}) {
  const {
    services,
    loading,
    error,
    sortKey,
    sortDir,
    handleSort,
    openLogs,
    logDialog,
    closeLogDialog,
  } = controller

  const sorted = useMemo(() => {
    const visibleServices = filter ? services.filter(filter) : services
    return [...visibleServices].sort((a, b) => {
      if (sortKey === 'cpu') return sortDir === 'asc' ? a.cpu - b.cpu : b.cpu - a.cpu
      if (sortKey === 'memory') return sortDir === 'asc' ? a.memory - b.memory : b.memory - a.memory
      if (sortKey === 'uptime') return sortDir === 'asc' ? a.uptime - b.uptime : b.uptime - a.uptime
      const av = String(sortKey === 'state' ? a.state : a.name || '')
      const bv = String(sortKey === 'state' ? b.state : b.name || '')
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [filter, services, sortDir, sortKey])

  return (
    <div className="space-y-2">
      {hideControls ? null : <ActiveServicesControls controller={controller} />}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">Loading active services...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">
            {emptyMessage || 'No active services are configured.'}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortBtn
                  label="Name"
                  field="name"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortBtn
                  label="State"
                  field="state"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="hidden sm:table-cell">PID</TableHead>
              <TableHead className="hidden md:table-cell">
                <SortBtn label="CPU" field="cpu" sort={sortKey} dir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <SortBtn
                  label="Memory"
                  field="memory"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="hidden lg:table-cell">
                <SortBtn
                  label="Uptime"
                  field="uptime"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(service => (
              <TableRow key={service.name}>
                <TableCell>
                  <div className="font-medium">{service.name}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="outline">{visibilityLabel(service.visibility)}</Badge>
                    <Badge variant="secondary">{lifecycleLabel(service.lifecycle)}</Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={serviceVariant(service.state)}>{service.state}</Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {service.pid > 0 ? service.pid : '-'}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {formatServiceCPU(service.state, service.cpu)}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {formatServiceMemory(service.memory)}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {formatServiceUptime(service.uptime)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="View Logs"
                    disabled={!service.log_available}
                    onClick={() => void openLogs(service.name)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!logDialog} onOpenChange={open => !open && closeLogDialog()}>
        <DialogContent className="sm:max-w-4xl h-[70vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle>Service Logs: {logDialog?.name}</DialogTitle>
            <DialogDescription>
              {logDialog?.lastDetectedAt
                ? `Last detected ${formatComponentStatusTime(logDialog.lastDetectedAt)}`
                : 'Diagnostic logs for the selected service'}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-2 flex gap-2">
            <Button
              variant={logDialog?.stream === 'stdout' ? 'default' : 'outline'}
              size="sm"
              onClick={() => logDialog && void openLogs(logDialog.name, 'stdout')}
            >
              stdout
            </Button>
            <Button
              variant={logDialog?.stream === 'stderr' ? 'default' : 'outline'}
              size="sm"
              onClick={() => logDialog && void openLogs(logDialog.name, 'stderr')}
            >
              stderr
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logDialog && void openLogs(logDialog.name, logDialog.stream)}
            >
              Refresh
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0 border-t px-5 py-3">
            <div className="rounded-xl bg-black px-4 py-3 font-mono text-[11px] leading-5 text-slate-100">
              <pre className="whitespace-pre-wrap break-all">
                {logDialog?.loading
                  ? 'Loading service logs...'
                  : logDialog?.content || 'No log content'}
              </pre>
            </div>
          </ScrollArea>
          {logDialog?.truncated ? (
            <p className="px-5 pb-2 text-xs text-muted-foreground">Showing a truncated log tail.</p>
          ) : null}
          <DialogFooter className="px-5 pb-4 pt-2">
            <Button variant="outline" onClick={closeLogDialog}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ActiveServicesContent() {
  const controller = useActiveServicesController()
  return <ActiveServicesTableContent controller={controller} />
}
