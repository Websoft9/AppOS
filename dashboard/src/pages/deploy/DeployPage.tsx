import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CircleHelp,
  Ellipsis,
  FileCode2,
  Filter,
  GitBranch,
  Loader2,
  List,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Store,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { getLocale } from '@/lib/i18n'
import { iacLoadLibraryAppFiles, iacRead } from '@/lib/iac-api'
import { fetchStoreJson, getIconUrl } from '@/lib/store-api'
import { type PrimaryCategory, type Product, type ProductWithCategories } from '@/lib/store-types'
import { useUserApps } from '@/lib/store-user-api'
import { type AppConfigResponse } from '@/pages/apps/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AppDetailModal } from '@/components/store/AppDetailModal'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type ServerEntry = {
  id: string
  label: string
  host: string
  status: 'online' | 'offline'
}

type DeploymentStep = {
  key: string
  label: string
  status: string
  detail?: string
  started_at?: string
  finished_at?: string
}

type DeploymentLifecycleStep = {
  key: string
  label: string
  status: 'pending' | 'active' | 'completed' | 'terminal' | string
  detail?: string
}

type DeploymentRecord = {
  id: string
  server_id: string
  server_label?: string
  server_host?: string
  source: string
  status: string
  adapter: string
  compose_project_name: string
  project_dir: string
  rendered_compose: string
  error_summary: string
  created: string
  updated: string
  user_id?: string
  user_email?: string
  started_at?: string
  finished_at?: string
  lifecycle?: DeploymentLifecycleStep[]
  steps?: DeploymentStep[]
}

type DeployPageProps = {
  prefillMode?: string
  prefillSource?: string
  prefillAppId?: string
  prefillAppKey?: string
  prefillAppName?: string
  prefillServerId?: string
  deploymentId?: string
  autoOpen?: string
  view?: 'home' | 'list'
}

type DeploymentLogsResponse = {
  id: string
  status: string
  execution_log: string
  execution_log_truncated: boolean
  updated: string
}

type DeploymentStreamMessage = {
  type: 'snapshot' | 'append' | 'status' | 'error'
  status?: string
  updated?: string
  content?: string
  execution_log_truncated?: boolean
  message?: string
}

type Notice = {
  variant: 'default' | 'destructive'
  message: string
}

type SortField = 'compose_project_name' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'
type ManualEntryMode = 'compose' | 'docker-command' | 'install-script' | 'store-prefill' | 'installed-prefill'
type StoreShortcut = Pick<Product, 'key' | 'trademark' | 'logo'>

const PAGE_SIZE_OPTIONS = [15, 30, 60, 90] as const
const STORE_SHORTCUT_COUNT = 15
const STORE_GRID_SLOTS = 16
const SAMPLE_COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
`

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'success': return 'default'
    case 'failed':
    case 'timeout':
    case 'cancelled':
    case 'manual_intervention_required':
    case 'rolled_back': return 'destructive'
    case 'running':
    case 'validating':
    case 'preparing':
    case 'verifying':
    case 'rolling_back': return 'secondary'
    default: return 'outline'
  }
}

function isActiveStatus(status: string): boolean {
  return ['queued', 'validating', 'preparing', 'running', 'verifying', 'rolling_back'].includes(status)
}

function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function stepTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'terminal':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    case 'active':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-500'
  }
}

function stepConnectorTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-300'
    case 'terminal':
      return 'bg-rose-300'
    case 'active':
      return 'bg-sky-300'
    default:
      return 'bg-slate-200'
  }
}

function TitleHelp({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={text}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-[240px] leading-5">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function AppLauncherIcon({ app, onOpen }: { app: StoreShortcut; onOpen: (app: StoreShortcut) => void }) {
  const primarySrc = app.logo?.imageurl?.trim() || getIconUrl(app.key)
  const fallbackSrc = getIconUrl(app.key)
  const [src, setSrc] = useState(primarySrc)
  const [usedFallback, setUsedFallback] = useState(primarySrc === fallbackSrc)

  useEffect(() => {
    setSrc(primarySrc)
    setUsedFallback(primarySrc === fallbackSrc)
  }, [fallbackSrc, primarySrc])

  const initials = (app.trademark || app.key).trim().slice(0, 2).toUpperCase()

  return (
    <button
      type="button"
      title={app.trademark}
      className="group flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center transition-colors hover:bg-sky-100/60"
      onClick={() => onOpen(app)}
    >
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden">
        {src ? (
          <img
            src={src}
            alt={app.trademark}
            className="h-10 w-10 object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              if (!usedFallback && fallbackSrc && src !== fallbackSrc) {
                setSrc(fallbackSrc)
                setUsedFallback(true)
                return
              }
              setSrc('')
            }}
          />
        ) : (
          <span className="text-sm font-semibold tracking-wide text-slate-600">{initials}</span>
        )}
      </div>
      <span className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-4 text-slate-700">{app.trademark}</span>
    </button>
  )
}

function MoreAppsTile() {
  return (
    <Link to="/store" className="group flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center transition-colors hover:bg-sky-100/60">
      <span className="flex h-12 w-12 items-center justify-center text-slate-500 transition-colors group-hover:text-sky-700">
        <Ellipsis className="h-8 w-8" />
      </span>
      <span className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-4 text-slate-700">More Apps</span>
    </Link>
  )
}

function buildWebSocketUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${path}`
}

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

export function DeployPage({
  prefillMode,
  prefillSource,
  prefillAppId,
  prefillAppKey,
  prefillAppName,
  prefillServerId,
  deploymentId,
  autoOpen,
  view = 'home',
}: DeployPageProps) {
  const navigate = useNavigate()
  const locale = getLocale()
  const { data: userApps = [] } = useUserApps()
  const [servers, setServers] = useState<ServerEntry[]>([{ id: 'local', label: 'local', host: 'local', status: 'online' }])
  const [storeShortcuts, setStoreShortcuts] = useState<StoreShortcut[]>([])
  const [storeProducts, setStoreProducts] = useState<ProductWithCategories[]>([])
  const [storePrimaryCategories, setStorePrimaryCategories] = useState<PrimaryCategory[]>([])
  const [selectedStoreProduct, setSelectedStoreProduct] = useState<ProductWithCategories | null>(null)
  const [storeDetailOpen, setStoreDetailOpen] = useState(false)
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentRecord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [gitCreateOpen, setGitCreateOpen] = useState(false)
  const [manualEntryMode, setManualEntryMode] = useState<ManualEntryMode>('compose')
  const [serverId, setServerId] = useState('local')
  const [projectName, setProjectName] = useState('demo-nginx')
  const [compose, setCompose] = useState(SAMPLE_COMPOSE)
  const [gitProjectName, setGitProjectName] = useState('')
  const [gitRepositoryUrl, setGitRepositoryUrl] = useState('')
  const [gitRef, setGitRef] = useState('main')
  const [gitComposePath, setGitComposePath] = useState('docker-compose.yml')
  const [gitAuthHeaderName, setGitAuthHeaderName] = useState('Authorization')
  const [gitAuthHeaderValue, setGitAuthHeaderValue] = useState('')
  const [logText, setLogText] = useState('')
  const [logUpdatedAt, setLogUpdatedAt] = useState('')
  const [logTruncated, setLogTruncated] = useState(false)
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'live' | 'closed'>('idle')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [gitSubmitting, setGitSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField | null>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [excludeStatus, setExcludeStatus] = useState<Set<string>>(new Set())
  const [excludeSource, setExcludeSource] = useState<Set<string>>(new Set())
  const [excludeServer, setExcludeServer] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(15)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [prefillLoading, setPrefillLoading] = useState(false)
  const [prefillReady, setPrefillReady] = useState('')
  const [pendingDelete, setPendingDelete] = useState<DeploymentRecord | null>(null)
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const serverMap = useMemo(() => new Map(servers.map(item => [item.id, item])), [servers])

  useEffect(() => {
    void fetchServers()
    void fetchDeployments()
  }, [])

  useEffect(() => {
    void fetchStoreShortcuts()
  }, [locale, userApps])

  function showNotice(variant: Notice['variant'], message: string) {
    setNotice({ variant, message })
  }

  useEffect(() => {
    let cancelled = false
    async function loadPrefill() {
      if (prefillMode !== 'target' && prefillMode !== 'installed') return
      setPrefillLoading(true)
      try {
        let loadedCompose: string | null = null
        let resolvedServerId = prefillServerId || 'local'

        if (prefillMode === 'target') {
          if (!prefillAppKey) return
          if (prefillSource === 'template') {
            const response = await iacRead(`templates/apps/${prefillAppKey}/docker-compose.yml`)
            loadedCompose = response.content
          } else {
            const { compose } = await iacLoadLibraryAppFiles(prefillAppKey)
            loadedCompose = compose
          }
        }

        if (prefillMode === 'installed') {
          if (!prefillAppId) return
          const response = await pb.send<AppConfigResponse>(`/api/apps/${prefillAppId}/config`, { method: 'GET' })
          loadedCompose = response.content
          resolvedServerId = response.server_id || resolvedServerId
        }

        if (cancelled) return
        if (!loadedCompose || !loadedCompose.trim()) {
          showNotice('destructive', prefillMode === 'installed'
            ? 'No docker-compose config was found for the selected installed application'
            : 'No docker-compose template was found for the selected application')
          return
        }
        setServerId(resolvedServerId)
        setProjectName(prefillAppName || prefillAppKey || '')
        setCompose(loadedCompose)
        setPrefillReady(prefillAppName || prefillAppKey || '')
        setManualEntryMode(prefillMode === 'installed' ? 'installed-prefill' : 'store-prefill')
        if (autoOpen === '1') setCreateOpen(true)
      } catch {
        if (!cancelled) {
          showNotice('destructive', prefillMode === 'installed'
            ? 'Failed to load deployment config for the selected installed application'
            : 'Failed to load deployment template for the selected application')
        }
      } finally {
        if (!cancelled) setPrefillLoading(false)
      }
    }
    void loadPrefill()
    return () => {
      cancelled = true
    }
  }, [autoOpen, prefillAppId, prefillAppKey, prefillAppName, prefillMode, prefillServerId, prefillSource])

  useEffect(() => {
    if (!deploymentId) return
    void openDetail(deploymentId)
  }, [deploymentId])

  const summary = useMemo(() => ({
    total: deployments.length,
    active: deployments.filter(item => isActiveStatus(item.status)).length,
    completed: deployments.filter(item => item.status === 'success').length,
    failed: deployments.filter(item => item.status === 'failed').length,
  }), [deployments])

  const latestDeployments = useMemo(
    () => [...deployments].sort((left, right) => String(right.updated || '').localeCompare(String(left.updated || ''))).slice(0, 5),
    [deployments]
  )

  const manualDialogCopy = useMemo(() => {
    switch (manualEntryMode) {
      case 'docker-command':
        return {
          title: 'Convert Docker Command to Deployment',
          description: 'Use the shared compose deployment path. Translate the docker run command into docker-compose content before submission.',
          helper: 'Docker command deployment is surfaced as a guided manual compose flow in this MVP.',
        }
      case 'install-script':
        return {
          title: 'Review Source Packages as Deployment Input',
          description: 'Use user-provided compressed source packages as the deployment input for the shared flow.',
          helper: 'Supported source package formats include zip and tar.gz. Review the package and prepare deployable content before submission.',
        }
      case 'store-prefill':
        return {
          title: 'Create Deployment Task',
          description: 'App Store inputs have been prefilled. Review the target server, deployment name, and compose content before starting.',
          helper: 'This deployment uses the same shared manual compose pipeline as custom deployments.',
        }
      case 'installed-prefill':
        return {
          title: 'Create Deployment Task',
          description: 'The current installed compose config has been prefilled. Review and submit the redeploy or upgrade task.',
          helper: 'This entry reuses the same deployment path so history, logs, and detail views stay consistent.',
        }
      default:
        return {
          title: 'Create Deployment Task',
          description: 'Minimal input set: target server, deployment name, and docker-compose content.',
          helper: 'Compose deployment is the recommended custom path for external files and one-off stacks.',
        }
    }
  }, [manualEntryMode])

  const filterOptions = useMemo(() => ({
    status: Array.from(new Set(deployments.map(item => item.status))).sort().map(value => ({ value, label: value })),
    source: Array.from(new Set(deployments.map(item => item.source))).sort().map(value => ({ value, label: value })),
    server: Array.from(new Set(deployments.map(item => item.server_id || 'local'))).sort().map(value => {
      const matched = deployments.find(item => (item.server_id || 'local') === value)
      return { value, label: matched ? getServerLabel(matched) : value }
    }),
  }), [deployments])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return deployments.filter(item => {
      if (excludeStatus.has(item.status)) return false
      if (excludeSource.has(item.source)) return false
      if (excludeServer.has(item.server_id || 'local')) return false
      if (!query) return true
      return [item.id, item.compose_project_name, item.source, item.server_id, item.server_label, item.server_host, item.user_id, item.user_email]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query))
    })
  }, [deployments, excludeServer, excludeSource, excludeStatus, search])

  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems
    const factor = sortDir === 'asc' ? 1 : -1
    return [...filteredItems].sort((left, right) => String(left[sortField] || '').localeCompare(String(right[sortField] || '')) * factor)
  }, [filteredItems, sortDir, sortField])

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize))
  const pagedItems = useMemo(() => sortedItems.slice((page - 1) * pageSize, page * pageSize), [page, pageSize, sortedItems])

  useEffect(() => {
    setPage(1)
  }, [excludeServer, excludeSource, excludeStatus, search, sortDir, sortField])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchDeployments()
    }, summary.active > 0 ? 3000 : 6000)
    return () => window.clearInterval(timer)
  }, [summary.active])

  useEffect(() => {
    if (!detailOpen || !selectedId) return
    void fetchDeploymentDetail(selectedId)
    const timer = window.setInterval(() => {
      void fetchDeploymentDetail(selectedId)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [detailOpen, selectedId])

  useEffect(() => {
    if (!detailOpen || !selectedId || !selectedDeployment) return
    if (!isActiveStatus(selectedDeployment.status)) {
      setStreamStatus('idle')
      void fetchDeploymentLogs(selectedId)
      return
    }
    setStreamStatus('connecting')
    const url = new URL(buildWebSocketUrl(`/api/deployments/${selectedId}/stream`))
    if (pb.authStore.token) url.searchParams.set('token', pb.authStore.token)
    const ws = new WebSocket(url.toString())
    ws.onopen = () => setStreamStatus('live')
    ws.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as DeploymentStreamMessage
        if (message.type === 'error') {
          setStreamStatus('closed')
          return
        }
        if (message.type === 'snapshot') setLogText(message.content || '')
        if (message.type === 'append') setLogText(current => current + (message.content || ''))
        if (message.updated) setLogUpdatedAt(message.updated)
        if (typeof message.execution_log_truncated === 'boolean') setLogTruncated(message.execution_log_truncated)
        if (message.status) setSelectedDeployment(current => (current ? { ...current, status: message.status || current.status } : current))
      } catch {
        setStreamStatus('closed')
      }
    }
    ws.onerror = () => setStreamStatus('closed')
    ws.onclose = () => setStreamStatus(current => (current === 'live' ? 'closed' : current))
    return () => ws.close()
  }, [detailOpen, selectedDeployment, selectedId])

  useEffect(() => {
    if (!logViewportRef.current || !stickToBottomRef.current) return
    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
  }, [logText])

  async function fetchServers() {
    try {
      const response = await pb.send<ServerEntry[]>('/api/ext/docker/servers', { method: 'GET' })
      if (Array.isArray(response) && response.length > 0) {
        setServers(response)
        setServerId(current => (response.some(item => item.id === current) ? current : response[0].id))
      }
    } catch {
      // Keep local fallback.
    }
  }

  async function fetchStoreShortcuts() {
    try {
      const [products, categories] = await Promise.all([
        fetchStoreJson<Product[]>(locale, 'product'),
        fetchStoreJson<PrimaryCategory[]>(locale, 'catalog'),
      ])
      const uniqueProducts = Array.from(new Map(products.map(item => [item.key, item])).values())
      const favoriteOrder = new Map(
        userApps
          .filter(item => item.is_favorite)
          .sort((left, right) => String(right.updated || '').localeCompare(String(left.updated || '')))
          .map((item, index) => [item.app_key, index])
      )
      const favorites = uniqueProducts
        .filter(item => favoriteOrder.has(item.key))
        .sort((left, right) => (favoriteOrder.get(left.key) ?? 0) - (favoriteOrder.get(right.key) ?? 0))
      const nonFavorites = uniqueProducts
        .filter(item => !favoriteOrder.has(item.key))
        .sort(() => Math.random() - 0.5)
      const ordered = [...favorites, ...nonFavorites]
      const detailedProducts = ordered.map(item => ({
        ...item,
        primaryCategoryKey: null,
        secondaryCategoryKeys: item.catalogCollection.items.map(entry => entry.key),
      }))
      setStoreProducts(detailedProducts)
      setStorePrimaryCategories(categories)
      setStoreShortcuts(
        detailedProducts.slice(0, STORE_SHORTCUT_COUNT).map(item => ({
          key: item.key,
          trademark: item.trademark,
          logo: item.logo,
        }))
      )
    } catch {
      setStoreShortcuts([])
      setStoreProducts([])
      setStorePrimaryCategories([])
    }
  }

  async function fetchDeployments() {
    try {
      const response = await pb.send<DeploymentRecord[]>('/api/deployments', { method: 'GET' })
      setDeployments(Array.isArray(response) ? response : [])
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to load deployments')
    } finally {
      setLoading(false)
    }
  }

  async function fetchDeploymentDetail(id: string) {
    setDetailLoading(true)
    try {
      const response = await pb.send<DeploymentRecord>(`/api/deployments/${id}`, { method: 'GET' })
      setSelectedDeployment(response)
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to load deployment detail')
    } finally {
      setDetailLoading(false)
    }
  }

  async function fetchDeploymentLogs(id: string) {
    try {
      const response = await pb.send<DeploymentLogsResponse>(`/api/deployments/${id}/logs`, { method: 'GET' })
      setLogText(response.execution_log || '')
      setLogUpdatedAt(response.updated)
      setLogTruncated(Boolean(response.execution_log_truncated))
    } catch (err) {
      setLogText(err instanceof Error ? err.message : 'Failed to load deployment logs')
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDir('asc')
  }

  async function openDetail(id: string) {
    setSelectedId(id)
    setDetailOpen(true)
    setLogText('')
    setLogUpdatedAt('')
    setLogTruncated(false)
    await fetchDeploymentDetail(id)
  }

  function openStoreShortcut(app: StoreShortcut) {
    setSelectedStoreProduct(storeProducts.find(item => item.key === app.key) ?? null)
    setStoreDetailOpen(true)
  }

  function deployFromStoreProduct(product: StoreShortcut | ProductWithCategories) {
    setStoreDetailOpen(false)
    void navigate({
      to: '/deploy',
      search: {
        prefillMode: 'target',
        prefillSource: 'library',
        prefillAppId: undefined,
        prefillAppKey: product.key,
        prefillAppName: product.trademark,
        prefillServerId: undefined,
        deploymentId: undefined,
        autoOpen: '1',
      },
    })
  }

  function openManualDialog(mode: ManualEntryMode) {
    setManualEntryMode(mode)
    if ((mode === 'docker-command' || mode === 'install-script') && compose === SAMPLE_COMPOSE) {
      setCompose('')
    }
    if (mode === 'compose' && !compose.trim()) {
      setCompose(SAMPLE_COMPOSE)
    }
    setCreateOpen(true)
  }

  function getServerLabel(item: DeploymentRecord): string {
    if (item.server_label) return item.server_label
    if (item.server_id && serverMap.has(item.server_id)) return serverMap.get(item.server_id)?.label || item.server_id
    return item.server_id || 'local'
  }

  function getServerHost(item: DeploymentRecord): string {
    if (item.server_host) return item.server_host
    if (item.server_id && serverMap.has(item.server_id)) return serverMap.get(item.server_id)?.host || '-'
    return item.server_id === 'local' || !item.server_id ? 'local' : '-'
  }

  function getUserLabel(item: DeploymentRecord): string {
    return item.user_email || item.user_id || '-'
  }

  const customEntries: Array<{
    key: ManualEntryMode | 'git-compose'
    title: string
    description: string
    icon: React.ReactNode
    action: () => void
    variant?: 'default' | 'outline'
  }> = [
    {
      key: 'compose',
      title: 'Compose File',
      description: 'Paste or review docker-compose YAML. This is the recommended path for standard app stacks.',
      icon: <FileCode2 className="h-4 w-4" />,
      action: () => openManualDialog('compose'),
      variant: 'default',
    },
    {
      key: 'git-compose',
      title: 'Git Repository',
      description: 'Pull a compose file from a repository branch or tag, then create the deployment task.',
      icon: <GitBranch className="h-4 w-4" />,
      action: () => setGitCreateOpen(true),
      variant: 'outline',
    },
    {
      key: 'docker-command',
      title: 'Docker Command',
      description: 'Convert a docker run command into compose-compatible content before submitting the deployment.',
      icon: <TerminalSquare className="h-4 w-4" />,
      action: () => openManualDialog('docker-command'),
      variant: 'outline',
    },
    {
      key: 'install-script',
      title: 'Source Packages',
      description: 'Use user-provided compressed source packages such as zip or tar.gz as the deployment input source.',
      icon: <Wrench className="h-4 w-4" />,
      action: () => openManualDialog('install-script'),
      variant: 'outline',
    },
  ]

  async function submitDeployment() {
    setSubmitting(true)
    setNotice(null)
    try {
      const created = await pb.send<DeploymentRecord>('/api/deployments/manual-compose', {
        method: 'POST',
        body: { server_id: serverId, project_name: projectName, compose },
      })
      showNotice('default', `Deployment ${created.compose_project_name || created.id} created`)
      setCreateOpen(false)
      await fetchDeployments()
      await openDetail(created.id)
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to create deployment')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitGitDeployment() {
    setGitSubmitting(true)
    setNotice(null)
    try {
      const created = await pb.send<DeploymentRecord>('/api/deployments/git-compose', {
        method: 'POST',
        body: {
          server_id: serverId,
          project_name: gitProjectName,
          repository_url: gitRepositoryUrl,
          ref: gitRef,
          compose_path: gitComposePath,
          auth_header_name: gitAuthHeaderValue.trim() ? gitAuthHeaderName : '',
          auth_header_value: gitAuthHeaderValue,
        },
      })
      showNotice('default', `Deployment ${created.compose_project_name || created.id} created from Git repository`)
      setGitCreateOpen(false)
      await fetchDeployments()
      await openDetail(created.id)
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to create git deployment')
    } finally {
      setGitSubmitting(false)
    }
  }

  async function deleteDeployment(id: string) {
    const target = deployments.find(item => item.id === id)
    const label = target?.compose_project_name || id
    setNotice(null)
    try {
      await pb.send(`/api/deployments/${id}`, { method: 'DELETE' })
      if (selectedId === id) {
        setSelectedId('')
        setSelectedDeployment(null)
        setDetailOpen(false)
      }
      await fetchDeployments()
      showNotice('default', `Deployment ${label} deleted`)
      setPendingDelete(null)
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to delete deployment')
    }
  }

  function renderActionMenu(item: DeploymentRecord) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More actions for ${item.compose_project_name || item.id}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void openDetail(item.id)}>View</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={isActiveStatus(item.status)}
            onClick={() => setPendingDelete(item)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const deploymentTableSection = (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search deployment..." className="w-[220px] pl-9" />
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortableHeader label="Deployment" field="compose_project_name" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
              <TableHead>User</TableHead>
              <TableHead><FilterHeader label="Source" options={filterOptions.source} excluded={excludeSource} onChange={setExcludeSource} /></TableHead>
              <TableHead><FilterHeader label="Status" options={filterOptions.status} excluded={excludeStatus} onChange={setExcludeStatus} /></TableHead>
              <TableHead><FilterHeader label="Server" options={filterOptions.server} excluded={excludeServer} onChange={setExcludeServer} /></TableHead>
              <TableHead>Host</TableHead>
              <TableHead><SortableHeader label="Updated" field="updated" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
              <TableHead className="w-[84px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading deployments...</TableCell></TableRow>
            ) : pagedItems.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No deployment records found.</TableCell></TableRow>
            ) : pagedItems.map(item => (
              <TableRow key={item.id}>
                <TableCell><div><div className="font-medium">{item.compose_project_name}</div><div className="font-mono text-xs text-muted-foreground">{item.id}</div></div></TableCell>
                <TableCell>{getUserLabel(item)}</TableCell>
                <TableCell>{item.source}</TableCell>
                <TableCell><Badge variant={statusVariant(item.status)}>{item.status}</Badge></TableCell>
                <TableCell>
                  <div className="font-medium">{getServerLabel(item)}</div>
                  <div className="text-xs text-muted-foreground">{item.server_id || 'local'}</div>
                </TableCell>
                <TableCell>{getServerHost(item)}</TableCell>
                <TableCell>{formatTime(item.updated)}</TableCell>
                <TableCell className="text-right">{renderActionMenu(item)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{sortedItems.length} total · Page {page} of {totalPages}</span>
        <div className="flex items-center gap-2">
          <select
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            value={pageSize}
            onChange={event => {
              setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])
              setPage(1)
            }}
          >
            {PAGE_SIZE_OPTIONS.map(option => (
              <option key={option} value={option}>{option} / page</option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>Next</Button>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">{summary.total}</span>, Active (<span className="font-semibold text-sky-600">{summary.active}</span>), Completed (<span className="font-semibold text-emerald-600">{summary.completed}</span>), Failed (<span className="font-semibold text-rose-600">{summary.failed}</span>)</div>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{view === 'list' ? 'Deployment List' : 'Deploy Application'}</h1>
          <p className="text-sm text-muted-foreground">{view === 'list' ? 'Browse deployment history and open task details.' : 'Choose an application source and start deployment.'}</p>
        </div>
        <div className="flex items-center gap-2">
          {view === 'home' ? (
            <>
              <Button size="icon" title="Deploy" aria-label="Deploy" onClick={() => openManualDialog('compose')}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" title="View deployment" aria-label="View deployment" asChild>
                <a href="/deployments">
                  <List className="h-4 w-4" />
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button size="icon" title="Deploy" aria-label="Deploy" asChild>
                <a href="/deploy">
                  <Plus className="h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" size="icon" title="Refresh" aria-label="Refresh" onClick={() => void fetchDeployments()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {notice ? (
        <Alert variant={notice.variant} className="flex items-center justify-between gap-3 py-3">
          <AlertDescription className="truncate">{notice.message}</AlertDescription>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close notification" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      ) : null}

      {view === 'list' ? (
        deploymentTableSection
      ) : (
        <div className="space-y-6">
          {prefillLoading ? (
            <Alert>
              <AlertDescription>
                {prefillMode === 'installed'
                  ? `Loading current compose config for ${prefillAppName || prefillAppId}...`
                  : `Loading deploy template for ${prefillAppName || prefillAppKey}...`}
              </AlertDescription>
            </Alert>
          ) : null}
          {prefillReady ? (
            <Alert>
              <AlertDescription>
                {prefillMode === 'installed'
                  ? `${prefillSource === 'upgrade' ? 'Upgrade' : 'Redeploy'} handoff is ready for ${prefillReady}. The shared deployment form has been prefilled with the current installed compose config.`
                  : `App Store handoff is ready for ${prefillReady}. The shared deployment form has been prefilled with its compose template.`}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-sky-200 bg-linear-to-br from-sky-50 via-white to-cyan-50/70">
              <CardHeader className="space-y-3">
                <div className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                  <Store className="h-4 w-4 text-sky-600" />
                  <span>Install from Store</span>
                  <TitleHelp text="Use a Store application shortcut for a fast deploy handoff, or open App Store to browse more applications." />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-8">
                  {storeShortcuts.length === 0
                    ? Array.from({ length: STORE_GRID_SLOTS }).map((_, index) => (
                        <div key={`store-placeholder-${index}`} className="h-[76px] rounded-xl bg-white/30" />
                      ))
                    : storeShortcuts.map(app => (
                        <AppLauncherIcon key={app.key} app={app} onOpen={openStoreShortcut} />
                      ))}
                  {storeShortcuts.length > 0 ? <MoreAppsTile /> : null}
                </div>
                <div className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-white/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900">Need more templates?</div>
                    <div className="text-xs text-muted-foreground">Browse 300+ installable app templates, then hand off directly into deployment.</div>
                  </div>
                  <Button asChild className="justify-between sm:min-w-[180px]">
                    <Link to="/store">
                      Open App Store
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader className="space-y-3">
                <div className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                  <Wrench className="h-4 w-4 text-slate-700" />
                  <span>Custom Deployment</span>
                  <TitleHelp text="Use Compose, a Git repository, a Docker command, or user-provided source packages such as zip and tar.gz as deployment inputs." />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {customEntries.map(item => (
                    <button
                      key={item.key}
                      type="button"
                      className={cn(
                        'flex h-full flex-col rounded-2xl border px-4 py-4 text-left transition-colors',
                        item.variant === 'default'
                          ? 'border-slate-900 bg-slate-950 text-white hover:bg-slate-900'
                          : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100/80'
                      )}
                      onClick={item.action}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl', item.variant === 'default' ? 'bg-white/10 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>
                          {item.icon}
                        </span>
                        <ArrowRight className={cn('h-4 w-4', item.variant === 'default' ? 'text-white/80' : 'text-slate-400')} />
                      </div>
                      <div className={cn('mt-4 text-sm font-semibold', item.variant === 'default' ? 'text-white' : 'text-slate-950')}>
                        {item.title}
                      </div>
                      <div className={cn('mt-1 text-xs leading-5', item.variant === 'default' ? 'text-white/75' : 'text-muted-foreground')}>
                        {item.description}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Latest Deployments</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <a href="/deployments">View deployment list</a>
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">Loading deployments...</div>
              ) : latestDeployments.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">No deployment records yet.</div>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Deployment</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Server</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead className="w-[84px] text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latestDeployments.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{item.compose_project_name || item.id}</div>
                              <div className="mt-1 font-mono text-xs text-muted-foreground">{item.id}</div>
                            </div>
                          </TableCell>
                          <TableCell>{getUserLabel(item)}</TableCell>
                          <TableCell>{item.source}</TableCell>
                          <TableCell>
                            <div className="font-medium">{getServerLabel(item)}</div>
                            <div className="text-xs text-muted-foreground">{getServerHost(item)}</div>
                          </TableCell>
                          <TableCell><Badge variant={statusVariant(item.status)}>{item.status}</Badge></TableCell>
                          <TableCell>{formatTime(item.updated)}</TableCell>
                          <TableCell className="text-right">{renderActionMenu(item)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{selectedDeployment?.compose_project_name || 'Deployment Detail'}</DialogTitle>
            <DialogDescription>Metadata, step timeline, and logs are stacked vertically to keep the reading flow stable.</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Loading deployment detail...</div>
          ) : selectedDeployment ? (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Metadata</CardTitle></CardHeader>
                <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
                  <div><span className="text-muted-foreground">Deployment:</span> {selectedDeployment.compose_project_name}</div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusVariant(selectedDeployment.status)}>{selectedDeployment.status}</Badge></div>
                  <div><span className="text-muted-foreground">Stream:</span> {streamStatus}</div>
                  <div><span className="text-muted-foreground">Deployment ID:</span> <span className="font-mono text-xs">{selectedDeployment.id}</span></div>
                  <div><span className="text-muted-foreground">User:</span> {getUserLabel(selectedDeployment)}</div>
                  <div><span className="text-muted-foreground">Server:</span> {getServerLabel(selectedDeployment)}</div>
                  <div><span className="text-muted-foreground">Server Host:</span> {getServerHost(selectedDeployment)}</div>
                  <div><span className="text-muted-foreground">Project Dir:</span> <span className="break-all">{selectedDeployment.project_dir || '-'}</span></div>
                  <div><span className="text-muted-foreground">Created:</span> {formatTime(selectedDeployment.created)}</div>
                  <div><span className="text-muted-foreground">Started:</span> {formatTime(selectedDeployment.started_at)}</div>
                  <div><span className="text-muted-foreground">Finished:</span> {formatTime(selectedDeployment.finished_at)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Lifecycle Timeline</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {(selectedDeployment.lifecycle || []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">No lifecycle timeline available yet.</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto pb-1">
                        <div className="flex min-w-max items-center gap-2">
                          {(selectedDeployment.lifecycle || []).map((step, index, list) => (
                            <div key={step.key} className="flex items-center gap-2">
                              <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap', stepTone(step.status))}>
                                <span className={cn('h-2.5 w-2.5 rounded-full', step.status === 'completed' ? 'bg-emerald-500' : step.status === 'terminal' ? 'bg-rose-500' : step.status === 'active' ? 'bg-sky-500' : 'bg-slate-300')} />
                                <span className="font-medium">{step.label}</span>
                              </div>
                              {index < list.length - 1 ? <div className={cn('h-px w-8', stepConnectorTone(step.status))} /> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {(selectedDeployment.lifecycle || []).filter(step => step.status !== 'pending').map(step => (
                          <div key={`${step.key}-meta`} className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                            <div className={cn('font-medium', step.status === 'completed' ? 'text-emerald-700' : step.status === 'terminal' ? 'text-rose-700' : step.status === 'active' ? 'text-sky-700' : 'text-slate-500')}>
                              {step.label} · {step.status}
                            </div>
                            {step.detail ? <div className="mt-1 line-clamp-2">{step.detail}</div> : null}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Execution Stage Details</CardTitle></CardHeader>
                <CardContent className="grid gap-2 lg:grid-cols-2">
                  {(selectedDeployment.steps || []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">No execution stage details available yet.</div>
                  ) : (selectedDeployment.steps || []).map(step => (
                    <div key={`${step.key}-detail`} className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      <div className={cn('font-medium', step.status === 'success' ? 'text-emerald-700' : step.status === 'failed' ? 'text-rose-700' : step.status === 'running' ? 'text-sky-700' : 'text-slate-500')}>
                        {step.label} · {step.status}
                      </div>
                      <div className="mt-1">Started: {formatTime(step.started_at)} · Finished: {formatTime(step.finished_at)}</div>
                      {step.detail ? <div className="mt-1 line-clamp-2">{step.detail}</div> : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">Execution Log</CardTitle><div className="text-xs text-muted-foreground">{logTruncated ? 'truncated · ' : ''}{logUpdatedAt ? `updated ${formatTime(logUpdatedAt)}` : 'waiting for logs'}</div></CardHeader>
                <CardContent>
                  <div ref={logViewportRef} className="h-[520px] overflow-auto rounded-xl bg-black px-4 py-3 font-mono text-[11px] leading-5 text-slate-100" onScroll={event => {
                    const target = event.currentTarget
                    stickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 32
                  }}>
                    <pre className={cn('whitespace-pre-wrap break-words', !logText && 'text-slate-500')}>{logText || 'No execution log yet.'}</pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
          <DialogFooter><Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{manualDialogCopy.title}</DialogTitle>
            <DialogDescription>{manualDialogCopy.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{manualDialogCopy.helper}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="deploy-project-name">Name</Label><Input id="deploy-project-name" value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="demo-nginx" /></div>
              <div className="space-y-2"><Label htmlFor="deploy-server-id">Target Server</Label><select id="deploy-server-id" className="border-input bg-background h-10 rounded-md border px-3 text-sm" value={serverId} onChange={event => setServerId(event.target.value)}>{servers.map(item => <option key={item.id} value={item.id}>{item.label} ({item.host})</option>)}</select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="deploy-compose">docker-compose.yml</Label><Textarea id="deploy-compose" className="min-h-[300px] font-mono text-xs" value={compose} onChange={event => setCompose(event.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={() => void submitDeployment()} disabled={submitting || !projectName.trim() || !compose.trim()}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create Deployment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={gitCreateOpen} onOpenChange={setGitCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create Deployment from Git Repository</DialogTitle>
            <DialogDescription>Provide the Git repository, ref, and compose file path. The backend resolves the raw compose file and creates a deployment task through the shared flow.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="git-project-name">Name</Label><Input id="git-project-name" value={gitProjectName} onChange={event => setGitProjectName(event.target.value)} placeholder="Optional: defaults to repository name" /></div>
              <div className="space-y-2"><Label htmlFor="git-server-id">Target Server</Label><select id="git-server-id" className="border-input bg-background h-10 rounded-md border px-3 text-sm" value={serverId} onChange={event => setServerId(event.target.value)}>{servers.map(item => <option key={item.id} value={item.id}>{item.label} ({item.host})</option>)}</select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="git-repository-url">Repository URL</Label><Input id="git-repository-url" value={gitRepositoryUrl} onChange={event => setGitRepositoryUrl(event.target.value)} placeholder="https://github.com/org/repo" /></div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="git-ref">Ref</Label><Input id="git-ref" value={gitRef} onChange={event => setGitRef(event.target.value)} placeholder="main" /></div>
              <div className="space-y-2"><Label htmlFor="git-compose-path">Compose Path</Label><Input id="git-compose-path" value={gitComposePath} onChange={event => setGitComposePath(event.target.value)} placeholder="docker-compose.yml" /></div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="text-sm font-medium">Private Repository Access</div>
              <div className="mt-1 text-xs text-muted-foreground">Optional. The header is used only to fetch the compose file and is not stored in deployment records.</div>
              <div className="mt-3 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-2"><Label htmlFor="git-auth-header-name">Header Name</Label><Input id="git-auth-header-name" value={gitAuthHeaderName} onChange={event => setGitAuthHeaderName(event.target.value)} placeholder="Authorization" /></div>
                <div className="space-y-2"><Label htmlFor="git-auth-header-value">Header Value</Label><Input id="git-auth-header-value" value={gitAuthHeaderValue} onChange={event => setGitAuthHeaderValue(event.target.value)} placeholder="Bearer <token>" /></div>
              </div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setGitCreateOpen(false)} disabled={gitSubmitting}>Cancel</Button><Button onClick={() => void submitGitDeployment()} disabled={gitSubmitting || !gitRepositoryUrl.trim() || !gitComposePath.trim()}>{gitSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}Create Deployment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deployment</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `Delete ${pendingDelete.compose_project_name || pendingDelete.id}? This removes the deployment record from history.`
                : 'Delete this deployment record?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void deleteDeployment(pendingDelete.id)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AppDetailModal
        product={selectedStoreProduct}
        primaryCategories={storePrimaryCategories}
        locale={locale}
        open={storeDetailOpen}
        onClose={() => setStoreDetailOpen(false)}
        userApps={userApps}
        showDeploy
        onDeploy={() => {
          if (selectedStoreProduct) deployFromStoreProduct(selectedStoreProduct)
        }}
      />
    </div>
  )
}