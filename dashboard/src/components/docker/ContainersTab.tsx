import { Fragment, useState, useEffect, useCallback, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { pb } from "@/lib/pb"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getApiErrorMessage } from "@/lib/api-error"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Play, Square, RotateCw, Trash2, MoreVertical, TerminalSquare, ScrollText, ChevronRight, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, Copy, Download, Loader2, Eye, EyeOff } from "lucide-react"

const CONTAINERS_SORT_KEY = 'docker.containers.sort'
const DOCKER_PAGE_SIZE_KEY = 'docker.list.page_size'

function loadGlobalPageSize(): 25 | 50 | 100 {
  try {
    const raw = Number(localStorage.getItem(DOCKER_PAGE_SIZE_KEY) || '50')
    if (raw === 25 || raw === 50 || raw === 100) return raw
  } catch {
    // ignore invalid local storage
  }
  return 50
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

interface ContainerStats {
  ID: string
  Name: string
  CPUPerc: string
  MemUsage: string
}

function parseContainers(output: string): Container[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean) as Container[]
}

function parseContainerStats(output: string): ContainerStats[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean) as ContainerStats[]
}

function shortName(name: string): string {
  if (!name) return "-"
  return name.length > 20 ? `${name.slice(0, 20)}…` : name
}

function memUsed(memUsage?: string): string {
  if (!memUsage) return "-"
  return memUsage.split("/")[0]?.trim() || memUsage
}

function memoryTextToBytes(raw?: string): number {
  if (!raw) return 0
  const value = raw.trim()
  const matched = value.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/)
  if (!matched) return 0

  const numeric = Number(matched[1])
  if (!Number.isFinite(numeric)) return 0
  const unit = String(matched[2] || 'B').toUpperCase()

  const base1024: Record<string, number> = {
    B: 1,
    KI: 1024,
    KIB: 1024,
    MI: 1024 ** 2,
    MIB: 1024 ** 2,
    GI: 1024 ** 3,
    GIB: 1024 ** 3,
    TI: 1024 ** 4,
    TIB: 1024 ** 4,
  }
  const base1000: Record<string, number> = {
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
  }

  if (base1024[unit]) return numeric * base1024[unit]
  if (base1000[unit]) return numeric * base1000[unit]
  if (unit === 'K') return numeric * 1000
  if (unit === 'M') return numeric * 1000 ** 2
  if (unit === 'G') return numeric * 1000 ** 3
  if (unit === 'T') return numeric * 1000 ** 4
  return numeric
}

function memUsageBytes(memUsage?: string): number {
  if (!memUsage) return 0
  const used = memUsage.split('/')[0]?.trim() || ''
  return memoryTextToBytes(used)
}

function hostPublishedPorts(rawPorts?: string): string {
  if (!rawPorts) return "-"
  const values = rawPorts
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.includes("->"))
    .map((item) => item.split("->")[0]?.trim())
    .map((left) => {
      if (!left) return ''
      const match = left.match(/:(\d+)$/)
      return match?.[1] || ''
    })
    .filter(Boolean)
  if (values.length === 0) return "-"
  return Array.from(new Set(values)).join(", ")
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
  if (!networks) return "-"
  for (const network of Object.values(networks)) {
    const ip = network?.IPAddress
    if (ip) return ip
  }
  return "-"
}

function composeName(inspect?: Record<string, any> | null): string {
  const labels = inspect?.Config?.Labels as Record<string, string> | undefined
  return labels?.["com.docker.compose.project"] || "-"
}

function inspectPorts(inspect?: Record<string, any> | null): string[] {
  const ports = inspect?.NetworkSettings?.Ports as Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | undefined
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
  const mounts = inspect?.Mounts as Array<{ Source?: string; Destination?: string; Type?: string }> | undefined
  if (!Array.isArray(mounts)) return []
  return mounts.map((mount) => `${mount.Source || '-'}:${mount.Destination || '-'} (${mount.Type || 'bind'})`)
}

function inspectNetworks(inspect?: Record<string, any> | null): string[] {
  const networks = inspect?.NetworkSettings?.Networks as Record<string, any> | undefined
  if (!networks) return []
  return Object.keys(networks)
}

function statusBadge(state: string) {
  const variant = state === "running" ? "default" : "secondary"
  return <Badge variant={variant}>{state}</Badge>
}

type SortKey = 'name' | 'state' | 'port' | 'created' | 'status' | 'cpu' | 'mem' | 'compose'

export function ContainersTab({
  serverId,
  onOpenTerminal,
  filterPreset,
  includeNames,
  onClearFilterPreset,
  onClearIncludeNames,
  onOpenComposeFilter,
}: {
  serverId: string
  onOpenTerminal?: (containerId: string) => void
  filterPreset?: string
  includeNames?: string[]
  onClearFilterPreset?: () => void
  onClearIncludeNames?: () => void
  onOpenComposeFilter?: (composeName: string) => void
}) {
  type PendingAction = {
    container: Container
    action: 'stop' | 'restart' | 'remove'
    force?: boolean
  }

  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [logsContainer, setLogsContainer] = useState<Container | null>(null)
  const [logsContent, setLogsContent] = useState("")
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsActionTip, setLogsActionTip] = useState("")
  const [filter, setFilter] = useState("")
  const [stateFilter, setStateFilter] = useState<'all' | 'running' | 'exited' | 'paused' | 'created'>('all')
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const raw = localStorage.getItem(CONTAINERS_SORT_KEY)
      if (!raw) return 'name'
      const parsed = JSON.parse(raw) as { key?: SortKey }
      return parsed.key || 'name'
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
  const [showMetaColumns, setShowMetaColumns] = useState(false)
  const [copiedTip, setCopiedTip] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [inspectMap, setInspectMap] = useState<Record<string, Record<string, any>>>({})
  const [statsMap, setStatsMap] = useState<Record<string, ContainerStats>>({})
  const [detailsLoadingMap, setDetailsLoadingMap] = useState<Record<string, boolean>>({})
  const [allDetailsLoading, setAllDetailsLoading] = useState(false)
  const [allDetailsCached, setAllDetailsCached] = useState(false)
  const [detailsErrorMessage, setDetailsErrorMessage] = useState<string | null>(null)
  const [fakeLoadingProgress, setFakeLoadingProgress] = useState(0)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  useEffect(() => {
    localStorage.setItem(CONTAINERS_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(pageSize))
  }, [pageSize])

  useEffect(() => {
    if (!filterPreset) return
    setFilter(filterPreset)
  }, [filterPreset])

  const {
    data: containers = [],
    isLoading: loading,
    error: containersError,
  } = useQuery<Container[]>({
    queryKey: ['docker', 'containers', serverId],
    queryFn: async () => {
      const res = await pb.send(`/api/ext/docker/containers?server_id=${serverId}`, { method: "GET" })
      return parseContainers(res.output)
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const containerIdsKey = useMemo(() => containers.map((c) => c.ID).join(','), [containers])

  useEffect(() => {
    const idSet = new Set(containers.map((container) => container.ID))
    setInspectMap((state) => {
      const next: Record<string, Record<string, any>> = {}
      for (const [id, inspect] of Object.entries(state)) {
        if (idSet.has(id)) next[id] = inspect
      }
      return next
    })
    setStatsMap((state) => {
      const next: Record<string, ContainerStats> = {}
      for (const [id, stats] of Object.entries(state)) {
        if (idSet.has(id)) next[id] = stats
      }
      return next
    })
    setAllDetailsCached(false)
    setDetailsErrorMessage(null)
  }, [containerIdsKey])

  const loadInspectForContainer = useCallback(async (containerId: string) => {
    if (!containerId || inspectMap[containerId] || detailsLoadingMap[containerId]) return

    setDetailsLoadingMap((state) => ({ ...state, [containerId]: true }))
    try {
      const inspectRes = await pb.send(`/api/ext/docker/containers/${containerId}?server_id=${serverId}`, { method: "GET" })
      const inspect = parseInspect(inspectRes.output)
      if (inspect) {
        setInspectMap((state) => ({ ...state, [containerId]: inspect }))
      }
    } catch (err) {
      setDetailsErrorMessage(getApiErrorMessage(err, 'Failed to load container details'))
    } finally {
      setDetailsLoadingMap((state) => ({ ...state, [containerId]: false }))
    }
  }, [detailsLoadingMap, inspectMap, serverId])

  const loadAllDetails = useCallback(async () => {
    if (containers.length === 0 || allDetailsLoading || allDetailsCached) return

    setAllDetailsLoading(true)
    setDetailsErrorMessage(null)
    try {
      const statsRes = await pb.send(`/api/ext/docker/containers/stats?server_id=${serverId}`, { method: "GET" })
      const parsedStats = parseContainerStats(statsRes.output)
      const nextStats: Record<string, ContainerStats> = {}
      for (const stat of parsedStats) {
        if (stat.ID) nextStats[stat.ID] = stat
      }

      const inspectEntries = await Promise.all(
        containers.map(async (container) => {
          try {
            const inspectRes = await pb.send(`/api/ext/docker/containers/${container.ID}?server_id=${serverId}`, { method: "GET" })
            return [container.ID, parseInspect(inspectRes.output)] as const
          } catch {
            return [container.ID, null] as const
          }
        }),
      )

      const nextInspect: Record<string, Record<string, any>> = {}
      for (const [id, inspect] of inspectEntries) {
        if (inspect) nextInspect[id] = inspect
      }

      setStatsMap((state) => ({ ...state, ...nextStats }))
      setInspectMap((state) => ({ ...state, ...nextInspect }))
      setAllDetailsCached(true)
    } catch (err) {
      setDetailsErrorMessage(getApiErrorMessage(err, 'Failed to load container details'))
    } finally {
      setAllDetailsLoading(false)
    }
  }, [allDetailsCached, allDetailsLoading, containers, serverId])

  useEffect(() => {
    if (!showMetaColumns) return
    void loadAllDetails()
  }, [loadAllDetails, showMetaColumns])

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
      setFakeLoadingProgress((value) => {
        if (value >= 92) return value
        const increment = Math.max(1, Math.round((100 - value) * 0.08))
        return Math.min(92, value + increment)
      })
    }, 180)

    return () => window.clearInterval(timer)
  }, [allDetailsLoading])

  useEffect(() => {
    if (showMetaColumns) return
    if (sortKey === 'created' || sortKey === 'cpu' || sortKey === 'mem' || sortKey === 'compose') {
      setSortKey('name')
      setSortDir('asc')
    }
  }, [showMetaColumns, sortKey])

  const action = async (id: string, act: string, options?: { force?: boolean }) => {
    try {
      setActionError(null)
      if (act === "remove") {
        const force = options?.force ? '&force=1' : ''
        await pb.send(`/api/ext/docker/containers/${id}?server_id=${serverId}${force}`, { method: "DELETE" })
      } else {
        await pb.send(`/api/ext/docker/containers/${id}/${act}?server_id=${serverId}`, { method: "POST" })
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

  const fetchLogs = useCallback(async (container: Container) => {
    try {
      setLogsLoading(true)
      setLogsContainer(container)
      const res = await pb.send(`/api/ext/docker/containers/${container.ID}/logs?server_id=${serverId}&tail=300`, {
        method: "GET",
      })
      setLogsContent(typeof res.output === "string" ? res.output : "")
    } catch (err) {
      setLogsContent(String(err))
    } finally {
      setLogsLoading(false)
    }
  }, [serverId])

  const copyLogs = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logsContent || "")
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

  const filtered = containers.filter(
    (c) =>
      c.Names?.toLowerCase().includes(filter.toLowerCase()) ||
      c.Image?.toLowerCase().includes(filter.toLowerCase()),
  )

  const stateFiltered = filtered.filter((container) => {
    if (stateFilter === 'all') return true
    return (container.State || '').toLowerCase() === stateFilter
  })

  const nameFiltered = stateFiltered.filter((container) => {
    if (!includeNames || includeNames.length === 0) return true
    return includeNames.includes(container.Names)
  })

  const sorted = useMemo(() => {
    const items = [...nameFiltered]
    items.sort((left, right) => {
      const leftInspect = inspectMap[left.ID]
      const rightInspect = inspectMap[right.ID]
      const leftStats = statsMap[left.ID]
      const rightStats = statsMap[right.ID]

      if (sortKey === 'mem') {
        const leftMem = memUsageBytes(leftStats?.MemUsage)
        const rightMem = memUsageBytes(rightStats?.MemUsage)
        if (leftMem < rightMem) return sortDir === 'asc' ? -1 : 1
        if (leftMem > rightMem) return sortDir === 'asc' ? 1 : -1
        return 0
      }

      if (sortKey === 'cpu') {
        const leftCpu = parseFloat(leftStats?.CPUPerc || '0')
        const rightCpu = parseFloat(rightStats?.CPUPerc || '0')
        if (leftCpu < rightCpu) return sortDir === 'asc' ? -1 : 1
        if (leftCpu > rightCpu) return sortDir === 'asc' ? 1 : -1
        return 0
      }

      const leftValue = (() => {
        switch (sortKey) {
          case 'state': return left.State
          case 'port': return hostPublishedPorts(left.Ports)
          case 'created': return String(leftInspect?.Created || '')
          case 'status': return left.Status
          case 'compose': return composeName(leftInspect)
          default: return left.Names
        }
      })().toLowerCase()

      const rightValue = (() => {
        switch (sortKey) {
          case 'state': return right.State
          case 'port': return hostPublishedPorts(right.Ports)
          case 'created': return String(rightInspect?.Created || '')
          case 'status': return right.Status
          case 'compose': return composeName(rightInspect)
          default: return right.Names
        }
      })().toLowerCase()

      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [inspectMap, nameFiltered, sortDir, sortKey, statsMap])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [page, pageSize, sorted])

  useEffect(() => {
    setPage(1)
  }, [filter, stateFilter, sortDir, sortKey, pageSize, serverId, filterPreset, includeNames])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

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
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: SortKey }) => (
    <Button variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-xs" onClick={() => toggleSort(keyName)}>
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
    : detailsErrorMessage

  const tableColSpan = showMetaColumns ? 9 : 5

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 pt-4">
      {(loadError || actionError) && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{loadError || actionError}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter containers..."
            className="border rounded-md px-3 py-1.5 text-sm bg-background"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="border rounded-md px-2 py-1.5 text-sm bg-background"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as 'all' | 'running' | 'exited' | 'paused' | 'created')}
          >
            <option value="all">All states</option>
            <option value="running">Running</option>
            <option value="exited">Exited</option>
            <option value="paused">Paused</option>
            <option value="created">Created</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowMetaColumns((visible) => !visible)}
            title={showMetaColumns ? 'Hide Created / CPU / Mem' : 'Show Created / CPU / Mem'}
            aria-label={showMetaColumns ? 'Hide Created / CPU / Mem' : 'Show Created / CPU / Mem'}
          >
            {showMetaColumns ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          {((filterPreset && onClearFilterPreset) || (includeNames && includeNames.length > 0)) && (
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
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {stateFilter !== 'all' && <Badge variant="secondary">State: {stateFilter}</Badge>}
        {includeNames && includeNames.length > 0 && <Badge variant="outline">Linked containers: {includeNames.length}</Badge>}
        {allDetailsLoading && <Badge variant="outline">Loading container details...</Badge>}
      </div>
      {(allDetailsLoading || (fakeLoadingProgress > 0 && fakeLoadingProgress < 100)) && (
        <div className="shrink-0 space-y-1">
          <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${Math.max(6, Math.min(100, fakeLoadingProgress))}%` }}
            />
          </div>
          <div className="text-[11px] text-muted-foreground">Preparing container metrics... {Math.min(100, Math.round(fakeLoadingProgress))}%</div>
        </div>
      )}
      {copiedTip && <div className="text-xs text-muted-foreground shrink-0">{copiedTip}</div>}
      <div data-docker-scroll-root="true" className="h-0 flex-1 min-h-0 overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead><SortHead label="Name" keyName="name" /></TableHead>
            <TableHead><SortHead label="State" keyName="state" /></TableHead>
            <TableHead><SortHead label="Port" keyName="port" /></TableHead>
            {showMetaColumns && <TableHead><SortHead label="Created" keyName="created" /></TableHead>}
            <TableHead><SortHead label="Status" keyName="status" /></TableHead>
            {showMetaColumns && <TableHead><SortHead label="CPU%" keyName="cpu" /></TableHead>}
            {showMetaColumns && <TableHead><SortHead label="Mem" keyName="mem" /></TableHead>}
            {showMetaColumns && <TableHead><SortHead label="Compose" keyName="compose" /></TableHead>}
            <TableHead className="w-[60px]" />
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
          {paged.map((c) => {
            const inspect = inspectMap[c.ID]
            const stats = statsMap[c.ID]
            return (
              <Fragment key={c.ID}>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">
                    <Button
                      variant="link"
                      className="h-auto p-0 text-left font-mono text-xs gap-1"
                      onClick={() => {
                        setExpandedId((id) => {
                          const nextId = id === c.ID ? null : c.ID
                          if (nextId === c.ID) {
                            void loadInspectForContainer(c.ID)
                          }
                          return nextId
                        })
                      }}
                    >
                      {expandedId === c.ID ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span title={c.Names}>{shortName(c.Names)}</span>
                    </Button>
                  </TableCell>
                  <TableCell>{statusBadge(c.State)}</TableCell>
                  <TableCell className="text-xs">{hostPublishedPorts(c.Ports)}</TableCell>
                  {showMetaColumns && (
                    <TableCell className="text-xs">{allDetailsLoading ? '...' : (inspect?.Created ? new Date(inspect.Created).toLocaleString() : '-')}</TableCell>
                  )}
                  <TableCell className="text-xs">{c.Status}</TableCell>
                  {showMetaColumns && <TableCell className="text-xs">{allDetailsLoading ? '...' : (stats?.CPUPerc || '-')}</TableCell>}
                  {showMetaColumns && <TableCell className="text-xs">{allDetailsLoading ? '...' : memUsed(stats?.MemUsage)}</TableCell>}
                  {showMetaColumns && (
                    <TableCell className="text-xs">
                      {composeName(inspect) !== '-' ? (
                        <Button
                          variant="link"
                          className="h-auto p-0 text-xs"
                          onClick={() => onOpenComposeFilter?.(composeName(inspect))}
                        >
                          {composeName(inspect)}
                        </Button>
                      ) : '-'}
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
                        {c.State === "running" && onOpenTerminal && (
                          <DropdownMenuItem onClick={() => onOpenTerminal(c.ID)}>
                            <TerminalSquare className="h-4 w-4 mr-2" /> Terminal
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => fetchLogs(c)}>
                          <ScrollText className="h-4 w-4 mr-2" /> Logs
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => action(c.ID, "start")}
                          disabled={(c.State || '').toLowerCase() === 'running'}
                        >
                          <Play className="h-4 w-4 mr-2" /> Start
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPendingAction({ container: c, action: 'stop' })}>
                          <Square className="h-4 w-4 mr-2" /> Stop
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPendingAction({ container: c, action: 'restart' })}>
                          <RotateCw className="h-4 w-4 mr-2" /> Restart
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setPendingAction({ container: c, action: 'remove', force: false })}
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
                    <TableCell colSpan={tableColSpan} className="bg-muted/20 px-4 py-3">
                      <div className="rounded-lg border bg-background p-4 shadow-sm space-y-3">
                        <div className="text-sm font-medium">Container Details</div>
                        {detailsLoadingMap[c.ID] && (
                          <div className="text-xs text-muted-foreground">Loading container details...</div>
                        )}
                        <div className="grid gap-3 md:grid-cols-2 text-xs">
                          <div className="rounded-md border bg-muted/20 p-3">
                            <div className="font-medium mb-2 text-muted-foreground">Basics</div>
                            <div className="font-mono break-all">Image: {c.Image || '-'}</div>
                            <div
                              className="font-mono break-all cursor-copy"
                              onDoubleClick={() => copyText(c.ID || '-', 'ID')}
                              title="Double click to copy ID"
                            >
                              ID: {c.ID || '-'}
                            </div>
                            <div
                              className="font-mono break-all cursor-copy"
                              onDoubleClick={() => copyText(containerIP(inspect), 'IP')}
                              title="Double click to copy IP"
                            >
                              IP: {containerIP(inspect)}
                            </div>
                          </div>
                          <div className="rounded-md border bg-muted/20 p-3">
                            <div className="font-medium mb-2 text-muted-foreground">Ports</div>
                            {inspectPorts(inspect).length > 0 ? inspectPorts(inspect).map((port) => (
                              <div key={port} className="font-mono">{port}</div>
                            )) : <div className="text-muted-foreground">-</div>}
                          </div>
                          <div className="rounded-md border bg-muted/20 p-3">
                            <div className="font-medium mb-2 text-muted-foreground">Volumes</div>
                            {inspectVolumes(inspect).length > 0 ? (
                              <div className="overflow-x-auto">
                                {inspectVolumes(inspect).map((volume) => (
                                  <div key={volume} className="font-mono whitespace-nowrap min-w-max">{volume}</div>
                                ))}
                              </div>
                            ) : <div className="text-muted-foreground">-</div>}
                          </div>
                          <div className="rounded-md border bg-muted/20 p-3">
                            <div className="font-medium mb-2 text-muted-foreground">Network</div>
                            {inspectNetworks(inspect).length > 0 ? inspectNetworks(inspect).map((network) => (
                              <div key={network} className="font-mono">{network}</div>
                            )) : <div className="text-muted-foreground">-</div>}
                          </div>
                          <div className="rounded-md border bg-muted/20 p-3">
                            <div className="font-medium mb-2 text-muted-foreground">Env</div>
                            <div className="max-h-32 overflow-auto">
                              {Array.isArray(inspect?.Config?.Env) && inspect.Config.Env.length > 0 ? (
                                inspect.Config.Env.map((env: string) => (
                                  <div key={env} className="font-mono break-all">{env}</div>
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
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="text-xs text-muted-foreground">
          {sorted.length === 0 ? '0 items' : `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, sorted.length)} of ${sorted.length}`}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={pageSize}
            onChange={(e) => {
              const next = Number(e.target.value) as 25 | 50 | 100
              setPageSize(next)
              setPage(1)
            }}
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground w-16 text-center">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      </div>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
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
                onCheckedChange={(checked) => setPendingAction((state) => state ? { ...state, force: !!checked } : state)}
              />
              <label htmlFor="container-remove-force" className="text-sm text-muted-foreground cursor-pointer">
                Force remove
              </label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={pendingAction?.action === 'remove' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
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

      <Dialog open={!!logsContainer} onOpenChange={(open) => !open && setLogsContainer(null)}>
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
            <Button
              variant="outline"
              size="sm"
              onClick={copyLogs}
              disabled={logsLoading}
            >
              <Copy className="h-4 w-4 mr-1" /> Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadLogs}
              disabled={logsLoading}
            >
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
            {logsActionTip && <span className="text-xs text-muted-foreground">{logsActionTip}</span>}
          </div>
          <ScrollArea className="h-[calc(70vh-8rem)] border-t px-5 py-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {logsLoading ? 'Loading logs...' : (logsContent || '(no logs)')}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}
