import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Filter,
  LayoutGrid,
  List,
  MoreVertical,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { type AppInstance, type AppOperationResponse, appIconClass, appInitials, formatTime, formatUptime, runtimeVariant } from '@/pages/apps/types'

type AppAction = 'start' | 'stop' | 'restart' | 'uninstall'

type SortField = 'name' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 12

function SortableHeader({ label, field, current, dir, onSort }: { label: string; field: SortField; current: SortField | null; dir: SortDir; onSort: (field: SortField) => void }) {
  const active = current === field
  return (
    <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => onSort(field)}>
      {label}
      {active ? (dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUp className="h-3.5 w-3.5 opacity-40" />}
    </button>
  )
}

function FilterHeader({ label, options, excluded, onChange }: { label: string; options: Array<{ value: string; label: string }>; excluded: Set<string>; onChange: (next: Set<string>) => void }) {
  const active = excluded.size > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1 hover:text-foreground">
          {label}
          <Filter className={cn('h-3.5 w-3.5', active ? 'text-primary' : 'opacity-40')} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px] space-y-1 p-2">
        {options.map(option => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
            <input type="checkbox" checked={!excluded.has(option.value)} onChange={event => {
              const next = new Set(excluded)
              if (event.target.checked) next.delete(option.value)
              else next.add(option.value)
              onChange(next)
            }} />
            {option.label}
          </label>
        ))}
        {active ? <button type="button" className="mt-1 w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(new Set())}>Reset</button> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppsPage() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<AppInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField | null>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [excludeRuntime, setExcludeRuntime] = useState<Set<string>>(new Set())
  const [excludeServer, setExcludeServer] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState('')
  const [deployLoading, setDeployLoading] = useState('')
  const [pendingUninstall, setPendingUninstall] = useState<AppInstance | null>(null)

  useEffect(() => {
    void fetchApps()
    const timer = window.setInterval(() => {
      void fetchApps()
    }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  async function fetchApps(showRefresh = false) {
    if (showRefresh) setRefreshing(true)
    try {
      const response = await pb.send<AppInstance[]>('/api/apps', { method: 'GET' })
      setApps(Array.isArray(response) ? response : [])
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load my apps'))
    } finally {
      setLoading(false)
      if (showRefresh) setRefreshing(false)
    }
  }

  function navigateToActionDetail(actionId: string) {
    void navigate({
      to: '/actions/$actionId' as never,
      params: { actionId } as never,
      search: { returnTo: 'list' } as never,
    })
  }

  async function runAction(app: AppInstance, action: AppAction) {
    if (action === 'uninstall') {
      setPendingUninstall(app)
      return
    }
    const actionKey = `${app.id}:${action}`
    setActionLoading(actionKey)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<AppOperationResponse>(`/api/apps/${app.id}/${action}`, { method: 'POST' })
      if (response?.id) {
        navigateToActionDetail(response.id)
        return
      }
      setSuccess(`${app.name} ${action} operation created`)
      await fetchApps()
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to ${action} ${app.name}`))
    } finally {
      setActionLoading('')
    }
  }

  async function confirmUninstall() {
    if (!pendingUninstall) return
    const app = pendingUninstall
    const actionKey = `${app.id}:uninstall`
    setActionLoading(actionKey)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<AppOperationResponse>(`/api/apps/${app.id}`, { method: 'DELETE' })
      setPendingUninstall(null)
      if (response?.id) {
        navigateToActionDetail(response.id)
        return
      }
      setSuccess(`${app.name} uninstall operation created`)
      await fetchApps()
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to uninstall ${app.name}`))
    } finally {
      setActionLoading('')
    }
  }

  const summary = useMemo(() => ({
    total: apps.length,
    running: apps.filter(item => item.runtime_status === 'running').length,
    stopped: apps.filter(item => item.runtime_status === 'stopped').length,
    error: apps.filter(item => item.runtime_status === 'error').length,
  }), [apps])

  const filterOptions = useMemo(() => ({
    runtime: Array.from(new Set(apps.map(item => item.runtime_status).filter(Boolean))).sort().map(value => ({ value, label: value })),
    server: Array.from(new Set(apps.map(item => item.server_id || 'local').filter(Boolean))).sort().map(value => ({ value, label: value })),
  }), [apps])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return apps.filter(item => {
      if (excludeRuntime.has(item.runtime_status)) return false
      if (excludeServer.has(item.server_id || 'local')) return false
      if (!query) return true
      return [item.id, item.name, item.project_dir, item.server_id].filter(Boolean).some(value => String(value).toLowerCase().includes(query))
    })
  }, [apps, excludeRuntime, excludeServer, search])

  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems
    const factor = sortDir === 'asc' ? 1 : -1
    return [...filteredItems].sort((left, right) => String(left[sortField] || '').localeCompare(String(right[sortField] || '')) * factor)
  }, [filteredItems, sortDir, sortField])

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE))
  const pagedItems = useMemo(() => sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page, sortedItems])

  useEffect(() => {
    setPage(1)
  }, [excludeRuntime, excludeServer, search, sortDir, sortField, view])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDir('asc')
  }

  async function triggerOperation(app: AppInstance, action: 'redeploy' | 'upgrade') {
    const key = `${app.id}:${action}`
    setDeployLoading(key)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<{ id: string }>(`/api/apps/${app.id}/${action}`, {
        method: 'POST',
      })
      setSuccess(`${app.name} ${action} operation created`)
      await fetchApps()
      navigateToActionDetail(response.id)
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to ${action} ${app.name}`))
    } finally {
      setDeployLoading('')
    }
  }

  function openOperationStatus(app: AppInstance) {
    if (!app.last_operation) return
    navigateToActionDetail(app.last_operation)
  }

  function renderActionMenu(app: AppInstance) {
    const currentAction = actionLoading.startsWith(`${app.id}:`) ? actionLoading.split(':')[1] : ''
    const currentOperationAction = deployLoading.startsWith(`${app.id}:`) ? deployLoading.split(':')[1] : ''
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={Boolean(actionLoading)}>
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Open actions for {app.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => void navigate({ to: '/apps/$appId', params: { appId: app.id } })}>
            <ExternalLink className="h-4 w-4" />
            Open detail
          </DropdownMenuItem>
          {app.last_operation ? (
            <DropdownMenuItem onSelect={() => openOperationStatus(app)}>
              <ExternalLink className="h-4 w-4" />
              View execution status
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void triggerOperation(app, 'redeploy')} disabled={Boolean(deployLoading || actionLoading)}>
            <RotateCcw className="h-4 w-4" />
            {currentOperationAction === 'redeploy' ? 'Redeploying...' : 'Redeploy'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void triggerOperation(app, 'upgrade')} disabled={Boolean(deployLoading || actionLoading)}>
            <ArrowUp className="h-4 w-4" />
            {currentOperationAction === 'upgrade' ? 'Upgrading...' : 'Upgrade'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void runAction(app, 'start')} disabled={Boolean(actionLoading)}>
            <Play className="h-4 w-4" />
            {currentAction === 'start' ? 'Starting...' : 'Start'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void runAction(app, 'stop')} disabled={Boolean(actionLoading)}>
            <Square className="h-4 w-4" />
            {currentAction === 'stop' ? 'Stopping...' : 'Stop'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void runAction(app, 'restart')} disabled={Boolean(actionLoading)}>
            <RotateCcw className="h-4 w-4" />
            {currentAction === 'restart' ? 'Restarting...' : 'Restart'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'uninstall')}
            disabled={Boolean(actionLoading)}
            variant="destructive"
          >
            <Trash2 className="h-4 w-4" />
            Uninstall
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Apps</h1>
          <p className="text-sm text-muted-foreground">Your app workspace stays focused on management summary. Lifecycle requests hand execution tracking off to the canonical Actions detail surface.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={view === 'grid' ? 'default' : 'outline'} onClick={() => setView('grid')}><LayoutGrid className="mr-2 h-4 w-4" />Grid</Button>
          <Button variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}><List className="mr-2 h-4 w-4" />List</Button>
          <Button variant="outline" onClick={() => void fetchApps(true)} disabled={refreshing}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </div>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {success ? <Alert><AlertDescription>{success}</AlertDescription></Alert> : null}
      <Alert>
        <AlertTitle>Execution Handoff</AlertTitle>
        <AlertDescription>
          <p>Start, stop, restart, uninstall, redeploy, and upgrade all create or resume shared lifecycle operations.</p>
          <p>This page shows app summary. Timeline, node progress, and final execution detail live in Actions.</p>
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by id, name, path, or server" className="pl-9" />
        </div>
        <div className="text-sm text-muted-foreground">Running {summary.running} · Stopped {summary.stopped} · Error {summary.error}</div>
        <div className="text-sm text-muted-foreground">Total {summary.total}</div>
      </div>

      {loading ? (
        <div className="rounded-xl border p-6 text-sm text-muted-foreground">Loading apps...</div>
      ) : view === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pagedItems.map(app => (
            <Card key={app.id} className="overflow-hidden">
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-semibold', appIconClass(app.name))}>{appInitials(app.name)}</div>
                    <div>
                      <div className="font-medium">{app.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{app.id}</div>
                    </div>
                  </div>
                  <Badge variant={runtimeVariant(app.runtime_status)}>{app.runtime_status}</Badge>
                </div>
                <div className="grid gap-2 text-sm text-muted-foreground">
                  <div>Uptime: {formatUptime(app)}</div>
                  <div>Created: {formatTime(app.created)}</div>
                  <div>Server: {app.server_id || 'local'}</div>
                  <div>Last Operation: {app.last_operation || '-'}</div>
                  <div className="truncate">{app.project_dir}</div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <Badge variant="outline">{app.status}</Badge>
                  <div className="flex items-center gap-1">
                    <Button asChild variant="outline"><Link to="/apps/$appId" params={{ appId: app.id }}>Open Detail</Link></Button>
                    {renderActionMenu(app)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortableHeader label="Name" field="name" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead><FilterHeader label="Runtime" options={filterOptions.runtime} excluded={excludeRuntime} onChange={setExcludeRuntime} /></TableHead>
                <TableHead><FilterHeader label="Server" options={filterOptions.server} excluded={excludeServer} onChange={setExcludeServer} /></TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead>Last Operation</TableHead>
                <TableHead><SortableHeader label="Created" field="created" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead><SortableHeader label="Updated" field="updated" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead className="w-[96px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedItems.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No apps found.</TableCell></TableRow>
              ) : pagedItems.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold', appIconClass(item.name))}>{appInitials(item.name)}</div>
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><div className="flex items-center gap-2"><Badge variant={runtimeVariant(item.runtime_status)}>{item.runtime_status}</Badge><Badge variant="outline">{item.status}</Badge></div></TableCell>
                  <TableCell>{item.server_id || 'local'}</TableCell>
                  <TableCell>{formatUptime(item)}</TableCell>
                  <TableCell>
                    {item.last_operation ? (
                      <button type="button" className="font-mono text-xs text-primary underline-offset-4 hover:underline" onClick={() => openOperationStatus(item)}>
                        {item.last_operation}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{formatTime(item.created)}</TableCell>
                  <TableCell>{formatTime(item.updated)}</TableCell>
                  <TableCell className="text-right">{renderActionMenu(item)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{sortedItems.length} total · Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>Next</Button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={Boolean(pendingUninstall)} onOpenChange={open => !open && setPendingUninstall(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall Application</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUninstall
                ? `Uninstall ${pendingUninstall.name}? This creates a shared uninstall operation and moves execution tracking to the canonical action detail view.`
                : 'This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading.endsWith(':uninstall')}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmUninstall()}>
              {actionLoading.endsWith(':uninstall') ? 'Uninstalling...' : 'Confirm Uninstall'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}