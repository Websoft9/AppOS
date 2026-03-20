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
import { pb } from '@/lib/pb'

type ComponentItem = {
  id: string
  name: string
  version: string
  available: boolean
  updated_at: string
}

type ServiceItem = {
  name: string
  state: string
  pid: number
  uptime: number
  cpu: number
  memory: number
  last_detected_at: string
  log_available: boolean
}

type ServiceLogResponse = {
  name: string
  stream: 'stdout' | 'stderr'
  content: string
  truncated: boolean
  last_detected_at: string
}

function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatMemory(bytes: number): string {
  if (bytes <= 0) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function serviceVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
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

export function ComponentsPage() {
  const [tab, setTab] = useState<'components' | 'services'>('components')
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [services, setServices] = useState<ServiceItem[]>([])
  const [componentsLoading, setComponentsLoading] = useState(true)
  const [servicesLoading, setServicesLoading] = useState(true)
  const [componentsError, setComponentsError] = useState('')
  const [servicesError, setServicesError] = useState('')
  const [servicesInterval, setServicesInterval] = useState(5000)
  const [logDialog, setLogDialog] = useState<{    name: string
    stream: 'stdout' | 'stderr'
    content: string
    loading: boolean
    truncated: boolean
    lastDetectedAt: string
  } | null>(null)

  const fetchComponents = useCallback(async (force = false) => {
    if (force) {
      setComponents([])
      setComponentsError('')
    }
    setComponentsLoading(true)
    try {
      const url = force ? '/api/components?force=1' : '/api/components'
      const data = await pb.send<ComponentItem[]>(url, { method: 'GET' })
      setComponents(Array.isArray(data) ? data : [])
      setComponentsError('')
    } catch (err) {
      setComponentsError(err instanceof Error ? err.message : 'Failed to load components')
    } finally {
      setComponentsLoading(false)
    }
  }, [])

  const fetchServices = useCallback(async () => {
    try {
      const data = await pb.send<ServiceItem[]>('/api/components/services', { method: 'GET' })
      setServices(Array.isArray(data) ? data : [])
      setServicesError('')
    } catch (err) {
      setServicesError(err instanceof Error ? err.message : 'Failed to load services')
    } finally {
      setServicesLoading(false)
    }
  }, [])

  const openLogs = useCallback(async (name: string, stream: 'stdout' | 'stderr' = 'stdout') => {
    setLogDialog({
      name,
      stream,
      content: '',
      loading: true,
      truncated: false,
      lastDetectedAt: '',
    })
    try {
      const data = await pb.send<ServiceLogResponse>(
        `/api/components/services/${encodeURIComponent(name)}/logs?stream=${stream}&tail=200`,
        { method: 'GET' }
      )
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
    void fetchComponents()
    void fetchServices()
  }, [fetchComponents, fetchServices])

  useEffect(() => {
    if (tab !== 'services' || servicesInterval === 0) return
    const timer = window.setInterval(() => {
      void fetchServices()
    }, servicesInterval)
    return () => window.clearInterval(timer)
  }, [fetchServices, tab, servicesInterval])

  return (
    <div className="space-y-4 p-4 cursor-default">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Components</h1>
          <p className="text-muted-foreground mt-1">
            Inspect installed platform components and active internal services.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={value => setTab(value as 'components' | 'services')}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="components">Installed Components</TabsTrigger>
            <TabsTrigger value="services">Active Services</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {tab === 'services' && (
              <Select
                value={String(servicesInterval)}
                onValueChange={v => setServicesInterval(Number(v))}
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
              disabled={tab === 'components' ? componentsLoading : servicesLoading}
              onClick={() =>
                tab === 'components' ? void fetchComponents(true) : void fetchServices()
              }
            >
              {tab === 'components' && componentsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tab === 'services' && servicesLoading ? (
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
            Read-only snapshot for quick awareness. No actions are required here.
          </p>

          {componentsLoading ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">Loading installed components...</p>
            </div>
          ) : components.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">No installed components were detected.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-gradient-to-br from-muted/40 via-background to-muted/20 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {components.map(component => (
                  <article
                    key={component.id}
                    className="rounded-xl border bg-background/80 p-4"
                  >
                    <p className="text-base font-medium leading-6">{component.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Version {component.version || 'unknown'}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Updated {formatTime(component.updated_at)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {component.available ? 'Detected and available' : 'Detected but currently unavailable'}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="services" className="mt-4 space-y-4">
          {servicesError ? (
            <Alert variant="destructive">
              <AlertDescription>{servicesError}</AlertDescription>
            </Alert>
          ) : null}

          {servicesLoading ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">Loading active services...</p>
            </div>
          ) : services.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
              <p className="text-muted-foreground">No active services are configured.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="hidden sm:table-cell">PID</TableHead>
                  <TableHead className="hidden md:table-cell">CPU</TableHead>
                  <TableHead className="hidden md:table-cell">Memory</TableHead>
                  <TableHead className="hidden lg:table-cell">Uptime</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Detected</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map(service => (
                  <TableRow key={service.name}>
                    <TableCell className="font-medium">{service.name}</TableCell>
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
                      {formatMemory(service.memory)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {formatUptime(service.uptime)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {formatTime(service.last_detected_at)}
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
        </TabsContent>
      </Tabs>

      <Dialog open={!!logDialog} onOpenChange={open => !open && setLogDialog(null)}>
        <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Service Logs: {logDialog?.name}</DialogTitle>
            <DialogDescription>
              {logDialog?.lastDetectedAt
                ? `Last detected ${formatTime(logDialog.lastDetectedAt)}`
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
            <Button variant="outline" onClick={() => setLogDialog(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Split-out exports for embedding in the Status page tabs ─────────────────

function SortBtn<K extends string>({
  label, field, sort, dir, onSort,
}: { label: string; field: K; sort: K; dir: 'asc' | 'desc'; onSort: (f: K) => void }) {
  const active = sort === field
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      {label}
      {active
        ? dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        : <ArrowUpDown className="h-3 w-3 opacity-40" />}
    </button>
  )
}

export function InstalledComponentsContent() {
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const sorted = useMemo(() => {
    return [...components].sort((a, b) => a.name.localeCompare(b.name))
  }, [components])

  const fetchComponents = useCallback(async (force = false) => {
    if (force) {
      setComponents([])
      setError('')
    }
    setLoading(true)
    try {
      const url = force ? '/api/components?force=1' : '/api/components'
      const data = await pb.send<ComponentItem[]>(url, { method: 'GET' })
      setComponents(Array.isArray(data) ? data : [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load components')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchComponents() }, [fetchComponents])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="icon" title="Force refresh" disabled={loading} onClick={() => void fetchComponents(true)}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {sorted.map(component => (
              <article key={component.id} className="rounded-xl border bg-background/80 p-4">
                <p className="text-base font-medium leading-6">{component.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">Version {component.version || 'unknown'}</p>
                <p className="mt-2 text-xs text-muted-foreground">Updated {formatTime(component.updated_at)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {component.available ? 'Detected and available' : 'Detected but currently unavailable'}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ActiveServicesContent() {
  const [services, setServices] = useState<ServiceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [servicesInterval, setServicesInterval] = useState(5000)
  const [logDialog, setLogDialog] = useState<{
    name: string
    stream: 'stdout' | 'stderr'
    content: string
    loading: boolean
    truncated: boolean
    lastDetectedAt: string
  } | null>(null)
  const [sortKey, setSortKey] = useState<'name' | 'state' | 'cpu' | 'memory' | 'uptime'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    return [...services].sort((a, b) => {
      if (sortKey === 'cpu') return sortDir === 'asc' ? a.cpu - b.cpu : b.cpu - a.cpu
      if (sortKey === 'memory') return sortDir === 'asc' ? a.memory - b.memory : b.memory - a.memory
      if (sortKey === 'uptime') return sortDir === 'asc' ? a.uptime - b.uptime : b.uptime - a.uptime
      const av = sortKey === 'state' ? a.state : a.name
      const bv = sortKey === 'state' ? b.state : b.name
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [services, sortKey, sortDir])

  const fetchServices = useCallback(async () => {
    try {
      const data = await pb.send<ServiceItem[]>('/api/components/services', { method: 'GET' })
      setServices(Array.isArray(data) ? data : [])
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
      const data = await pb.send<ServiceLogResponse>(
        `/api/components/services/${encodeURIComponent(name)}/logs?stream=${stream}&tail=200`,
        { method: 'GET' }
      )
      setLogDialog({ name, stream, content: data.content, loading: false, truncated: data.truncated, lastDetectedAt: data.last_detected_at })
    } catch (err) {
      setLogDialog({ name, stream, content: err instanceof Error ? err.message : 'Failed to load logs', loading: false, truncated: false, lastDetectedAt: '' })
    }
  }, [])

  useEffect(() => { void fetchServices() }, [fetchServices])

  useEffect(() => {
    if (servicesInterval === 0) return
    const timer = window.setInterval(() => { void fetchServices() }, servicesInterval)
    return () => window.clearInterval(timer)
  }, [fetchServices, servicesInterval])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <Select value={String(servicesInterval)} onValueChange={v => setServicesInterval(Number(v))}>
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
        <Button variant="outline" size="icon" title="Refresh" onClick={() => void fetchServices()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">Loading active services...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">No active services are configured.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortBtn label="Name" field="name" sort={sortKey} dir={sortDir} onSort={handleSort} /></TableHead>
              <TableHead><SortBtn label="State" field="state" sort={sortKey} dir={sortDir} onSort={handleSort} /></TableHead>
              <TableHead className="hidden sm:table-cell">PID</TableHead>
              <TableHead className="hidden md:table-cell"><SortBtn label="CPU" field="cpu" sort={sortKey} dir={sortDir} onSort={handleSort} /></TableHead>
              <TableHead className="hidden md:table-cell"><SortBtn label="Memory" field="memory" sort={sortKey} dir={sortDir} onSort={handleSort} /></TableHead>
              <TableHead className="hidden lg:table-cell"><SortBtn label="Uptime" field="uptime" sort={sortKey} dir={sortDir} onSort={handleSort} /></TableHead>
              <TableHead className="hidden lg:table-cell">Last Detected</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(service => (
              <TableRow key={service.name}>
                <TableCell className="font-medium">{service.name}</TableCell>
                <TableCell>
                  <Badge variant={serviceVariant(service.state)}>{service.state}</Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{service.pid > 0 ? service.pid : '-'}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {service.state === 'running' || service.cpu > 0 ? `${service.cpu.toFixed(1)}%` : '-'}
                </TableCell>
                <TableCell className="hidden md:table-cell">{formatMemory(service.memory)}</TableCell>
                <TableCell className="hidden lg:table-cell">{formatUptime(service.uptime)}</TableCell>
                <TableCell className="hidden lg:table-cell">{formatTime(service.last_detected_at)}</TableCell>
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

      <Dialog open={!!logDialog} onOpenChange={open => !open && setLogDialog(null)}>
        <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Service Logs: {logDialog?.name}</DialogTitle>
            <DialogDescription>
              {logDialog?.lastDetectedAt
                ? `Last detected ${formatTime(logDialog.lastDetectedAt)}`
                : 'Diagnostic logs for the selected service'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mb-2">
            <Button variant={logDialog?.stream === 'stdout' ? 'default' : 'outline'} size="sm"
              onClick={() => logDialog && void openLogs(logDialog.name, 'stdout')}>stdout</Button>
            <Button variant={logDialog?.stream === 'stderr' ? 'default' : 'outline'} size="sm"
              onClick={() => logDialog && void openLogs(logDialog.name, 'stderr')}>stderr</Button>
            <Button variant="outline" size="sm"
              onClick={() => logDialog && void openLogs(logDialog.name, logDialog.stream)}>Refresh</Button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {logDialog?.loading ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground">Loading service logs...</div>
            ) : (
              <pre className="bg-muted p-4 rounded-lg text-xs font-mono whitespace-pre-wrap break-all overflow-auto max-h-[65vh]">
                {logDialog?.content || 'No log content'}
              </pre>
            )}
          </div>
          {logDialog?.truncated ? <p className="text-xs text-muted-foreground">Showing a truncated log tail.</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}