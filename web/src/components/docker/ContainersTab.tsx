import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import { dockerApiPath, dockerApiUrl } from '@/lib/docker-api'
import {
  getServerContainerTelemetry,
  type MonitorContainerTelemetryItem,
  type MonitorContainerTelemetryResponse,
  type MonitorMetricSeries,
} from '@/lib/monitor-api'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { TimeSeriesChart } from '@/components/monitor/TimeSeriesChart'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Play,
  Square,
  RefreshCw,
  RotateCw,
  Trash2,
  MoreVertical,
  Container as ContainerIcon,
  TerminalSquare,
  ScrollText,
  Activity,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Download,
  Filter,
  Loader2,
  Settings2,
} from 'lucide-react'

const CONTAINERS_SORT_KEY = 'docker.containers.sort'

type ContainerPageSize = 25 | 50 | 100

type ContainerVisibleColumns = {
  ports: boolean
  status: boolean
  cpu: boolean
  mem: boolean
  network: boolean
  compose: boolean
}

interface Container {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
  Ports?: string
  RunningFor?: string
}

function parseContainers(output: string): Container[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean) as Container[]
}

function shortName(name: string): string {
  if (!name) return '-'
  return name.length > 20 ? `${name.slice(0, 20)}…` : name
}

function formatBytesCompact(bytes?: number): string {
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

function formatPercent(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function formatRateBytes(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '-'
  return `${formatBytesCompact(value)}/s`
}

function formatNetworkSummary(item?: MonitorContainerTelemetryItem): string {
  if (!item || item.freshness.state === 'missing') return 'No telemetry'
  const inbound = item.latest.networkRxBytesPerSecond
  const outbound = item.latest.networkTxBytesPerSecond
  if (inbound == null && outbound == null) return 'No telemetry'
  return `${inbound == null ? '—' : formatRateBytes(inbound)} in / ${outbound == null ? '—' : formatRateBytes(outbound)} out`
}

function telemetrySeries(
  item: MonitorContainerTelemetryItem | undefined,
  name: string
): MonitorMetricSeries | undefined {
  return item?.series?.find(series => series.name === name)
}

function telemetryBadge(item?: MonitorContainerTelemetryItem) {
  if (!item || item.freshness.state === 'missing') {
    return <Badge variant="outline">No telemetry</Badge>
  }
  if (item.freshness.state === 'stale') {
    return <Badge variant="outline">Stale telemetry</Badge>
  }
  return null
}

function telemetryObservedAt(item?: MonitorContainerTelemetryItem): string {
  if (!item?.freshness.observedAt) return '—'
  return new Date(item.freshness.observedAt).toLocaleString()
}

function formatTrendValue(unit: string, _name: string, value: number): string {
  if (unit === 'bytes') return formatBytesCompact(value)
  if (unit === 'bytes/s') return `${formatBytesCompact(value)}/s`
  if (unit === 'percent') return formatPercent(value)
  return `${value}`
}

function hostPublishedPorts(rawPorts?: string): string {
  if (!rawPorts) return '-'
  const values = rawPorts
    .split(',')
    .map(item => item.trim())
    .filter(item => item.includes('->'))
    .map(item => item.split('->')[0]?.trim())
    .map(left => {
      if (!left) return ''
      const match = left.match(/:(\d+)$/)
      return match?.[1] || ''
    })
    .filter(Boolean)
  if (values.length === 0) return '-'
  return Array.from(new Set(values)).join(', ')
}

function parseInspect(output: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed[0]) return parsed[0] as Record<string, any>
    return null
  } catch {
    return null
  }
}

function containerIP(inspect?: Record<string, any> | null): string {
  const networks = inspect?.NetworkSettings?.Networks as Record<string, any> | undefined
  if (!networks) return '-'
  for (const network of Object.values(networks)) {
    const ip = network?.IPAddress
    if (ip) return ip
  }
  return '-'
}

function composeName(inspect?: Record<string, any> | null): string {
  const labels = inspect?.Config?.Labels as Record<string, string> | undefined
  return labels?.['com.docker.compose.project'] || '-'
}

function inspectPorts(inspect?: Record<string, any> | null): string[] {
  const ports = inspect?.NetworkSettings?.Ports as
    | Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>
    | undefined
  if (!ports) return []
  const result: string[] = []
  for (const [containerPort, bindings] of Object.entries(ports)) {
    if (!bindings || bindings.length === 0) {
      result.push(containerPort)
      continue
    }
    for (const binding of bindings) {
      result.push(`${binding.HostIp || '0.0.0.0'}:${binding.HostPort || '?'} -> ${containerPort}`)
    }
  }
  return result
}

function inspectVolumes(inspect?: Record<string, any> | null): string[] {
  const mounts = inspect?.Mounts as
    | Array<{ Source?: string; Destination?: string; Type?: string }>
    | undefined
  if (!Array.isArray(mounts)) return []
  return mounts.map(
    mount => `${mount.Source || '-'}:${mount.Destination || '-'} (${mount.Type || 'bind'})`
  )
}

function inspectNetworks(inspect?: Record<string, any> | null): string[] {
  const networks = inspect?.NetworkSettings?.Networks as Record<string, any> | undefined
  if (!networks) return []
  return Object.keys(networks)
}

function statusBadge(state: string) {
  const variant = state === 'running' ? 'default' : 'secondary'
  return <Badge variant={variant}>{state}</Badge>
}

type SortKey = 'name' | 'created' | 'cpu' | 'mem' | 'compose'

export function ContainersTab({
  serverId,
  searchQuery,
  onSearchQueryChange,
  page,
  pageSize,
  visibleColumns,
  refreshDisabled,
  refreshing,
  onOpenTerminal,
  filterPreset,
  includeNames,
  onClearFilterPreset,
  onClearIncludeNames,
  onPageChange,
  onPageSizeChange,
  onSummaryChange,
  onVisibleColumnsChange,
  onRefresh,
  onOpenComposeFilter,
  showPanelChrome = true,
}: {
  serverId: string
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
  page: number
  pageSize: ContainerPageSize
  visibleColumns: ContainerVisibleColumns
  refreshDisabled?: boolean
  refreshing?: boolean
  onOpenTerminal?: (containerId: string) => void
  filterPreset?: string
  includeNames?: string[]
  onClearFilterPreset?: () => void
  onClearIncludeNames?: () => void
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: ContainerPageSize) => void
  onSummaryChange?: (summary: { totalItems: number; totalPages: number }) => void
  onVisibleColumnsChange?: (columns: ContainerVisibleColumns) => void
  onRefresh?: () => void
  onOpenComposeFilter?: (composeName: string) => void
  showPanelChrome?: boolean
}) {
  type PendingAction = {
    container: Container
    action: 'stop' | 'restart' | 'remove'
    force?: boolean
  }

  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [logsContainer, setLogsContainer] = useState<Container | null>(null)
  const [statsContainer, setStatsContainer] = useState<Container | null>(null)
  const [logsContent, setLogsContent] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsActionTip, setLogsActionTip] = useState('')
  const [stateFilter, setStateFilter] = useState<
    'all' | 'running' | 'exited' | 'paused' | 'created'
  >('all')
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const raw = localStorage.getItem(CONTAINERS_SORT_KEY)
      if (!raw) return 'name'
      const parsed = JSON.parse(raw) as { key?: SortKey }
      return parsed.key && ['name', 'created', 'cpu', 'mem', 'compose'].includes(parsed.key)
        ? parsed.key
        : 'name'
    } catch {
      return 'name'
    }
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try {
      const raw = localStorage.getItem(CONTAINERS_SORT_KEY)
      if (!raw) return 'asc'
      const parsed = JSON.parse(raw) as { dir?: 'asc' | 'desc' }
      return parsed.dir || 'asc'
    } catch {
      return 'asc'
    }
  })
  const [copiedTip, setCopiedTip] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [inspectMap, setInspectMap] = useState<Record<string, Record<string, any>>>({})
  const [detailsLoadingMap, setDetailsLoadingMap] = useState<Record<string, boolean>>({})
  const [allDetailsLoading, setAllDetailsLoading] = useState(false)
  const [allDetailsCached, setAllDetailsCached] = useState(false)
  const [detailsErrorMessage, setDetailsErrorMessage] = useState<string | null>(null)
  const [fakeLoadingProgress, setFakeLoadingProgress] = useState(0)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  useEffect(() => {
    localStorage.setItem(CONTAINERS_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])
  const {
    data: containers = [],
    isLoading: loading,
    error: containersError,
  } = useQuery<Container[]>({
    queryKey: ['docker', 'containers', serverId],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/containers'), {
        method: 'GET',
      })
      return parseContainers(res.output)
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const containerIdsKey = useMemo(() => containers.map(c => c.ID).join(','), [containers])

  useEffect(() => {
    const idSet = new Set(containers.map(container => container.ID))
    setInspectMap(state => {
      const next: Record<string, Record<string, any>> = {}
      for (const [id, inspect] of Object.entries(state)) {
        if (idSet.has(id)) next[id] = inspect
      }
      return next
    })
    setAllDetailsCached(false)
    setDetailsErrorMessage(null)
  }, [containerIdsKey])

  const telemetryIds = useMemo(
    () =>
      containers
        .map(container => container.ID)
        .filter(Boolean)
        .sort(),
    [containers]
  )

  const {
    data: telemetry,
    isLoading: telemetryLoading,
    error: telemetryError,
  } = useQuery<MonitorContainerTelemetryResponse>({
    queryKey: ['monitor', 'container-telemetry', serverId, telemetryIds.join(','), '15m'],
    queryFn: () => getServerContainerTelemetry(serverId, telemetryIds, '15m'),
    enabled: telemetryIds.length > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const telemetryMap = useMemo(() => {
    const next: Record<string, MonitorContainerTelemetryItem> = {}
    for (const item of telemetry?.items || []) {
      if (!item.containerId) continue
      next[item.containerId] = item
    }
    return next
  }, [telemetry?.items])

  const loadInspectForContainer = useCallback(
    async (containerId: string) => {
      if (!containerId || inspectMap[containerId] || detailsLoadingMap[containerId]) return

      setDetailsLoadingMap(state => ({ ...state, [containerId]: true }))
      try {
        const inspectRes = await pb.send(dockerApiPath(serverId, `/containers/${containerId}`), {
          method: 'GET',
        })
        const inspect = parseInspect(inspectRes.output)
        if (inspect) {
          setInspectMap(state => ({ ...state, [containerId]: inspect }))
        }
      } catch (err) {
        setDetailsErrorMessage(getApiErrorMessage(err, 'Failed to load container details'))
      } finally {
        setDetailsLoadingMap(state => ({ ...state, [containerId]: false }))
      }
    },
    [detailsLoadingMap, inspectMap, serverId]
  )

  const loadAllDetails = useCallback(async () => {
    if (containers.length === 0 || allDetailsLoading || allDetailsCached) return

    setAllDetailsLoading(true)
    setDetailsErrorMessage(null)
    try {
      const inspectEntries = await Promise.all(
        containers.map(async container => {
          try {
            const inspectRes = await pb.send(
              dockerApiPath(serverId, `/containers/${container.ID}`),
              { method: 'GET' }
            )
            return [container.ID, parseInspect(inspectRes.output)] as const
          } catch {
            return [container.ID, null] as const
          }
        })
      )

      const nextInspect: Record<string, Record<string, any>> = {}
      for (const [id, inspect] of inspectEntries) {
        if (inspect) nextInspect[id] = inspect
      }

      setInspectMap(state => ({ ...state, ...nextInspect }))
      setAllDetailsCached(true)
    } catch (err) {
      setDetailsErrorMessage(getApiErrorMessage(err, 'Failed to load container details'))
    } finally {
      setAllDetailsLoading(false)
    }
  }, [allDetailsCached, allDetailsLoading, containers, serverId])

  useEffect(() => {
    if (!visibleColumns.cpu && !visibleColumns.mem && !visibleColumns.compose) return
    void loadAllDetails()
  }, [loadAllDetails, visibleColumns.compose, visibleColumns.cpu, visibleColumns.mem])

  useEffect(() => {
    if (!allDetailsLoading) {
      if (fakeLoadingProgress > 0 && fakeLoadingProgress < 100) {
        setFakeLoadingProgress(100)
        const doneTimer = window.setTimeout(() => setFakeLoadingProgress(0), 260)
        return () => window.clearTimeout(doneTimer)
      }
      return
    }

    setFakeLoadingProgress(8)
    const timer = window.setInterval(() => {
      setFakeLoadingProgress(value => {
        if (value >= 92) return value
        const increment = Math.max(1, Math.round((100 - value) * 0.08))
        return Math.min(92, value + increment)
      })
    }, 180)

    return () => window.clearInterval(timer)
  }, [allDetailsLoading])

  useEffect(() => {
    if (visibleColumns.cpu || visibleColumns.mem || visibleColumns.compose) return
    if (sortKey === 'created' || sortKey === 'cpu' || sortKey === 'mem' || sortKey === 'compose') {
      setSortKey('name')
      setSortDir('asc')
    }
  }, [sortKey, visibleColumns.compose, visibleColumns.cpu, visibleColumns.mem])

  const action = async (id: string, act: string, options?: { force?: boolean }) => {
    try {
      setActionError(null)
      if (act === 'remove') {
        await pb.send(dockerApiUrl(serverId, `/containers/${id}`, { force: options?.force ? 1 : undefined }), {
          method: 'DELETE',
        })
      } else {
        await pb.send(dockerApiPath(serverId, `/containers/${id}/${act}`), {
          method: 'POST',
        })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'containers', serverId] }),
      ])
      setAllDetailsCached(false)
      setDetailsErrorMessage(null)
    } catch (err) {
      setActionError(getApiErrorMessage(err, `Failed to ${act} container`))
    }
  }

  const fetchLogs = useCallback(
    async (container: Container) => {
      try {
        setLogsLoading(true)
        setLogsContainer(container)
        const res = await pb.send(dockerApiUrl(serverId, `/containers/${container.ID}/logs`, { tail: 300 }), {
          method: 'GET',
        })
        setLogsContent(typeof res.output === 'string' ? res.output : '')
      } catch (err) {
        setLogsContent(String(err))
      } finally {
        setLogsLoading(false)
      }
    },
    [serverId]
  )

  const copyLogs = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logsContent || '')
      setLogsActionTip('Logs copied')
      window.setTimeout(() => setLogsActionTip(''), 1200)
    } catch {
      setLogsActionTip('Failed to copy logs')
      window.setTimeout(() => setLogsActionTip(''), 1200)
    }
  }, [logsContent])

  const downloadLogs = useCallback(() => {
    try {
      const safeName = (logsContainer?.Names || 'container').replace(/[^a-zA-Z0-9._-]/g, '_')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const blob = new Blob([logsContent || ''], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeName}-logs-${timestamp}.log`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      setLogsActionTip('Failed to download logs')
      window.setTimeout(() => setLogsActionTip(''), 1200)
    }
  }, [logsContainer?.Names, logsContent])

  const activeSearchQuery = String(searchQuery ?? filterPreset ?? '')
    .trim()
    .toLowerCase()

  const filtered = containers.filter(
    c =>
      c.Names?.toLowerCase().includes(activeSearchQuery) ||
      c.Image?.toLowerCase().includes(activeSearchQuery)
  )

  const stateFiltered = filtered.filter(container => {
    if (stateFilter === 'all') return true
    return (container.State || '').toLowerCase() === stateFilter
  })

  const nameFiltered = stateFiltered.filter(container => {
    if (!includeNames || includeNames.length === 0) return true
    return includeNames.includes(container.Names)
  })

  const sorted = useMemo(() => {
    const items = [...nameFiltered]
    items.sort((left, right) => {
      const leftInspect = inspectMap[left.ID]
      const rightInspect = inspectMap[right.ID]
      const leftTelemetry = telemetryMap[left.ID]
      const rightTelemetry = telemetryMap[right.ID]

      if (sortKey === 'mem') {
        const leftMem = leftTelemetry?.latest.memoryBytes || 0
        const rightMem = rightTelemetry?.latest.memoryBytes || 0
        if (leftMem < rightMem) return sortDir === 'asc' ? -1 : 1
        if (leftMem > rightMem) return sortDir === 'asc' ? 1 : -1
        return 0
      }

      if (sortKey === 'cpu') {
        const leftCpu = leftTelemetry?.latest.cpuPercent || 0
        const rightCpu = rightTelemetry?.latest.cpuPercent || 0
        if (leftCpu < rightCpu) return sortDir === 'asc' ? -1 : 1
        if (leftCpu > rightCpu) return sortDir === 'asc' ? 1 : -1
        return 0
      }

      const leftValue = (() => {
        switch (sortKey) {
          case 'created':
            return String(leftInspect?.Created || '')
          case 'compose':
            return composeName(leftInspect)
          default:
            return left.Names
        }
      })().toLowerCase()

      const rightValue = (() => {
        switch (sortKey) {
          case 'created':
            return String(rightInspect?.Created || '')
          case 'compose':
            return composeName(rightInspect)
          default:
            return right.Names
        }
      })().toLowerCase()

      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [inspectMap, nameFiltered, sortDir, sortKey, telemetryMap])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [page, pageSize, sorted])

  useEffect(() => {
    if (page !== 1) onPageChange?.(1)
  }, [
    activeSearchQuery,
    includeNames,
    onPageChange,
    page,
    pageSize,
    serverId,
    sortDir,
    sortKey,
    stateFilter,
  ])

  useEffect(() => {
    if (page > totalPages) onPageChange?.(totalPages)
  }, [onPageChange, page, totalPages])

  useEffect(() => {
    onSummaryChange?.({ totalItems: sorted.length, totalPages })
  }, [onSummaryChange, sorted.length, totalPages])

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedTip(`${label} copied`)
      window.setTimeout(() => setCopiedTip(''), 1200)
    } catch {
      setCopiedTip(`Failed to copy ${label}`)
      window.setTimeout(() => setCopiedTip(''), 1200)
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({
    label,
    keyName,
    className,
  }: {
    label: string
    keyName: SortKey
    className?: string
  }) => (
    <Button
      variant="ghost"
      size="sm"
      className={cn('h-7 justify-start px-0 text-xs', className)}
      onClick={() => toggleSort(keyName)}
    >
      {label}
      {sortKey !== keyName ? (
        <ArrowUpDown className="h-3 w-3 ml-1" />
      ) : sortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3 ml-1" />
      ) : (
        <ArrowDown className="h-3 w-3 ml-1" />
      )}
    </Button>
  )

  const loadError = containersError
    ? getApiErrorMessage(containersError, 'Failed to load containers')
    : telemetryError
      ? getApiErrorMessage(telemetryError, 'Failed to load container telemetry')
      : detailsErrorMessage

  const detailsColumnsVisible = visibleColumns.cpu || visibleColumns.mem || visibleColumns.compose
  const tableColSpan =
    3 +
    (visibleColumns.ports ? 1 : 0) +
    (visibleColumns.status ? 1 : 0) +
    (detailsColumnsVisible ? 1 : 0) +
    (visibleColumns.cpu ? 1 : 0) +
    (visibleColumns.mem ? 1 : 0) +
    (visibleColumns.network ? 1 : 0) +
    (visibleColumns.compose ? 1 : 0)
  const totalItems = sorted.length

  return (
    <div className="min-h-0 flex flex-col gap-3">
      {(loadError || actionError) && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{loadError || actionError}</AlertDescription>
        </Alert>
      )}
      <div className="overflow-hidden bg-background">
        <div className="flex flex-col gap-3 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {showPanelChrome ? (
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ContainerIcon className="h-4 w-4 text-muted-foreground" />
                <span>Containers</span>
              </div>
            ) : (
              <div />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <input
                value={searchQuery ?? ''}
                onChange={event => onSearchQueryChange?.(event.target.value)}
                placeholder="Search containers"
                className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
              />
              <span className="text-xs text-muted-foreground">Total {totalItems} items</span>
              <div className="flex items-center gap-0.5 text-xs">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 min-w-0 px-0.5"
                  onClick={() => onPageChange?.(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  aria-label="Previous containers page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-center font-medium tabular-nums">{page}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 min-w-0 px-0.5"
                  onClick={() => onPageChange?.(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  aria-label="Next containers page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              {showPanelChrome ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onRefresh?.()}
                  disabled={refreshDisabled || refreshing}
                  title="Refresh Docker data"
                  aria-label="Refresh Docker data"
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Container display settings"
                    title="Container display settings"
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Rows Per Page</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={String(pageSize)}
                    onValueChange={value => onPageSizeChange?.(Number(value) as ContainerPageSize)}
                  >
                    <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Visible Columns</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.ports}
                    onCheckedChange={checked =>
                      onVisibleColumnsChange?.({ ...visibleColumns, ports: checked === true })
                    }
                  >
                    Ports
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.status}
                    onCheckedChange={checked =>
                      onVisibleColumnsChange?.({ ...visibleColumns, status: checked === true })
                    }
                  >
                    Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.cpu}
                    onCheckedChange={checked =>
                      onVisibleColumnsChange?.({ ...visibleColumns, cpu: checked === true })
                    }
                  >
                    CPU%
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.mem}
                    onCheckedChange={checked =>
                      onVisibleColumnsChange?.({ ...visibleColumns, mem: checked === true })
                    }
                  >
                    Mem
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.network}
                    onCheckedChange={checked =>
                      onVisibleColumnsChange?.({ ...visibleColumns, network: checked === true })
                    }
                  >
                    Network
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.compose}
                    onCheckedChange={checked =>
                      onVisibleColumnsChange?.({ ...visibleColumns, compose: checked === true })
                    }
                  >
                    Compose
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {((filterPreset && onClearFilterPreset) || (includeNames && includeNames.length > 0)) && (
            <div className="flex items-center justify-end gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClearFilterPreset?.()
                  onClearIncludeNames?.()
                }}
              >
                Clear linked filter
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {includeNames && includeNames.length > 0 && (
              <Badge variant="outline">Linked containers: {includeNames.length}</Badge>
            )}
            {allDetailsLoading && <Badge variant="outline">Loading container details...</Badge>}
            {telemetryLoading && <Badge variant="outline">Loading telemetry...</Badge>}
          </div>
          {(allDetailsLoading || (fakeLoadingProgress > 0 && fakeLoadingProgress < 100)) && (
            <div className="shrink-0 space-y-1">
              <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${Math.max(6, Math.min(100, fakeLoadingProgress))}%` }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                Preparing container metrics... {Math.min(100, Math.round(fakeLoadingProgress))}%
              </div>
            </div>
          )}
          {copiedTip && <div className="text-xs text-muted-foreground shrink-0">{copiedTip}</div>}
        </div>

        <div className="border-t" />

        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="px-2">
                <div className="grid grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-1">
                  <span aria-hidden="true" />
                  <SortHead label="Name" keyName="name" />
                </div>
              </TableHead>
              <TableHead>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-foreground">State</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Filter container state"
                        title={
                          stateFilter === 'all'
                            ? 'Filter container state'
                            : `Container state: ${stateFilter}`
                        }
                      >
                        <Filter
                          className={
                            stateFilter === 'all' ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5 text-foreground'
                          }
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuRadioGroup
                        value={stateFilter}
                        onValueChange={value =>
                          setStateFilter(
                            value as 'all' | 'running' | 'exited' | 'paused' | 'created'
                          )
                        }
                      >
                        <DropdownMenuRadioItem value="all">All states</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="running">Running</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="exited">Exited</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="paused">Paused</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableHead>
              {visibleColumns.ports && (
                <TableHead className="text-xs font-medium text-foreground">Ports</TableHead>
              )}
              {detailsColumnsVisible && (
                <TableHead>
                  <SortHead label="Created" keyName="created" />
                </TableHead>
              )}
              {visibleColumns.status && (
                <TableHead className="text-xs font-medium text-foreground">Status</TableHead>
              )}
              {visibleColumns.cpu && (
                <TableHead>
                  <SortHead label="CPU%" keyName="cpu" />
                </TableHead>
              )}
              {visibleColumns.mem && (
                <TableHead>
                  <SortHead label="Mem" keyName="mem" />
                </TableHead>
              )}
              {visibleColumns.network && (
                <TableHead className="text-xs font-medium text-foreground">Net</TableHead>
              )}
              {visibleColumns.compose && (
                <TableHead>
                  <SortHead label="Compose" keyName="compose" />
                </TableHead>
              )}
              <TableHead className="w-[60px] text-xs font-medium text-foreground">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={tableColSpan} className="text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                </TableCell>
              </TableRow>
            )}
            {paged.map(c => {
              const inspect = inspectMap[c.ID]
              const telemetryItem = telemetryMap[c.ID]
              return (
                <Fragment key={c.ID}>
                  <TableRow className="hover:bg-muted/30">
                    <TableCell className="px-2 font-mono text-xs">
                      <Button
                        variant="link"
                        className="grid h-auto w-full grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-1 p-0 text-left font-mono text-xs"
                        onClick={() => {
                          setExpandedId(id => {
                            const nextId = id === c.ID ? null : c.ID
                            if (nextId === c.ID) {
                              void loadInspectForContainer(c.ID)
                            }
                            return nextId
                          })
                        }}
                      >
                        {expandedId === c.ID ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        <span className="truncate text-left" title={c.Names}>
                          {shortName(c.Names)}
                        </span>
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {statusBadge(c.State)}
                        {telemetryBadge(telemetryItem)}
                      </div>
                    </TableCell>
                    {visibleColumns.ports && (
                      <TableCell className="text-xs">{hostPublishedPorts(c.Ports)}</TableCell>
                    )}
                    {detailsColumnsVisible && (
                      <TableCell className="text-xs">
                        {allDetailsLoading
                          ? '...'
                          : inspect?.Created
                            ? new Date(inspect.Created).toLocaleString()
                            : '-'}
                      </TableCell>
                    )}
                    {visibleColumns.status && <TableCell className="text-xs">{c.Status}</TableCell>}
                    {visibleColumns.cpu && (
                      <TableCell className="text-xs">
                        {telemetryLoading
                          ? '...'
                          : telemetryItem?.freshness.state === 'missing'
                            ? 'No telemetry'
                            : formatPercent(telemetryItem?.latest.cpuPercent)}
                      </TableCell>
                    )}
                    {visibleColumns.mem && (
                      <TableCell className="text-xs">
                        {telemetryLoading
                          ? '...'
                          : telemetryItem?.freshness.state === 'missing'
                            ? 'No telemetry'
                            : formatBytesCompact(telemetryItem?.latest.memoryBytes)}
                      </TableCell>
                    )}
                    {visibleColumns.network && (
                      <TableCell className="text-xs">
                        {telemetryLoading ? '...' : formatNetworkSummary(telemetryItem)}
                      </TableCell>
                    )}
                    {visibleColumns.compose && (
                      <TableCell className="text-xs">
                        {composeName(inspect) !== '-' ? (
                          <Button
                            variant="link"
                            className="h-auto p-0 text-xs"
                            onClick={() => onOpenComposeFilter?.(composeName(inspect))}
                          >
                            {composeName(inspect)}
                          </Button>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {c.State === 'running' && onOpenTerminal && (
                            <DropdownMenuItem onClick={() => onOpenTerminal(c.ID)}>
                              <TerminalSquare className="h-4 w-4 mr-2" /> Terminal
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setStatsContainer(c)}>
                            <Activity className="h-4 w-4 mr-2" /> Stats
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => fetchLogs(c)}>
                            <ScrollText className="h-4 w-4 mr-2" /> Logs
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => action(c.ID, 'start')}
                            disabled={(c.State || '').toLowerCase() === 'running'}
                          >
                            <Play className="h-4 w-4 mr-2" /> Start
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setPendingAction({ container: c, action: 'stop' })}
                          >
                            <Square className="h-4 w-4 mr-2" /> Stop
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setPendingAction({ container: c, action: 'restart' })}
                          >
                            <RotateCw className="h-4 w-4 mr-2" /> Restart
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setPendingAction({ container: c, action: 'remove', force: false })
                            }
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {expandedId === c.ID && (
                    <TableRow>
                      <TableCell colSpan={tableColSpan} className="bg-muted/20 px-3 py-3">
                        <div className="space-y-3 rounded-lg bg-background/80 p-3">
                          <div className="text-sm font-medium">Container Details</div>
                          {detailsLoadingMap[c.ID] && (
                            <div className="text-xs text-muted-foreground">
                              Loading container details...
                            </div>
                          )}
                          <div className="grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-3">
                            <div className="min-w-0 space-y-2 overflow-x-auto">
                              <div className="mb-2 font-semibold text-foreground">Basics</div>
                              <div className="min-w-max whitespace-nowrap font-mono">
                                Image: {c.Image || '-'}
                              </div>
                              <div
                                className="min-w-max cursor-copy whitespace-nowrap font-mono"
                                onDoubleClick={() => copyText(c.ID || '-', 'ID')}
                                title="Double click to copy ID"
                              >
                                ID: {c.ID || '-'}
                              </div>
                              <div
                                className="min-w-max cursor-copy whitespace-nowrap font-mono"
                                onDoubleClick={() => copyText(containerIP(inspect), 'IP')}
                                title="Double click to copy IP"
                              >
                                IP: {containerIP(inspect)}
                              </div>
                            </div>
                            <div className="min-w-0 space-y-2 overflow-x-auto">
                              <div className="mb-2 font-semibold text-foreground">Ports</div>
                              {inspectPorts(inspect).length > 0 ? (
                                inspectPorts(inspect).map(port => (
                                  <div key={port} className="min-w-max whitespace-nowrap font-mono">
                                    {port}
                                  </div>
                                ))
                              ) : (
                                <div className="text-muted-foreground">-</div>
                              )}
                            </div>
                            <div className="min-w-0 space-y-2 overflow-x-auto">
                              <div className="mb-2 font-semibold text-foreground">Network</div>
                              {inspectNetworks(inspect).length > 0 ? (
                                inspectNetworks(inspect).map(network => (
                                  <div
                                    key={network}
                                    className="min-w-max whitespace-nowrap font-mono"
                                  >
                                    {network}
                                  </div>
                                ))
                              ) : (
                                <div className="text-muted-foreground">-</div>
                              )}
                            </div>
                            <div className="min-w-0 space-y-2 overflow-x-auto">
                              <div className="mb-2 font-semibold text-foreground">Volumes</div>
                              {inspectVolumes(inspect).length > 0 ? (
                                <div className="overflow-x-auto">
                                  {inspectVolumes(inspect).map(volume => (
                                    <div
                                      key={volume}
                                      className="min-w-max whitespace-nowrap font-mono"
                                    >
                                      {volume}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-muted-foreground">-</div>
                              )}
                            </div>
                            <div className="min-w-0 space-y-2 overflow-x-auto">
                              <div className="mb-2 font-semibold text-foreground">Env</div>
                              <div className="max-h-32 overflow-auto">
                                {Array.isArray(inspect?.Config?.Env) &&
                                inspect.Config.Env.length > 0 ? (
                                  inspect.Config.Env.map((env: string) => (
                                    <div
                                      key={env}
                                      className="min-w-max whitespace-nowrap font-mono"
                                    >
                                      {env}
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-muted-foreground">-</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
            {!loading && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={tableColSpan} className="text-center text-muted-foreground">
                  No containers found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={open => {
          if (!open) setPendingAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.action === 'remove'
                ? 'Remove container?'
                : pendingAction?.action === 'restart'
                  ? 'Restart container?'
                  : 'Stop container?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.container?.Names
                ? `Container: ${pendingAction.container.Names}`
                : 'Please confirm this action.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingAction?.action === 'remove' && (
            <div className="flex items-center gap-2 py-1">
              <Checkbox
                id="container-remove-force"
                checked={!!pendingAction.force}
                onCheckedChange={checked =>
                  setPendingAction(state => (state ? { ...state, force: !!checked } : state))
                }
              />
              <label
                htmlFor="container-remove-force"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Force remove
              </label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                pendingAction?.action === 'remove'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
              onClick={() => {
                const next = pendingAction
                setPendingAction(null)
                if (!next) return
                void action(next.container.ID, next.action, { force: !!next.force })
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!statsContainer} onOpenChange={open => !open && setStatsContainer(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Container Stats: {statsContainer?.Names}</DialogTitle>
            <DialogDescription>
              Monitor-backed container telemetry for the last 15 minutes.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const item = statsContainer ? telemetryMap[statsContainer.ID] : undefined
            const cpuSeries = telemetrySeries(item, 'cpu')
            const memorySeries = telemetrySeries(item, 'memory')
            const networkSeries = telemetrySeries(item, 'network')
            if (!item || item.freshness.state === 'missing') {
              return (
                <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                  No telemetry for this container yet. Inventory, inspect, logs, and actions remain
                  available.
                </div>
              )
            }
            return (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      CPU
                    </div>
                    <div className="mt-2 font-medium">{formatPercent(item.latest.cpuPercent)}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Memory
                    </div>
                    <div className="mt-2 font-medium">
                      {formatBytesCompact(item.latest.memoryBytes)}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Network
                    </div>
                    <div className="mt-2 font-medium">{formatNetworkSummary(item)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">Telemetry {item.freshness.state}</Badge>
                  <span>Observed {telemetryObservedAt(item)}</span>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">CPU Trend</div>
                    <TimeSeriesChart
                      name="cpu"
                      unit={cpuSeries?.unit || 'percent'}
                      window={telemetry?.window || '15m'}
                      rangeStartAt={telemetry?.rangeStartAt}
                      rangeEndAt={telemetry?.rangeEndAt}
                      stepSeconds={telemetry?.stepSeconds}
                      points={cpuSeries?.points}
                      formatValue={formatTrendValue}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Memory Trend</div>
                    <TimeSeriesChart
                      name="memory"
                      unit={memorySeries?.unit || 'bytes'}
                      window={telemetry?.window || '15m'}
                      rangeStartAt={telemetry?.rangeStartAt}
                      rangeEndAt={telemetry?.rangeEndAt}
                      stepSeconds={telemetry?.stepSeconds}
                      points={memorySeries?.points}
                      formatValue={formatTrendValue}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Network Trend</div>
                    <TimeSeriesChart
                      name="network"
                      unit={networkSeries?.unit || 'bytes/s'}
                      window={telemetry?.window || '15m'}
                      rangeStartAt={telemetry?.rangeStartAt}
                      rangeEndAt={telemetry?.rangeEndAt}
                      stepSeconds={telemetry?.stepSeconds}
                      points={networkSeries?.points}
                      segments={networkSeries?.segments}
                      formatValue={formatTrendValue}
                    />
                  </div>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!logsContainer} onOpenChange={open => !open && setLogsContainer(null)}>
        <DialogContent className="sm:max-w-4xl h-[70vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle>Container Logs: {logsContainer?.Names}</DialogTitle>
          </DialogHeader>
          <div className="px-5 pb-2 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => logsContainer && fetchLogs(logsContainer)}
              disabled={logsLoading || !logsContainer}
            >
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={copyLogs} disabled={logsLoading}>
              <Copy className="h-4 w-4 mr-1" /> Copy
            </Button>
            <Button variant="outline" size="sm" onClick={downloadLogs} disabled={logsLoading}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
            {logsActionTip && (
              <span className="text-xs text-muted-foreground">{logsActionTip}</span>
            )}
          </div>
          <ScrollArea className="h-[calc(70vh-8rem)] border-t px-5 py-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {logsLoading ? 'Loading logs...' : logsContent || '(no logs)'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}
