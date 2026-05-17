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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getApiErrorMessage } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const NETWORKS_SORT_KEY = 'docker.networks.sort'
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

interface Network {
  ID: string
  Name: string
  Driver: string
  Scope: string
  Created?: string
  Internal?: boolean
  EnableIPv6?: boolean
  Attachable?: boolean
  Ingress?: boolean
  Labels?: Record<string, string>
  Options?: Record<string, string>
  Containers?: Record<string, { Name?: string; IPv4Address?: string; IPv6Address?: string }>
  IPAM?: {
    Driver?: string
    Config?: Array<{
      Subnet?: string
      Gateway?: string
    }>
  }
}

function parseNetworks(output: string): Network[] {
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
    .filter(Boolean) as Network[]
}

function isSystemNetwork(network: Network): boolean {
  return network.Ingress === true || ['bridge', 'host', 'none'].includes(network.Name)
}

export type NetworksTabRef = {
  openCreateDialog: () => void
}

type NetworksTabProps = {
  serverId: string
  refreshSignal?: number
  embeddedInWorkspace?: boolean
  externalFilter?: string
  page?: number
  pageSize?: 25 | 50 | 100
  onPageChange?: (page: number) => void
  onSummaryChange?: (summary: { totalItems: number; totalPages: number }) => void
}

export const NetworksTab = forwardRef<NetworksTabRef, NetworksTabProps>(function NetworksTab(
  {
    serverId,
    refreshSignal = 0,
    embeddedInWorkspace = false,
    externalFilter,
    page: externalPage,
    pageSize: externalPageSize,
    onPageChange,
    onSummaryChange,
  },
  ref
) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [driverFilter, setDriverFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [sortKey, setSortKey] = useState<'name'>(() => {
    try {
      const raw = localStorage.getItem(NETWORKS_SORT_KEY)
      if (!raw) return 'name'
      const parsed = JSON.parse(raw) as { key?: 'name' }
      return parsed.key === 'name' ? 'name' : 'name'
    } catch {
      return 'name'
    }
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try {
      const raw = localStorage.getItem(NETWORKS_SORT_KEY)
      if (!raw) return 'asc'
      const parsed = JSON.parse(raw) as { dir?: 'asc' | 'desc' }
      return parsed.dir === 'desc' ? 'desc' : 'asc'
    } catch {
      return 'asc'
    }
  })
  const [internalPageSize, setInternalPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [internalPage, setInternalPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Network | null>(null)
  const [removingNetworkId, setRemovingNetworkId] = useState<string | null>(null)
  const [expandedNetworkId, setExpandedNetworkId] = useState<string | null>(null)
  const [inspectMap, setInspectMap] = useState<Record<string, string>>({})
  const [inspectLoadingMap, setInspectLoadingMap] = useState<Record<string, boolean>>({})
  const [typeFilter, setTypeFilter] = useState<'all' | 'system' | 'user'>('all')

  const effectivePage = externalPage ?? internalPage
  const effectivePageSize = externalPageSize ?? internalPageSize

  const setPage = (nextPage: number) => {
    setInternalPage(nextPage)
    onPageChange?.(nextPage)
  }

  const setPageSize = (nextPageSize: 25 | 50 | 100) => {
    if (externalPageSize !== undefined) return
    setInternalPageSize(nextPageSize)
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(nextPageSize))
    setInternalPage(1)
  }

  useEffect(() => {
    if (externalFilter !== undefined) setFilter(externalFilter)
  }, [externalFilter])

  useEffect(() => {
    localStorage.setItem(NETWORKS_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useImperativeHandle(ref, () => ({
    openCreateDialog: () => setCreateDialogOpen(true),
  }))

  const {
    data: networks = [],
    isLoading: loading,
    error,
  } = useQuery<Network[]>({
    queryKey: ['docker', 'networks', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/networks'), { method: 'GET' })
      return parseNetworks(res.output)
    },
    placeholderData: previousData => previousData,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const driverCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const network of networks) {
      const key = network.Driver || '-'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries()).sort((left, right) => left[0].localeCompare(right[0]))
  }, [networks])

  const scopeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const network of networks) {
      const key = network.Scope || '-'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries()).sort((left, right) => left[0].localeCompare(right[0]))
  }, [networks])

  const typeCounts = useMemo(() => {
    let system = 0
    let user = 0
    for (const network of networks) {
      if (isSystemNetwork(network)) system += 1
      else user += 1
    }
    return { all: networks.length, system, user }
  }, [networks])

  const loadNetworkInspect = async (id: string) => {
    if (!id || inspectMap[id] || inspectLoadingMap[id]) return
    setInspectLoadingMap(state => ({ ...state, [id]: true }))
    try {
      const res = await pb.send(dockerApiPath(serverId, `/networks/${id}/inspect`), {
        method: 'GET',
      })
      const rawOutput = String(res.output ?? '')
      try {
        setInspectMap(state => ({
          ...state,
          [id]: JSON.stringify(JSON.parse(rawOutput), null, 2),
        }))
      } catch {
        setInspectMap(state => ({ ...state, [id]: rawOutput }))
      }
    } catch (err) {
      setInspectMap(state => ({
        ...state,
        [id]: getApiErrorMessage(err, 'Failed to inspect network'),
      }))
    } finally {
      setInspectLoadingMap(state => ({ ...state, [id]: false }))
    }
  }

  const removeNetwork = async (id: string) => {
    try {
      setActionError(null)
      setRemovingNetworkId(id)
      await pb.send(dockerApiPath(serverId, `/networks/${id}`), { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to remove network'))
    } finally {
      setRemovingNetworkId(current => (current === id ? null : current))
      setPendingDelete(current => (current?.ID === id ? null : current))
    }
  }

  const createNetwork = async () => {
    if (!newName.trim()) return
    try {
      setActionError(null)
      await pb.send(dockerApiPath(serverId, '/networks'), {
        method: 'POST',
        body: { name: newName.trim() },
      })
      setNewName('')
      setCreateDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to create network'))
    }
  }

  const loadError = error ? getApiErrorMessage(error, 'Failed to load networks') : null

  const filtered = useMemo(() => {
    return networks.filter(network => {
      if (!network.Name?.toLowerCase().includes(filter.toLowerCase())) return false
      if (driverFilter !== 'all' && (network.Driver || '-') !== driverFilter) return false
      if (scopeFilter !== 'all' && (network.Scope || '-') !== scopeFilter) return false
      if (typeFilter === 'system' && !isSystemNetwork(network)) return false
      if (typeFilter === 'user' && isSystemNetwork(network)) return false
      return true
    })
  }, [driverFilter, filter, networks, scopeFilter, typeFilter])

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
  }, [filtered, sortDir, sortKey])

  const totalPages = Math.max(1, Math.ceil(sorted.length / effectivePageSize))

  const paged = useMemo(() => {
    const start = (effectivePage - 1) * effectivePageSize
    return sorted.slice(start, start + effectivePageSize)
  }, [effectivePage, effectivePageSize, sorted])

  useEffect(() => {
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverFilter, filter, scopeFilter, sortDir, sortKey, effectivePageSize, serverId, typeFilter])

  useEffect(() => {
    if (effectivePage > totalPages) setPage(totalPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePage, totalPages])

  useEffect(() => {
    onSummaryChange?.({ totalItems: sorted.length, totalPages })
  }, [onSummaryChange, sorted.length, totalPages])

  const toggleSort = (key: 'name') => {
    if (sortKey === key) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: 'name' }) => (
    <button
      type="button"
      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
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

  const toggleNetworkExpansion = (networkId: string) => {
    setExpandedNetworkId(current => {
      const next = current === networkId ? null : networkId
      if (next === networkId) void loadNetworkInspect(networkId)
      return next
    })
  }

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col gap-4',
        embeddedInWorkspace ? 'pt-0' : 'pt-4'
      )}
    >
      {(loadError || actionError) && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{loadError || actionError}</AlertDescription>
        </Alert>
      )}

      {!embeddedInWorkspace && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-lg border bg-muted/20 px-3 py-3">
          <input
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Search networks"
            className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
          />
          <span className="text-xs text-muted-foreground">{sorted.length} total</span>
          <div className="flex items-center gap-0.5 text-xs">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => setPage(Math.max(1, effectivePage - 1))}
              disabled={effectivePage <= 1}
              aria-label="Previous networks page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-center font-medium tabular-nums">{effectivePage}/{totalPages}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => setPage(Math.min(totalPages, effectivePage + 1))}
              disabled={effectivePage >= totalPages}
              aria-label="Next networks page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => setCreateDialogOpen(true)}
            title="Create network"
          >
            <Plus className="mr-1 h-4 w-4" /> Create
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Networks display settings"
                title="Networks display settings"
              >
                <ArrowUpDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuRadioGroup
                value={String(effectivePageSize)}
                onValueChange={value => setPageSize(Number(value) as 25 | 50 | 100)}
              >
                <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-background">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
              <TableRow>
                <TableHead className="min-w-[240px] pl-4 pr-2">
                  <div className="flex items-center">
                    <SortHead label="Name" keyName="name" />
                  </div>
                </TableHead>
                <TableHead className="min-w-[120px] text-xs font-medium text-foreground">ID</TableHead>
                <TableHead className="min-w-[160px]">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-foreground">Driver</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Filter network driver"
                          title={driverFilter === 'all' ? 'Filter network driver' : `Network driver: ${driverFilter}`}
                        >
                          <Filter
                            className={cn(
                              'h-3.5 w-3.5',
                              driverFilter !== 'all' && 'text-foreground'
                            )}
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuRadioGroup value={driverFilter} onValueChange={setDriverFilter}>
                          <DropdownMenuRadioItem value="all">
                            All drivers ({networks.length})
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
                <TableHead className="min-w-[140px]">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-foreground">Type</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Filter network type"
                          title={typeFilter === 'all' ? 'Filter network type' : `Network type: ${typeFilter}`}
                        >
                          <Filter className={cn('h-3.5 w-3.5', typeFilter !== 'all' && 'text-foreground')} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuRadioGroup
                          value={typeFilter}
                          onValueChange={value => setTypeFilter(value as 'all' | 'system' | 'user')}
                        >
                          <DropdownMenuRadioItem value="all">All types ({typeCounts.all})</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="system">System ({typeCounts.system})</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="user">User ({typeCounts.user})</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead className="min-w-[140px]">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-foreground">Scope</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Filter network scope"
                          title={scopeFilter === 'all' ? 'Filter network scope' : `Network scope: ${scopeFilter}`}
                        >
                          <Filter
                            className={cn(
                              'h-3.5 w-3.5',
                              scopeFilter !== 'all' && 'text-foreground'
                            )}
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuRadioGroup value={scopeFilter} onValueChange={setScopeFilter}>
                          <DropdownMenuRadioItem value="all">
                            All scopes ({networks.length})
                          </DropdownMenuRadioItem>
                          {scopeCounts.map(([scope, count]) => (
                            <DropdownMenuRadioItem key={scope} value={scope}>
                              {scope} ({count})
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead className="w-[52px] text-center text-xs font-medium text-foreground">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {paged.map(network => {
                const isExpanded = expandedNetworkId === network.ID
                return (
                  <Fragment key={network.ID}>
                    <TableRow className={cn('border-b border-border/60 align-top transition-colors hover:bg-muted/30', isExpanded && 'bg-muted/20')}>
                      <TableCell
                        className="cursor-pointer pl-4 pr-3 py-3 text-left text-xs"
                        onClick={event => {
                          const target = event.target as HTMLElement
                          if (target.closest('button')) return
                          toggleNetworkExpansion(network.ID)
                        }}
                      >
                        <button
                          type="button"
                          className="min-w-0 truncate text-left text-xs font-medium leading-tight text-foreground hover:underline"
                          title={network.Name}
                          onClick={() => toggleNetworkExpansion(network.ID)}
                        >
                          {network.Name}
                        </button>
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs" title={network.ID}>
                        {network.ID?.substring(0, 12)}
                      </TableCell>
                      <TableCell className="py-3 text-xs">{network.Driver}</TableCell>
                      <TableCell className="py-3 text-xs">
                        {isSystemNetwork(network) ? (
                          <Badge variant="secondary" className="text-[11px] font-medium">
                            System
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[11px] font-medium">
                            User
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-3 text-xs">{network.Scope}</TableCell>
                      <TableCell className="py-3 text-center align-middle">
                        {isSystemNetwork(network) ? (
                          <span className="inline-flex h-7 w-7 items-center justify-center text-xs text-muted-foreground">-</span>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => setTimeout(() => setPendingDelete(network), 0)}
                                className="text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20 px-0 py-3">
                          {inspectLoadingMap[network.ID] ? (
                            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading inspect...
                            </div>
                          ) : (
                            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                              {inspectMap[network.ID] || '(empty output)'}
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
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No networks found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create network</DialogTitle>
            <DialogDescription>
              Enter a network name to create a new Docker network.
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            placeholder="Network name"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={newName}
            onChange={event => setNewName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void createNetwork()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createNetwork()} disabled={!newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={open => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove network?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `This will remove the network \"${pendingDelete.Name}\". Containers still attached to it may block the operation.`
                : 'This will remove the selected network.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingNetworkId === pendingDelete?.ID}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!pendingDelete || removingNetworkId === pendingDelete.ID}
              onClick={event => {
                event.preventDefault()
                if (!pendingDelete) return
                void removeNetwork(pendingDelete.ID)
              }}
            >
              {removingNetworkId === pendingDelete?.ID ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})
