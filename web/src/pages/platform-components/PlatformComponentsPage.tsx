import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  fetchInstalledComponents,
  fetchServiceLogs,
  formatComponentStatusTime,
  formatServiceMemory,
  formatServiceUptime,
  serviceVariant,
  type ComponentItem,
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

function defaultVisibilityService(service: ServiceItem): boolean {
  return service.visibility === 'default'
}

function nonDefaultVisibilityService(service: ServiceItem): boolean {
  return service.visibility !== 'default'
}

export function PlatformComponentsPage() {
  const [tab, setTab] = useState<'components' | 'services'>('components')
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [componentsLoading, setComponentsLoading] = useState(true)
  const [componentsError, setComponentsError] = useState('')
  const servicesController = useActiveServicesController()

  const fetchComponents = useCallback(async (force = false) => {
    if (force) {
      setComponents([])
      setComponentsError('')
    }
    setComponentsLoading(true)
    try {
      setComponents(await fetchInstalledComponents(force))
      setComponentsError('')
    } catch (err) {
      setComponentsError(err instanceof Error ? err.message : 'Failed to load components')
    } finally {
      setComponentsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchComponents()
  }, [fetchComponents])

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
            <TabsTrigger value="components">Built-in Components</TabsTrigger>
            <TabsTrigger value="services">Active Services</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {tab === 'services' && (
              <Select
                value={String(servicesController.servicesInterval)}
                onValueChange={v => servicesController.setServicesInterval(Number(v))}
              >
                <SelectTrigger className="h-8 w-[110px] text-xs">
                  <SelectValue placeholder="Auto-refresh" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Off</SelectItem>
                  <SelectItem value="5000">5s</SelectItem>
                  <SelectItem value="10000">10s</SelectItem>
                  <SelectItem value="30000">30s</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="icon"
              title="Refresh"
              disabled={tab === 'components' ? componentsLoading : servicesController.loading}
              onClick={() =>
                tab === 'components'
                  ? void fetchComponents(true)
                  : void servicesController.refreshServices()
              }
            >
              {tab === 'components' && componentsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tab === 'services' && servicesController.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <TabsContent value="components" className="mt-4 space-y-4">
          {componentsError ? (
            <Alert variant="destructive">
              <AlertDescription>{componentsError}</AlertDescription>
            </Alert>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Read-only runtime inventory for quick awareness. No actions are required here.
          </p>

          {componentsLoading ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">Loading built-in components...</p>
            </div>
          ) : components.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">No built-in components were detected.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-gradient-to-br from-muted/40 via-background to-muted/20 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {components.map(component => (
                  <article key={component.id} className="rounded-xl border bg-background/80 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-medium leading-6">{component.name}</p>
                      <Badge variant="outline">{titleizeRuntimeKind(component.runtime_kind)}</Badge>
                      <Badge variant="secondary">{component.criticality || 'unknown'}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {component.role || 'No role declared'}
                    </p>
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
        </TabsContent>

        <TabsContent value="services" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Services are grouped by operator visibility so the default surface stays focused while diagnostic dependencies remain accessible.
          </p>

          <div className="space-y-6">
            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Active Services</h2>
                <p className="text-sm text-muted-foreground">
                  Default operator-visible services for the current AppOS instance.
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
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const sorted = useMemo(() => {
    return [...components].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  }, [components])

  const fetchComponents = useCallback(async (force = false) => {
    if (force) {
      setComponents([])
      setError('')
    }
    setLoading(true)
    try {
      setComponents(await fetchInstalledComponents(force))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load components')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchComponents()
  }, [fetchComponents])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="icon"
          title="Force refresh"
          disabled={loading}
          onClick={() => void fetchComponents(true)}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
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
  servicesInterval: number
  setServicesInterval: (value: number) => void
  sortKey: ActiveServicesSortKey
  sortDir: 'asc' | 'desc'
  handleSort: (key: ActiveServicesSortKey) => void
  refreshServices: () => Promise<void>
  openLogs: (name: string, stream?: 'stdout' | 'stderr') => Promise<void>
  logDialog: ActiveServicesLogDialog | null
  closeLogDialog: () => void
}

export function useActiveServicesController(): ActiveServicesController {
  const [services, setServices] = useState<ServiceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [servicesInterval, setServicesInterval] = useState(5000)
  const [logDialog, setLogDialog] = useState<ActiveServicesLogDialog | null>(null)
  const [sortKey, setSortKey] = useState<ActiveServicesSortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: ActiveServicesSortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const fetchServices = useCallback(async () => {
    try {
      setServices(await fetchActiveServices())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services')
    } finally {
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
    if (servicesInterval === 0) return
    const timer = window.setInterval(() => {
      void fetchServices()
    }, servicesInterval)
    return () => window.clearInterval(timer)
  }, [fetchServices, servicesInterval])

  return {
    services,
    loading,
    error,
    servicesInterval,
    setServicesInterval,
    sortKey,
    sortDir,
    handleSort,
    refreshServices: fetchServices,
    openLogs,
    logDialog,
    closeLogDialog: () => setLogDialog(null),
  }
}

export function ActiveServicesControls({ controller }: { controller: ActiveServicesController }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Select
        value={String(controller.servicesInterval)}
        onValueChange={value => controller.setServicesInterval(Number(value))}
      >
        <SelectTrigger className="h-8 w-[90px] text-xs">
          <SelectValue placeholder="Auto-refresh" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Off</SelectItem>
          <SelectItem value="5000">5s</SelectItem>
          <SelectItem value="10000">10s</SelectItem>
          <SelectItem value="30000">30s</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        title="Refresh active services"
        aria-label="Refresh active services"
        onClick={() => void controller.refreshServices()}
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
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
      const av = sortKey === 'state' ? a.state : a.name
      const bv = sortKey === 'state' ? b.state : b.name
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
          <p className="text-muted-foreground">{emptyMessage || 'No active services are configured.'}</p>
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
              <TableHead className="hidden lg:table-cell">Last Detected</TableHead>
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
                  {service.state === 'running' || service.cpu > 0
                    ? `${service.cpu.toFixed(1)}%`
                    : '-'}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {formatServiceMemory(service.memory)}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {formatServiceUptime(service.uptime)}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {formatComponentStatusTime(service.last_detected_at)}
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
        <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Service Logs: {logDialog?.name}</DialogTitle>
            <DialogDescription>
              {logDialog?.lastDetectedAt
                ? `Last detected ${formatComponentStatusTime(logDialog.lastDetectedAt)}`
                : 'Diagnostic logs for the selected service'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mb-2">
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
          <div className="flex-1 overflow-auto min-h-0">
            {logDialog?.loading ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground">
                Loading service logs...
              </div>
            ) : (
              <pre className="bg-muted p-4 rounded-lg text-xs font-mono whitespace-pre-wrap break-all overflow-auto max-h-[65vh]">
                {logDialog?.content || 'No log content'}
              </pre>
            )}
          </div>
          {logDialog?.truncated ? (
            <p className="text-xs text-muted-foreground">Showing a truncated log tail.</p>
          ) : null}
          <DialogFooter>
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