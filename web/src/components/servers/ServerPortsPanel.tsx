import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClientResponseError } from 'pocketbase'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  MoreVertical,
  RotateCw,
} from 'lucide-react'

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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  listServerPorts,
  releaseServerPort,
  type ServerPortItem,
  type ServerPortListener,
  type ServerPortProtocol,
  type ServerPortProtocolFilter,
  type ServerPortReservationSource,
} from '@/lib/connect-api'
import { getApiErrorMessage, isRequestCancellation } from '@/lib/api-error'
import { cn } from '@/lib/utils'

type PortRow = ServerPortItem & { protocol: ServerPortProtocol }
type PortsSortColumn = 'port' | 'status' | 'protocol' | 'process'
type PortsSortDirection = 'asc' | 'desc'
type PortStatusFilter = 'all' | 'occupied' | 'reserved'

const PAGE_SIZE = 20
const PORTS_INVENTORY_GRID_CLASS = 'grid-cols-[4.5rem_5rem_4.75rem_5.25rem_minmax(0,1fr)_2rem]'

function getPortStatusLabel(row: ServerPortItem) {
  if (row.occupancy?.occupied) return 'Occupied'
  if (row.reservation?.reserved) return 'Reserved'
  return 'Available'
}

function getPortProcessLabel(row: ServerPortItem) {
  return row.occupancy?.process?.name || row.occupancy?.listeners?.[0]?.process?.name || '—'
}

function getPortPidLabel(row: ServerPortItem) {
  const pidList = row.occupancy?.pids || row.occupancy?.listeners?.[0]?.pids || []
  if (pidList.length) return pidList.join(', ')
  const pid = row.occupancy?.process?.pid || row.occupancy?.listeners?.[0]?.process?.pid
  return pid ? String(pid) : '—'
}

function getPortSourceLabel(row: ServerPortItem) {
  const sources = row.reservation?.sources || []
  if (!sources.length) return '—'
  return sources.map(source => source.type).join(', ')
}

function getPortRowKey(row: Pick<PortRow, 'port' | 'protocol'>) {
  return `${row.protocol}:${row.port}`
}

function matchesQuery(row: PortRow, query: string) {
  if (!query) return true
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const listenerText = (row.occupancy?.listeners || [])
    .map(listener =>
      [
        listener.local_address,
        listener.peer_address,
        listener.raw,
        listener.process?.name || '',
      ].join(' ')
    )
    .join(' ')
    .toLowerCase()

  return (
    String(row.port).includes(normalized) ||
    row.protocol.toLowerCase().includes(normalized) ||
    getPortProcessLabel(row).toLowerCase().includes(normalized) ||
    getPortSourceLabel(row).toLowerCase().includes(normalized) ||
    listenerText.includes(normalized)
  )
}

function matchesStatus(row: PortRow, filter: PortStatusFilter) {
  if (filter === 'all') return true
  if (filter === 'occupied') return !!row.occupancy?.occupied
  return !!row.reservation?.reserved
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function compareRows(
  left: PortRow,
  right: PortRow,
  sortBy: PortsSortColumn,
  sortDirection: PortsSortDirection
) {
  let result = 0
  if (sortBy === 'status') {
    result = compareText(getPortStatusLabel(left), getPortStatusLabel(right))
  } else if (sortBy === 'protocol') {
    result = compareText(left.protocol, right.protocol)
  } else if (sortBy === 'process') {
    result = compareText(getPortProcessLabel(left), getPortProcessLabel(right))
  } else {
    result = left.port - right.port
  }

  if (result === 0) {
    result = left.port - right.port || compareText(left.protocol, right.protocol)
  }

  return sortDirection === 'desc' ? result * -1 : result
}

export function ServerPortsPanel({ serverId }: { serverId: string }) {
  const requestSeqRef = useRef(0)
  const [protocol, setProtocol] = useState<ServerPortProtocolFilter>('all')
  const [rows, setRows] = useState<PortRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<PortStatusFilter>('all')
  const [sortBy, setSortBy] = useState<PortsSortColumn>('port')
  const [sortDirection, setSortDirection] = useState<PortsSortDirection>('asc')
  const [page, setPage] = useState(1)
  const [selectedPortKey, setSelectedPortKey] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [releaseSubmitting, setReleaseSubmitting] = useState(false)
  const [releasingTarget, setReleasingTarget] = useState<Pick<PortRow, 'port' | 'protocol'> | null>(
    null
  )
  const [releaseForce, setReleaseForce] = useState(false)

  const loadPorts = useCallback(async () => {
    if (!serverId) return
    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    setLoading(true)
    setError('')
    try {
      const response = await listServerPorts(serverId, 'all', protocol)
      if (requestSeqRef.current !== requestSeq) return
      const nextRows = (Array.isArray(response.ports) ? response.ports : []).map(row => ({
        ...row,
        protocol: row.protocol || (response.protocol === 'all' ? 'tcp' : response.protocol),
      }))
      if (requestSeqRef.current !== requestSeq) return
      setRows(nextRows)
    } catch (loadError) {
      if (requestSeqRef.current !== requestSeq || isRequestCancellation(loadError)) return
      setError(getApiErrorMessage(loadError, 'Failed to load ports'))
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setLoading(false)
      }
    }
  }, [protocol, serverId])

  useEffect(() => {
    void loadPorts()
  }, [loadPorts])

  useEffect(() => {
    setPage(1)
  }, [protocol, query, statusFilter])

  const searchMatchedRows = useMemo(
    () => rows.filter(row => matchesQuery(row, query)),
    [query, rows]
  )

  const filteredRows = useMemo(() => {
    return [...searchMatchedRows]
      .filter(row => matchesStatus(row, statusFilter))
      .sort((left, right) => compareRows(left, right, sortBy, sortDirection))
  }, [searchMatchedRows, sortBy, sortDirection, statusFilter])

  const filterCounts = useMemo(() => {
    let occupied = 0
    let reserved = 0

    for (const row of searchMatchedRows) {
      if (row.occupancy?.occupied) occupied += 1
      if (row.reservation?.reserved) reserved += 1
    }

    return {
      all: searchMatchedRows.length,
      occupied,
      reserved,
    }
  }, [searchMatchedRows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredRows.slice(start, start + PAGE_SIZE)
  }, [currentPage, filteredRows])

  const selectedRow = useMemo(
    () => filteredRows.find(row => getPortRowKey(row) === selectedPortKey) ?? null,
    [filteredRows, selectedPortKey]
  )

  useEffect(() => {
    if (
      selectedPortKey != null &&
      !filteredRows.some(row => getPortRowKey(row) === selectedPortKey)
    ) {
      setSelectedPortKey(null)
    }
  }, [filteredRows, selectedPortKey])

  const requestReleaseOccupiedPort = useCallback((row: Pick<PortRow, 'port' | 'protocol'>) => {
    setReleasingTarget(row)
    setReleaseForce(false)
    setConfirmOpen(true)
    setError('')
    setHint('')
  }, [])

  const releaseOccupiedPort = useCallback(
    async (target: Pick<PortRow, 'port' | 'protocol'>) => {
      setConfirmOpen(false)
      setReleaseSubmitting(true)
      setReleasingTarget(target)
      setError('')
      setHint('')
      try {
        const mode = releaseForce ? 'force' : 'graceful'
        const result = await releaseServerPort(serverId, target.port, target.protocol, mode)
        if (!result.released) {
          setError(
            `Port ${target.port}/${target.protocol.toUpperCase()} is still occupied after ${mode} release.`
          )
        } else {
          setHint(
            `Port ${target.port}/${target.protocol.toUpperCase()} released by ${result.action_taken}.`
          )
        }
        await loadPorts()
      } catch (releaseError) {
        if (releaseError instanceof ClientResponseError && releaseError.status === 409) {
          const forceHint = !releaseForce ? ' Try enabling force mode.' : ''
          setError(
            `Port ${target.port}/${target.protocol.toUpperCase()} is still occupied after release.${forceHint}`
          )
          await loadPorts()
        } else {
          setError(releaseError instanceof Error ? releaseError.message : 'Failed to release port')
        }
      } finally {
        setReleaseSubmitting(false)
        setReleaseForce(false)
        setReleasingTarget(null)
      }
    },
    [loadPorts, releaseForce, serverId]
  )

  const summary = useMemo(() => {
    let occupied = 0
    let reserved = 0
    for (const row of filteredRows) {
      if (row.occupancy?.occupied) occupied += 1
      if (row.reservation?.reserved) reserved += 1
    }
    return { occupied, reserved, total: filteredRows.length }
  }, [filteredRows])

  const toggleSort = useCallback((column: PortsSortColumn) => {
    setSortBy(current => {
      if (current === column) {
        setSortDirection(direction => (direction === 'asc' ? 'desc' : 'asc'))
        return current
      }
      setSortDirection('asc')
      return column
    })
  }, [])

  const renderSortIcon = useCallback(
    (column: PortsSortColumn) => {
      if (sortBy !== column) {
        return <ArrowUpDown className="h-3.5 w-3.5" />
      }
      return sortDirection === 'asc' ? (
        <ArrowUp className="h-3.5 w-3.5" />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" />
      )
    },
    [sortBy, sortDirection]
  )

  const selectedListeners = selectedRow?.occupancy?.listeners || []
  const selectedSources = selectedRow?.reservation?.sources || []

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Ports</h2>
            <p className="text-sm text-muted-foreground">
              Review occupied and reserved ports, inspect ownership, and release active listeners
              when needed.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => void loadPorts()}
              disabled={loading || releaseSubmitting}
              aria-label="Refresh ports data"
            >
              <RotateCw
                className={cn('h-4 w-4', (loading || releaseSubmitting) && 'animate-spin')}
              />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-4 rounded-md border p-4" aria-label="Port inventory">
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-center gap-3 whitespace-nowrap">
              <span className="text-sm text-muted-foreground">
                Total {summary.total} ports, {summary.occupied} occupied, {summary.reserved}{' '}
                reserved.
              </span>
              <div className="ml-auto flex items-center gap-2">
                <select
                  aria-label="Port protocol"
                  value={protocol}
                  onChange={event => setProtocol(event.target.value as ServerPortProtocolFilter)}
                  className="h-8 w-28 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="all">All Protocol</option>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search"
                  className="h-8 w-[clamp(6ch,15vw,15ch)] min-w-0 rounded-md border bg-background px-2 text-sm"
                />
                <select
                  aria-label="Status filter"
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.target.value as PortStatusFilter)}
                  className="h-8 w-36 shrink-0 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="all">All status ({filterCounts.all})</option>
                  <option value="occupied">Occupied ({filterCounts.occupied})</option>
                  <option value="reserved">Reserved ({filterCounts.reserved})</option>
                </select>
                <div className="flex items-center gap-0.5 text-sm text-muted-foreground">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                  >
                    {'<'}
                  </Button>
                  <span className="px-1 text-center font-medium text-foreground">
                    {currentPage}/{totalPages}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                  >
                    {'>'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div
              className={cn(
                'grid gap-2 px-3 py-2 text-sm font-medium text-muted-foreground',
                PORTS_INVENTORY_GRID_CLASS
              )}
            >
              <button
                type="button"
                onClick={() => toggleSort('port')}
                className="inline-flex items-center gap-1 py-1 text-left transition-colors hover:text-foreground"
                aria-label={`Port ${sortBy === 'port' ? `sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : 'sortable'}`}
              >
                <span>Port</span>
                {renderSortIcon('port')}
              </button>
              <button
                type="button"
                onClick={() => toggleSort('status')}
                className="inline-flex items-center gap-1 py-1 text-left transition-colors hover:text-foreground"
                aria-label={`Status ${sortBy === 'status' ? `sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : 'sortable'}`}
              >
                <span>Status</span>
                {renderSortIcon('status')}
              </button>
              <button
                type="button"
                onClick={() => toggleSort('protocol')}
                className="inline-flex items-center gap-1 py-1 text-left transition-colors hover:text-foreground"
                aria-label={`Protocol ${sortBy === 'protocol' ? `sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : 'sortable'}`}
              >
                <span>Protocol</span>
                {renderSortIcon('protocol')}
              </button>
              <span className="py-1 text-left">PIDs</span>
              <button
                type="button"
                onClick={() => toggleSort('process')}
                className="inline-flex items-center gap-1 py-1 text-left transition-colors hover:text-foreground"
                aria-label={`Process ${sortBy === 'process' ? `sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : 'sortable'}`}
              >
                <span>Process</span>
                {renderSortIcon('process')}
              </button>
              <span className="py-1 text-center">Actions</span>
            </div>

            {error ? <div className="px-3 py-2 text-sm text-destructive">{error}</div> : null}

            {loading ? (
              <div className="inline-flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading ports...
              </div>
            ) : pagedRows.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                No ports match the current filters.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {pagedRows.map(row => {
                  const portLabel = String(row.port)
                  const rowKey = getPortRowKey(row)
                  const occupied = !!row.occupancy?.occupied
                  return (
                    <div
                      key={rowKey}
                      className={cn(
                        'grid items-center gap-2 px-3 py-1.5 text-sm',
                        PORTS_INVENTORY_GRID_CLASS,
                        selectedPortKey === rowKey && 'bg-accent/40'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPortKey(rowKey)}
                        className="min-w-0 text-left"
                        aria-label={`${portLabel}/${row.protocol.toUpperCase()}`}
                      >
                        <span className="block truncate font-medium leading-5">{portLabel}</span>
                      </button>
                      <span
                        className={cn(
                          'truncate py-1 text-left',
                          occupied
                            ? 'text-emerald-600'
                            : row.reservation?.reserved
                              ? 'text-amber-600'
                              : 'text-muted-foreground'
                        )}
                      >
                        {getPortStatusLabel(row)}
                      </span>
                      <span className="truncate py-1 text-left text-muted-foreground">
                        {row.protocol.toUpperCase()}
                      </span>
                      <span className="truncate py-1 text-left text-muted-foreground">
                        {getPortPidLabel(row)}
                      </span>
                      <span className="truncate py-1 text-left text-muted-foreground">
                        {getPortProcessLabel(row)}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 justify-self-center p-0"
                            disabled={loading || releaseSubmitting}
                            aria-label={`Port actions for ${portLabel}/${row.protocol.toUpperCase()}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedPortKey(rowKey)}>
                            Open details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!occupied}
                            onClick={() => requestReleaseOccupiedPort(row)}
                          >
                            Release port
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section
          className="max-h-[calc(100vh-50px)] self-start overflow-auto space-y-4 rounded-md border p-4"
          aria-labelledby="selected-port-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="selected-port-heading" className="text-sm font-semibold">
                Selected Port
              </h3>
              <p className="text-xs text-muted-foreground">
                {selectedRow
                  ? `Port ${selectedRow.port}/${selectedRow.protocol.toUpperCase()}`
                  : 'Select one port from the inventory.'}
              </p>
            </div>
            {selectedRow ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!selectedRow.occupancy?.occupied || loading || releaseSubmitting}
                  onClick={() => requestReleaseOccupiedPort(selectedRow)}
                >
                  Release
                </Button>
              </div>
            ) : null}
          </div>

          {!selectedRow ? (
            <div className="text-sm text-muted-foreground">
              Choose a port to inspect occupancy, reservation sources, and release options.
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Port:</span>
                  <span className="break-words text-muted-foreground">{selectedRow.port}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Protocol:</span>
                  <span className="break-words text-muted-foreground">
                    {selectedRow.protocol.toUpperCase()}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Status:</span>
                  <span className="break-words text-muted-foreground">
                    {getPortStatusLabel(selectedRow)}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Process:</span>
                  <span className="break-words text-muted-foreground">
                    {getPortProcessLabel(selectedRow)}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">PIDs:</span>
                  <span className="break-words text-muted-foreground">
                    {getPortPidLabel(selectedRow)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">Listeners</div>
                {selectedListeners.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No listener details.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedListeners.map((listener: ServerPortListener, index) => (
                      <div
                        key={`${listener.local_address}-${listener.peer_address}-${index}`}
                        className="rounded-md border px-3 py-2"
                      >
                        <div className="text-sm text-foreground">
                          {listener.local_address || '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {listener.state || 'unknown'}
                          {listener.peer_address ? ` · ${listener.peer_address}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">Reservation Sources</div>
                {selectedSources.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No reservation sources.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedSources.map((source: ServerPortReservationSource, index) => (
                      <div key={`${source.type}-${index}`} className="rounded-md border px-3 py-2">
                        <div className="text-sm text-foreground">{source.type}</div>
                        <div className="text-xs text-muted-foreground">
                          Confidence: {source.confidence}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {hint ? <div className="text-sm text-emerald-600">{hint}</div> : null}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={open => {
          if (releaseSubmitting) return
          setConfirmOpen(open)
          if (!open) {
            setReleasingTarget(null)
            setReleaseForce(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Release port{' '}
              {releasingTarget
                ? `${releasingTarget.port}/${releasingTarget.protocol.toUpperCase()}`
                : '-'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This operation stops the current owner of this port. Use with caution.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={releaseForce}
                disabled={releaseSubmitting}
                onCheckedChange={checked => setReleaseForce(checked === true)}
              />
              <span>
                Force release (non-graceful). This may terminate processes or containers
                immediately.
              </span>
            </label>

            {releaseForce ? (
              <div className="inline-flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <span>
                  Dangerous operation: force mode may cause service interruption or data loss.
                </span>
              </div>
            ) : null}

            {releaseSubmitting ? (
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Releasing port owner... please wait.
              </div>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={releaseSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={releaseSubmitting || releasingTarget == null}
              onClick={() => {
                if (releasingTarget == null) return
                void releaseOccupiedPort(releasingTarget)
              }}
            >
              {releaseSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Releasing...
                </>
              ) : (
                'Confirm Release'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
