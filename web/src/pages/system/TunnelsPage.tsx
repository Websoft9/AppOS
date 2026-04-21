import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUpRight,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  MoreVertical,
  Plus,
  PlugZap,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react'
import { DismissibleAlert } from '@/components/ui/dismissible-alert'
import { pb } from '@/lib/pb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TunnelSetupWizard } from '@/components/servers/TunnelSetupWizard'

import type {
  TunnelItem,
  TunnelForward,
  TunnelLogItem,
  TunnelOverviewResponse,
  StatusFilter,
  SortField,
  SortDir,
  TunnelsPageQueryState,
  ConfirmTarget,
  LogState,
  PendingStatusKind,
} from './tunnel-types'
import { PAGE_SIZE_OPTIONS, DEFAULT_QUERY_STATE } from './tunnel-types'
export type { TunnelsPageQueryState } from './tunnel-types'
import {
  normalizeTunnelOverviewResponse,
  normalizeTunnelForwardsResponse,
  normalizeTunnelLogsResponse,
  formatDateTime,
  formatDisconnectReason,
  formatLogReason,
  formatLastConnected,
  formatCreated,
  formatSessionDuration,
  formatEffectiveMapping,
  infoValue,
  resolvedStatus,
  statusTone,
} from './tunnel-utils'

function statusBadge(item: TunnelItem, pendingStatus?: PendingStatusKind) {
  const status = resolvedStatus(item, pendingStatus)

  if (status === 'online') {
    return <Badge variant="default">Online</Badge>
  }
  if (status === 'paused') {
    return <Badge variant="outline">Paused</Badge>
  }
  if (status === 'waiting') {
    return <Badge variant="outline">Waiting</Badge>
  }
  if (status === 'restarting') {
    return <Badge variant="outline">Restarting</Badge>
  }
  if (status === 'reconnecting') {
    return <Badge variant="outline">Reconnecting</Badge>
  }
  return <Badge variant="secondary">Offline</Badge>
}

function SortableHeader({
  label,
  field,
  activeField,
  dir,
  onToggle,
}: {
  label: string
  field: SortField
  activeField: SortField
  dir: SortDir
  onToggle: (field: SortField) => void
}) {
  const isActive = activeField === field

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 hover:text-foreground"
      onClick={() => onToggle(field)}
    >
      <span>{label}</span>
      {isActive ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />
      )}
    </button>
  )
}

function DetailItem({
  label,
  value,
  children,
  className = '',
}: {
  label: string
  value?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-md border bg-background px-3 py-2 ${className}`.trim()}>
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words leading-6 text-foreground">{children ?? value ?? '—'}</div>
    </div>
  )
}

export function TunnelsPage({
  queryState,
  onQueryStateChange,
  onOpenServerDetail,
}: {
  queryState?: TunnelsPageQueryState
  onQueryStateChange?: (patch: Partial<TunnelsPageQueryState>) => void
  onOpenServerDetail?: (serverId: string) => void
}) {
  const [data, setData] = useState<TunnelOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [wizardServerId, setWizardServerId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [pauseTarget, setPauseTarget] = useState<TunnelItem | null>(null)
  const [pauseMinutes, setPauseMinutes] = useState('10')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [logsTarget, _setLogsTarget] = useState<TunnelItem | null>(null)
  const [logsById, setLogsById] = useState<Record<string, LogState>>({})
  const [portForwardTarget, _setPortForwardTarget] = useState<TunnelItem | null>(null)
  const [forwardDraft, setForwardDraft] = useState<TunnelForward[]>([])
  const [forwardsLoading, setForwardsLoading] = useState(false)
  const [forwardsSaving, setForwardsSaving] = useState(false)
  const [forwardsError, setForwardsError] = useState('')
  const [forwardsMessage, setForwardsMessage] = useState('')
  const [showStats, setShowStats] = useState(false)
  const [localQueryState, setLocalQueryState] = useState<TunnelsPageQueryState>(DEFAULT_QUERY_STATE)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transientStatusTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [pendingStatusById, setPendingStatusById] = useState<Record<string, PendingStatusKind>>({})
  const logsTargetRef = useRef<TunnelItem | null>(null)
  const portForwardTargetRef = useRef<TunnelItem | null>(null)

  function setLogsTarget(v: TunnelItem | null) {
    _setLogsTarget(v)
    logsTargetRef.current = v
  }

  function setPortForwardTarget(v: TunnelItem | null) {
    _setPortForwardTarget(v)
    portForwardTargetRef.current = v
  }

  const currentQueryState = queryState ?? localQueryState
  const search = currentQueryState.q
  const statusFilter = currentQueryState.status
  const sortField = currentQueryState.sort
  const sortDir = currentQueryState.dir
  const page = currentQueryState.page
  const pageSize = currentQueryState.pageSize

  function updateQueryState(patch: Partial<TunnelsPageQueryState>) {
    if (onQueryStateChange) {
      onQueryStateChange(patch)
      return
    }
    setLocalQueryState(prev => ({ ...prev, ...patch }))
  }

  async function loadOverview(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true)
    }
    setError('')
    try {
      const res = await pb.send<TunnelOverviewResponse>('/api/tunnel/overview', { method: 'GET' })
      const normalized = normalizeTunnelOverviewResponse(res)
      setData(normalized)
      setPendingStatusById(current => {
        const next = { ...current }
        const itemsById = new Map(normalized.items.map(item => [item.id, item]))

        for (const [serverId, pendingStatus] of Object.entries(current)) {
          const item = itemsById.get(serverId)
          if (!item) {
            delete next[serverId]
            continue
          }
          if (pendingStatus === 'restarting' && item.status !== 'online') {
            delete next[serverId]
            continue
          }
          if (
            pendingStatus === 'reconnecting' &&
            (item.status === 'online' || item.is_paused || item.status === 'paused')
          ) {
            delete next[serverId]
          }
        }

        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tunnel overview')
    } finally {
      if (!options?.silent) {
        setLoading(false)
      }
    }
  }

  async function loadForwards(serverId: string) {
    setForwardsLoading(true)
    setForwardsError('')
    try {
      const res = await pb.send<{ forwards?: TunnelForward[] }>(
        `/api/tunnel/servers/${serverId}/forwards`,
        {
          method: 'GET',
        }
      )
      setForwardDraft(normalizeTunnelForwardsResponse(res))
    } catch (err) {
      setForwardsError(err instanceof Error ? err.message : 'Failed to load desired forwards')
    } finally {
      setForwardsLoading(false)
    }
  }

  async function loadLogs(serverId: string, options?: { silent?: boolean }) {
    setLogsById(current => ({
      ...current,
      [serverId]: {
        loading: !options?.silent,
        error: '',
        items: current[serverId]?.items ?? [],
      },
    }))
    try {
      const res = await pb.send<{ items?: TunnelLogItem[] }>(
        `/api/tunnel/servers/${serverId}/logs`,
        {
          method: 'GET',
        }
      )
      setLogsById(current => ({
        ...current,
        [serverId]: {
          loading: false,
          error: '',
          items: normalizeTunnelLogsResponse(res),
        },
      }))
    } catch (err) {
      setLogsById(current => ({
        ...current,
        [serverId]: {
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load connection logs',
          items: current[serverId]?.items ?? [],
        },
      }))
    }
  }

  function toggleExpanded(item: TunnelItem) {
    setNotice('')
    setError('')
    setExpandedId(current => (current === item.id ? null : item.id))
  }

  function openPortForwardSheet(item: TunnelItem) {
    setPortForwardTarget(item)
    setForwardDraft([])
    setForwardsError('')
    setForwardsMessage('')
    void loadForwards(item.id)
  }

  function openLogsSheet(item: TunnelItem) {
    setLogsTarget(item)
    void loadLogs(item.id)
  }

  function setPendingStatus(serverId: string, status: PendingStatusKind, ttlMs = 45000) {
    const existingTimer = transientStatusTimersRef.current[serverId]
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    setPendingStatusById(current => ({ ...current, [serverId]: status }))
    transientStatusTimersRef.current[serverId] = setTimeout(() => {
      setPendingStatusById(current => {
        const next = { ...current }
        delete next[serverId]
        return next
      })
      delete transientStatusTimersRef.current[serverId]
    }, ttlMs)
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    pb.collection('servers')
      .subscribe('*', event => {
        const record = event.record as Record<string, unknown>
        if (record.connect_type !== 'tunnel') {
          return
        }

        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current)
        }
        refreshTimerRef.current = setTimeout(() => {
          void loadOverview({ silent: true })
          const pft = portForwardTargetRef.current
          if (pft && record.id === pft.id) {
            void loadForwards(pft.id)
          }
          const lt = logsTargetRef.current
          if (lt && record.id === lt.id) {
            void loadLogs(lt.id, { silent: true })
          }
        }, 250)
      })
      .then(fn => {
        unsubscribe = fn
      })
      .catch(() => {
        /* realtime unavailable */
      })

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
      unsubscribe?.()
      pb.collection('servers')
        .unsubscribe('*')
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (Object.keys(pendingStatusById).length === 0) {
      return
    }

    const interval = setInterval(() => {
      void loadOverview({ silent: true })
    }, 3000)

    return () => clearInterval(interval)
  }, [pendingStatusById])

  useEffect(() => {
    return () => {
      Object.values(transientStatusTimersRef.current).forEach(timer => clearTimeout(timer))
    }
  }, [])

  useEffect(() => {
    if (page !== 1) {
      updateQueryState({ page: 1 })
    }
  }, [search, statusFilter, pageSize])

  async function handleCheckStatus(item: TunnelItem) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      await pb.send(`/api/tunnel/servers/${item.id}/status`, { method: 'GET' })
      await loadOverview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check tunnel status')
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirmAction() {
    if (!confirmTarget) return
    setBusyId(confirmTarget.item.id)
    setError('')
    setNotice('')
    try {
      if (confirmTarget.action === 'disconnect') {
        await pb.send(`/api/tunnel/servers/${confirmTarget.item.id}/disconnect`, { method: 'POST' })
        setPendingStatus(confirmTarget.item.id, 'restarting', 20000)
        setNotice('Tunnel connection restart requested.')
      } else if (confirmTarget.action === 'resume') {
        await pb.send(`/api/tunnel/servers/${confirmTarget.item.id}/resume`, { method: 'POST' })
        setPendingStatus(confirmTarget.item.id, 'reconnecting')
        setNotice('Resume sent. Waiting for reconnect.')
      } else {
        await pb.send(`/api/tunnel/servers/${confirmTarget.item.id}/token?rotate=true`, {
          method: 'POST',
        })
        setWizardServerId(confirmTarget.item.id)
        setNotice('Tunnel token rotated.')
      }
      setConfirmTarget(null)
      await loadOverview()
      if (logsTarget?.id === confirmTarget.item.id) {
        await loadLogs(confirmTarget.item.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tunnel action failed')
    } finally {
      setBusyId(null)
    }
  }

  async function handlePauseSubmit() {
    if (!pauseTarget) return
    const minutes = Number(pauseMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError('Pause minutes must be a positive number.')
      return
    }

    setBusyId(pauseTarget.id)
    setError('')
    setNotice('')
    try {
      await pb.send(`/api/tunnel/servers/${pauseTarget.id}/pause`, {
        method: 'POST',
        body: { minutes },
      })
      setPauseTarget(null)
      setPauseMinutes('10')
      setPendingStatusById(current => {
        const next = { ...current }
        delete next[pauseTarget.id]
        return next
      })
      setNotice('Tunnel connect paused.')
      await loadOverview()
      if (logsTarget?.id === pauseTarget.id) {
        await loadLogs(pauseTarget.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause tunnel connect')
    } finally {
      setBusyId(null)
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      updateQueryState({ dir: sortDir === 'asc' ? 'desc' : 'asc' })
      return
    }
    updateQueryState({
      sort: field,
      dir: field === 'name' || field === 'status' || field === 'remote_addr' ? 'asc' : 'desc',
    })
  }

  const items = data?.items ?? []

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()

    const filtered = items.filter(item => {
      if (statusFilter === 'online' && item.status !== 'online') {
        return false
      }
      if (
        statusFilter === 'offline' &&
        (item.status === 'online' || item.waiting_for_first_connect || item.is_paused)
      ) {
        return false
      }
      if (statusFilter === 'paused' && !item.is_paused && item.status !== 'paused') {
        return false
      }
      if (statusFilter === 'waiting' && !item.waiting_for_first_connect) {
        return false
      }
      if (!query) {
        return true
      }

      const searchable = [
        item.name,
        item.description,
        item.remote_addr,
        item.disconnect_reason_label,
        item.disconnect_reason,
        item.pause_until,
        ...item.group_names,
        ...item.services.map(service => `${service.service_name}:${service.tunnel_port}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchable.includes(query)
    })

    return [...filtered].sort((left, right) => {
      const leftStatus = left.waiting_for_first_connect ? 'waiting' : left.status
      const rightStatus = right.waiting_for_first_connect ? 'waiting' : right.status

      let comparison = 0
      if (sortField === 'name') {
        comparison = left.name.localeCompare(right.name)
      } else if (sortField === 'status') {
        comparison = leftStatus.localeCompare(rightStatus)
      } else if (sortField === 'connected_at') {
        comparison = (left.connected_at ?? '').localeCompare(right.connected_at ?? '')
      } else if (sortField === 'remote_addr') {
        comparison = (left.remote_addr ?? '').localeCompare(right.remote_addr ?? '')
      }

      return sortDir === 'asc' ? comparison : -comparison
    })
  }, [items, search, sortDir, sortField, statusFilter])

  const overallSummary = useMemo(() => {
    return items.reduce(
      (summary, item) => {
        summary.total += 1
        if (item.status === 'online') {
          summary.online += 1
        } else if (item.is_paused || item.status === 'paused') {
          summary.paused += 1
        } else if (item.waiting_for_first_connect) {
          summary.waiting += 1
        } else {
          summary.offline += 1
        }
        return summary
      },
      { total: 0, online: 0, offline: 0, paused: 0, waiting: 0 }
    )
  }, [items])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const safePage = Math.min(page, totalPages)

  useEffect(() => {
    if (safePage !== page) {
      updateQueryState({ page: safePage })
    }
  }, [page, safePage])

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredItems.slice(start, start + pageSize)
  }, [filteredItems, pageSize, safePage])

  async function handleSaveForwards() {
    if (!portForwardTarget) return
    setForwardsSaving(true)
    setForwardsError('')
    setForwardsMessage('')
    try {
      await pb.send(`/api/tunnel/servers/${portForwardTarget.id}/forwards`, {
        method: 'PUT',
        body: { forwards: forwardDraft },
      })
      setForwardsMessage('Saved. Applies on next reconnect or regenerated setup.')
      await loadForwards(portForwardTarget.id)
      await loadOverview({ silent: true })
    } catch (err) {
      setForwardsError(err instanceof Error ? err.message : 'Failed to save desired forwards')
    } finally {
      setForwardsSaving(false)
    }
  }

  function updateForward(index: number, patch: Partial<TunnelForward>) {
    setForwardDraft(current =>
      current.map((forward, i) => (i === index ? { ...forward, ...patch } : forward))
    )
  }

  function addForward() {
    setForwardDraft(current => [...current, { service_name: '', local_port: 0 }])
  }

  function removeForward(index: number) {
    setForwardDraft(current => current.filter((_, i) => i !== index))
  }

  const logsState = logsTarget
    ? (logsById[logsTarget.id] ?? { loading: false, error: '', items: [] })
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tunnels</h1>
          <p className="text-muted-foreground mt-1">
            Inspect active tunnel connectivity, review connection logs, and operate recovery
            actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            title="Refresh"
            aria-label="Refresh tunnels"
            onClick={() => void loadOverview()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <DismissibleAlert message={error} variant="destructive" onDismiss={() => setError('')} />
      ) : null}

      {notice ? <DismissibleAlert message={notice} onDismiss={() => setNotice('')} /> : null}

      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => updateQueryState({ q: event.target.value })}
                placeholder="Search tunnels"
                className="pl-9"
              />
            </div>
            <select
              aria-label="Filter tunnels by status"
              value={statusFilter}
              onChange={event => updateQueryState({ status: event.target.value as StatusFilter })}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All status</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="paused">Paused</option>
              <option value="waiting">Waiting</option>
            </select>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => setShowStats(current => !current)}
            >
              {showStats ? 'Hide stats' : 'Show stats'}
            </button>
            {showStats ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/60 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">Total {overallSummary.total}</span>
                <span className="font-medium text-emerald-600">Online {overallSummary.online}</span>
                <span className="font-medium text-slate-500">Offline {overallSummary.offline}</span>
                <span className="font-medium text-amber-700">Paused {overallSummary.paused}</span>
                <span className="font-medium text-amber-600">Waiting {overallSummary.waiting}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden bg-background">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tunnels...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground">No tunnels match the current view.</p>
              {(search || statusFilter !== 'all') && (
                <button
                  type="button"
                  className="mt-2 text-sm text-primary hover:underline"
                  onClick={() => {
                    updateQueryState({ q: '', status: 'all' })
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <SortableHeader
                          label="Server"
                          field="name"
                          activeField={sortField}
                          dir={sortDir}
                          onToggle={toggleSort}
                        />
                      </TableHead>
                      <TableHead>
                        <SortableHeader
                          label="Status"
                          field="status"
                          activeField={sortField}
                          dir={sortDir}
                          onToggle={toggleSort}
                        />
                      </TableHead>
                      <TableHead>
                        <SortableHeader
                          label="Last Connected"
                          field="connected_at"
                          activeField={sortField}
                          dir={sortDir}
                          onToggle={toggleSort}
                        />
                      </TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Session Duration</TableHead>
                      <TableHead>
                        <SortableHeader
                          label="Remote Address"
                          field="remote_addr"
                          activeField={sortField}
                          dir={sortDir}
                          onToggle={toggleSort}
                        />
                      </TableHead>
                      <TableHead className="w-[52px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedItems.map(item => {
                      const actionBusy = busyId === item.id
                      const isExpanded = expandedId === item.id
                      const pendingStatus = pendingStatusById[item.id]
                      const effectiveMappings = item.services.length
                        ? item.services.map(service => formatEffectiveMapping(service)).join(' | ')
                        : 'None'

                      return (
                        <Fragment key={item.id}>
                          <TableRow className="[&>td]:py-3 [&>td]:align-middle">
                            <TableCell className="whitespace-normal text-sm">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 text-left font-medium text-foreground hover:underline"
                                onClick={() => toggleExpanded(item)}
                              >
                                <span>{item.name}</span>
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              {item.disconnect_reason ? (
                                <div className="text-muted-foreground mt-1 text-xs">
                                  Last disconnect: {formatDisconnectReason(item)}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div
                                className={`inline-flex items-center gap-2 ${statusTone(item, pendingStatus)}`}
                              >
                                {statusBadge(item, pendingStatus)}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatLastConnected(item)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatCreated(item)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatSessionDuration(item)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {item.remote_addr || '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreVertical className="h-4 w-4" />
                                    <span className="sr-only">Actions</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openPortForwardSheet(item)}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    Port Forward
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openLogsSheet(item)}>
                                    <FileText className="mr-2 h-4 w-4" />
                                    Connection Logs
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setWizardServerId(item.id)}>
                                    <Wrench className="mr-2 h-4 w-4" />
                                    Setup
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={actionBusy}
                                    onClick={() => void handleCheckStatus(item)}
                                  >
                                    {!actionBusy && <RefreshCw className="mr-2 h-4 w-4" />}
                                    {actionBusy ? 'Checking...' : 'Check'}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {item.is_paused || item.status === 'paused' ? (
                                    <DropdownMenuItem
                                      onClick={() => setConfirmTarget({ action: 'resume', item })}
                                    >
                                      <RefreshCw className="mr-2 h-4 w-4" />
                                      Resume Connect
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setPauseTarget(item)
                                        setPauseMinutes('10')
                                      }}
                                    >
                                      <PlugZap className="mr-2 h-4 w-4" />
                                      Pause Connect
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    disabled={item.status !== 'online'}
                                    onClick={() => setConfirmTarget({ action: 'disconnect', item })}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Restart Connection
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setConfirmTarget({ action: 'rotate', item })}
                                  >
                                    <KeyRound className="mr-2 h-4 w-4" />
                                    Rotate token
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                          {isExpanded ? (
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={7} className="py-3">
                                <div className="space-y-3 rounded-lg border bg-muted/10 px-4 py-3 text-sm">
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b pb-2">
                                    <span className="font-medium text-foreground">
                                      Tunnel Details
                                    </span>
                                    {item.description ? (
                                      <span className="text-muted-foreground">
                                        {item.description}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                    <DetailItem label="Server Name">
                                      {onOpenServerDetail ? (
                                        <button
                                          type="button"
                                          className="inline-flex items-center gap-1.5 font-medium text-sky-700 hover:text-sky-800 hover:underline"
                                          onClick={() => onOpenServerDetail(item.id)}
                                        >
                                          {item.name}
                                          <ArrowUpRight className="h-3.5 w-3.5" />
                                        </button>
                                      ) : (
                                        <span>{item.name}</span>
                                      )}
                                    </DetailItem>
                                    <DetailItem
                                      label="Status"
                                      value={item.is_paused ? 'Paused' : item.status}
                                    />
                                    <DetailItem
                                      label="Last Connected"
                                      value={formatLastConnected(item)}
                                    />
                                    <DetailItem label="Created" value={formatCreated(item)} />
                                    <DetailItem
                                      label="Session Duration"
                                      value={formatSessionDuration(item)}
                                    />
                                    <DetailItem
                                      label="Remote"
                                      value={infoValue(item.remote_addr || '—')}
                                    />
                                    <DetailItem
                                      label="Reconnects 24h"
                                      value={String(item.recent_reconnect_count_24h ?? 0)}
                                    />
                                    <DetailItem
                                      label="Pause Until"
                                      value={formatDateTime(item.pause_until)}
                                    />
                                    <DetailItem
                                      label="Last Disconnect"
                                      value={formatDisconnectReason(item)}
                                    />
                                    <DetailItem
                                      label="Waiting First Connect"
                                      value={item.waiting_for_first_connect ? 'Yes' : 'No'}
                                    />
                                    <DetailItem
                                      label="Effective Mappings"
                                      value={effectiveMappings}
                                      className="md:col-span-2 xl:col-span-3"
                                    />
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end px-4 py-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Rows</span>
                  <select
                    aria-label="Rows per page"
                    value={pageSize}
                    onChange={event =>
                      updateQueryState({
                        pageSize: Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number],
                      })
                    }
                    className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
                  >
                    {PAGE_SIZE_OPTIONS.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => updateQueryState({ page: Math.max(1, safePage - 1) })}
                  >
                    Previous
                  </Button>
                  <span className="px-2 text-sm text-muted-foreground">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => updateQueryState({ page: Math.min(totalPages, safePage + 1) })}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {wizardServerId ? (
        <TunnelSetupWizard serverId={wizardServerId} onClose={() => setWizardServerId(null)} />
      ) : null}

      <AlertDialog open={!!confirmTarget} onOpenChange={open => !open && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget?.action === 'rotate'
                ? 'Rotate Tunnel Token'
                : confirmTarget?.action === 'resume'
                  ? 'Resume Tunnel Connect'
                  : 'Restart Connection'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.action === 'rotate'
                ? 'Rotating the token immediately disconnects the active tunnel. The local server must be updated with the new setup command.'
                : confirmTarget?.action === 'resume'
                  ? 'Resume connect clears pause_until and allows the local tunnel service to reconnect immediately.'
                  : 'Drop the current tunnel. Local autossh may reconnect immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmAction()}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pauseTarget} onOpenChange={open => !open && setPauseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Tunnel Connect</AlertDialogTitle>
            <AlertDialogDescription>
              Set a pause window in minutes. Decimal values are supported, for example 0.1 minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="pause-minutes">
              Minutes
            </label>
            <Input
              id="pause-minutes"
              aria-label="Pause minutes"
              type="number"
              min="0.1"
              step="0.1"
              value={pauseMinutes}
              onChange={event => setPauseMinutes(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handlePauseSubmit()}>
              Pause Connect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={!!portForwardTarget}
        onOpenChange={open => {
          if (!open) {
            setPortForwardTarget(null)
            setForwardDraft([])
            setForwardsError('')
            setForwardsMessage('')
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader className="border-b pb-4">
            <SheetTitle>
              {portForwardTarget ? `Port Forward · ${portForwardTarget.name}` : 'Port Forward'}
            </SheetTitle>
            <SheetDescription>
              Saved intent on the left, current live mappings on the right.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {forwardsError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {forwardsError}
              </div>
            ) : null}

            {forwardsMessage ? (
              <div className="rounded-lg border border-emerald-300/40 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {forwardsMessage}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold">Desired Forwards</div>
                      <div className="text-sm text-muted-foreground">
                        Saved mapping intent. Applies on reconnect.
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addForward}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  </div>

                  {forwardsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading desired forwards...
                    </div>
                  ) : forwardDraft.length ? (
                    <div className="space-y-2.5">
                      {forwardDraft.map((forward, index) => (
                        <div
                          key={`${forward.service_name}-${index}`}
                          className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
                        >
                          <Input
                            value={forward.service_name}
                            placeholder="service name"
                            onChange={event =>
                              updateForward(index, { service_name: event.target.value })
                            }
                          />
                          <div className="flex items-center gap-2 sm:justify-end">
                            <Input
                              value={forward.local_port || ''}
                              placeholder="local port"
                              type="number"
                              min="1"
                              max="65535"
                              onChange={event =>
                                updateForward(index, {
                                  local_port: Number(event.target.value || 0),
                                })
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="justify-self-end"
                            onClick={() => removeForward(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Remove forward</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No desired forwards yet.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 pt-6">
                  <div>
                    <div className="text-base font-semibold">Effective Mappings</div>
                    <div className="text-sm text-muted-foreground">
                      Live mappings from the latest connected tunnel session.
                    </div>
                  </div>
                  {portForwardTarget?.services.length ? (
                    <div className="space-y-2">
                      {portForwardTarget.services.map(service => (
                        <div
                          key={`${service.service_name}-${service.tunnel_port}`}
                          className="rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="font-medium text-foreground">{service.service_name}</div>
                          <div className="text-muted-foreground">
                            {formatEffectiveMapping(service)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No effective mappings.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <SheetFooter className="border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setPortForwardTarget(null)}>
              Close
            </Button>
            <Button onClick={() => void handleSaveForwards()} disabled={forwardsSaving}>
              {forwardsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Desired Forwards
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!logsTarget}
        onOpenChange={open => {
          if (!open) {
            setLogsTarget(null)
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader className="border-b pb-4">
            <div className="flex items-start justify-between gap-3 pr-12">
              <SheetTitle>
                {logsTarget ? `Connection Logs · ${logsTarget.name}` : 'Connection Logs'}
              </SheetTitle>
              {logsTarget ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadLogs(logsTarget.id)}
                  disabled={logsState?.loading}
                >
                  {logsState?.loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
              ) : null}
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {logsState?.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {logsState.error}
              </div>
            ) : null}

            {logsState?.loading && !logsState.items.length ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading connection logs...
              </div>
            ) : logsState?.items.length ? (
              <div className="space-y-2">
                {logsState.items.map(log => {
                  const reason = formatLogReason(log)
                  const metaItems = [
                    reason ? { label: 'Reason', value: reason } : null,
                    log.remote_addr ? { label: 'Remote', value: log.remote_addr } : null,
                    log.pause_until
                      ? { label: 'Pause until', value: formatDateTime(log.pause_until) }
                      : null,
                  ].filter(Boolean) as Array<{ label: string; value: string }>

                  return (
                    <div key={log.id} className="rounded-md border px-3 py-3 text-sm">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="font-medium text-foreground">
                          {log.label || log.action || 'Event'}
                        </div>
                        <div className="text-muted-foreground">{formatDateTime(log.at)}</div>
                      </div>
                      {metaItems.length ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {metaItems.map(item => (
                            <div
                              key={`${log.id}-${item.label}`}
                              className="rounded-md bg-muted/40 px-3 py-2"
                            >
                              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                {item.label}
                              </div>
                              <div className="mt-1 break-words text-foreground">{item.value}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No connection logs yet.</div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
