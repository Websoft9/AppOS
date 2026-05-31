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
import { getApiErrorMessage } from '@/lib/api-error'
import { DockerTextDialog } from '@/components/docker/DockerTextDialog'
import {
  DockerDependencyAlert,
  getDockerDependencyIssue,
} from '@/components/docker/DockerDependencyAlert'
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
  FileText,
  Activity,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Filter,
  Loader2,
  Settings2,
} from 'lucide-react'

const CONTAINERS_SORT_KEY = 'docker.containers.sort'
const CONTAINER_STATS_LIVE_INTERVAL_MS = 2000
const CONTAINER_SNAPSHOT_WINDOW = '5m'

const CONTAINER_TELEMETRY_WINDOWS = [
  { value: '1m', label: '1m', description: 'Last minute.' },
  { value: '5m', label: '5m', description: 'Last five minutes.' },
  { value: '15m', label: '15m', description: 'Last fifteen minutes.' },
  { value: '0.5h', label: '0.5h', description: 'Last thirty minutes.' },
  { value: '1h', label: '1h', description: 'Last hour.' },
  { value: '5h', label: '5h', description: 'Last five hours.' },
  { value: '12h', label: '12h', description: 'Last twelve hours.' },
  { value: '24h', label: '24h', description: 'Last 24 hours.' },
  { value: '7d', label: '7d', description: 'Last seven days.' },
] as const

type ContainerTelemetryWindow = (typeof CONTAINER_TELEMETRY_WINDOWS)[number]['value']

type ContainerPageSize = 25 | 50 | 100

type ContainerVisibleColumns = {
  ports: boolean
  volumes: boolean
  status: boolean
  created: boolean
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

interface ContainerMetadataItem {
  created?: string
  compose_project?: string
  volume_names?: string[]
}

interface DockerContainerStats {
  ID?: string
  Container?: string
  Name?: string
  CPUPerc?: string
  MemUsage?: string
  NetIO?: string
  BlockIO?: string
}

interface InspectPortRow {
  hostIP: string
  hostPort: string
  containerPort: string
  protocol: string
}

interface InspectMountRow {
  type: string
  source: string
  destination: string
  rw: string
  name: string
}

interface InspectNetworkRow {
  name: string
  ip: string
  gateway: string
  aliases: string[]
}

interface InspectEnvRow {
  key: string
  value: string
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

function memoryUsagePercent(usage?: number, limit?: number): number | undefined {
  if (
    usage == null ||
    limit == null ||
    !Number.isFinite(usage) ||
    !Number.isFinite(limit) ||
    limit <= 0
  ) {
    return undefined
  }
  return (usage / limit) * 100
}

function formatRuntimeMemoryUsage(value: string | undefined): string {
  const memory = parseDockerMemoryPair(value)
  if (memory.usage == null) return '-'
  return formatBytesCompact(memory.usage)
}

function parseDockerStatsStreamEvent(block: string): { event: string; data: string } | null {
  const lines = block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }

  return { event, data: dataLines.join('\n') }
}

function telemetrySeries(
  item: MonitorContainerTelemetryItem | undefined,
  name: string
): MonitorMetricSeries | undefined {
  return item?.series?.find(series => series.name === name)
}

function normalizeTelemetryContainerKey(value: string | undefined): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  return normalized.replace(/^\/+/, '')
}

function buildTelemetryItemMap(
  items: MonitorContainerTelemetryItem[] | undefined
): Record<string, MonitorContainerTelemetryItem> {
  const next: Record<string, MonitorContainerTelemetryItem> = {}
  for (const item of items || []) {
    const keys = [
      normalizeTelemetryContainerKey(item.containerId),
      normalizeTelemetryContainerKey(item.containerName),
    ]
    for (const key of keys) {
      if (!key) continue
      next[key] = item
    }
  }
  return next
}

function resolveTelemetryItem(
  itemsByKey: Record<string, MonitorContainerTelemetryItem>,
  container?: Container | null
): MonitorContainerTelemetryItem | undefined {
  if (!container) return undefined
  return (
    itemsByKey[normalizeTelemetryContainerKey(container.ID)] ||
    itemsByKey[normalizeTelemetryContainerKey(container.Names)]
  )
}

function telemetryBadge(item?: MonitorContainerTelemetryItem) {
  if (!item || item.freshness.state === 'missing') return null
  if (item.freshness.state === 'stale') {
    return (
      <Badge
        variant="outline"
        className="border-dashed border-amber-500/40 bg-amber-500/5 text-[11px] font-normal text-amber-700"
      >
        Stale telemetry
      </Badge>
    )
  }
  return null
}

function formatTrendValue(unit: string, _name: string, value: number): string {
  if (unit === 'bytes') return formatBytesCompact(Math.abs(value))
  if (unit === 'bytes/s') return `${formatBytesCompact(Math.abs(value))}/s`
  if (unit === 'percent' && value > 0 && value < 0.1) return '<0.1%'
  if (unit === 'percent') return formatPercent(value)
  return `${value}`
}

function formatMetricLine(value: number | undefined, label: string, suffix = ''): string {
  return `${value == null ? '—' : `${formatBytesCompact(value)}${suffix}`} ${label}`
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

function parseContainerMetadataItems(payload: unknown): Record<string, ContainerMetadataItem> {
  if (!payload || typeof payload !== 'object') return {}
  const items = (payload as { items?: unknown }).items
  if (!items || typeof items !== 'object') return {}

  const next: Record<string, ContainerMetadataItem> = {}
  for (const [id, raw] of Object.entries(items as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    next[id] = {
      created: typeof entry.created === 'string' ? entry.created : undefined,
      compose_project:
        typeof entry.compose_project === 'string' ? entry.compose_project : undefined,
      volume_names: Array.isArray(entry.volume_names)
        ? entry.volume_names.filter((value): value is string => typeof value === 'string')
        : undefined,
    }
  }

  return next
}

function parseDockerContainerStats(output: string): DockerContainerStats[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line) as DockerContainerStats
      } catch {
        return null
      }
    })
    .filter(Boolean) as DockerContainerStats[]
}

function parseDockerByteValue(value: string): number | undefined {
  const normalized = String(value || '').trim()
  if (!normalized) return undefined
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?i?b)$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    PB: 1000 ** 5,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    PIB: 1024 ** 5,
  }
  return amount * (multipliers[unit] ?? 1)
}

function parseDockerIoPair(value: string | undefined): { input?: number; output?: number } {
  const parts = String(value || '')
    .split('/')
    .map(part => parseDockerByteValue(part))
  return { input: parts[0], output: parts[1] }
}

function parseDockerPercent(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(
    String(value || '')
      .replace('%', '')
      .trim()
  )
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseDockerMemoryPair(value: string | undefined): { usage?: number; limit?: number } {
  const parts = String(value || '')
    .split('/')
    .map(part => parseDockerByteValue(part))
  return { usage: parts[0], limit: parts[1] }
}

function buildDockerStatsMap(items: DockerContainerStats[]): Record<string, DockerContainerStats> {
  const next: Record<string, DockerContainerStats> = {}
  for (const item of items) {
    for (const key of [item.Container, item.ID, item.Name]) {
      const normalized = String(key || '').trim()
      if (normalized) next[normalized] = item
    }
  }
  return next
}

function resolveDockerStatsItem(
  statsMap: Record<string, DockerContainerStats>,
  container?: Container | null
): DockerContainerStats | undefined {
  if (!container) return undefined
  const byId = statsMap[container.ID]
  if (byId) return byId
  const byName = statsMap[container.Names]
  if (byName) return byName
  const trimmedName = container.Names.replace(/^\//, '')
  if (trimmedName && statsMap[trimmedName]) return statsMap[trimmedName]
  return Object.values(statsMap).find(item => {
    const shortId = String(item.ID || '').trim()
    const fullId = String(item.Container || '').trim()
    return (
      (shortId && container.ID.startsWith(shortId)) ||
      (fullId && container.ID === fullId) ||
      String(item.Name || '').trim() === trimmedName
    )
  })
}

function chunkContainerIds(ids: string[], chunkSize: number): string[][] {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
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

function metadataComposeName(metadata?: ContainerMetadataItem): string {
  return metadata?.compose_project || '-'
}

function inspectPorts(inspect?: Record<string, any> | null): InspectPortRow[] {
  const ports = inspect?.NetworkSettings?.Ports as
    | Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>
    | undefined
  if (!ports) return []
  const result: InspectPortRow[] = []
  for (const [containerPort, bindings] of Object.entries(ports)) {
    const [containerPortValue, protocol = 'tcp'] = containerPort.split('/')
    if (!bindings || bindings.length === 0) {
      result.push({
        hostIP: '-',
        hostPort: '-',
        containerPort: containerPortValue || containerPort,
        protocol,
      })
      continue
    }
    for (const binding of bindings) {
      result.push({
        hostIP: binding.HostIp || '0.0.0.0',
        hostPort: binding.HostPort || '?',
        containerPort: containerPortValue || containerPort,
        protocol,
      })
    }
  }
  return result
}

function inspectVolumes(inspect?: Record<string, any> | null): InspectMountRow[] {
  const mounts = inspect?.Mounts as
    | Array<{ Source?: string; Destination?: string; Type?: string; RW?: boolean; Name?: string }>
    | undefined
  if (!Array.isArray(mounts)) return []
  return mounts.map(mount => ({
    type: mount.Type || 'bind',
    source: mount.Source || '-',
    destination: mount.Destination || '-',
    rw: mount.RW === false ? 'ro' : 'rw',
    name: mount.Name || '',
  }))
}

function inspectNetworks(inspect?: Record<string, any> | null): InspectNetworkRow[] {
  const networks = inspect?.NetworkSettings?.Networks as Record<string, any> | undefined
  if (!networks) return []
  return Object.entries(networks).map(([name, network]) => ({
    name,
    ip: network?.IPAddress || '-',
    gateway: network?.Gateway || '-',
    aliases: Array.isArray(network?.Aliases)
      ? network.Aliases.filter((value: unknown): value is string => typeof value === 'string')
      : [],
  }))
}

function inspectEnvRows(inspect?: Record<string, any> | null): InspectEnvRow[] {
  const envs = inspect?.Config?.Env
  if (!Array.isArray(envs)) return []
  return envs
    .filter((value: unknown): value is string => typeof value === 'string')
    .map(entry => {
      const separatorIndex = entry.indexOf('=')
      if (separatorIndex === -1) {
        return { key: entry, value: '' }
      }
      return {
        key: entry.slice(0, separatorIndex),
        value: entry.slice(separatorIndex + 1),
      }
    })
}

function shortImageLabel(image: string): string {
  if (!image) return '-'
  const compact = image.split('@')[0] || image
  return compact
}

function formatStateLabel(state: string): string {
  if (!state) return 'Unknown'
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function statusBadge(state: string) {
  const normalized = state.toLowerCase()
  const className =
    normalized === 'running'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
      : normalized === 'paused'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
        : 'border-border/70 bg-muted/40 text-foreground'

  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium', className)}>
      {formatStateLabel(state)}
    </Badge>
  )
}

type SortKey = 'name' | 'created' | 'cpu' | 'mem'
type OutputViewMode = 'logs' | 'inspect'

export function ContainersTab({
  serverId,
  refreshSignal = 0,
  searchQuery,
  stateFilter,
  onStateFilterChange,
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
  onOpenVolumeFilter,
  onOpenImageFilter,
  onOpenNetworkFilter,
  showPanelChrome = true,
}: {
  serverId: string
  refreshSignal?: number
  searchQuery?: string
  stateFilter: 'all' | 'running' | 'exited' | 'paused' | 'created'
  onStateFilterChange?: (value: 'all' | 'running' | 'exited' | 'paused' | 'created') => void
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
  onSummaryChange?: (summary: {
    totalItems: number
    totalPages: number
    stateCounts: Record<'all' | 'running' | 'exited' | 'paused' | 'created', number>
  }) => void
  onVisibleColumnsChange?: (columns: ContainerVisibleColumns) => void
  onRefresh?: () => void
  onOpenVolumeFilter?: (volumeNames: string[]) => void
  onOpenImageFilter?: (imageName: string) => void
  onOpenNetworkFilter?: (networkName: string) => void
  showPanelChrome?: boolean
}) {
  type PendingAction = {
    container: Container
    action: 'stop' | 'restart' | 'remove'
    force?: boolean
  }

  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [outputContainer, setOutputContainer] = useState<Container | null>(null)
  const [outputMode, setOutputMode] = useState<OutputViewMode>('logs')
  const [statsContainer, setStatsContainer] = useState<Container | null>(null)
  const [statsLive, setStatsLive] = useState(false)
  const [telemetryWindow, setTelemetryWindow] = useState<ContainerTelemetryWindow>('15m')
  const [outputContent, setOutputContent] = useState('')
  const [outputLoading, setOutputLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const raw = localStorage.getItem(CONTAINERS_SORT_KEY)
      if (!raw) return 'name'
      const parsed = JSON.parse(raw) as { key?: SortKey }
      return parsed.key && ['name', 'created', 'cpu', 'mem'].includes(parsed.key)
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
  const [metadataMap, setMetadataMap] = useState<Record<string, ContainerMetadataItem>>({})
  const [detailsLoadingMap, setDetailsLoadingMap] = useState<Record<string, boolean>>({})
  const [allDetailsLoading, setAllDetailsLoading] = useState(false)
  const [allDetailsCached, setAllDetailsCached] = useState(false)
  const [detailsErrorMessage, setDetailsErrorMessage] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [composeFilter, setComposeFilter] = useState('all')

  useEffect(() => {
    localStorage.setItem(CONTAINERS_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])
  const {
    data: containers = [],
    isLoading: loading,
    error: containersError,
  } = useQuery<Container[]>({
    queryKey: ['docker', 'containers', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/containers'), {
        method: 'GET',
      })
      return parseContainers(res.output)
    },
    placeholderData: previousData => previousData,
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
    setMetadataMap(state => {
      const next: Record<string, ContainerMetadataItem> = {}
      for (const [id, metadata] of Object.entries(state)) {
        if (idSet.has(id)) next[id] = metadata
      }
      return next
    })
    setAllDetailsCached(false)
    setDetailsErrorMessage(null)
  }, [containerIdsKey])

  const telemetryTargets = useMemo(
    () =>
      containers
        .map(container => ({ id: container.ID, name: container.Names }))
        .filter(container => Boolean(container.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
    [containers]
  )

  const telemetryIdsKey = useMemo(
    () => telemetryTargets.map(container => `${container.id}:${container.name || ''}`).join(','),
    [telemetryTargets]
  )

  const {
    data: snapshotTelemetry,
    isLoading: snapshotTelemetryLoading,
    error: snapshotTelemetryError,
  } = useQuery<MonitorContainerTelemetryResponse>({
    queryKey: [
      'monitor',
      'container-telemetry',
      'snapshot',
      serverId,
      telemetryIdsKey,
      CONTAINER_SNAPSHOT_WINDOW,
      refreshSignal,
    ],
    queryFn: () =>
      getServerContainerTelemetry(serverId, telemetryTargets, CONTAINER_SNAPSHOT_WINDOW),
    enabled: telemetryTargets.length > 0,
    placeholderData: previousData => previousData,
    staleTime: statsLive ? 0 : 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchInterval: statsLive && statsContainer ? CONTAINER_STATS_LIVE_INTERVAL_MS : false,
  })

  const {
    data: trendTelemetry,
    isLoading: trendTelemetryLoading,
    error: trendTelemetryError,
  } = useQuery<MonitorContainerTelemetryResponse>({
    queryKey: [
      'monitor',
      'container-telemetry',
      'trend',
      serverId,
      telemetryIdsKey,
      telemetryWindow,
      refreshSignal,
    ],
    queryFn: () => getServerContainerTelemetry(serverId, telemetryTargets, telemetryWindow),
    enabled: telemetryTargets.length > 0,
    placeholderData: previousData => previousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const {
    data: runtimeStatsSnapshotMap = {},
    isLoading: runtimeStatsSnapshotLoading,
    error: runtimeStatsSnapshotError,
    refetch: refetchRuntimeStats,
  } = useQuery<Record<string, DockerContainerStats>>({
    queryKey: ['docker', 'container-stats', serverId, refreshSignal],
    queryFn: async () => {
      const response = await pb.send<{ output?: string }>(
        dockerApiPath(serverId, '/containers/stats'),
        {
          method: 'GET',
        }
      )
      return buildDockerStatsMap(parseDockerContainerStats(response.output || ''))
    },
    enabled: Boolean(statsContainer),
    placeholderData: previousData => previousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchInterval: false,
  })

  const [runtimeStatsStreamMap, setRuntimeStatsStreamMap] = useState<
    Record<string, DockerContainerStats>
  >({})
  const [runtimeStatsStreamLoading, setRuntimeStatsStreamLoading] = useState(false)
  const [runtimeStatsStreamError, setRuntimeStatsStreamError] = useState<unknown>(null)
  const shouldStreamRuntimeStats =
    visibleColumns.cpu || visibleColumns.mem || (Boolean(statsContainer) && statsLive)

  useEffect(() => {
    if (!shouldStreamRuntimeStats) {
      setRuntimeStatsStreamLoading(false)
      setRuntimeStatsStreamError(null)
      setRuntimeStatsStreamMap({})
      return
    }

    const controller = new AbortController()
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    }
    const authToken = typeof pb.authStore?.token === 'string' ? pb.authStore.token : ''
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }

    setRuntimeStatsStreamLoading(true)
    setRuntimeStatsStreamError(null)

    void (async () => {
      try {
        const response = await fetch(
          dockerApiUrl(serverId, '/containers/stats', { stream: true }),
          {
            method: 'GET',
            headers,
            credentials: 'same-origin',
            signal: controller.signal,
          }
        )

        if (!response.ok || !response.body) {
          throw new Error(`Container stats stream failed (${response.status})`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        const applyEvent = (block: string) => {
          const parsed = parseDockerStatsStreamEvent(block)
          if (!parsed?.data) return
          let payload: { output?: string; message?: string }
          try {
            payload = JSON.parse(parsed.data) as { output?: string; message?: string }
          } catch {
            return
          }

          if (parsed.event === 'stats') {
            setRuntimeStatsStreamMap(
              buildDockerStatsMap(parseDockerContainerStats(payload.output || ''))
            )
            setRuntimeStatsStreamLoading(false)
            return
          }

          if (parsed.event === 'error') {
            setRuntimeStatsStreamError(
              new Error(payload.message || 'Failed to stream container stats')
            )
            setRuntimeStatsStreamLoading(false)
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() || ''
          for (const block of blocks) {
            applyEvent(block)
          }
        }

        buffer += decoder.decode()
        if (buffer.trim()) {
          applyEvent(buffer)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setRuntimeStatsStreamError(error)
      } finally {
        if (!controller.signal.aborted) {
          setRuntimeStatsStreamLoading(false)
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [
    refreshSignal,
    serverId,
    shouldStreamRuntimeStats,
    statsLive,
    visibleColumns.cpu,
    visibleColumns.mem,
  ])

  const runtimeStatsError = runtimeStatsStreamError || runtimeStatsSnapshotError
  const telemetryError = snapshotTelemetryError || trendTelemetryError || runtimeStatsError
  const currentTelemetryLoading = snapshotTelemetryLoading
  const currentRuntimeStatsLoading = runtimeStatsStreamLoading

  const telemetryWindowMeta = useMemo(
    () =>
      CONTAINER_TELEMETRY_WINDOWS.find(window => window.value === telemetryWindow) ??
      CONTAINER_TELEMETRY_WINDOWS[2],
    [telemetryWindow]
  )

  useEffect(() => {
    setAllDetailsCached(false)
    setDetailsErrorMessage(null)
  }, [refreshSignal])

  useEffect(() => {
    setComposeFilter('all')
  }, [serverId])

  const telemetryMap = useMemo(
    () => buildTelemetryItemMap(snapshotTelemetry?.items),
    [snapshotTelemetry?.items]
  )

  const trendTelemetryMap = useMemo(
    () => buildTelemetryItemMap(trendTelemetry?.items),
    [trendTelemetry?.items]
  )

  const dialogRuntimeStatsMap = useMemo(
    () =>
      Object.keys(runtimeStatsStreamMap).length > 0
        ? runtimeStatsStreamMap
        : runtimeStatsSnapshotMap,
    [runtimeStatsSnapshotMap, runtimeStatsStreamMap]
  )

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
      const ids = containers.map(container => container.ID).filter(Boolean)
      const responses = await Promise.all(
        chunkContainerIds(ids, 200).map(chunk =>
          pb.send(dockerApiPath(serverId, '/containers/metadata'), {
            method: 'POST',
            body: { ids: chunk },
          })
        )
      )

      const nextMetadata: Record<string, ContainerMetadataItem> = {}
      for (const response of responses) {
        Object.assign(nextMetadata, parseContainerMetadataItems(response))
      }

      setMetadataMap(state => ({ ...state, ...nextMetadata }))
      setAllDetailsCached(true)
    } catch (err) {
      setDetailsErrorMessage(getApiErrorMessage(err, 'Failed to load container metadata'))
    } finally {
      setAllDetailsLoading(false)
    }
  }, [allDetailsCached, allDetailsLoading, containers, serverId])

  useEffect(() => {
    if (
      !visibleColumns.created &&
      !visibleColumns.cpu &&
      !visibleColumns.mem &&
      !visibleColumns.compose &&
      composeFilter === 'all' &&
      !visibleColumns.volumes
    ) {
      return
    }
    void loadAllDetails()
  }, [
    loadAllDetails,
    visibleColumns.compose,
    visibleColumns.cpu,
    visibleColumns.created,
    visibleColumns.mem,
    visibleColumns.volumes,
    composeFilter,
  ])

  useEffect(() => {
    if (visibleColumns.created || visibleColumns.cpu || visibleColumns.mem) return
    if (sortKey === 'created' || sortKey === 'cpu' || sortKey === 'mem') {
      setSortKey('name')
      setSortDir('asc')
    }
  }, [sortKey, visibleColumns.cpu, visibleColumns.created, visibleColumns.mem])

  const action = async (id: string, act: string, options?: { force?: boolean }) => {
    try {
      setActionError(null)
      if (act === 'remove') {
        await pb.send(
          dockerApiUrl(serverId, `/containers/${id}`, { force: options?.force ? 1 : undefined }),
          {
            method: 'DELETE',
          }
        )
      } else {
        await pb.send(dockerApiPath(serverId, `/containers/${id}/${act}`), {
          method: 'POST',
        })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'containers', serverId] }),
      ])
      setMetadataMap({})
      setAllDetailsCached(false)
      setDetailsErrorMessage(null)
    } catch (err) {
      setActionError(getApiErrorMessage(err, `Failed to ${act} container`))
    }
  }

  const fetchOutput = useCallback(
    async (container: Container, mode: OutputViewMode) => {
      try {
        setOutputLoading(true)
        setOutputContainer(container)
        setOutputMode(mode)
        if (mode === 'logs') {
          const res = await pb.send(
            dockerApiUrl(serverId, `/containers/${container.ID}/logs`, { tail: 300 }),
            {
              method: 'GET',
            }
          )
          setOutputContent(typeof res.output === 'string' ? res.output : '')
        } else {
          const res = await pb.send(dockerApiPath(serverId, `/containers/${container.ID}`), {
            method: 'GET',
          })
          const inspect = parseInspect(typeof res.output === 'string' ? res.output : '')
          setOutputContent(
            inspect
              ? JSON.stringify(inspect, null, 2)
              : typeof res.output === 'string'
                ? res.output
                : JSON.stringify(res.output, null, 2)
          )
        }
      } catch (err) {
        setOutputContent(String(err))
      } finally {
        setOutputLoading(false)
      }
    },
    [serverId]
  )

  const activeSearchQuery = String(searchQuery ?? filterPreset ?? '')
    .trim()
    .toLowerCase()

  const filtered = useMemo(
    () =>
      containers.filter(
        c =>
          c.Names?.toLowerCase().includes(activeSearchQuery) ||
          c.Image?.toLowerCase().includes(activeSearchQuery)
      ),
    [containers, activeSearchQuery]
  )

  const stateFiltered = useMemo(
    () =>
      filtered.filter(container => {
        if (stateFilter === 'all') return true
        return (container.State || '').toLowerCase() === stateFilter
      }),
    [filtered, stateFilter]
  )

  const stateOptionCounts = useMemo(() => {
    let running = 0
    let exited = 0
    let paused = 0
    let created = 0

    for (const container of filtered) {
      const state = (container.State || '').toLowerCase()
      if (state === 'running') running += 1
      else if (state === 'exited') exited += 1
      else if (state === 'paused') paused += 1
      else if (state === 'created') created += 1
    }

    return {
      all: filtered.length,
      running,
      exited,
      paused,
      created,
    }
  }, [filtered])

  const nameFiltered = useMemo(
    () =>
      stateFiltered.filter(container => {
        if (!includeNames || includeNames.length === 0) return true
        return includeNames.includes(container.Names)
      }),
    [stateFiltered, includeNames]
  )

  const composeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const container of nameFiltered) {
      const composeName = metadataComposeName(metadataMap[container.ID])
      if (!composeName || composeName === '-') continue
      counts.set(composeName, (counts.get(composeName) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([name, count]) => ({ name, count }))
  }, [metadataMap, nameFiltered])

  const composeFiltered = useMemo(() => {
    if (composeFilter === 'all') return nameFiltered
    if (!allDetailsCached && allDetailsLoading) return nameFiltered
    return nameFiltered.filter(
      container => metadataComposeName(metadataMap[container.ID]) === composeFilter
    )
  }, [allDetailsCached, allDetailsLoading, composeFilter, metadataMap, nameFiltered])

  const sorted = useMemo(() => {
    const items = [...composeFiltered]
    items.sort((left, right) => {
      const leftMetadata = metadataMap[left.ID]
      const rightMetadata = metadataMap[right.ID]
      const leftRuntimeStats = resolveDockerStatsItem(runtimeStatsStreamMap, left)
      const rightRuntimeStats = resolveDockerStatsItem(runtimeStatsStreamMap, right)

      if (sortKey === 'mem') {
        const leftMem = parseDockerMemoryPair(leftRuntimeStats?.MemUsage).usage || 0
        const rightMem = parseDockerMemoryPair(rightRuntimeStats?.MemUsage).usage || 0
        if (leftMem < rightMem) return sortDir === 'asc' ? -1 : 1
        if (leftMem > rightMem) return sortDir === 'asc' ? 1 : -1
        return 0
      }

      if (sortKey === 'cpu') {
        const leftCpu = parseDockerPercent(leftRuntimeStats?.CPUPerc) || 0
        const rightCpu = parseDockerPercent(rightRuntimeStats?.CPUPerc) || 0
        if (leftCpu < rightCpu) return sortDir === 'asc' ? -1 : 1
        if (leftCpu > rightCpu) return sortDir === 'asc' ? 1 : -1
        return 0
      }

      const leftValue = (() => {
        switch (sortKey) {
          case 'created':
            return String(leftMetadata?.created || '')
          default:
            return left.Names
        }
      })().toLowerCase()

      const rightValue = (() => {
        switch (sortKey) {
          case 'created':
            return String(rightMetadata?.created || '')
          default:
            return right.Names
        }
      })().toLowerCase()

      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [composeFiltered, metadataMap, runtimeStatsStreamMap, sortDir, sortKey])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [page, pageSize, sorted])

  useEffect(() => {
    if (!visibleColumns.network) return
    for (const container of paged) {
      if (!inspectMap[container.ID]) {
        void loadInspectForContainer(container.ID)
      }
    }
  }, [inspectMap, loadInspectForContainer, paged, visibleColumns.network])

  useEffect(() => {
    if (page !== 1) onPageChange?.(1)
  }, [
    activeSearchQuery,
    includeNames,
    onPageChange,
    page,
    pageSize,
    serverId,
    composeFilter,
    sortDir,
    sortKey,
    stateFilter,
  ])

  useEffect(() => {
    if (page > totalPages) onPageChange?.(totalPages)
  }, [onPageChange, page, totalPages])

  useEffect(() => {
    onSummaryChange?.({ totalItems: sorted.length, totalPages, stateCounts: stateOptionCounts })
  }, [onSummaryChange, sorted.length, totalPages, stateOptionCounts])

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
    <button
      type="button"
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1 rounded text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground',
        className
      )}
      onClick={() => toggleSort(keyName)}
    >
      {label}
      {sortKey !== keyName ? (
        <ArrowUpDown className="h-3 w-3" />
      ) : sortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )}
    </button>
  )

  const loadError = containersError
    ? getApiErrorMessage(containersError, 'Failed to load containers')
    : telemetryError
      ? getApiErrorMessage(telemetryError, 'Failed to load container telemetry')
      : detailsErrorMessage
  const visibleError = loadError || actionError
  const dependencyIssue = getDockerDependencyIssue(
    containersError ?? telemetryError ?? visibleError
  )

  const tableColSpan =
    4 +
    (visibleColumns.ports ? 1 : 0) +
    (visibleColumns.volumes ? 1 : 0) +
    (visibleColumns.created ? 1 : 0) +
    (visibleColumns.compose ? 1 : 0) +
    (visibleColumns.cpu ? 1 : 0) +
    (visibleColumns.mem ? 1 : 0) +
    (visibleColumns.network ? 1 : 0) +
    (visibleColumns.status ? 1 : 0)
  const totalItems = sorted.length
  const hasComposeFilter = composeFilter !== 'all'
  const hasSearchFilter = activeSearchQuery.length > 0
  const hasStateFilter = stateFilter !== 'all'
  const hasAnyFilter =
    hasSearchFilter ||
    hasStateFilter ||
    hasComposeFilter ||
    !!(includeNames && includeNames.length > 0)
  const hasStatusBadges =
    (includeNames && includeNames.length > 0) ||
    currentTelemetryLoading ||
    currentRuntimeStatsLoading ||
    copiedTip

  return (
    <div className="min-h-0 flex flex-col gap-3">
      {dependencyIssue && visibleError ? (
        <DockerDependencyAlert
          serverId={serverId}
          message={visibleError}
          focusSource="containers"
        />
      ) : visibleError ? (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{visibleError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-hidden rounded-lg bg-background">
        <div className={cn('flex flex-col', showPanelChrome ? 'gap-3 px-3 py-3' : 'gap-2')}>
          {showPanelChrome ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ContainerIcon className="h-4 w-4 text-muted-foreground" />
                <span>Containers</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <input
                  value={searchQuery ?? ''}
                  onChange={event => onSearchQueryChange?.(event.target.value)}
                  placeholder="Search containers"
                  className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
                />
                <span className="text-xs text-muted-foreground">{totalItems} total</span>
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
                  <span className="text-center font-medium tabular-nums">
                    {page}/{totalPages}
                  </span>
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
                      onValueChange={value =>
                        onPageSizeChange?.(Number(value) as ContainerPageSize)
                      }
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
                      checked={visibleColumns.volumes}
                      onCheckedChange={checked =>
                        onVisibleColumnsChange?.({ ...visibleColumns, volumes: checked === true })
                      }
                    >
                      Volumes
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={visibleColumns.status}
                      onCheckedChange={checked =>
                        onVisibleColumnsChange?.({ ...visibleColumns, status: checked === true })
                      }
                    >
                      Lifecycle
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={visibleColumns.created}
                      onCheckedChange={checked =>
                        onVisibleColumnsChange?.({ ...visibleColumns, created: checked === true })
                      }
                    >
                      Created
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={visibleColumns.cpu}
                      onCheckedChange={checked =>
                        onVisibleColumnsChange?.({ ...visibleColumns, cpu: checked === true })
                      }
                    >
                      CPU
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={visibleColumns.mem}
                      onCheckedChange={checked =>
                        onVisibleColumnsChange?.({ ...visibleColumns, mem: checked === true })
                      }
                    >
                      Memory
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
          ) : null}
          {hasAnyFilter && (
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              {hasSearchFilter && <Badge variant="outline">Search: {activeSearchQuery}</Badge>}
              {hasStateFilter && <Badge variant="outline">Runtime: {stateFilter}</Badge>}
              {includeNames && includeNames.length > 0 && (
                <Badge variant="outline">Linked containers: {includeNames.length}</Badge>
              )}
              {hasComposeFilter && <Badge variant="outline">Compose: {composeFilter}</Badge>}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClearFilterPreset?.()
                  onClearIncludeNames?.()
                  onStateFilterChange?.('all')
                  setComposeFilter('all')
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
          {hasStatusBadges && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {currentTelemetryLoading && <Badge variant="outline">Loading telemetry...</Badge>}
              {currentRuntimeStatsLoading && <Badge variant="outline">Loading stats...</Badge>}
              {copiedTip && (
                <div className="text-xs text-muted-foreground shrink-0">{copiedTip}</div>
              )}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-lg bg-background">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
                <TableRow>
                  <TableHead className="w-[32%] min-w-[260px] pl-4 pr-2">
                    <div className="flex items-center">
                      <SortHead label="Name" keyName="name" />
                    </div>
                  </TableHead>
                  <TableHead className="w-[16%] min-w-[160px]">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium text-foreground">Runtime</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              'h-7 w-7',
                              stateFilter !== 'all' &&
                                'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                            )}
                            aria-label="Filter container state"
                            title={
                              stateFilter === 'all'
                                ? 'Filter container state'
                                : `Container state: ${stateFilter}`
                            }
                          >
                            <Filter className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuRadioGroup
                            value={stateFilter}
                            onValueChange={value =>
                              onStateFilterChange?.(
                                value as 'all' | 'running' | 'exited' | 'paused' | 'created'
                              )
                            }
                          >
                            <DropdownMenuRadioItem value="all">
                              All states ({stateOptionCounts.all})
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="running">
                              Running ({stateOptionCounts.running})
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="exited">
                              Exited ({stateOptionCounts.exited})
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="paused">
                              Paused ({stateOptionCounts.paused})
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="created">
                              Created ({stateOptionCounts.created})
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead className="w-[150px] min-w-[150px] text-xs font-medium text-foreground">
                    Quick
                  </TableHead>
                  {visibleColumns.ports && (
                    <TableHead className="min-w-[140px] text-xs font-medium text-foreground">
                      Ports
                    </TableHead>
                  )}
                  {visibleColumns.volumes && (
                    <TableHead className="w-[160px] min-w-[160px] text-left text-xs font-medium text-foreground">
                      Volumes
                    </TableHead>
                  )}
                  {visibleColumns.created && (
                    <TableHead className="min-w-[160px]">
                      <SortHead label="Created" keyName="created" />
                    </TableHead>
                  )}
                  {visibleColumns.compose && (
                    <TableHead className="min-w-[140px]">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium text-foreground">Compose</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                'h-7 w-7',
                                composeFilter !== 'all' &&
                                  'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                              )}
                              aria-label="Filter compose project"
                              title={
                                composeFilter === 'all'
                                  ? 'Filter compose project'
                                  : `Compose: ${composeFilter}`
                              }
                            >
                              <Filter className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuRadioGroup
                              value={composeFilter}
                              onValueChange={value => setComposeFilter(value)}
                            >
                              <DropdownMenuRadioItem value="all">All compose</DropdownMenuRadioItem>
                              {composeOptions.map(option => (
                                <DropdownMenuRadioItem key={option.name} value={option.name}>
                                  {option.name} ({option.count})
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableHead>
                  )}
                  {visibleColumns.cpu && (
                    <TableHead className="w-[88px] min-w-[88px]">
                      <SortHead label="CPU" keyName="cpu" />
                    </TableHead>
                  )}
                  {visibleColumns.mem && (
                    <TableHead className="w-[110px] min-w-[110px]">
                      <SortHead label="Memory" keyName="mem" />
                    </TableHead>
                  )}
                  {visibleColumns.network && (
                    <TableHead className="min-w-[170px] text-xs font-medium text-foreground">
                      Network
                    </TableHead>
                  )}
                  {visibleColumns.status && (
                    <TableHead className="min-w-[150px] text-xs font-medium text-foreground">
                      Lifecycle
                    </TableHead>
                  )}
                  <TableHead className="w-[52px] text-xs font-medium text-foreground">
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
                  const metadata = metadataMap[c.ID]
                  const linkedVolumes = metadata?.volume_names || []
                  const linkedNetworks = inspectNetworks(inspect)
                    .map(network => network.name)
                    .filter(Boolean)
                  const uniqueLinkedNetworks = Array.from(new Set(linkedNetworks))
                  const telemetryItem = resolveTelemetryItem(telemetryMap, c)
                  const runtimeStatsItem = resolveDockerStatsItem(runtimeStatsStreamMap, c)
                  return (
                    <Fragment key={c.ID}>
                      <TableRow
                        className={cn(
                          'border-b border-border/60 align-top transition-colors hover:bg-muted/30',
                          c.State.toLowerCase() === 'running' && 'bg-emerald-500/[0.015]',
                          expandedId === c.ID && 'bg-muted/35'
                        )}
                      >
                        <TableCell className="pl-4 pr-3 py-3 text-xs">
                          <Button
                            variant="link"
                            className="group min-h-8 w-full justify-start p-0 text-left no-underline hover:no-underline"
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
                            <div className="min-w-0 space-y-1 text-left">
                              <div
                                className="truncate text-xs font-semibold leading-tight text-foreground group-hover:underline"
                                title={c.Names}
                              >
                                {shortName(c.Names)}
                              </div>
                              <div
                                className="truncate font-mono text-[11px] font-semibold leading-tight text-muted-foreground"
                                title={c.Image}
                              >
                                {shortImageLabel(c.Image)}
                              </div>
                            </div>
                          </Button>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {statusBadge(c.State)}
                            {telemetryBadge(telemetryItem)}
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground"
                              onClick={event => {
                                event.preventDefault()
                                event.stopPropagation()
                                void fetchOutput(c, 'logs')
                              }}
                              aria-label={`Open logs for ${c.Names}`}
                              title="Logs"
                            >
                              <FileText className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground"
                              onClick={event => {
                                event.preventDefault()
                                event.stopPropagation()
                                setStatsContainer(c)
                              }}
                              aria-label={`Open monitor for ${c.Names}`}
                              title="Monitor"
                            >
                              <Activity className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground"
                              onClick={event => {
                                event.preventDefault()
                                event.stopPropagation()
                                onOpenTerminal?.(c.ID)
                              }}
                              disabled={c.State !== 'running' || !onOpenTerminal}
                              aria-label={`Open exec for ${c.Names}`}
                              title={c.State === 'running' ? 'Exec' : 'Exec unavailable'}
                            >
                              <TerminalSquare className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        {visibleColumns.ports && (
                          <TableCell className="py-3 text-xs text-foreground/90">
                            {hostPublishedPorts(c.Ports)}
                          </TableCell>
                        )}
                        {visibleColumns.volumes && (
                          <TableCell className="w-[160px] min-w-[160px] py-3 text-left text-xs align-middle">
                            <div className="flex h-8 items-center">
                              {linkedVolumes.length > 0 ? (
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-full items-center justify-start gap-1 text-left text-xs text-primary hover:underline"
                                  title={linkedVolumes.join(', ')}
                                  onClick={() => onOpenVolumeFilter?.(linkedVolumes)}
                                >
                                  <span className="truncate">
                                    {linkedVolumes.length} volume
                                    {linkedVolumes.length > 1 ? 's' : ''}
                                  </span>
                                  <ExternalLink className="ml-1 h-3 w-3" />
                                </button>
                              ) : (
                                <span className="inline-flex h-8 items-center text-muted-foreground">
                                  -
                                </span>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {visibleColumns.created && (
                          <TableCell className="py-3 text-xs text-muted-foreground">
                            {allDetailsLoading
                              ? '...'
                              : metadata?.created
                                ? new Date(metadata.created).toLocaleString()
                                : '-'}
                          </TableCell>
                        )}
                        {visibleColumns.compose && (
                          <TableCell className="py-3 text-xs">
                            {metadataComposeName(metadata) !== '-' ? (
                              <Button
                                variant="link"
                                className="h-auto w-full justify-start p-0 text-left text-xs"
                                onClick={() => setComposeFilter(metadataComposeName(metadata))}
                              >
                                {metadataComposeName(metadata)}
                              </Button>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.cpu && (
                          <TableCell className="py-3 text-xs tabular-nums text-foreground/90">
                            {currentRuntimeStatsLoading ? (
                              '...'
                            ) : !runtimeStatsItem ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              <span className="font-medium text-foreground">
                                {formatPercent(parseDockerPercent(runtimeStatsItem.CPUPerc))}
                              </span>
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.mem && (
                          <TableCell className="py-3 text-xs tabular-nums text-foreground/90">
                            {currentRuntimeStatsLoading ? (
                              '...'
                            ) : !runtimeStatsItem ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              <span className="font-medium text-foreground">
                                {formatRuntimeMemoryUsage(runtimeStatsItem.MemUsage)}
                              </span>
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.network && (
                          <TableCell className="min-w-[170px] py-3 text-left text-xs align-middle">
                            <div className="flex h-8 items-center">
                              {!inspect && detailsLoadingMap[c.ID] ? (
                                <span className="inline-flex h-8 items-center text-muted-foreground">
                                  Loading...
                                </span>
                              ) : uniqueLinkedNetworks.length > 0 ? (
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-full items-center justify-start gap-1 text-left text-xs text-primary hover:underline"
                                  title={uniqueLinkedNetworks.join(', ')}
                                  onClick={() => onOpenNetworkFilter?.(uniqueLinkedNetworks[0])}
                                >
                                  <span className="truncate">
                                    {uniqueLinkedNetworks.join(', ')}
                                  </span>
                                  <ExternalLink className="ml-1 h-3 w-3" />
                                </button>
                              ) : (
                                <span className="inline-flex h-8 items-center text-muted-foreground">
                                  -
                                </span>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {visibleColumns.status && (
                          <TableCell className="py-3 text-xs text-muted-foreground">
                            {c.Status || '-'}
                          </TableCell>
                        )}
                        <TableCell className="py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`More actions for ${c.Names}`}
                                title={`More actions for ${c.Names}`}
                                onClick={event => event.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {c.State === 'running' && onOpenTerminal && (
                                <DropdownMenuItem
                                  onSelect={event => {
                                    event.stopPropagation()
                                    window.setTimeout(() => onOpenTerminal(c.ID), 0)
                                  }}
                                >
                                  <TerminalSquare className="h-4 w-4 mr-2" /> Exec
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onSelect={event => {
                                  event.stopPropagation()
                                  window.setTimeout(() => setStatsContainer(c), 0)
                                }}
                              >
                                <Activity className="h-4 w-4 mr-2" /> Stats
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={event => {
                                  event.stopPropagation()
                                  window.setTimeout(() => void fetchOutput(c, 'logs'), 0)
                                }}
                              >
                                <FileText className="h-4 w-4 mr-2" /> Logs
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={event => {
                                  event.stopPropagation()
                                  window.setTimeout(() => void fetchOutput(c, 'inspect'), 0)
                                }}
                              >
                                <FileText className="h-4 w-4 mr-2" /> Inspect
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={event => {
                                  event.stopPropagation()
                                  window.setTimeout(() => void action(c.ID, 'start'), 0)
                                }}
                                disabled={(c.State || '').toLowerCase() === 'running'}
                              >
                                <Play className="h-4 w-4 mr-2" /> Start
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={event => {
                                  event.stopPropagation()
                                  window.setTimeout(
                                    () => setPendingAction({ container: c, action: 'stop' }),
                                    0
                                  )
                                }}
                              >
                                <Square className="h-4 w-4 mr-2" /> Stop
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={event => {
                                  event.stopPropagation()
                                  window.setTimeout(
                                    () => setPendingAction({ container: c, action: 'restart' }),
                                    0
                                  )
                                }}
                              >
                                <RotateCw className="h-4 w-4 mr-2" /> Restart
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={event => {
                                  event.stopPropagation()
                                  window.setTimeout(
                                    () =>
                                      setPendingAction({
                                        container: c,
                                        action: 'remove',
                                        force: false,
                                      }),
                                    0
                                  )
                                }}
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
                              {detailsLoadingMap[c.ID] ? (
                                <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" /> Loading inspect
                                  details...
                                </div>
                              ) : (
                                <div className="space-y-4 text-xs">
                                  <div className="overflow-hidden rounded-md border">
                                    <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">
                                      Metadata
                                    </div>
                                    <div className="grid gap-x-6 gap-y-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          Name
                                        </div>
                                        <div className="font-mono text-foreground">
                                          {c.Names || '-'}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          ID
                                        </div>
                                        <button
                                          type="button"
                                          className="font-mono text-left text-foreground hover:underline"
                                          onClick={() => void copyText(c.ID || '-', 'ID')}
                                          title="Click to copy ID"
                                        >
                                          {c.ID || '-'}
                                        </button>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          Image
                                        </div>
                                        {onOpenImageFilter ? (
                                          <Button
                                            variant="link"
                                            className="h-auto p-0 font-mono text-xs"
                                            onClick={() => onOpenImageFilter(c.Image)}
                                          >
                                            {c.Image || '-'}
                                          </Button>
                                        ) : (
                                          <div className="font-mono text-foreground">
                                            {c.Image || '-'}
                                          </div>
                                        )}
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          Compose
                                        </div>
                                        {metadataComposeName(metadata) !== '-' ? (
                                          <Button
                                            variant="link"
                                            className="h-auto p-0 text-xs"
                                            onClick={() =>
                                              setComposeFilter(metadataComposeName(metadata))
                                            }
                                          >
                                            {metadataComposeName(metadata)}
                                          </Button>
                                        ) : (
                                          <div className="text-muted-foreground">-</div>
                                        )}
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          Runtime
                                        </div>
                                        <div className="text-foreground">{c.Status || '-'}</div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          Lifecycle
                                        </div>
                                        <div>{statusBadge(c.State)}</div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          Created
                                        </div>
                                        <div className="text-foreground">
                                          {metadata?.created
                                            ? new Date(metadata.created).toLocaleString()
                                            : '-'}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          Running For
                                        </div>
                                        <div className="text-foreground">{c.RunningFor || '-'}</div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                          IP
                                        </div>
                                        <button
                                          type="button"
                                          className="font-mono text-left text-foreground hover:underline"
                                          onClick={() => void copyText(containerIP(inspect), 'IP')}
                                          title="Click to copy IP"
                                        >
                                          {containerIP(inspect)}
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="overflow-hidden rounded-md border">
                                    <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">
                                      Ports
                                    </div>
                                    {inspectPorts(inspect).length > 0 ? (
                                      <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                          <thead className="bg-muted/10 text-muted-foreground">
                                            <tr>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Host IP
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Host Port
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Container Port
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Protocol
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {inspectPorts(inspect).map(port => (
                                              <tr
                                                key={`${port.hostIP}-${port.hostPort}-${port.containerPort}-${port.protocol}`}
                                                className="border-t"
                                              >
                                                <td className="px-3 py-2 font-mono">
                                                  {port.hostIP}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                  {port.hostPort}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                  {port.containerPort}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                  {port.protocol}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="px-3 py-3 text-muted-foreground">
                                        No exposed ports
                                      </div>
                                    )}
                                  </div>

                                  <div className="overflow-hidden rounded-md border">
                                    <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">
                                      Networks
                                    </div>
                                    {inspectNetworks(inspect).length > 0 ? (
                                      <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                          <thead className="bg-muted/10 text-muted-foreground">
                                            <tr>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Network
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                IP
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Gateway
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Aliases
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {inspectNetworks(inspect).map(network => (
                                              <tr key={network.name} className="border-t">
                                                <td className="px-3 py-2">
                                                  {onOpenNetworkFilter ? (
                                                    <Button
                                                      variant="link"
                                                      className="h-auto p-0 text-xs"
                                                      onClick={() =>
                                                        onOpenNetworkFilter(network.name)
                                                      }
                                                    >
                                                      {network.name}
                                                    </Button>
                                                  ) : (
                                                    <span className="font-mono">
                                                      {network.name}
                                                    </span>
                                                  )}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                  {network.ip}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                  {network.gateway}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                  {network.aliases.join(', ') || '-'}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="px-3 py-3 text-muted-foreground">
                                        No attached networks
                                      </div>
                                    )}
                                  </div>

                                  <div className="overflow-hidden rounded-md border">
                                    <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">
                                      Volumes
                                    </div>
                                    {inspectVolumes(inspect).length > 0 ? (
                                      <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                          <thead className="bg-muted/10 text-muted-foreground">
                                            <tr>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Type
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Source / Name
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Destination
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Mode
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {inspectVolumes(inspect).map(volume => (
                                              <tr
                                                key={`${volume.source}-${volume.destination}`}
                                                className="border-t"
                                              >
                                                <td className="px-3 py-2 font-mono">
                                                  {volume.type}
                                                </td>
                                                <td className="px-3 py-2">
                                                  {volume.name && onOpenVolumeFilter ? (
                                                    <Button
                                                      variant="link"
                                                      className="h-auto p-0 text-xs"
                                                      onClick={() =>
                                                        onOpenVolumeFilter([volume.name])
                                                      }
                                                    >
                                                      {volume.name}
                                                    </Button>
                                                  ) : (
                                                    <span className="font-mono">
                                                      {volume.name || volume.source}
                                                    </span>
                                                  )}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                  {volume.destination}
                                                </td>
                                                <td className="px-3 py-2 font-mono">{volume.rw}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="px-3 py-3 text-muted-foreground">
                                        No mounted volumes
                                      </div>
                                    )}
                                  </div>

                                  <div className="overflow-hidden rounded-md border">
                                    <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">
                                      Environment
                                    </div>
                                    {inspectEnvRows(inspect).length > 0 ? (
                                      <div className="max-h-72 overflow-auto">
                                        <table className="min-w-full">
                                          <thead className="bg-muted/10 text-muted-foreground">
                                            <tr>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Key
                                              </th>
                                              <th className="px-3 py-2 text-left font-medium">
                                                Value
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {inspectEnvRows(inspect).map(env => (
                                              <tr
                                                key={`${env.key}-${env.value}`}
                                                className="border-t align-top"
                                              >
                                                <td className="px-3 py-2 font-mono">{env.key}</td>
                                                <td className="px-3 py-2 font-mono break-all">
                                                  {env.value || '-'}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="px-3 py-3 text-muted-foreground">
                                        No environment variables
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
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
        </div>
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
              Direct Docker snapshot with canonical monitor trends for{' '}
              {telemetryWindowMeta.description.toLowerCase()}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const snapshotItem = resolveTelemetryItem(telemetryMap, statsContainer)
            const trendItem = resolveTelemetryItem(trendTelemetryMap, statsContainer)
            const runtimeStats = resolveDockerStatsItem(dialogRuntimeStatsMap, statsContainer)
            const runtimeNetwork = parseDockerIoPair(runtimeStats?.NetIO)
            const runtimeBlock = parseDockerIoPair(runtimeStats?.BlockIO)
            const runtimeMemory = parseDockerMemoryPair(runtimeStats?.MemUsage)
            const runtimeMemoryPercent = memoryUsagePercent(
              runtimeMemory.usage,
              runtimeMemory.limit
            )
            const runtimeCPU = parseDockerPercent(runtimeStats?.CPUPerc)
            const cpuSeries = telemetrySeries(trendItem, 'cpu')
            const memorySeries = telemetrySeries(trendItem, 'memory')
            const networkSeries = telemetrySeries(trendItem, 'network')
            const blockSeries = telemetrySeries(trendItem, 'block')
            if (!runtimeStats && (!snapshotItem || snapshotItem.freshness.state === 'missing')) {
              return (
                <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                  No telemetry for this container yet. Inventory, inspect, logs, and actions remain
                  available.
                </div>
              )
            }
            return (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">Realtime Snapshot</div>
                      <div className="text-xs text-muted-foreground">
                        Current runtime values from docker stats.
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={statsLive ? 'secondary' : 'outline'}
                      aria-pressed={statsLive}
                      className="h-8 gap-2 self-start"
                      onClick={() => {
                        setStatsLive(enabled => {
                          const next = !enabled
                          if (next) {
                            void refetchRuntimeStats()
                          }
                          return next
                        })
                      }}
                      disabled={runtimeStatsSnapshotLoading || runtimeStatsStreamLoading}
                    >
                      <Activity className={cn('h-4 w-4', statsLive && 'text-emerald-600')} />
                      Live
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-md border bg-background p-3 text-sm">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        CPU
                      </div>
                      <div className="mt-2 font-medium">{formatPercent(runtimeCPU)}</div>
                    </div>
                    <div className="rounded-md border bg-background p-3 text-sm">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Memory
                      </div>
                      <div className="mt-2 font-medium">{formatPercent(runtimeMemoryPercent)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {runtimeMemory.limit == null
                          ? formatBytesCompact(runtimeMemory.usage)
                          : `${formatBytesCompact(runtimeMemory.usage)} / ${formatBytesCompact(runtimeMemory.limit)}`}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background p-3 text-sm">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Network
                      </div>
                      <div className="mt-2 space-y-1 font-medium leading-tight">
                        <div>{formatMetricLine(runtimeNetwork.input, 'in total')}</div>
                        <div>{formatMetricLine(runtimeNetwork.output, 'out total')}</div>
                      </div>
                    </div>
                    <div className="rounded-md border bg-background p-3 text-sm">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Block I/O
                      </div>
                      <div className="mt-2 space-y-1 font-medium leading-tight">
                        <div>{formatMetricLine(runtimeBlock.input, 'read total')}</div>
                        <div>{formatMetricLine(runtimeBlock.output, 'write total')}</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">Docker stats snapshot</Badge>
                    <span>Observed now</span>
                    {statsLive ? <span>Refreshing every 2s</span> : null}
                  </div>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">Trend History</div>
                      <div className="text-xs text-muted-foreground">
                        {telemetryWindowMeta.description} Select a range to redraw all trend charts.
                      </div>
                    </div>
                    <div
                      className="inline-flex flex-wrap items-center rounded-lg border bg-muted/20 p-1"
                      role="tablist"
                      aria-label="container trend window selector"
                    >
                      {CONTAINER_TELEMETRY_WINDOWS.map(window => {
                        const active = window.value === telemetryWindow
                        return (
                          <Button
                            key={window.value}
                            type="button"
                            size="xs"
                            variant={active ? 'secondary' : 'ghost'}
                            aria-pressed={active}
                            onClick={() => setTelemetryWindow(window.value)}
                            disabled={trendTelemetryLoading}
                          >
                            {window.label}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                      <div className="text-sm font-medium">CPU Trend</div>
                      <TimeSeriesChart
                        name="cpu"
                        unit={cpuSeries?.unit || 'percent'}
                        window={trendTelemetry?.window || telemetryWindow}
                        rangeStartAt={trendTelemetry?.rangeStartAt}
                        rangeEndAt={trendTelemetry?.rangeEndAt}
                        stepSeconds={trendTelemetry?.stepSeconds}
                        points={cpuSeries?.points}
                        formatValue={formatTrendValue}
                      />
                    </div>
                    <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                      <div className="text-sm font-medium">Memory Trend</div>
                      <TimeSeriesChart
                        name="memory"
                        unit={memorySeries?.unit || 'bytes'}
                        window={trendTelemetry?.window || telemetryWindow}
                        rangeStartAt={trendTelemetry?.rangeStartAt}
                        rangeEndAt={trendTelemetry?.rangeEndAt}
                        stepSeconds={trendTelemetry?.stepSeconds}
                        points={memorySeries?.points}
                        segments={memorySeries?.segments}
                        formatValue={formatTrendValue}
                      />
                    </div>
                    <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                      <div className="text-sm font-medium">Network Trend</div>
                      <TimeSeriesChart
                        name="network"
                        unit={networkSeries?.unit || 'bytes/s'}
                        window={trendTelemetry?.window || telemetryWindow}
                        rangeStartAt={trendTelemetry?.rangeStartAt}
                        rangeEndAt={trendTelemetry?.rangeEndAt}
                        stepSeconds={trendTelemetry?.stepSeconds}
                        points={networkSeries?.points}
                        segments={networkSeries?.segments}
                        formatValue={formatTrendValue}
                      />
                    </div>
                    <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                      <div className="text-sm font-medium">Block I/O Trend</div>
                      <TimeSeriesChart
                        name="block"
                        unit={blockSeries?.unit || 'bytes/s'}
                        window={trendTelemetry?.window || telemetryWindow}
                        rangeStartAt={trendTelemetry?.rangeStartAt}
                        rangeEndAt={trendTelemetry?.rangeEndAt}
                        stepSeconds={trendTelemetry?.stepSeconds}
                        points={blockSeries?.points}
                        segments={blockSeries?.segments}
                        formatValue={formatTrendValue}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      <DockerTextDialog
        open={!!outputContainer}
        onOpenChange={open => !open && setOutputContainer(null)}
        title={`${outputMode === 'inspect' ? 'Container Inspect' : 'Container Logs'}: ${outputContainer?.Names || ''}`}
        description={
          outputMode === 'inspect'
            ? 'Structured docker inspect output for this container.'
            : 'Recent docker logs for this container.'
        }
        content={outputContent}
        loading={outputLoading}
        loadingText={outputMode === 'inspect' ? 'Loading inspect...' : 'Loading logs...'}
        emptyText="(no output)"
        onRefresh={
          outputContainer ? () => void fetchOutput(outputContainer, outputMode) : undefined
        }
        refreshDisabled={!outputContainer}
        downloadBaseName={`${outputContainer?.Names || 'container'}-${outputMode}`}
        downloadExtension={outputMode === 'inspect' ? 'json' : 'log'}
        copySuccessText={outputMode === 'inspect' ? 'Inspect copied' : 'Logs copied'}
        copyFailureText={
          outputMode === 'inspect' ? 'Failed to copy inspect' : 'Failed to copy logs'
        }
        downloadFailureText={
          outputMode === 'inspect' ? 'Failed to download inspect' : 'Failed to download logs'
        }
      />
    </div>
  )
}
