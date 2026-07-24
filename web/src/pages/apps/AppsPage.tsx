import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
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
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { isSessionExpiredError } from '@/lib/auth-session'
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
  effectiveInstanceStateVariant,
  formatEffectiveInstanceStateLabel,
  formatServerConnectionLabel,
  formatTime,
  formatUptime,
  formatInstanceStateLabel,
  getServerConnectionReason,
  hasBlockingServerConnectionIssue,
  instanceStateVariant,
} from '@/pages/apps/types'

type AppAction = 'start' | 'stop' | 'restart' | 'uninstall'

type SortField = 'name' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 12
const TEMPLATE_FILTER_ALL = '__all__'
const TEMPLATE_FILTER_UNTEMPLATED = '__untemplated__'
const noAutoCancel = { requestKey: null }

type AppListHealthState =
  | 'unavailable'
  | 'running'
  | 'stopped'
  | 'degraded'
  | 'attention_required'
  | 'updating'
  | 'unknown'

function normalizeTemplateKey(value?: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const lowered = trimmed.toLowerCase()
  if (lowered === 'nil' || lowered === '<nil>' || lowered === 'null' || lowered === 'none')
    return null
  return trimmed
}

function appListHealthState(app: AppInstance): AppListHealthState {
  if (hasBlockingServerConnectionIssue(app)) return 'unavailable'
  switch ((app.instance_state || '').trim().toLowerCase()) {
    case 'running':
      return 'running'
    case 'stopped':
      return 'stopped'
    case 'degraded':
      return 'degraded'
    case 'attention_required':
      return 'attention_required'
    case 'updating':
    case 'installing':
    case 'uninstalling':
      return 'updating'
    default:
      return 'unknown'
  }
}

function getListActionAvailability(app: AppInstance) {
  const normalizedInstanceState = (app.instance_state || '').toLowerCase()
  const blockedByServer = hasBlockingServerConnectionIssue(app)

  return {
    blockedByServer,
    start:
      !blockedByServer &&
      (normalizedInstanceState
        ? ['stopped', 'attention_required'].includes(normalizedInstanceState)
        : false),
    stop:
      !blockedByServer &&
      (normalizedInstanceState
        ? ['running', 'degraded', 'attention_required'].includes(normalizedInstanceState)
        : false),
    restart:
      !blockedByServer &&
      (normalizedInstanceState ? ['running', 'degraded'].includes(normalizedInstanceState) : false),
    redeploy: !blockedByServer,
    upgrade: !blockedByServer,
    uninstall: !blockedByServer,
  }
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

function formatCardSourceLabel(app: AppInstance): string {
  const t = i18n.t.bind(i18n)
  const templateKey = normalizeTemplateKey(app.catalog_app_key)
  if (templateKey) return templateKey

  switch (app.source) {
    case 'manualops':
      return t('apps:labels.sourceManualDeployment', 'Manual deployment')
    case 'docker':
      return t('apps:labels.sourceDockerRuntime', 'Docker runtime')
    case 'catalog':
      return t('apps:labels.sourceCatalogApp', 'Catalog app')
    default:
      return app.source
        ? app.source
            .split(/[^a-zA-Z0-9]+/)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
        : t('apps:labels.sourceAppInstance', 'App instance')
  }
}

function appServerLabel(app: AppInstance): string {
  return app.server_name?.trim() || app.server_id || i18n.t('apps:labels.serverLocal', 'Local')
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
  const { t } = useTranslation('apps')
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
  const [selectedInstanceState, setSelectedInstanceState] = useState<string | null>(null)
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
      const response = await pb.send<AppInstance[]>('/api/apps', {
        method: 'GET',
        ...noAutoCancel,
      })
      setApps(Array.isArray(response) ? response : [])
      setError('')
    } catch (err) {
      if (isSessionExpiredError(err)) {
        setError('')
        return
      }
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
    const serverConnectionReason = getServerConnectionReason(app)
    if (hasBlockingServerConnectionIssue(app)) {
      setError(serverConnectionReason || 'Server runtime status is unavailable.')
      return
    }
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
      if (isSessionExpiredError(err)) {
        return
      }
      setError(getApiErrorMessage(err, `Failed to ${action} ${app.name}`))
    } finally {
      setActionLoading('')
    }
  }

  async function confirmUninstall() {
    if (!pendingUninstall) return
    const app = pendingUninstall
    const serverConnectionReason = getServerConnectionReason(app)
    if (hasBlockingServerConnectionIssue(app)) {
      setError(serverConnectionReason || 'Server runtime status is unavailable.')
      setPendingUninstall(null)
      return
    }
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
      if (isSessionExpiredError(err)) {
        return
      }
      setError(getApiErrorMessage(err, `Failed to uninstall ${app.name}`))
    } finally {
      setActionLoading('')
    }
  }

  const summary = useMemo(
    () => ({
      total: apps.length,
      unavailable: apps.filter(item => appListHealthState(item) === 'unavailable').length,
      running: apps.filter(item => appListHealthState(item) === 'running').length,
      stopped: apps.filter(item => appListHealthState(item) === 'stopped').length,
      updating: apps.filter(item => appListHealthState(item) === 'updating').length,
      degraded: apps.filter(item => appListHealthState(item) === 'degraded').length,
      attentionRequired: apps.filter(item => appListHealthState(item) === 'attention_required')
        .length,
      unknown: apps.filter(item => appListHealthState(item) === 'unknown').length,
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
      if (selectedInstanceState && appListHealthState(item) !== selectedInstanceState) {
        return false
      }
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
  }, [apps, effectiveTemplate, search, selectedInstanceState, selectedServer])

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
  }, [effectiveTemplate, search, selectedInstanceState, selectedServer, sortDir, sortField, view])

  function handleTemplateFilterChange(value: string) {
    setSelectedTemplate(value || TEMPLATE_FILTER_ALL)
    if (catalogAppKey) {
      void navigate({ to: '/apps', search: { catalogAppKey: undefined } })
    }
  }

  function handleInstanceStateSummaryClick(instanceState: string | null) {
    setSelectedInstanceState(current => (current === instanceState ? null : instanceState))
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
    const serverConnectionReason = getServerConnectionReason(app)
    if (hasBlockingServerConnectionIssue(app)) {
      setError(serverConnectionReason || 'Server runtime status is unavailable.')
      return
    }
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
        {t('empty.list', { defaultValue: 'No apps found.' })}
      </div>
    )
  }

  function renderActionMenu(app: AppInstance) {
    const currentAction = actionLoading.startsWith(`${app.id}:`) ? actionLoading.split(':')[1] : ''
    const currentOperationAction = deployLoading.startsWith(`${app.id}:`)
      ? deployLoading.split(':')[1]
      : ''
    const availability = getListActionAvailability(app)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={Boolean(actionLoading)}>
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">
              {t('actions.openActivityFor', {
                defaultValue: 'Open activity for {{name}}',
                name: app.name,
              })}
            </span>
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
            {t('actions.openDetail', { defaultValue: 'Open detail' })}
          </DropdownMenuItem>
          {app.last_operation ? (
            <DropdownMenuItem onSelect={() => openOperationStatus(app)}>
              <ExternalLink className="h-4 w-4" />
              {t('actions.openLatestActionDetail', {
                defaultValue: 'Open latest action detail',
              })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void triggerOperation(app, 'redeploy')}
            disabled={Boolean(deployLoading || actionLoading) || !availability.redeploy}
          >
            <RotateCcw className="h-4 w-4" />
            {currentOperationAction === 'redeploy'
              ? t('actions.redeploying', { defaultValue: 'Redeploying...' })
              : t('actions.redeploy', { defaultValue: 'Redeploy' })}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void triggerOperation(app, 'upgrade')}
            disabled={Boolean(deployLoading || actionLoading) || !availability.upgrade}
          >
            <ArrowUp className="h-4 w-4" />
            {currentOperationAction === 'upgrade'
              ? t('actions.upgrading', { defaultValue: 'Upgrading...' })
              : t('actions.upgrade', { defaultValue: 'Upgrade' })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'start')}
            disabled={Boolean(actionLoading) || !availability.start}
          >
            <Play className="h-4 w-4" />
            {currentAction === 'start'
              ? t('actions.starting', { defaultValue: 'Starting...' })
              : t('actions.start', { defaultValue: 'Start' })}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'stop')}
            disabled={Boolean(actionLoading) || !availability.stop}
          >
            <Square className="h-4 w-4" />
            {currentAction === 'stop'
              ? t('actions.stopping', { defaultValue: 'Stopping...' })
              : t('actions.stop', { defaultValue: 'Stop' })}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'restart')}
            disabled={Boolean(actionLoading) || !availability.restart}
          >
            <RotateCcw className="h-4 w-4" />
            {currentAction === 'restart'
              ? t('actions.restarting', { defaultValue: 'Restarting...' })
              : t('actions.restart', { defaultValue: 'Restart' })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void runAction(app, 'uninstall')}
            disabled={Boolean(actionLoading) || !availability.uninstall}
            variant="destructive"
          >
            <Trash2 className="h-4 w-4" />
            {t('actions.uninstall', { defaultValue: 'Uninstall' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderAppsSurface() {
    if (loading) {
      return (
        <div className="rounded-2xl bg-background/80 p-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/60">
          {t('loading.list', { defaultValue: 'Loading apps...' })}
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
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant={
                          hasBlockingServerConnectionIssue(app)
                            ? effectiveInstanceStateVariant(app)
                            : instanceStateVariant(app.instance_state)
                        }
                      >
                        {hasBlockingServerConnectionIssue(app)
                          ? formatEffectiveInstanceStateLabel(app)
                          : formatInstanceStateLabel(app.instance_state)}
                      </Badge>
                      {hasBlockingServerConnectionIssue(app) ? (
                        <span className="max-w-[170px] text-right text-[10px] text-destructive">
                          {getServerConnectionReason(app) ||
                            formatServerConnectionLabel(app.server_connection_status)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-muted/55 px-3 py-3 ring-1 ring-border/70 dark:bg-muted/35 dark:ring-border/60">
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs text-muted-foreground">
                      <span>Server</span>

                      <span className="truncate text-right text-foreground">
                        {appServerLabel(app)}
                      </span>
                      <span>{t('labels.uptime', { defaultValue: 'Uptime' })}</span>
                      <span className="text-right text-foreground">{formatUptime(app)}</span>
                      <span>{t('labels.updated', { defaultValue: 'Updated' })}</span>
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
                        {t('labels.latestAction', { defaultValue: 'Latest action' })}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {app.last_operation}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      {t('labels.noActionRecorded', { defaultValue: 'No action recorded yet' })}
                    </div>
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
                  label={t('labels.name', { defaultValue: 'Name' })}
                  field="name"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>{t('labels.status', { defaultValue: 'Status' })}</TableHead>
              <TableHead>{t('labels.server', { defaultValue: 'Server' })}</TableHead>
              <TableHead>{t('labels.uptime', { defaultValue: 'Uptime' })}</TableHead>
              <TableHead>{t('labels.latestAction', { defaultValue: 'Latest action' })}</TableHead>
              <TableHead>
                <SortableHeader
                  label={t('labels.updated', { defaultValue: 'Updated' })}
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
                  {t('empty.list', { defaultValue: 'No apps found.' })}
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
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant={
                          hasBlockingServerConnectionIssue(item)
                            ? effectiveInstanceStateVariant(item)
                            : instanceStateVariant(item.instance_state)
                        }
                      >
                        {hasBlockingServerConnectionIssue(item)
                          ? formatEffectiveInstanceStateLabel(item)
                          : formatInstanceStateLabel(item.instance_state)}
                      </Badge>
                      {hasBlockingServerConnectionIssue(item) ? (
                        <span className="max-w-[220px] text-xs text-destructive">
                          {getServerConnectionReason(item) ||
                            formatServerConnectionLabel(item.server_connection_status)}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{appServerLabel(item)}</TableCell>
                  <TableCell>{formatUptime(item)}</TableCell>
                  <TableCell>
                    {item.last_operation ? (
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {t('actions.openLatestActionDetail', {
                            defaultValue: 'Open latest action detail',
                          })}
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
            {t('pages.listDescription', {
              defaultValue: 'Unified entry to manage your installed & shared apps.',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 self-end md:self-auto">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void fetchApps(true)}
            disabled={refreshing}
            aria-label={t('controls.refreshApps', { defaultValue: 'Refresh apps' })}
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
          <AlertTitle>{t('storeFilter.title', { defaultValue: 'Store Filter Active' })}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {t('storeFilter.description', {
                defaultValue: 'Showing installed instances for catalog app {{key}}.',
                key: catalogAppKey,
              }).replace(catalogAppKey, '')}{' '}
              <span className="font-mono">{catalogAppKey}</span>.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate({ to: '/apps', search: { catalogAppKey: undefined } })}
            >
              {t('controls.clearFilter', { defaultValue: 'Clear filter' })}
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
                  !selectedInstanceState ? 'bg-muted/55 text-foreground' : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick(null)}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.total', { defaultValue: 'Total' })}
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
                  selectedInstanceState === 'unavailable'
                    ? 'bg-muted/55 text-foreground'
                    : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick('unavailable')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.unavailable', { defaultValue: 'Unavailable' })}
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.unavailable}
                </span>
              </button>
              <span className="mx-0.5 hidden h-4 w-px bg-border/55 md:block" aria-hidden="true" />
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  selectedInstanceState === 'running'
                    ? 'bg-muted/55 text-foreground'
                    : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick('running')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.running', { defaultValue: 'Running' })}
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
                  selectedInstanceState === 'stopped'
                    ? 'bg-muted/55 text-foreground'
                    : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick('stopped')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.stopped', { defaultValue: 'Stopped' })}
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
                  selectedInstanceState === 'degraded'
                    ? 'bg-muted/55 text-foreground'
                    : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick('degraded')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.degraded', { defaultValue: 'Degraded' })}
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.degraded}
                </span>
              </button>
              <span className="mx-0.5 hidden h-4 w-px bg-border/55 md:block" aria-hidden="true" />
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  selectedInstanceState === 'attention_required'
                    ? 'bg-muted/55 text-foreground'
                    : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick('attention_required')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.attentionRequired', { defaultValue: 'Attention Required' })}
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.attentionRequired}
                </span>
              </button>
              <span className="mx-0.5 hidden h-4 w-px bg-border/55 md:block" aria-hidden="true" />
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  selectedInstanceState === 'updating'
                    ? 'bg-muted/55 text-foreground'
                    : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick('updating')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.updating', { defaultValue: 'Updating' })}
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.updating}
                </span>
              </button>
              <span className="mx-0.5 hidden h-4 w-px bg-border/55 md:block" aria-hidden="true" />
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors',
                  selectedInstanceState === 'unknown'
                    ? 'bg-muted/55 text-foreground'
                    : 'hover:bg-muted/70'
                )}
                onClick={() => handleInstanceStateSummaryClick('unknown')}
              >
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                  {t('summary.unknown', { defaultValue: 'Unknown' })}
                </span>
                <span className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {summary.unknown}
                </span>
              </button>
            </div>

            <div className="relative min-w-0 w-full sm:w-[156px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value.slice(0, 15))}
                placeholder={t('controls.searchApps', { defaultValue: 'Search apps' })}
                className="h-8.5 border-transparent bg-background/90 pl-9 shadow-sm ring-1 ring-border/55"
                maxLength={15}
                aria-label={t('controls.searchApps', { defaultValue: 'Search apps' })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
            <label className="min-w-0 sm:w-[150px]">
              <select
                className="h-9 w-full rounded-md border-transparent bg-background/90 px-3 text-sm shadow-sm ring-1 ring-border/60 outline-none focus:ring-2 focus:ring-ring"
                value={effectiveTemplate}
                onChange={event => handleTemplateFilterChange(event.target.value)}
                aria-label={t('controls.filterByTemplate', {
                  defaultValue: 'Filter by app template',
                })}
              >
                <option value={TEMPLATE_FILTER_ALL}>
                  {t('controls.byTemplate', { defaultValue: 'By template' })}
                </option>
                <option value={TEMPLATE_FILTER_UNTEMPLATED}>
                  {t('controls.noTemplate', {
                    defaultValue: 'No-template ({{count}})',
                    count: filterOptions.noTemplateCount,
                  })}
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
                aria-label={t('controls.filterByServer', { defaultValue: 'Filter by server' })}
              >
                <option value="">{t('controls.byServer', { defaultValue: 'By server' })}</option>
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
                  aria-label={t('controls.previousPage', { defaultValue: 'Previous page' })}
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
                  aria-label={t('controls.nextPage', { defaultValue: 'Next page' })}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded-full border-transparent bg-background/90 shadow-sm ring-1 ring-border/60"
                onClick={() => setView(current => (current === 'grid' ? 'list' : 'grid'))}
                aria-label={
                  view === 'grid'
                    ? t('controls.switchToListView', { defaultValue: 'Switch to list view' })
                    : t('controls.switchToGridView', { defaultValue: 'Switch to grid view' })
                }
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
            <AlertDialogTitle>
              {t('dialogs.uninstallTitle', { defaultValue: 'Uninstall Application' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUninstall
                ? t('dialogs.uninstallDescription', {
                    defaultValue:
                      'Uninstall {{name}}? This creates a shared uninstall operation and moves execution tracking to the canonical action detail view.',
                    name: pendingUninstall.name,
                  })
                : t('dialogs.cannotUndo', { defaultValue: 'This action cannot be undone.' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading.endsWith(':uninstall')}>
              {t('common:cancel', { defaultValue: 'Cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmUninstall()}>
              {actionLoading.endsWith(':uninstall')
                ? t('actions.uninstall', { defaultValue: 'Uninstall' }) + '...'
                : t('dialogs.confirmUninstall', { defaultValue: 'Confirm Uninstall' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
