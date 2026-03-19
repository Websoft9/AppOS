import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowRight, ArrowUp, Filter, GitBranch, Loader2, Plus, RefreshCw, Search, Store } from 'lucide-react'
import { pb } from '@/lib/pb'
import { iacLoadLibraryAppFiles, iacRead } from '@/lib/iac-api'
import { type AppConfigResponse } from '@/pages/apps/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
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
  source: string
  status: string
  adapter: string
  compose_project_name: string
  project_dir: string
  rendered_compose: string
  error_summary: string
  created: string
  updated: string
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

type SortField = 'compose_project_name' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 12
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
}: DeployPageProps) {
  const [surfaceTab, setSurfaceTab] = useState('entry')
  const [servers, setServers] = useState<ServerEntry[]>([{ id: 'local', label: 'local', host: 'local', status: 'online' }])
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentRecord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [gitCreateOpen, setGitCreateOpen] = useState(false)
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
  const [refreshing, setRefreshing] = useState(false)
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [prefillLoading, setPrefillLoading] = useState(false)
  const [prefillReady, setPrefillReady] = useState('')
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    void fetchServers()
    void fetchDeployments()
  }, [])

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
          setError(prefillMode === 'installed'
            ? 'No docker-compose config was found for the selected installed application'
            : 'No docker-compose template was found for the selected application')
          return
        }
        setServerId(resolvedServerId)
        setProjectName(prefillAppName || prefillAppKey || '')
        setCompose(loadedCompose)
        setPrefillReady(prefillAppName || prefillAppKey || '')
        setSurfaceTab('entry')
        if (autoOpen === '1') setCreateOpen(true)
      } catch {
        if (!cancelled) {
          setError(prefillMode === 'installed'
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

  const filterOptions = useMemo(() => ({
    status: Array.from(new Set(deployments.map(item => item.status))).sort().map(value => ({ value, label: value })),
    source: Array.from(new Set(deployments.map(item => item.source))).sort().map(value => ({ value, label: value })),
    server: Array.from(new Set(deployments.map(item => item.server_id || 'local'))).sort().map(value => ({ value, label: value })),
  }), [deployments])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return deployments.filter(item => {
      if (excludeStatus.has(item.status)) return false
      if (excludeSource.has(item.source)) return false
      if (excludeServer.has(item.server_id || 'local')) return false
      if (!query) return true
      return [item.id, item.compose_project_name, item.source, item.server_id].filter(Boolean).some(value => String(value).toLowerCase().includes(query))
    })
  }, [deployments, excludeServer, excludeSource, excludeStatus, search])

  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems
    const factor = sortDir === 'asc' ? 1 : -1
    return [...filteredItems].sort((left, right) => String(left[sortField] || '').localeCompare(String(right[sortField] || '')) * factor)
  }, [filteredItems, sortDir, sortField])

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE))
  const pagedItems = useMemo(() => sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page, sortedItems])

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

  async function fetchDeployments(showRefresh = false) {
    if (showRefresh) setRefreshing(true)
    try {
      const response = await pb.send<DeploymentRecord[]>('/api/deployments', { method: 'GET' })
      setDeployments(Array.isArray(response) ? response : [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployments')
    } finally {
      setLoading(false)
      if (showRefresh) setRefreshing(false)
    }
  }

  async function fetchDeploymentDetail(id: string) {
    setDetailLoading(true)
    try {
      const response = await pb.send<DeploymentRecord>(`/api/deployments/${id}`, { method: 'GET' })
      setSelectedDeployment(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployment detail')
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
    setSurfaceTab('pipelines')
    setSelectedId(id)
    setDetailOpen(true)
    setLogText('')
    setLogUpdatedAt('')
    setLogTruncated(false)
    await fetchDeploymentDetail(id)
  }

  async function submitDeployment() {
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const created = await pb.send<DeploymentRecord>('/api/deployments/manual-compose', {
        method: 'POST',
        body: { server_id: serverId, project_name: projectName, compose },
      })
      setSuccess(`Deployment pipeline ${created.compose_project_name || created.id} created`)
      setSurfaceTab('pipelines')
      setCreateOpen(false)
      await fetchDeployments()
      await openDetail(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deployment')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitGitDeployment() {
    setGitSubmitting(true)
    setError('')
    setSuccess('')
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
      setSuccess(`Git deployment pipeline ${created.compose_project_name || created.id} created`)
      setSurfaceTab('pipelines')
      setGitCreateOpen(false)
      await fetchDeployments()
      await openDetail(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create git deployment')
    } finally {
      setGitSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Deploy Center</h1>
          <p className="text-sm text-muted-foreground">Use the entry tab to start a deployment path, and the pipeline tab to monitor every deployment run.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void fetchDeployments(true)} disabled={refreshing}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Deploy</Button>
        </div>
      </div>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {success ? <Alert><AlertDescription>{success}</AlertDescription></Alert> : null}

      <Tabs value={surfaceTab} onValueChange={setSurfaceTab} className="space-y-6">
        <TabsList className="grid w-full max-w-[360px] grid-cols-2">
          <TabsTrigger value="entry">Deploy Entry</TabsTrigger>
          <TabsTrigger value="pipelines">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="entry" className="mt-0 space-y-6">
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
                  ? `${prefillSource === 'upgrade' ? 'Upgrade' : 'Redeploy'} handoff is ready for ${prefillReady}. The manual pipeline dialog has been prefilled with the current installed compose config.`
                  : `Target-based deploy is ready for ${prefillReady}. The manual pipeline dialog has been prefilled with its compose template.`}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="border-sky-200 bg-linear-to-br from-sky-50 to-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Store className="h-4 w-4 text-sky-600" />
                  Target-Based Auto Deploy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <p>Pick a target app from App Store and jump here with its compose template preloaded for deployment.</p>
                <div className="rounded-lg border border-sky-100 bg-white/80 px-3 py-2 text-xs text-slate-600">
                  Best for template-based installs and standard app rollouts.
                </div>
                {prefillReady ? (
                  <Button className="w-full justify-between" onClick={() => setCreateOpen(true)}>
                    Open Prefilled Pipeline
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button asChild className="w-full justify-between">
                    <Link to="/store">
                      Open App Store
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="border-amber-200 bg-linear-to-br from-amber-50 to-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4 text-amber-600" />
                  Git-Based Deploy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <p>Connect a repository and generate a deployable pipeline from versioned application sources.</p>
                <div className="rounded-lg border border-amber-100 bg-white/80 px-3 py-2 text-xs text-slate-600">
                  Pull a compose file from a git repository using repository URL, ref, and compose path.
                </div>
                <Button variant="outline" className="w-full justify-between" onClick={() => setGitCreateOpen(true)}>
                  Create Git Pipeline
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-emerald-200 bg-linear-to-br from-emerald-50 to-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="h-4 w-4 text-emerald-600" />
                  Manual Deploy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <p>Paste docker compose content, choose a target server, and create a pipeline directly.</p>
                <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2 text-xs text-slate-600">
                  Best for custom stacks, external compose files, and one-off deployment trials.
                </div>
                <Button className="w-full justify-between" onClick={() => setCreateOpen(true)}>
                  Create Manual Pipeline
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline Health Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
                  <div className="mt-1 text-2xl font-semibold">{summary.total}</div>
                </div>
                <div className="rounded-xl border px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Active</div>
                  <div className="mt-1 text-2xl font-semibold text-sky-600">{summary.active}</div>
                </div>
                <div className="rounded-xl border px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Completed</div>
                  <div className="mt-1 text-2xl font-semibold text-emerald-600">{summary.completed}</div>
                </div>
                <div className="rounded-xl border px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Failed</div>
                  <div className="mt-1 text-2xl font-semibold text-rose-600">{summary.failed}</div>
                </div>
              </div>
              <Button variant="outline" onClick={() => setSurfaceTab('pipelines')}>
                Open Pipeline View
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pipelines" className="mt-0 space-y-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by id, name, source, or server" className="pl-9" />
          </div>

          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><SortableHeader label="Pipeline" field="compose_project_name" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
                  <TableHead><FilterHeader label="Source" options={filterOptions.source} excluded={excludeSource} onChange={setExcludeSource} /></TableHead>
                  <TableHead><FilterHeader label="Status" options={filterOptions.status} excluded={excludeStatus} onChange={setExcludeStatus} /></TableHead>
                  <TableHead><FilterHeader label="Server" options={filterOptions.server} excluded={excludeServer} onChange={setExcludeServer} /></TableHead>
                  <TableHead><SortableHeader label="Created" field="created" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
                  <TableHead><SortableHeader label="Updated" field="updated" current={sortField} dir={sortDir} onSort={handleSort} /></TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading pipelines...</TableCell></TableRow>
                ) : pagedItems.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No deployment pipelines found.</TableCell></TableRow>
                ) : pagedItems.map(item => (
                  <TableRow key={item.id}>
                    <TableCell><div><div className="font-medium">{item.compose_project_name}</div><div className="font-mono text-xs text-muted-foreground">{item.id}</div></div></TableCell>
                    <TableCell>{item.source}</TableCell>
                    <TableCell><Badge variant={statusVariant(item.status)}>{item.status}</Badge></TableCell>
                    <TableCell>{item.server_id || 'local'}</TableCell>
                    <TableCell>{formatTime(item.created)}</TableCell>
                    <TableCell>{formatTime(item.updated)}</TableCell>
                    <TableCell className="text-right"><Button variant="ghost" onClick={() => void openDetail(item.id)}>Open</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{sortedItems.length} total · Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>Next</Button>
              </div>
            </div>
          ) : null}

          <div className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">{summary.total}</span>, Active (<span className="font-semibold text-sky-600">{summary.active}</span>), Completed (<span className="font-semibold text-emerald-600">{summary.completed}</span>), Failed (<span className="font-semibold text-rose-600">{summary.failed}</span>)</div>
        </TabsContent>
      </Tabs>

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
                  <div><span className="text-muted-foreground">Pipeline:</span> {selectedDeployment.compose_project_name}</div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusVariant(selectedDeployment.status)}>{selectedDeployment.status}</Badge></div>
                  <div><span className="text-muted-foreground">Stream:</span> {streamStatus}</div>
                  <div><span className="text-muted-foreground">Deployment ID:</span> <span className="font-mono text-xs">{selectedDeployment.id}</span></div>
                  <div><span className="text-muted-foreground">Server:</span> {selectedDeployment.server_id || 'local'}</div>
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
            <DialogTitle>Create Deployment Pipeline</DialogTitle>
            <DialogDescription>Minimal input set: target server, pipeline name, and docker-compose content.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="deploy-project-name">Name</Label><Input id="deploy-project-name" value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="demo-nginx" /></div>
              <div className="space-y-2"><Label htmlFor="deploy-server-id">Target Server</Label><select id="deploy-server-id" className="border-input bg-background h-10 rounded-md border px-3 text-sm" value={serverId} onChange={event => setServerId(event.target.value)}>{servers.map(item => <option key={item.id} value={item.id}>{item.label} ({item.host})</option>)}</select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="deploy-compose">docker-compose.yml</Label><Textarea id="deploy-compose" className="min-h-[300px] font-mono text-xs" value={compose} onChange={event => setCompose(event.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={() => void submitDeployment()} disabled={submitting || !projectName.trim() || !compose.trim()}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create Pipeline</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={gitCreateOpen} onOpenChange={setGitCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create Git Deployment Pipeline</DialogTitle>
            <DialogDescription>Provide the repository, ref, and compose file path. The backend resolves the raw compose file and creates a deployment pipeline.</DialogDescription>
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
          <DialogFooter><Button variant="outline" onClick={() => setGitCreateOpen(false)} disabled={gitSubmitting}>Cancel</Button><Button onClick={() => void submitGitDeployment()} disabled={gitSubmitting || !gitRepositoryUrl.trim() || !gitComposePath.trim()}>{gitSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}Create Git Pipeline</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}