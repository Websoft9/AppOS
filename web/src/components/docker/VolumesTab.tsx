import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import { dockerApiPath } from '@/lib/docker-api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Trash2,
  MoreVertical,
  ArrowUpDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  ArrowUp,
  ArrowDown,
  Eraser,
  ExternalLink,
  Filter,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  DockerDependencyAlert,
  getDockerDependencyIssue,
} from '@/components/docker/DockerDependencyAlert'
import { cn } from '@/lib/utils'
import { FileManagerPanel } from '@/components/connect/FileManagerPanel'

const VOLUMES_SORT_KEY = 'docker.volumes.sort'
const DOCKER_PAGE_SIZE_KEY = 'docker.list.page_size'
const PRUNE_CONFIRMATION_PHRASE = 'prune unused volumes'

type LinkedContainerFilter = 'all' | 'linked' | 'unlinked'

function loadGlobalPageSize(): 25 | 50 | 100 {
  try {
    const raw = Number(localStorage.getItem(DOCKER_PAGE_SIZE_KEY) || '50')
    if (raw === 25 || raw === 50 || raw === 100) return raw
  } catch {
    // ignore invalid local storage
  }
  return 50
}

interface Volume {
  Name: string
  Driver: string
  Mountpoint: string
}

interface Container {
  ID: string
  Names: string
}

type VolumeContainerLink = {
  allNames: string[]
  runningNames: string[]
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

function parseInspect(output: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed[0]) return parsed[0] as Record<string, any>
    return null
  } catch {
    return null
  }
}

function parseVolumes(output: string): Volume[] {
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
    .filter(Boolean) as Volume[]
}

function shortVolumeName(name: string): string {
  if (!name) return '-'
  return name.length > 30 ? `${name.slice(0, 30)}…` : name
}

function shortMountpoint(path: string): string {
  if (!path) return '-'
  return path.length > 45 ? `${path.slice(0, 45)}...` : path
}

function normalizeContainerName(name: string): string {
  if (!name) return '-'
  return name.replace(/^\/+/, '')
}

export type VolumesTabRef = {
  openPruneDialog: () => void
}

export const VolumesTab = forwardRef<
  VolumesTabRef,
  {
    serverId: string
    refreshSignal?: number
    embeddedInWorkspace?: boolean
    externalFilter?: string
    includeNames?: string[]
    page?: number
    pageSize?: 25 | 50 | 100
    onPageChange?: (page: number) => void
    onSummaryChange?: (summary: { totalItems: number; totalPages: number }) => void
    onOpenContainerFilter?: (volumeName: string, containerNames: string[]) => void
    onClearIncludeNames?: () => void
  }
>(function VolumesTab(
  {
    serverId,
    refreshSignal = 0,
    embeddedInWorkspace = false,
    externalFilter,
    includeNames,
    page: externalPage,
    pageSize: externalPageSize,
    onPageChange,
    onSummaryChange,
    onOpenContainerFilter,
    onClearIncludeNames,
  },
  ref
) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<'name'>(() => {
    try {
      const raw = localStorage.getItem(VOLUMES_SORT_KEY)
      if (!raw) return 'name'
      const parsed = JSON.parse(raw) as { key?: 'name' | 'driver' | 'mountpoint' }
      return parsed.key === 'name' ? 'name' : 'name'
    } catch {
      return 'name'
    }
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try {
      const raw = localStorage.getItem(VOLUMES_SORT_KEY)
      if (!raw) return 'asc'
      const parsed = JSON.parse(raw) as { dir?: 'asc' | 'desc' }
      return parsed.dir || 'asc'
    } catch {
      return 'asc'
    }
  })
  const [linkedContainerFilter, setLinkedContainerFilter] = useState<LinkedContainerFilter>('all')
  const [internalPageSize, setInternalPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [internalPage, setInternalPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const [expandedVolume, setExpandedVolume] = useState<string | null>(null)
  const [inspectMap, setInspectMap] = useState<Record<string, string>>({})
  const [inspectLoadingMap, setInspectLoadingMap] = useState<Record<string, boolean>>({})
  const [pendingRemoveVolume, setPendingRemoveVolume] = useState<string | null>(null)
  const [pruneConfirmOpen, setPruneConfirmOpen] = useState(false)
  const [pruneConfirmationText, setPruneConfirmationText] = useState('')
  const [filesVolume, setFilesVolume] = useState<Volume | null>(null)

  const effectivePage = externalPage ?? internalPage
  const effectivePageSize = externalPageSize ?? internalPageSize

  const changePage = (nextPage: number) => {
    setInternalPage(nextPage)
    onPageChange?.(nextPage)
  }

  const changePageSize = (nextPageSize: 25 | 50 | 100) => {
    if (externalPageSize !== undefined) return
    setInternalPageSize(nextPageSize)
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(nextPageSize))
    setInternalPage(1)
  }

  useEffect(() => {
    if (externalFilter !== undefined) setFilter(externalFilter)
  }, [externalFilter])

  useEffect(() => {
    localStorage.setItem(VOLUMES_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useImperativeHandle(ref, () => ({
    openPruneDialog: () => setPruneConfirmOpen(true),
  }))

  const {
    data: volumes = [],
    isLoading: loading,
    error,
  } = useQuery<Volume[]>({
    queryKey: ['docker', 'volumes', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/volumes'), { method: 'GET' })
      return parseVolumes(res.output)
    },
    placeholderData: previousData => previousData,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const volumeNamesKey = useMemo(
    () =>
      volumes
        .map(volume => volume.Name)
        .sort()
        .join(','),
    [volumes]
  )

  const { data: volumeContainerLinks = {}, isLoading: volumeContainersLoading } = useQuery<
    Record<string, VolumeContainerLink>
  >({
    queryKey: ['docker', 'volumes', 'containers', serverId, refreshSignal, volumeNamesKey],
    queryFn: async () => {
      const containersRes = await pb.send(dockerApiPath(serverId, '/containers'), {
        method: 'GET',
      })
      const containers = parseContainers(containersRes.output)

      const inspectEntries = await Promise.all(
        containers.map(async container => {
          try {
            const inspectRes = await pb.send(
              dockerApiPath(serverId, `/containers/${container.ID}`),
              {
                method: 'GET',
              }
            )
            return [container.Names, parseInspect(inspectRes.output)] as const
          } catch {
            return [container.Names, null] as const
          }
        })
      )

      const mapping: Record<string, VolumeContainerLink> = {}
      for (const volume of volumes) {
        mapping[volume.Name] = {
          allNames: [],
          runningNames: [],
        }
      }
      for (const [containerName, inspect] of inspectEntries) {
        const mounts = inspect?.Mounts as
          | Array<{ Name?: string; Source?: string; Type?: string }>
          | undefined
        const normalizedName = normalizeContainerName(containerName)
        const isRunning = inspect?.State?.Running === true
        if (!Array.isArray(mounts)) continue
        for (const mount of mounts) {
          const mountedVolume = mount.Name
          if (mountedVolume && mapping[mountedVolume]) {
            mapping[mountedVolume].allNames.push(normalizedName)
            if (isRunning) {
              mapping[mountedVolume].runningNames.push(normalizedName)
            }
          }
        }
      }

      for (const key of Object.keys(mapping)) {
        mapping[key].allNames = Array.from(new Set(mapping[key].allNames))
        mapping[key].runningNames = Array.from(new Set(mapping[key].runningNames))
      }

      return mapping
    },
    enabled: volumes.length > 0,
    placeholderData: previousData => previousData,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const loadVolumeInspect = async (name: string) => {
    if (!name || inspectMap[name] || inspectLoadingMap[name]) return
    setInspectLoadingMap(state => ({ ...state, [name]: true }))
    try {
      const res = await pb.send(dockerApiPath(serverId, `/volumes/${name}/inspect`), {
        method: 'GET',
      })
      setInspectMap(state => ({ ...state, [name]: String(res.output || '') }))
    } catch (err) {
      setInspectMap(state => ({
        ...state,
        [name]: getApiErrorMessage(err, 'Failed to inspect volume'),
      }))
    } finally {
      setInspectLoadingMap(state => ({ ...state, [name]: false }))
    }
  }

  const removeVolume = async (name: string) => {
    try {
      setActionError(null)
      await pb.send(dockerApiPath(serverId, `/volumes/${name}`), { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to remove volume'))
    }
  }

  const pruneVolumes = async () => {
    try {
      setActionError(null)
      await pb.send(dockerApiPath(serverId, '/volumes/prune'), { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to prune volumes'))
    }
  }

  const loadError = error ? getApiErrorMessage(error, 'Failed to load volumes') : null
  const visibleError = loadError || actionError
  const dependencyIssue = getDockerDependencyIssue(error ?? visibleError)

  const driverCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const volume of volumes) {
      const key = volume.Driver || '-'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries()).sort((left, right) => left[0].localeCompare(right[0]))
  }, [volumes])

  const unusedVolumes = useMemo(
    () => volumes.filter(volume => (volumeContainerLinks[volume.Name]?.allNames.length ?? 0) === 0),
    [volumeContainerLinks, volumes]
  )

  const pruneActionEnabled =
    !volumeContainersLoading &&
    unusedVolumes.length > 0 &&
    pruneConfirmationText.trim() === PRUNE_CONFIRMATION_PHRASE

  const filtered = volumes.filter(v => {
    const nameMatched = v.Name?.toLowerCase().includes(filter.toLowerCase())
    if (!nameMatched) return false
    if (includeNames && includeNames.length > 0 && !includeNames.includes(v.Name)) return false
    if (driverFilter !== 'all' && (v.Driver || '-') !== driverFilter) return false

    const linkedCount = volumeContainerLinks[v.Name]?.allNames.length ?? 0
    if (linkedContainerFilter === 'linked') return linkedCount > 0
    if (linkedContainerFilter === 'unlinked') return linkedCount === 0
    return true
  })

  const sorted = useMemo(() => {
    const items = [...filtered]
    items.sort((left, right) => {
      const leftValue = (left.Name || '').toLowerCase()
      const rightValue = (right.Name || '').toLowerCase()
      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [filtered, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / effectivePageSize))
  const paged = useMemo(() => {
    const start = (effectivePage - 1) * effectivePageSize
    return sorted.slice(start, start + effectivePageSize)
  }, [effectivePage, effectivePageSize, sorted])

  useEffect(() => {
    changePage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverFilter, filter, linkedContainerFilter, sortDir, sortKey, effectivePageSize, serverId])

  useEffect(() => {
    if (effectivePage > totalPages) changePage(totalPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePage, totalPages])

  useEffect(() => {
    onSummaryChange?.({ totalItems: sorted.length, totalPages })
  }, [onSummaryChange, sorted.length, totalPages])

  const toggleSort = (key: 'name') => {
    if (sortKey === key) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: 'name' }) => (
    <button
      type="button"
      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded px-0 text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
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

  const toggleVolumeExpansion = (volumeName: string) => {
    setExpandedVolume(state => {
      const next = state === volumeName ? null : volumeName
      if (next === volumeName) {
        void loadVolumeInspect(volumeName)
      }
      return next
    })
  }

  const handlePruneDialogOpenChange = (open: boolean) => {
    setPruneConfirmOpen(open)
    if (!open) setPruneConfirmationText('')
  }

  const openVolumeFiles = (volume: Volume) => {
    setFilesVolume(volume)
  }

  const hasActiveFilters =
    filter.trim().length > 0 ||
    driverFilter !== 'all' ||
    linkedContainerFilter !== 'all' ||
    !!(includeNames && includeNames.length > 0)

  const filesVolumeRunningContainers = filesVolume
    ? (volumeContainerLinks[filesVolume.Name]?.runningNames ?? [])
    : []

  return (
    <div
      className={cn('h-full min-h-0 flex flex-col gap-4', embeddedInWorkspace ? 'pt-0' : 'pt-4')}
    >
      {dependencyIssue && visibleError ? (
        <DockerDependencyAlert serverId={serverId} message={visibleError} focusSource="volumes" />
      ) : visibleError ? (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{visibleError}</AlertDescription>
        </Alert>
      ) : null}
      {!embeddedInWorkspace && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-3 shrink-0">
          <input
            type="text"
            placeholder="Filter volumes..."
            className="h-9 min-w-[14rem] rounded-md border bg-background px-3 text-sm"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPruneConfirmOpen(true)}
            disabled={loading || volumeContainersLoading}
          >
            <Eraser className="h-4 w-4 mr-1" /> Prune unused
          </Button>
        </div>
      )}
      {hasActiveFilters && (
        <div className="flex items-center justify-end gap-2 shrink-0">
          {includeNames && includeNames.length > 0 && (
            <Alert className="border-dashed bg-muted/10 px-3 py-2">
              <AlertDescription className="text-xs">
                Linked containers: {includeNames.length}
              </AlertDescription>
            </Alert>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilter('')
              setDriverFilter('all')
              setLinkedContainerFilter('all')
              onClearIncludeNames?.()
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg bg-background">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
              <TableRow>
                <TableHead className="min-w-[220px] pl-4 pr-2">
                  <SortHead label="Name" keyName="name" />
                </TableHead>
                <TableHead className="min-w-[120px]">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-foreground">Driver</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'h-7 w-7',
                            driverFilter !== 'all' &&
                              'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                          )}
                          aria-label="Filter volume driver"
                          title={
                            driverFilter === 'all'
                              ? 'Filter volume driver'
                              : `Volume driver: ${driverFilter}`
                          }
                        >
                          <Filter className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuRadioGroup
                          value={driverFilter}
                          onValueChange={setDriverFilter}
                        >
                          <DropdownMenuRadioItem value="all">
                            All drivers ({volumes.length})
                          </DropdownMenuRadioItem>
                          {driverCounts.map(([driver, count]) => (
                            <DropdownMenuRadioItem key={driver} value={driver}>
                              {driver} ({count})
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead className="min-w-[280px] text-xs font-medium text-foreground">
                  Mountpoint
                </TableHead>
                <TableHead className="w-[180px] min-w-[180px] text-left">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-foreground">Containers</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'h-7 w-7',
                            linkedContainerFilter !== 'all' &&
                              'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                          )}
                          aria-label="Filter linked containers"
                          title={
                            linkedContainerFilter === 'all'
                              ? 'All'
                              : linkedContainerFilter === 'linked'
                                ? 'With container'
                                : 'Without container'
                          }
                        >
                          <Filter className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuRadioGroup
                          value={linkedContainerFilter}
                          onValueChange={value =>
                            setLinkedContainerFilter(value as LinkedContainerFilter)
                          }
                        >
                          <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="linked">
                            With container
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="unlinked">
                            Without container
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead className="w-[52px] text-xs font-medium text-foreground">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {paged.map(v => {
                const isExpanded = expandedVolume === v.Name
                const linkedContainers = volumeContainerLinks[v.Name]?.allNames || []
                return (
                  <Fragment key={v.Name}>
                    <TableRow className={cn(isExpanded && 'bg-muted/20')}>
                      <TableCell
                        className="cursor-pointer pl-4 pr-3 py-3 text-xs"
                        onClick={event => {
                          const target = event.target as HTMLElement
                          if (target.closest('button')) return
                          toggleVolumeExpansion(v.Name)
                        }}
                      >
                        <Button
                          variant="link"
                          className="group min-h-8 w-full justify-start p-0 text-left no-underline hover:no-underline"
                          onClick={() => toggleVolumeExpansion(v.Name)}
                        >
                          <span
                            className="truncate text-xs font-semibold leading-tight text-foreground group-hover:underline"
                            title={v.Name}
                          >
                            {shortVolumeName(v.Name)}
                          </span>
                        </Button>
                      </TableCell>
                      <TableCell className="py-3 text-xs">{v.Driver}</TableCell>
                      <TableCell className="py-3 font-mono text-xs" title={v.Mountpoint}>
                        {shortMountpoint(v.Mountpoint)}
                      </TableCell>
                      <TableCell className="w-[180px] min-w-[180px] py-3 text-left text-xs align-middle">
                        <div className="flex h-8 max-w-[180px] items-center">
                          {volumeContainersLoading ? (
                            <span className="inline-flex h-8 items-center truncate text-muted-foreground">
                              Loading...
                            </span>
                          ) : linkedContainers.length > 0 ? (
                            <button
                              type="button"
                              className="inline-flex h-8 w-full items-center justify-start gap-1 text-left text-xs text-primary hover:underline"
                              onClick={() => onOpenContainerFilter?.(v.Name, linkedContainers)}
                              title={linkedContainers.join(', ')}
                            >
                              <span className="truncate">
                                {linkedContainers.length} linked container
                                {linkedContainers.length > 1 ? 's' : ''}
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
                      <TableCell className="py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openVolumeFiles(v)}>
                              <FolderOpen className="h-4 w-4 mr-2" /> Open in Files
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPendingRemoveVolume(v.Name)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/20 px-0 py-3">
                          {inspectLoadingMap[v.Name] ? (
                            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading inspect...
                            </div>
                          ) : (
                            <pre className="text-xs font-mono bg-muted/40 rounded-md border p-3 overflow-auto max-h-[300px] whitespace-pre-wrap">
                              {inspectMap[v.Name] || '(empty output)'}
                            </pre>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
              {!loading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No volumes found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {!embeddedInWorkspace && (
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs text-muted-foreground">
            {sorted.length === 0
              ? '0 items'
              : `${(effectivePage - 1) * effectivePageSize + 1}-${Math.min(effectivePage * effectivePageSize, sorted.length)} of ${sorted.length}`}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={String(effectivePageSize)}
              onChange={e => changePageSize(Number(e.target.value) as 25 | 50 | 100)}
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => changePage(Math.max(1, effectivePage - 1))}
              disabled={effectivePage <= 1}
              aria-label="Previous volumes page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="w-16 text-center font-medium tabular-nums">
              {effectivePage} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => changePage(Math.min(totalPages, effectivePage + 1))}
              disabled={effectivePage >= totalPages}
              aria-label="Next volumes page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog
        open={!!pendingRemoveVolume}
        onOpenChange={open => {
          if (!open) setPendingRemoveVolume(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove volume?</AlertDialogTitle>
            <AlertDialogDescription>
              This operation is irreversible and may permanently delete data stored in the volume.
              {pendingRemoveVolume ? `\nVolume: ${pendingRemoveVolume}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const next = pendingRemoveVolume
                setPendingRemoveVolume(null)
                if (!next) return
                void removeVolume(next)
              }}
            >
              Delete volume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pruneConfirmOpen} onOpenChange={handlePruneDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Review unused volumes</AlertDialogTitle>
            <AlertDialogDescription>
              Review the local volumes that are not used by any container before running prune. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/20 px-3 py-3 text-sm">
              {volumeContainersLoading ? (
                <div className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking linked containers...
                </div>
              ) : unusedVolumes.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-foreground">
                    {unusedVolumes.length} unused volume{unusedVolumes.length > 1 ? 's' : ''} will
                    be removed.
                  </div>
                  <div className="max-h-56 overflow-auto rounded-md bg-background/90 ring-1 ring-border/60">
                    <div className="divide-y divide-border/60">
                      {unusedVolumes.map(volume => (
                        <div
                          key={volume.Name}
                          className="flex items-start justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div
                              className="truncate font-mono text-xs text-foreground"
                              title={volume.Name}
                            >
                              {volume.Name}
                            </div>
                            <div
                              className="truncate text-xs text-muted-foreground"
                              title={volume.Mountpoint}
                            >
                              {volume.Driver || '-'} · {shortMountpoint(volume.Mountpoint)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">
                  No unused volumes are available to prune.
                </div>
              )}
            </div>

            {unusedVolumes.length > 0 && !volumeContainersLoading ? (
              <div className="space-y-2">
                <label
                  htmlFor="prune-volumes-confirmation"
                  className="text-sm font-medium text-foreground"
                >
                  Type <span className="font-mono">{PRUNE_CONFIRMATION_PHRASE}</span> to enable
                  prune.
                </label>
                <Input
                  id="prune-volumes-confirmation"
                  value={pruneConfirmationText}
                  onChange={event => setPruneConfirmationText(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={PRUNE_CONFIRMATION_PHRASE}
                />
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!pruneActionEnabled}
              onClick={() => {
                handlePruneDialogOpenChange(false)
                void pruneVolumes()
              }}
            >
              Prune
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!filesVolume} onOpenChange={open => !open && setFilesVolume(null)}>
        <DialogContent className="flex h-[82vh] sm:max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 pr-12">
            <DialogTitle className="truncate text-base">Volume files</DialogTitle>
            <DialogDescription className="truncate font-mono text-xs">
              {filesVolume?.Mountpoint || ''}
            </DialogDescription>
          </DialogHeader>
          {filesVolume ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {filesVolumeRunningContainers.length > 0 ? (
                <Alert className="mx-4 mt-4 mb-0 min-w-0 w-auto shrink-0 border-amber-500/40 bg-amber-500/8 text-foreground">
                  <AlertDescription className="min-w-0 pr-8 leading-5">
                    This volume is currently used by {filesVolumeRunningContainers.length} running
                    container
                    {filesVolumeRunningContainers.length > 1 ? 's' : ''}:{' '}
                    {filesVolumeRunningContainers.join(', ')}. Editing may affect the running app.
                  </AlertDescription>
                </Alert>
              ) : null}
              <FileManagerPanel
                key={filesVolume.Mountpoint}
                serverId={serverId}
                initialPath={filesVolume.Mountpoint}
                lockedRootPath={filesVolume.Mountpoint}
                showCurrentPathInStatusBar={false}
                className="h-full min-h-0"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
})
