import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
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
import {
  type AppInstance,
  type AppOperationResponse,
  appIconClass,
  appInitials,
  formatTime,
  formatUptime,
  runtimeVariant,
} from '@/pages/apps/types'

type AppAction = 'start' | 'stop' | 'restart' | 'uninstall'

type SortField = 'name' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 12
const TEMPLATE_FILTER_ALL = '__all__'
const TEMPLATE_FILTER_UNTEMPLATED = '__untemplated__'

function normalizeTemplateKey(value?: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const lowered = trimmed.toLowerCase()
  if (lowered === 'nil' || lowered === '<nil>' || lowered === 'null' || lowered === 'none')
    return null
  return trimmed
}

function SortableHeader({
  label,
  field,
  current,
  dir,
  onSort,
}: {
  label: string
  field: SortField
  current: SortField | null
  dir: SortDir
  onSort: (field: SortField) => void
}) {
  const active = current === field
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUp className="h-3.5 w-3.5 opacity-40" />
      )}
    </button>
  )
}

function FilterHeader({
  label,
  options,
  excluded,
  onChange,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  excluded: Set<string>
  onChange: (next: Set<string>) => void
}) {
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
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm"
          >
            <input
              type="checkbox"
              checked={!excluded.has(option.value)}
              onChange={event => {
                const next = new Set(excluded)
                if (event.target.checked) next.delete(option.value)
                else next.add(option.value)
                onChange(next)
              }}
            />
            {option.label}
          </label>
        ))}
        {active ? (
          <button
            type="button"
            className="mt-1 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(new Set())}
          >
            Reset
          </button>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatCardSourceLabel(app: AppInstance): string {
  const templateKey = normalizeTemplateKey(app.catalog_app_key)
  if (templateKey) return templateKey

  switch (app.source) {
    case 'manualops':
      return 'Manual deployment'
    case 'docker':
      return 'Docker runtime'
    case 'catalog':
      return 'Catalog app'
    default:
      return app.source
        ? app.source
            .split(/[^a-zA-Z0-9]+/)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
        : 'App instance'
  }
}

function appServerLabel(app: AppInstance): string {
  return app.server_name?.trim() || app.server_id || 'Local'
}

function AppAvatar({
  app,
  sizeClass,
  radiusClass,
}: {
  app: AppInstance
  sizeClass: string
  radiusClass: string
}) {
  const [imgError, setImgError] = useState(false)
  const templateIconURL = app.template_icon_url?.trim()
  const showTemplateIcon = Boolean(templateIconURL) && !imgError

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden text-sm font-semibold shadow-sm',
        sizeClass,
        radiusClass,
        showTemplateIcon
          ? 'bg-background ring-1 ring-border/60 dark:bg-muted/40'
          : appIconClass(app.name)
      )}
    >
      {showTemplateIcon ? (
        <img
          src={templateIconURL}
          alt={`${app.name} template icon`}
          className="h-full w-full object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      ) : (
        appInitials(app.name)
      )}
    </div>
  )
}

export function AppsPage({ catalogAppKey }: { catalogAppKey?: string }) {
  const navigate = useNavigate()
  const [apps, setApps] = useState<AppInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string>(TEMPLATE_FILTER_ALL)
  const [selectedServer, setSelectedServer] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField | null>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [excludeRuntime, setExcludeRuntime] = useState<Set<string>>(new Set())
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
      to: '/activity/$actionId' as never,
      params: { actionId } as never,
      search: { returnTo: 'list' } as never,
    })
  }

  function navigateToAppDetail(appId: string) {
    void navigate({
      to: '/apps/$appId' as never,
      params: { appId } as never,
      search: { catalogAppKey: undefined } as never,
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
      const response = await pb.send<AppOperationResponse>(`/api/apps/${app.id}/${action}`, {
        method: 'POST',
      })
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
      const response = await pb.send<AppOperationResponse>(`/api/apps/${app.id}`, {
        method: 'DELETE',
      })
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

  const summary = useMemo(
    () => ({
      total: apps.length,
      running: apps.filter(item => item.runtime_status === 'running').length,
      stopped: apps.filter(item => item.runtime_status === 'stopped').length,
      error: apps.filter(item => item.runtime_status === 'error').length,
    }),
    [apps]
  )

  const filterOptions = useMemo(() => {
    const templateCounts = apps.reduce<Record<string, number>>((counts, item) => {
      const templateKey = normalizeTemplateKey(item.catalog_app_key)
      if (!templateKey) return counts
      counts[templateKey] = (counts[templateKey] ?? 0) + 1
      return counts
    }, {})

    const noTemplateCount = apps.filter(item => !normalizeTemplateKey(item.catalog_app_key)).length
    return {
      runtime: Array.from(new Set(apps.map(item => item.runtime_status).filter(Boolean)))
        .sort()
        .map(value => ({ value, label: value })),
      server: Array.from(
        new Map(apps.map(item => [item.server_id || 'local', appServerLabel(item)])).entries()
      )
        .sort((left, right) => left[1].localeCompare(right[1]))
        .map(([value, label]) => {
          const count = apps.filter(item => (item.server_id || 'local') === value).length
          return { value, label, count }
        }),
      template: Object.entries(templateCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([value, count]) => ({ value, label: value, count })),
      noTemplateCount,
    }
  }, [apps])

  const routeTemplate = normalizeTemplateKey(catalogAppKey)
  const effectiveTemplate = routeTemplate ?? selectedTemplate

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return apps.filter(item => {
      const templateKey = normalizeTemplateKey(item.catalog_app_key)
      if (excludeRuntime.has(item.runtime_status)) return false
      if (selectedServer && (item.server_id || 'local') !== selectedServer) return false
      if (effectiveTemplate === TEMPLATE_FILTER_UNTEMPLATED && templateKey) return false
      if (
        effectiveTemplate !== TEMPLATE_FILTER_ALL &&
        effectiveTemplate !== TEMPLATE_FILTER_UNTEMPLATED &&
        templateKey !== effectiveTemplate
      ) {
        return false
      }
      if (!query) return true
      return [item.id, item.name, item.project_dir, item.server_id, templateKey]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query))
    })
  }, [apps, effectiveTemplate, excludeRuntime, search, selectedServer])

  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems
    const factor = sortDir === 'asc' ? 1 : -1
    return [...filteredItems].sort(
      (left, right) =>
        String(left[sortField] || '').localeCompare(String(right[sortField] || '')) * factor
    )
  }, [filteredItems, sortDir, sortField])

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE))
  const pagedItems = useMemo(
    () => sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, sortedItems]
  )
  const hasResults = pagedItems.length > 0

  useEffect(() => {
    setPage(1)
  }, [effectiveTemplate, excludeRuntime, search, selectedServer, sortDir, sortField, view])

  function handleTemplateFilterChange(value: string) {
    setSelectedTemplate(value || TEMPLATE_FILTER_ALL)
    if (catalogAppKey) {
      void navigate({ to: '/apps', search: { catalogAppKey: undefined } })
    }
  }

  const activeRuntime = useMemo(() => {
    const includedStatuses = filterOptions.runtime.filter(
      option => !excludeRuntime.has(option.value)
    )
    return includedStatuses.length === 1 ? (includedStatuses[0]?.value ?? null) : null
  }, [excludeRuntime, filterOptions.runtime])

  function handleRuntimeSummaryClick(runtime: string | null) {
    if (!runtime) {
      setExcludeRuntime(new Set())
      return
    }
    if (activeRuntime === runtime) {
      setExcludeRuntime(new Set())
      return
    }
    setExcludeRuntime(
      new Set(filterOptions.runtime.map(option => option.value).filter(value => value !== runtime))
    )
  }

  function renderAppAvatar(app: AppInstance, sizeClass: string, radiusClass: string) {
    return <AppAvatar app={app} sizeClass={sizeClass} radiusClass={radiusClass} />
  }

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

  function renderEmptyState() {
    return (
      <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
        No apps found.
      </div>
    )
  }

  function renderActionMenu(app: AppInstance) {
    const currentAction = actionLoading.startsWith(`${app.id}:`) ? actionLoading.split(':')[1] : ''
    const currentOperationAction = deployLoading.startsWith(`${app.id}:`)
      ? deployLoading.split(':')[1]
      : ''
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={Boolean(actionLoading)}>
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Open activity for {app.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={() =>
              void navigate({
                to: '/apps/$appId',
                params: { appId: app.id },
                search: { catalogAppKey: undefined },
              })
            }
          >
            <ExternalLink className="h-4 w-4" />
            Open detail
          </DropdownMenuItem>
          {app.last_operation ? (
            <DropdownMenuItem onSelect={() => openOperationStatus(app)}>
              <ExternalLink className="h-4 w-4" />
              Open latest action detail
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void triggerOperation(app, 'redeploy')}
            disabled={Boolean(deployLoading || actionLoading)}
          >
            <RotateCcw className="h-4 w-4" />
            {currentOperationAction === 'redeploy' ? 'Redeploying...' : 'Redeploy'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void triggerOperation(app, 'upgrade')}
            disabled={Boolean(deployLoading || actionLoading)}
          >
            <ArrowUp className="h-4 w-4" />
            {currentOperationAction === 'upgrade' ? 'Upgrading...' : 'Upgrade'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'start')}
            disabled={Boolean(actionLoading)}
          >
            <Play className="h-4 w-4" />
            {currentAction === 'start' ? 'Starting...' : 'Start'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'stop')}
            disabled={Boolean(actionLoading)}
          >
            <Square className="h-4 w-4" />
            {currentAction === 'stop' ? 'Stopping...' : 'Stop'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'restart')}
            disabled={Boolean(actionLoading)}
          >
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

  function renderAppsSurface() {
    if (loading) {
      return (
        <div className="rounded-2xl bg-background/80 p-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/60">
          Loading apps...
        </div>
      )
    }

    if (view === 'grid') {
      if (!hasResults) {
        return renderEmptyState()
      }

      return (
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {pagedItems.map(app => (
            <Card
              key={app.id}
              className="overflow-hidden rounded-[24px] border-border/70 bg-card/95 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_18px_36px_rgba(15,23,42,0.10)] dark:bg-card/92 dark:shadow-[0_16px_34px_rgba(2,6,23,0.42)]"
            >
              <CardContent
                role="link"
                tabIndex={0}
                className="relative flex h-full min-h-[214px] cursor-pointer flex-col justify-between gap-4 p-4"
                onClick={() => navigateToAppDetail(app.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    navigateToAppDetail(app.id)
                  }
                }}
              >
                <div className="absolute right-0 top-0 h-20 w-20 rounded-full bg-primary/10 blur-2xl dark:bg-primary/15" />
                <div className="relative flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      {renderAppAvatar(app, 'h-11 w-11', 'rounded-2xl')}
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold leading-5">
                          {app.name}
                        </div>
                        <div className="truncate pt-0.5 text-[11px] text-muted-foreground">
                          {formatCardSourceLabel(app)}
                        </div>
                      </div>
                    </div>
                    <Badge variant={runtimeVariant(app.runtime_status)}>{app.runtime_status}</Badge>
                  </div>

                  <div className="rounded-2xl bg-muted/55 px-3 py-3 ring-1 ring-border/70 dark:bg-muted/35 dark:ring-border/60">
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs text-muted-foreground">
                      <span>Server</span>
                      <span className="truncate text-right text-foreground">
                        {appServerLabel(app)}
                      </span>
                      <span>Uptime</span>
                      <span className="text-right text-foreground">{formatUptime(app)}</span>
                      <span>Updated</span>
                      <span className="truncate text-right text-foreground">
                        {formatTime(app.updated)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="relative mt-auto flex items-end justify-between gap-3 border-t border-border/75 pt-3">
                  {app.last_operation ? (
                    <div className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                      <div className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                        Latest action
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {app.last_operation}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">No action recorded yet</div>
                  )}
                  <div
                    className="flex items-center gap-1"
                    onClick={event => event.stopPropagation()}
                  >
                    {renderActionMenu(app)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )
    }

    return (
      <div className="overflow-hidden rounded-2xl bg-background/88 shadow-sm ring-1 ring-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">
                <SortableHeader
                  label="Name"
                  field="name"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label="Runtime"
                  options={filterOptions.runtime}
                  excluded={excludeRuntime}
                  onChange={setExcludeRuntime}
                />
              </TableHead>
              <TableHead>Server</TableHead>
              <TableHead>Uptime</TableHead>
              <TableHead>Latest Action</TableHead>
              <TableHead>
                <SortableHeader
                  label="Updated"
                  field="updated"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="w-[72px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No apps found.
                </TableCell>
              </TableRow>
            ) : (
              pagedItems.map(item => (
                <TableRow key={item.id} className="h-14">
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-3">
                      {renderAppAvatar(item, 'h-10 w-10', 'rounded-xl')}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={runtimeVariant(item.runtime_status)}>
                      {item.runtime_status}
                    </Badge>
                  </TableCell>
                  <TableCell>{appServerLabel(item)}</TableCell>
                  <TableCell>{formatUptime(item)}</TableCell>
                  <TableCell>
                    {item.last_operation ? (
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          Latest action detail
                        </div>
                        <button
                          type="button"
                          className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                          onClick={() => openOperationStatus(item)}
                        >
                          {item.last_operation}
                        </button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{formatTime(item.updated)}</TableCell>
                  <TableCell className="text-right">{renderActionMenu(item)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Apps</h1>
          <p className="text-sm text-muted-foreground">
            Unified entry to manage your installed & shared apps.
          </p>
        </div>
        <div className="flex items-center gap-2 self-end md:self-auto">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void fetchApps(true)}
            disabled={refreshing}
            aria-label="Refresh apps"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}
      {catalogAppKey ? (
        <Alert>
          <AlertTitle>Store Filter Active</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing installed instances for catalog app{' '}
              <span className="font-mono">{catalogAppKey}</span>.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate({ to: '/apps', search: { catalogAppKey: undefined } })}
            >
              Clear filter
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="overflow-hidden rounded-[28px] bg-gradient-to-b from-muted/35 via-background to-background px-4 py-3 md:px-5 md:py-4">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-3">
            <div className="inline-flex h-8.5 flex-wrap items-center rounded-xl bg-background/88 px-1 text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  !activeRuntime ? 'bg-muted/55 text-foreground' : 'hover:bg-muted/70'
                )}
                onClick={() => handleRuntimeSummaryClick(null)}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  Total
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.total}
                </span>
              </button>
              <span className="mx-0.5 hidden h-4 w-px bg-border/55 md:block" aria-hidden="true" />
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  activeRuntime === 'running' ? 'bg-muted/55 text-foreground' : 'hover:bg-muted/70'
                )}
                onClick={() => handleRuntimeSummaryClick('running')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  Running
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.running}
                </span>
              </button>
              <span className="mx-0.5 hidden h-4 w-px bg-border/55 md:block" aria-hidden="true" />
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  activeRuntime === 'stopped' ? 'bg-muted/55 text-foreground' : 'hover:bg-muted/70'
                )}
                onClick={() => handleRuntimeSummaryClick('stopped')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  Stopped
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.stopped}
                </span>
              </button>
              <span className="mx-0.5 hidden h-4 w-px bg-border/55 md:block" aria-hidden="true" />
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  activeRuntime === 'error' ? 'bg-muted/55 text-foreground' : 'hover:bg-muted/70'
                )}
                onClick={() => handleRuntimeSummaryClick('error')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  Error
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.error}
                </span>
              </button>
            </div>

            <div className="relative min-w-0 w-full sm:w-[156px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value.slice(0, 15))}
                placeholder="Search apps"
                className="h-8.5 border-transparent bg-background/90 pl-9 shadow-sm ring-1 ring-border/55"
                maxLength={15}
                aria-label="Search apps"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
            <label className="min-w-0 sm:w-[150px]">
              <select
                className="h-9 w-full rounded-md border-transparent bg-background/90 px-3 text-sm shadow-sm ring-1 ring-border/60 outline-none focus:ring-2 focus:ring-ring"
                value={effectiveTemplate}
                onChange={event => handleTemplateFilterChange(event.target.value)}
                aria-label="Filter by app template"
              >
                <option value={TEMPLATE_FILTER_ALL}>By template</option>
                <option value={TEMPLATE_FILTER_UNTEMPLATED}>
                  No-template ({filterOptions.noTemplateCount})
                </option>
                {filterOptions.template.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 sm:w-[150px]">
              <select
                className="h-9 w-full rounded-md border-transparent bg-background/90 px-3 text-sm shadow-sm ring-1 ring-border/60 outline-none focus:ring-2 focus:ring-ring"
                value={selectedServer ?? ''}
                onChange={event => setSelectedServer(event.target.value || null)}
                aria-label="Filter by server"
              >
                <option value="">By server</option>
                {filterOptions.server.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-between gap-1.5 sm:justify-end">
              <div className="inline-flex items-center gap-0.5 rounded-full bg-background/90 px-1 py-0.5 text-sm text-muted-foreground">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full"
                  disabled={page <= 1}
                  onClick={() => setPage(current => current - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-0.5 text-center font-mono text-xs text-foreground">
                  {page}/{totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full"
                  disabled={page >= totalPages}
                  onClick={() => setPage(current => current + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded-full border-transparent bg-background/90 shadow-sm ring-1 ring-border/60"
                onClick={() => setView(current => (current === 'grid' ? 'list' : 'grid'))}
                aria-label={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              >
                {view === 'grid' ? (
                  <List className="h-4 w-4" />
                ) : (
                  <LayoutGrid className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 md:mt-5">{renderAppsSurface()}</div>
      </section>

      <AlertDialog
        open={Boolean(pendingUninstall)}
        onOpenChange={open => !open && setPendingUninstall(null)}
      >
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
            <AlertDialogCancel disabled={actionLoading.endsWith(':uninstall')}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmUninstall()}>
              {actionLoading.endsWith(':uninstall') ? 'Uninstalling...' : 'Confirm Uninstall'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
