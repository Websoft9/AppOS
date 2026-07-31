import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Container,
  Download,
  Eraser,
  HardDrive,
  LayoutDashboard,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Settings2,
  TerminalSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { ContainersTab } from '@/components/docker/ContainersTab'
import { ImagesTab, type ImagesTabRef } from '@/components/docker/ImagesTab'
import { NetworksTab, type NetworksTabRef } from '@/components/docker/NetworksTab'
import { VolumesTab, type VolumesTabRef } from '@/components/docker/VolumesTab'
import { ComposeTab, type ComposeTabSummary } from '@/components/docker/ComposeTab'
import {
  DockerDependencyAlert,
  getDockerDependencyIssue,
} from '@/components/docker/DockerDependencyAlert'
import { dockerApiPath, dockerTargetsPath } from '@/lib/docker-api'
import { cn } from '@/lib/utils'

const LazyTerminalPanel = lazy(() =>
  import('@/components/connect/TerminalPanel').then(module => ({ default: module.TerminalPanel }))
)

interface HostEntry {
  id: string
  label: string
  status: 'online' | 'offline'
  reason?: string
}

type DockerHostState = 'loading' | 'ready' | 'offline'

interface DockerPanelProps {
  serverId: string
  className?: string
  showWorkspaceHeader?: boolean
}

type ContainerPageSize = 25 | 50 | 100

type ContainerVisibleColumns = {
  ports: boolean
  volumes: boolean
  status: boolean
  created: boolean
  cpu: boolean
  mem: boolean
  network: boolean
  compose: boolean
}

type ContainerStateFilter = 'all' | 'running' | 'exited' | 'paused' | 'created'
type DockerTabId = 'overview' | 'containers' | 'images' | 'volumes' | 'networks' | 'compose'

const DOCKER_PAGE_SIZE_KEY = 'docker.list.page_size'
const MIN_DOCKER_REFRESH_SPIN_MS = 650
const DOCKER_TARGETS_REFRESH_INTERVAL_MS = 15_000

function loadGlobalPageSize(): ContainerPageSize {
  try {
    const raw = Number(localStorage.getItem(DOCKER_PAGE_SIZE_KEY) || '50')
    if (raw === 25 || raw === 50 || raw === 100) return raw
  } catch {
    // ignore invalid local storage
  }
  return 50
}

const DEFAULT_CONTAINER_VISIBLE_COLUMNS: ContainerVisibleColumns = {
  ports: true,
  volumes: true,
  status: true,
  created: false,
  cpu: false,
  mem: false,
  network: false,
  compose: true,
}

interface OverviewContainer {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
}

interface OverviewImage {
  ID: string
  Repository: string
  Tag: string
}

interface OverviewVolume {
  Name: string
}

interface OverviewNetwork {
  ID: string
  Name: string
}

interface OverviewComposeProject {
  Name: string
  Status: string
}

function parseDockerJsonLines<T>(output: string): T[] {
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
    .filter(Boolean) as T[]
}

function parseComposeProjects(output: string): OverviewComposeProject[] {
  if (!output.trim()) return []
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed)) return parsed as OverviewComposeProject[]
    return [parsed as OverviewComposeProject]
  } catch {
    return parseDockerJsonLines<OverviewComposeProject>(output)
  }
}

function getContainerDisplayName(container: OverviewContainer) {
  return (container.Names || container.ID || '-').replace(/^\/+/, '')
}

function isComposeProjectRunning(project: OverviewComposeProject) {
  return (project.Status || '').toLowerCase().includes('running')
}

function OverviewTab({
  serverId,
  disabled,
  active,
  embeddedInWorkspace = false,
  onSelectTab,
  onFilterContainersByNames,
  onOpenPullImage,
  onOpenPruneImages,
  onOpenPruneVolumes,
}: {
  serverId: string
  disabled: boolean
  active: boolean
  embeddedInWorkspace?: boolean
  onSelectTab: (tabId: DockerTabId) => void
  onFilterContainersByNames: (names: string[]) => void
  onOpenPullImage: () => void
  onOpenPruneImages: () => void
  onOpenPruneVolumes: () => void
}) {
  const containersQuery = useQuery<OverviewContainer[]>({
    queryKey: ['docker', 'containers', serverId],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/containers'), {
        method: 'GET',
      })
      return parseDockerJsonLines<OverviewContainer>(res.output)
    },
    enabled: active && !disabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const imagesQuery = useQuery<OverviewImage[]>({
    queryKey: ['docker', 'images', serverId],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/images'), {
        method: 'GET',
      })
      return parseDockerJsonLines<OverviewImage>(res.output)
    },
    enabled: active && !disabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const volumesQuery = useQuery<OverviewVolume[]>({
    queryKey: ['docker', 'volumes', serverId],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/volumes'), {
        method: 'GET',
      })
      return parseDockerJsonLines<OverviewVolume>(res.output)
    },
    enabled: active && !disabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const networksQuery = useQuery<OverviewNetwork[]>({
    queryKey: ['docker', 'networks', serverId],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/networks'), {
        method: 'GET',
      })
      return parseDockerJsonLines<OverviewNetwork>(res.output)
    },
    enabled: active && !disabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const composeQuery = useQuery<OverviewComposeProject[]>({
    queryKey: ['docker', 'compose', serverId],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/compose/ls'), {
        method: 'GET',
      })
      return parseComposeProjects(res.output)
    },
    enabled: active && !disabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  const loadError = [
    containersQuery.error,
    imagesQuery.error,
    volumesQuery.error,
    networksQuery.error,
    composeQuery.error,
  ].find(Boolean)

  const containers = containersQuery.data ?? []
  const images = imagesQuery.data ?? []
  const volumes = volumesQuery.data ?? []
  const networks = networksQuery.data ?? []
  const projects = composeQuery.data ?? []
  const loading =
    containersQuery.isLoading ||
    imagesQuery.isLoading ||
    volumesQuery.isLoading ||
    networksQuery.isLoading ||
    composeQuery.isLoading

  const stoppedCount = containers.filter(container => container.State !== 'running').length
  const nonRunningProjects = projects.filter(project => !isComposeProjectRunning(project)).length
  const taggedImages = images.filter(image => image.Tag && image.Tag !== '<none>').length

  const resourceCards = [
    {
      tab: 'containers' as const,
      label: 'Containers',
      count: containers.length,
      stateLine: stoppedCount > 0 ? `${stoppedCount} stopped` : 'all running',
      warning: stoppedCount > 0,
      icon: Container,
    },
    {
      tab: 'compose' as const,
      label: 'Compose',
      count: projects.length,
      stateLine: nonRunningProjects > 0 ? `${nonRunningProjects} attention` : 'all running',
      warning: nonRunningProjects > 0,
      icon: Boxes,
    },
    {
      tab: 'images' as const,
      label: 'Images',
      count: images.length,
      stateLine: `${taggedImages} tagged`,
      warning: false,
      icon: Box,
    },
    {
      tab: 'volumes' as const,
      label: 'Volumes',
      count: volumes.length,
      stateLine: 'clean',
      warning: false,
      icon: HardDrive,
    },
    {
      tab: 'networks' as const,
      label: 'Networks',
      count: networks.length,
      stateLine: 'ok',
      warning: false,
      icon: Network,
    },
  ]

  const attentionIssues = useMemo(() => {
    const unhealthyContainers = containers
      .filter(container => (container.Status || '').toLowerCase().includes('unhealthy'))
      .map(container => ({
        id: `unhealthy-${container.ID}`,
        type: 'container' as const,
        name: getContainerDisplayName(container),
        reason: 'Unhealthy container',
        severity: 'destructive' as const,
      }))

    const unhealthyIds = new Set(
      containers
        .filter(container => (container.Status || '').toLowerCase().includes('unhealthy'))
        .map(container => container.ID)
    )

    const stoppedContainers = containers
      .filter(container => container.State !== 'running' && !unhealthyIds.has(container.ID))
      .map(container => ({
        id: `stopped-${container.ID}`,
        type: 'container' as const,
        name: getContainerDisplayName(container),
        reason: container.State ? `${container.State} container` : 'Stopped container',
        severity: 'secondary' as const,
      }))

    const composeIssues = projects
      .filter(project => !isComposeProjectRunning(project))
      .map(project => ({
        id: `compose-${project.Name}`,
        type: 'compose' as const,
        name: project.Name || 'Compose project',
        reason: 'Compose project needs attention',
        severity: 'secondary' as const,
      }))

    return [...unhealthyContainers, ...stoppedContainers, ...composeIssues]
  }, [containers, projects])

  const visibleAttentionIssues = attentionIssues.slice(0, 6)
  const hiddenAttentionCount = Math.max(0, attentionIssues.length - visibleAttentionIssues.length)
  const hasContainerIssues = attentionIssues.some(issue => issue.type === 'container')
  const hasComposeIssues = attentionIssues.some(issue => issue.type === 'compose')
  const loadErrorMessage = loadError
    ? getApiErrorMessage(loadError, 'Failed to load Docker overview')
    : null
  const dependencyIssue = getDockerDependencyIssue(loadError ?? loadErrorMessage)
  const dependencyFocusSource = containersQuery.error
    ? 'containers'
    : composeQuery.error
      ? 'compose'
      : imagesQuery.error
        ? 'images'
        : volumesQuery.error
          ? 'volumes'
          : networksQuery.error
            ? 'networks'
            : 'overview'

  if (loadError) {
    return dependencyIssue && loadErrorMessage ? (
      <DockerDependencyAlert
        serverId={serverId}
        message={loadErrorMessage}
        focusSource={dependencyFocusSource}
      />
    ) : (
      <Alert variant="destructive">
        <AlertDescription>{loadErrorMessage}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-4', embeddedInWorkspace ? 'pt-0' : 'pt-4')}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {resourceCards.map(card => {
          const Icon = card.icon
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => onSelectTab(card.tab)}
              className="min-w-0 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className={cn('h-full gap-3 py-4 transition-colors hover:bg-muted/30')}>
                <CardHeader className="px-4 pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardDescription>{card.label}</CardDescription>
                      <CardTitle className="mt-2 text-3xl">
                        {loading ? '...' : card.count}
                      </CardTitle>
                    </div>
                    <div
                      className={cn(
                        'rounded-lg border bg-muted/40 p-2 text-muted-foreground',
                        card.warning &&
                          'border-amber-300/70 bg-amber-100/70 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent
                  className={cn(
                    'flex items-center gap-1 px-4 pt-0 text-sm text-muted-foreground',
                    card.warning && 'font-medium text-amber-700 dark:text-amber-300'
                  )}
                >
                  {loading ? 'Loading Docker inventory...' : card.stateLine}
                  {!loading && card.warning && <AlertTriangle className="h-3.5 w-3.5" />}
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      <Card className="gap-4 py-4">
        <CardHeader className="px-4 pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Needs Attention</CardTitle>
              <CardDescription>
                Actionable Docker issues found from current inventory data.
              </CardDescription>
            </div>
            {!loading && (
              <Badge variant={attentionIssues.length > 0 ? 'secondary' : 'outline'}>
                {attentionIssues.length} {attentionIssues.length === 1 ? 'issue' : 'issues'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          {loading ? (
            <div className="rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              Loading Docker inventory states...
            </div>
          ) : visibleAttentionIssues.length > 0 ? (
            <>
              <div className="space-y-2">
                {visibleAttentionIssues.map(issue => (
                  <button
                    key={issue.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => {
                      if (issue.type === 'container') {
                        onFilterContainersByNames([issue.name])
                      } else {
                        onSelectTab('compose')
                      }
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          'rounded-full border p-1.5 text-muted-foreground',
                          issue.severity === 'destructive' &&
                            'border-destructive/30 bg-destructive/10 text-destructive'
                        )}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{issue.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{issue.reason}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={issue.severity}>
                        {issue.type === 'container' ? 'Container' : 'Compose'}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        View <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {hiddenAttentionCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/10 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    Showing first {visibleAttentionIssues.length} of {attentionIssues.length}{' '}
                    issues.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hasContainerIssues && (
                      <Button variant="outline" size="sm" onClick={() => onSelectTab('containers')}>
                        View containers
                      </Button>
                    )}
                    {hasComposeIssues && (
                      <Button variant="outline" size="sm" onClick={() => onSelectTab('compose')}>
                        View compose
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">No issues detected</div>
                <div className="text-sm text-muted-foreground">
                  All discovered Docker resources look operational from current inventory data.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="gap-4 py-4">
        <CardHeader className="px-4 pb-0">
          <CardTitle className="text-base">Quick Actions</CardTitle>
          <CardDescription>Common Docker actions for this server.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 px-4">
          <Link
            to="/deploy/create"
            search={{
              entry: undefined,
              prefillMode: undefined,
              prefillSource: undefined,
              prefillAppId: undefined,
              prefillAppKey: undefined,
              prefillAppName: undefined,
              prefillServerId: undefined,
            }}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Create Compose
          </Link>
          <Button variant="outline" size="sm" onClick={onOpenPullImage} disabled={disabled}>
            <Download className="mr-1.5 h-4 w-4" /> Pull Image
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={disabled}>
                <Eraser className="mr-1.5 h-4 w-4" /> Prune Resources
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={onOpenPruneImages}>Prune images</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenPruneVolumes}>Prune volumes</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>
    </div>
  )
}

export function DockerPanel({ serverId, className, showWorkspaceHeader = true }: DockerPanelProps) {
  const queryClient = useQueryClient()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const refreshFeedbackTimerRef = useRef<number | null>(null)
  const imagesTabRef = useRef<ImagesTabRef>(null)
  const volumesTabRef = useRef<VolumesTabRef>(null)
  const networksTabRef = useRef<NetworksTabRef>(null)
  const [hosts, setHosts] = useState<HostEntry[]>([])
  const [hostsLoading, setHostsLoading] = useState(true)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [activeTab, setActiveTab] = useState<DockerTabId>('overview')
  const [containerFilter, setContainerFilter] = useState('')
  const [containerFilterNames, setContainerFilterNames] = useState<string[]>([])
  const [volumeFilterNames, setVolumeFilterNames] = useState<string[]>([])
  const [composeFilter, setComposeFilter] = useState('')
  const [imagesFilter, setImagesFilter] = useState('')
  const [imagesUsageFilter, setImagesUsageFilter] = useState<'all' | 'used' | 'unused'>('all')
  const [imagesPage, setImagesPage] = useState(1)
  const [imagesPageSize, setImagesPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [imagesSummary, setImagesSummary] = useState<{
    totalItems: number
    totalPages: number
    usedItems: number
    unusedItems: number
  } | null>(null)
  const [imagesPullActivity, setImagesPullActivity] = useState<{
    activeCount: number
    recentFailedCount: number
    hasRecentHistory: boolean
  }>({
    activeCount: 0,
    recentFailedCount: 0,
    hasRecentHistory: false,
  })
  const [volumesFilter, setVolumesFilter] = useState('')
  const [volumesPage, setVolumesPage] = useState(1)
  const [volumesPageSize, setVolumesPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [volumesSummary, setVolumesSummary] = useState<{
    totalItems: number
    totalPages: number
  } | null>(null)
  const [networksFilter, setNetworksFilter] = useState('')
  const [networksPage, setNetworksPage] = useState(1)
  const [networksPageSize, setNetworksPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [networksSummary, setNetworksSummary] = useState<{
    totalItems: number
    totalPages: number
  } | null>(null)
  const [composePage, setComposePage] = useState(1)
  const [composePageSize, setComposePageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [composeStatusFilter, setComposeStatusFilter] = useState('all')
  const [composeSummary, setComposeSummary] = useState<ComposeTabSummary | null>(null)
  const [containerPage, setContainerPage] = useState(1)
  const [containerPageSize, setContainerPageSize] = useState<ContainerPageSize>(loadGlobalPageSize)
  const [containerStateFilter, setContainerStateFilter] = useState<ContainerStateFilter>('all')
  const [containerSummary, setContainerSummary] = useState<{
    totalItems: number
    totalPages: number
    stateCounts: Record<ContainerStateFilter, number>
  }>({
    totalItems: 0,
    totalPages: 1,
    stateCounts: { all: 0, running: 0, exited: 0, paused: 0, created: 0 },
  })
  const [containerVisibleColumns, setContainerVisibleColumns] = useState<ContainerVisibleColumns>(
    DEFAULT_CONTAINER_VISIBLE_COLUMNS
  )
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [terminalContainerId, setTerminalContainerId] = useState<string | null>(null)
  const [terminalShell, setTerminalShell] = useState<string>('/bin/sh')
  const [manualShell, setManualShell] = useState(false)
  const [terminalResumeSession, setTerminalResumeSession] = useState<{
    key: string
    sessionId: string
  } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const overviewContainersFetching = useIsFetching({ queryKey: ['docker', 'containers', serverId] })
  const overviewImagesFetching = useIsFetching({ queryKey: ['docker', 'images', serverId] })
  const overviewVolumesFetching = useIsFetching({ queryKey: ['docker', 'volumes', serverId] })
  const overviewNetworksFetching = useIsFetching({ queryKey: ['docker', 'networks', serverId] })
  const overviewComposeFetching = useIsFetching({ queryKey: ['docker', 'compose', serverId] })
  const volumeContainersFetching = useIsFetching({
    queryKey: ['docker', 'volumes', 'containers', serverId],
  })
  const imageContainersFetching = useIsFetching({
    queryKey: ['docker', 'containers', 'for-images', serverId],
  })
  const containerTelemetryFetching = useIsFetching({
    queryKey: ['monitor', 'container-telemetry', serverId],
  })

  const activeTerminalSessionKey =
    terminalContainerId == null
      ? null
      : `${serverId}:${terminalContainerId}:${manualShell ? terminalShell : 'auto'}`

  const activeTabFetching = useMemo(() => {
    switch (activeTab) {
      case 'containers':
        return overviewContainersFetching + containerTelemetryFetching
      case 'images':
        return overviewImagesFetching + imageContainersFetching
      case 'volumes':
        return overviewVolumesFetching + volumeContainersFetching
      case 'networks':
        return overviewNetworksFetching
      case 'compose':
        return overviewComposeFetching
      default:
        return (
          overviewContainersFetching +
          overviewImagesFetching +
          overviewVolumesFetching +
          overviewNetworksFetching +
          overviewComposeFetching
        )
    }
  }, [
    activeTab,
    containerTelemetryFetching,
    imageContainersFetching,
    overviewComposeFetching,
    overviewContainersFetching,
    overviewImagesFetching,
    overviewNetworksFetching,
    overviewVolumesFetching,
    volumeContainersFetching,
  ])

  const refreshFeedbackActive = refreshing || activeTabFetching > 0

  useEffect(() => {
    let cancelled = false

    const loadHosts = async (showLoading: boolean) => {
      if (showLoading) setHostsLoading(true)
      try {
        const res = await pb.send(dockerTargetsPath(), { method: 'GET' })
        if (cancelled) return
        setHosts(Array.isArray(res) ? (res as HostEntry[]) : [])
      } catch {
        if (cancelled) return
        setHosts([])
      } finally {
        if (cancelled) return
        setHostsLoading(false)
      }
    }

    void loadHosts(true)
    const timer = window.setInterval(() => {
      void loadHosts(false)
    }, DOCKER_TARGETS_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (refreshFeedbackTimerRef.current != null) {
        window.clearTimeout(refreshFeedbackTimerRef.current)
      }
    }
  }, [])

  const activeHost = hosts.find(h => h.id === serverId)
  const dockerHostState: DockerHostState = hostsLoading
    ? 'loading'
    : activeHost && activeHost.status !== 'online'
      ? 'offline'
      : 'ready'
  const dockerDisabled = dockerHostState !== 'ready'
  const dockerDisabledReason = activeHost?.reason || `${activeHost?.label ?? 'server'} is offline`
  const dockerStatusMessage =
    dockerHostState === 'loading'
      ? 'Checking Docker connection to the selected server...'
      : dockerDisabledReason
  const previousHostStateRef = useRef<DockerHostState>('loading')

  useEffect(() => {
    const previous = previousHostStateRef.current
    previousHostStateRef.current = dockerHostState
    if (previous === 'ready' || dockerHostState !== 'ready') return

    setRefreshSignal(signal => signal + 1)
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers', serverId] }),
      queryClient.invalidateQueries({
        queryKey: ['docker', 'containers', 'for-images', serverId],
      }),
      queryClient.invalidateQueries({ queryKey: ['monitor', 'container-telemetry', serverId] }),
      queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
      queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] }),
      queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] }),
      queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] }),
    ])
  }, [dockerHostState, queryClient, serverId])
  const activeTabMeta = useMemo(() => {
    return {
      overview: {
        label: 'Overview',
        description: 'Fast scan of Docker resources and issues needing attention.',
      },
      containers: {
        label: 'Containers',
        description: 'Inspect runtime containers, status, ports, and container-level actions.',
      },
      images: {
        label: 'Images',
        description: 'Manage cached images and review image usage.',
      },
      volumes: {
        label: 'Volumes',
        description: 'Track persistent storage and linked containers.',
      },
      networks: {
        label: 'Networks',
        description: 'Review Docker networks and connectivity surface.',
      },
      compose: {
        label: 'Compose',
        description: 'Manage compose projects and open linked containers.',
      },
    }[activeTab]
  }, [activeTab])

  const tabItems = useMemo(
    () => [
      { value: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
      { value: 'containers' as const, label: 'Containers', icon: Container },
      { value: 'images' as const, label: 'Images', icon: Box },
      { value: 'volumes' as const, label: 'Volumes', icon: HardDrive },
      { value: 'networks' as const, label: 'Networks', icon: Network },
      { value: 'compose' as const, label: 'Compose', icon: Boxes },
    ],
    []
  )

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(containerPageSize))
  }, [containerPageSize])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(imagesPageSize))
  }, [imagesPageSize])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(volumesPageSize))
  }, [volumesPageSize])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(networksPageSize))
  }, [networksPageSize])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(composePageSize))
  }, [composePageSize])

  useEffect(() => {
    setContainerPage(1)
  }, [serverId])

  useEffect(() => {
    setComposeStatusFilter('all')
  }, [serverId])

  useEffect(() => {
    setContainerPage(1)
  }, [containerStateFilter])

  const refreshDockerData = async () => {
    const startedAt = Date.now()
    if (refreshFeedbackTimerRef.current != null) {
      window.clearTimeout(refreshFeedbackTimerRef.current)
      refreshFeedbackTimerRef.current = null
    }
    setRefreshing(true)
    setRefreshError(null)
    setRefreshSignal(signal => signal + 1)
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'containers', serverId] }),
        queryClient.invalidateQueries({
          queryKey: ['docker', 'containers', 'for-images', serverId],
        }),
        queryClient.invalidateQueries({ queryKey: ['monitor', 'container-telemetry', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] }),
      ])
    } catch (err) {
      setRefreshError(getApiErrorMessage(err, 'Failed to refresh Docker data'))
    } finally {
      const remaining = Math.max(0, MIN_DOCKER_REFRESH_SPIN_MS - (Date.now() - startedAt))
      refreshFeedbackTimerRef.current = window.setTimeout(() => {
        setRefreshing(false)
        refreshFeedbackTimerRef.current = null
      }, remaining)
    }
  }

  useEffect(() => {
    const container = rootRef.current?.querySelector(
      '[data-docker-active-panel="true"]'
    ) as HTMLElement | null
    if (container) container.scrollTop = 0
  }, [activeTab])

  return (
    <div ref={rootRef} className={cn('flex h-full min-h-0 min-w-0 flex-col gap-4', className)}>
      {showWorkspaceHeader ? (
        <div className="shrink-0 space-y-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1 min-w-0">
              <h2 className="text-sm font-semibold">Docker</h2>
              <p className="text-sm text-muted-foreground">
                Inspect containers, compose projects, images, volumes, and networks on this server.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={refreshDockerData}
                disabled={dockerDisabled || refreshFeedbackActive}
                title={
                  dockerHostState === 'loading'
                    ? 'Checking Docker connection'
                    : refreshFeedbackActive
                      ? 'Refreshing Docker data'
                      : 'Refresh Docker data'
                }
                aria-label="Refresh Docker data"
              >
                {refreshFeedbackActive ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as DockerTabId)}
        orientation="vertical"
        className="flex h-full flex-1 min-h-0 min-w-0"
      >
        <div className="flex h-full flex-1 min-h-0 min-w-0 flex-col gap-4 md:flex-row">
          <div
            className={cn(
              'relative shrink-0 overflow-y-auto rounded-xl border bg-muted/20 p-2 transition-all md:h-full md:min-h-0 md:self-stretch',
              navCollapsed ? 'md:w-14' : 'md:w-48'
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'absolute top-3 hidden h-5 w-5 p-0 hover:bg-transparent md:inline-flex',
                navCollapsed ? 'right-0' : 'right-3'
              )}
              onClick={() => setNavCollapsed(value => !value)}
              aria-label={navCollapsed ? 'Expand Docker tabs' : 'Collapse Docker tabs'}
              title={navCollapsed ? 'Expand Docker tabs' : 'Collapse Docker tabs'}
            >
              {navCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" />
              )}
            </Button>

            <TabsList
              variant="line"
              className="flex w-full flex-col items-stretch gap-1 bg-transparent p-0 pr-6"
            >
              {tabItems.map(item => {
                const Icon = item.icon
                return (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    disabled={dockerDisabled}
                    className={cn(
                      'h-10 rounded-lg px-3 text-sm after:hidden',
                      navCollapsed && 'justify-center px-2',
                      !navCollapsed && 'pr-8'
                    )}
                    aria-label={item.label}
                    title={item.label}
                  >
                    <Icon className="h-4 w-4" />
                    {!navCollapsed && <span>{item.label}</span>}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
            <div className="shrink-0 border-b bg-muted/10 px-4 py-3">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-foreground">{activeTabMeta.label}</h3>
                  </div>
                  {activeTab === 'containers' ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <input
                        value={containerFilter}
                        onChange={event => setContainerFilter(event.target.value)}
                        placeholder="Search containers"
                        className="h-8 w-full min-w-[12rem] rounded-md border bg-background px-3 text-sm sm:w-[20ch]"
                      />
                      <select
                        value={containerStateFilter}
                        onChange={event =>
                          setContainerStateFilter(event.target.value as ContainerStateFilter)
                        }
                        className="h-8 rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="all">All states ({containerSummary.stateCounts.all})</option>
                        <option value="running">
                          Running ({containerSummary.stateCounts.running})
                        </option>
                        <option value="exited">
                          Exited ({containerSummary.stateCounts.exited})
                        </option>
                        <option value="paused">
                          Paused ({containerSummary.stateCounts.paused})
                        </option>
                        <option value="created">
                          Created ({containerSummary.stateCounts.created})
                        </option>
                      </select>
                      <div className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{containerSummary.totalItems} total</span>
                        <div className="flex items-center gap-0 text-xs text-foreground">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() => setContainerPage(Math.max(1, containerPage - 1))}
                            disabled={containerPage <= 1}
                            aria-label="Previous containers page"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="min-w-[2rem] text-center font-medium tabular-nums">
                            {containerPage}/{containerSummary.totalPages}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() =>
                              setContainerPage(
                                Math.min(containerSummary.totalPages, containerPage + 1)
                              )
                            }
                            disabled={containerPage >= containerSummary.totalPages}
                            aria-label="Next containers page"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Link
                        to="/deploy/create"
                        search={{
                          entry: undefined,
                          prefillMode: undefined,
                          prefillSource: undefined,
                          prefillAppId: undefined,
                          prefillAppKey: undefined,
                          prefillAppName: undefined,
                          prefillServerId: undefined,
                        }}
                        className="inline-flex h-8 items-center px-2 text-xs font-medium text-primary hover:underline"
                      >
                        <Plus className="mr-1 h-4 w-4" /> Create
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Container display settings"
                            title="Container display settings"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>Rows Per Page</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={String(containerPageSize)}
                            onValueChange={value => {
                              setContainerPageSize(Number(value) as ContainerPageSize)
                              setContainerPage(1)
                            }}
                          >
                            <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Visible Columns</DropdownMenuLabel>
                          <DropdownMenuCheckboxItem
                            checked={containerVisibleColumns.ports}
                            onCheckedChange={checked =>
                              setContainerVisibleColumns({
                                ...containerVisibleColumns,
                                ports: checked === true,
                              })
                            }
                          >
                            Ports
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={containerVisibleColumns.status}
                            onCheckedChange={checked =>
                              setContainerVisibleColumns({
                                ...containerVisibleColumns,
                                status: checked === true,
                              })
                            }
                          >
                            Lifecycle
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={containerVisibleColumns.created}
                            onCheckedChange={checked =>
                              setContainerVisibleColumns({
                                ...containerVisibleColumns,
                                created: checked === true,
                              })
                            }
                          >
                            Created
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={containerVisibleColumns.cpu}
                            onCheckedChange={checked =>
                              setContainerVisibleColumns({
                                ...containerVisibleColumns,
                                cpu: checked === true,
                              })
                            }
                          >
                            CPU
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={containerVisibleColumns.mem}
                            onCheckedChange={checked =>
                              setContainerVisibleColumns({
                                ...containerVisibleColumns,
                                mem: checked === true,
                              })
                            }
                          >
                            Memory
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={containerVisibleColumns.network}
                            onCheckedChange={checked =>
                              setContainerVisibleColumns({
                                ...containerVisibleColumns,
                                network: checked === true,
                              })
                            }
                          >
                            Network
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={containerVisibleColumns.compose}
                            onCheckedChange={checked =>
                              setContainerVisibleColumns({
                                ...containerVisibleColumns,
                                compose: checked === true,
                              })
                            }
                          >
                            Compose
                          </DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : activeTab === 'images' ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <input
                        value={imagesFilter}
                        onChange={e => setImagesFilter(e.target.value)}
                        placeholder="Filter images..."
                        className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
                      />
                      <select
                        value={imagesUsageFilter}
                        onChange={e =>
                          setImagesUsageFilter(e.target.value as 'all' | 'used' | 'unused')
                        }
                        className="h-8 shrink-0 rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="all">All images</option>
                        <option value="used">Used ({imagesSummary?.usedItems ?? 0})</option>
                        <option value="unused">Unused ({imagesSummary?.unusedItems ?? 0})</option>
                      </select>
                      <div className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
                        {imagesSummary && <span>{imagesSummary.totalItems} total</span>}
                        <div className="flex items-center gap-0 text-xs text-foreground">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() => setImagesPage(p => Math.max(1, p - 1))}
                            disabled={imagesPage <= 1}
                            aria-label="Previous images page"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="min-w-[2rem] text-center font-medium tabular-nums">
                            {imagesPage}/{imagesSummary?.totalPages ?? 1}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() =>
                              setImagesPage(p => Math.min(imagesSummary?.totalPages ?? 1, p + 1))
                            }
                            disabled={imagesPage >= (imagesSummary?.totalPages ?? 1)}
                            aria-label="Next images page"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-xs"
                        onClick={() =>
                          imagesPullActivity.activeCount > 0
                            ? imagesTabRef.current?.openPullHistory('pulling')
                            : imagesTabRef.current?.openPullDialog()
                        }
                        title="Pull image"
                      >
                        {imagesPullActivity.activeCount > 0 ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-1" />
                        )}
                        {imagesPullActivity.activeCount > 0
                          ? `Pulling (${imagesPullActivity.activeCount})`
                          : 'Pull'}
                      </Button>
                      {imagesPullActivity.recentFailedCount > 0 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                          onClick={() => imagesTabRef.current?.openPullHistory('recents')}
                          title="View failed image pulls"
                        >
                          <Badge
                            variant="outline"
                            className="h-5 rounded-sm border-destructive/30 px-1.5 text-[10px] text-destructive"
                          >
                            {imagesPullActivity.recentFailedCount}
                          </Badge>
                          Failed
                        </Button>
                      ) : imagesPullActivity.hasRecentHistory ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 px-2 text-xs"
                          onClick={() => imagesTabRef.current?.openPullHistory('recents')}
                          title="View pull history"
                        >
                          History
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-xs"
                        onClick={() => imagesTabRef.current?.openPruneDialog()}
                        title="Prune unused images"
                      >
                        <Eraser className="h-4 w-4 mr-1" /> Prune
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Images display settings"
                            title="Images display settings"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>Rows Per Page</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={String(imagesPageSize)}
                            onValueChange={value => {
                              const s = Number(value) as 25 | 50 | 100
                              setImagesPageSize(s)
                              setImagesPage(1)
                            }}
                          >
                            <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : activeTab === 'volumes' ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <input
                        value={volumesFilter}
                        onChange={e => setVolumesFilter(e.target.value)}
                        placeholder="Filter volumes..."
                        className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
                      />
                      <div className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
                        {volumesSummary && <span>{volumesSummary.totalItems} total</span>}
                        <div className="flex items-center gap-0 text-xs text-foreground">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() => setVolumesPage(p => Math.max(1, p - 1))}
                            disabled={volumesPage <= 1}
                            aria-label="Previous volumes page"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="min-w-[2rem] text-center font-medium tabular-nums">
                            {volumesPage}/{volumesSummary?.totalPages ?? 1}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() =>
                              setVolumesPage(p => Math.min(volumesSummary?.totalPages ?? 1, p + 1))
                            }
                            disabled={volumesPage >= (volumesSummary?.totalPages ?? 1)}
                            aria-label="Next volumes page"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-xs"
                        onClick={() => volumesTabRef.current?.openPruneDialog()}
                        title="Prune unused volumes"
                      >
                        <Eraser className="h-4 w-4 mr-1" /> Prune
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Volumes display settings"
                            title="Volumes display settings"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>Rows Per Page</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={String(volumesPageSize)}
                            onValueChange={value => {
                              const size = Number(value) as 25 | 50 | 100
                              setVolumesPageSize(size)
                              setVolumesPage(1)
                            }}
                          >
                            <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : activeTab === 'networks' ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <input
                        value={networksFilter}
                        onChange={e => setNetworksFilter(e.target.value)}
                        placeholder="Search networks"
                        className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
                      />
                      <div className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
                        {networksSummary && <span>{networksSummary.totalItems} total</span>}
                        <div className="flex items-center gap-0 text-xs text-foreground">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() => setNetworksPage(p => Math.max(1, p - 1))}
                            disabled={networksPage <= 1}
                            aria-label="Previous networks page"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="min-w-[2rem] text-center font-medium tabular-nums">
                            {networksPage}/{networksSummary?.totalPages ?? 1}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() =>
                              setNetworksPage(p =>
                                Math.min(networksSummary?.totalPages ?? 1, p + 1)
                              )
                            }
                            disabled={networksPage >= (networksSummary?.totalPages ?? 1)}
                            aria-label="Next networks page"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-xs"
                        onClick={() => networksTabRef.current?.openCreateDialog()}
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
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>Rows Per Page</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={String(networksPageSize)}
                            onValueChange={value => {
                              const size = Number(value) as 25 | 50 | 100
                              setNetworksPageSize(size)
                              setNetworksPage(1)
                            }}
                          >
                            <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : activeTab === 'compose' ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <input
                        value={composeFilter}
                        onChange={e => setComposeFilter(e.target.value)}
                        placeholder="Search projects"
                        className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
                      />
                      <select
                        value={composeStatusFilter}
                        onChange={e => setComposeStatusFilter(e.target.value)}
                        className="h-8 shrink-0 rounded-md border bg-background px-2 text-sm"
                        aria-label="Filter compose status"
                      >
                        <option value="all">All status</option>
                        {(composeSummary?.statusCounts ?? []).map(({ status, count }) => (
                          <option key={status} value={status}>
                            {status} ({count})
                          </option>
                        ))}
                      </select>
                      <div className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
                        {composeSummary && <span>{composeSummary.totalItems} total</span>}
                        <div className="flex items-center gap-0 text-xs text-foreground">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() => setComposePage(p => Math.max(1, p - 1))}
                            disabled={composePage <= 1}
                            aria-label="Previous compose page"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="min-w-[2rem] text-center font-medium tabular-nums">
                            {composePage}/{composeSummary?.totalPages ?? 1}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-5 px-0"
                            onClick={() =>
                              setComposePage(p => Math.min(composeSummary?.totalPages ?? 1, p + 1))
                            }
                            disabled={composePage >= (composeSummary?.totalPages ?? 1)}
                            aria-label="Next compose page"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Link
                        to="/deploy/create"
                        search={{
                          entry: undefined,
                          prefillMode: undefined,
                          prefillSource: undefined,
                          prefillAppId: undefined,
                          prefillAppKey: undefined,
                          prefillAppName: undefined,
                          prefillServerId: undefined,
                        }}
                        className="inline-flex h-8 shrink-0 items-center px-2 text-xs font-medium text-primary hover:underline"
                      >
                        <Plus className="mr-1 h-4 w-4" /> Create
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Compose display settings"
                            title="Compose display settings"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>Rows Per Page</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={String(composePageSize)}
                            onValueChange={value => {
                              const size = Number(value) as 25 | 50 | 100
                              setComposePageSize(size)
                              setComposePage(1)
                            }}
                          >
                            <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {dockerHostState !== 'ready' && (
              <Alert
                variant={dockerHostState === 'offline' ? 'destructive' : 'default'}
                className="mx-4 mt-4"
              >
                <AlertDescription>{dockerStatusMessage}</AlertDescription>
              </Alert>
            )}

            {refreshError && (
              <Alert variant="destructive" className="mx-4 mt-4">
                <AlertDescription>{refreshError}</AlertDescription>
              </Alert>
            )}

            <div className="min-h-0 flex-1">
              {activeTab === 'overview' ? (
                <TabsContent
                  value="overview"
                  forceMount
                  className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                  data-docker-active-panel="true"
                >
                  <OverviewTab
                    serverId={serverId}
                    disabled={dockerDisabled}
                    active
                    embeddedInWorkspace
                    onSelectTab={setActiveTab}
                    onFilterContainersByNames={names => {
                      setContainerFilter('')
                      setContainerFilterNames(names)
                      setContainerStateFilter('all')
                      setActiveTab('containers')
                    }}
                    onOpenPullImage={() => {
                      setActiveTab('images')
                      window.setTimeout(() => imagesTabRef.current?.openPullDialog(), 0)
                    }}
                    onOpenPruneImages={() => {
                      setActiveTab('images')
                      window.setTimeout(() => imagesTabRef.current?.openPruneDialog(), 0)
                    }}
                    onOpenPruneVolumes={() => {
                      setActiveTab('volumes')
                      window.setTimeout(() => volumesTabRef.current?.openPruneDialog(), 0)
                    }}
                  />
                </TabsContent>
              ) : null}
              {activeTab === 'containers' ? (
                <TabsContent
                  value="containers"
                  forceMount
                  className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                  data-docker-active-panel="true"
                >
                  <ContainersTab
                    serverId={serverId}
                    refreshSignal={refreshSignal}
                    searchQuery={containerFilter}
                    stateFilter={containerStateFilter}
                    onStateFilterChange={setContainerStateFilter}
                    onSearchQueryChange={setContainerFilter}
                    filterPreset={containerFilter}
                    includeNames={containerFilterNames}
                    page={containerPage}
                    pageSize={containerPageSize}
                    visibleColumns={containerVisibleColumns}
                    refreshDisabled={dockerDisabled}
                    refreshing={refreshFeedbackActive}
                    onClearFilterPreset={() => setContainerFilter('')}
                    onClearIncludeNames={() => setContainerFilterNames([])}
                    onPageChange={setContainerPage}
                    onPageSizeChange={() => {}}
                    onVisibleColumnsChange={() => {}}
                    onSummaryChange={setContainerSummary}
                    onRefresh={refreshDockerData}
                    onOpenVolumeFilter={volumeNames => {
                      if (!volumeNames || volumeNames.length === 0) return
                      setVolumesFilter('')
                      setVolumeFilterNames(volumeNames)
                      setActiveTab('volumes')
                    }}
                    onOpenImageFilter={imageName => {
                      if (!imageName) return
                      setImagesFilter(imageName)
                      setImagesUsageFilter('all')
                      setActiveTab('images')
                    }}
                    onOpenNetworkFilter={networkName => {
                      if (!networkName) return
                      setNetworksFilter(networkName)
                      setActiveTab('networks')
                    }}
                    onOpenTerminal={id => setTerminalContainerId(id)}
                    showPanelChrome={false}
                  />
                </TabsContent>
              ) : null}
              {activeTab === 'images' ? (
                <TabsContent
                  value="images"
                  forceMount
                  className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                  data-docker-active-panel="true"
                >
                  <ImagesTab
                    ref={imagesTabRef}
                    serverId={serverId}
                    refreshSignal={refreshSignal}
                    embeddedInWorkspace
                    externalFilter={imagesFilter}
                    externalUsageFilter={imagesUsageFilter}
                    page={imagesPage}
                    pageSize={imagesPageSize}
                    onPageChange={setImagesPage}
                    onOpenContainerFilter={(_imageName, containerNames) => {
                      setContainerFilter('')
                      setContainerFilterNames(containerNames)
                      setActiveTab('containers')
                    }}
                    onPullActivityChange={setImagesPullActivity}
                    onSummaryChange={setImagesSummary}
                  />
                </TabsContent>
              ) : null}
              {activeTab === 'volumes' ? (
                <TabsContent
                  value="volumes"
                  forceMount
                  className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                  data-docker-active-panel="true"
                >
                  <VolumesTab
                    ref={volumesTabRef}
                    serverId={serverId}
                    refreshSignal={refreshSignal}
                    embeddedInWorkspace
                    externalFilter={volumesFilter}
                    includeNames={volumeFilterNames}
                    page={volumesPage}
                    pageSize={volumesPageSize}
                    onPageChange={setVolumesPage}
                    onSummaryChange={setVolumesSummary}
                    onClearIncludeNames={() => setVolumeFilterNames([])}
                    onOpenContainerFilter={(_name, containerNames) => {
                      setContainerFilter('')
                      setContainerFilterNames(containerNames)
                      setActiveTab('containers')
                    }}
                  />
                </TabsContent>
              ) : null}
              {activeTab === 'networks' ? (
                <TabsContent
                  value="networks"
                  forceMount
                  className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                  data-docker-active-panel="true"
                >
                  <NetworksTab
                    ref={networksTabRef}
                    serverId={serverId}
                    refreshSignal={refreshSignal}
                    embeddedInWorkspace
                    externalFilter={networksFilter}
                    page={networksPage}
                    pageSize={networksPageSize}
                    onPageChange={setNetworksPage}
                    onSummaryChange={setNetworksSummary}
                  />
                </TabsContent>
              ) : null}
              {activeTab === 'compose' ? (
                <TabsContent
                  value="compose"
                  forceMount
                  className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                  data-docker-active-panel="true"
                >
                  <ComposeTab
                    serverId={serverId}
                    refreshSignal={refreshSignal}
                    embeddedInWorkspace
                    externalFilter={composeFilter}
                    externalStatusFilter={composeStatusFilter}
                    page={composePage}
                    pageSize={composePageSize}
                    onPageChange={setComposePage}
                    onSummaryChange={setComposeSummary}
                    onStatusFilterChange={setComposeStatusFilter}
                    onOpenContainerFilter={containerName => {
                      if (!containerName) return
                      setContainerFilter(containerName)
                      setContainerFilterNames([])
                      setActiveTab('containers')
                    }}
                    onOpenContainerNames={containerNames => {
                      setContainerFilter('')
                      setContainerFilterNames(containerNames)
                      setActiveTab('containers')
                    }}
                  />
                </TabsContent>
              ) : null}
            </div>
          </div>
        </div>
      </Tabs>

      <Dialog
        open={!!terminalContainerId}
        onOpenChange={open => {
          if (!open) setTerminalContainerId(null)
        }}
      >
        <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <TerminalSquare className="h-5 w-5" />
              Container Terminal
              <span className="text-xs font-mono text-muted-foreground ml-2">
                {terminalContainerId?.slice(0, 12)}
              </span>
            </DialogTitle>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex items-center gap-2 mr-1">
                <Checkbox
                  id="docker-manual-shell"
                  checked={manualShell}
                  onCheckedChange={value => setManualShell(!!value)}
                  className="h-3.5 w-3.5"
                />
                <label
                  htmlFor="docker-manual-shell"
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  Manual shell
                </label>
              </div>
              {manualShell &&
                ['/bin/sh', '/bin/bash', '/bin/zsh'].map(shell => (
                  <Button
                    key={shell}
                    variant={terminalShell === shell ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-6 px-2 text-xs font-mono"
                    onClick={() => setTerminalShell(shell)}
                  >
                    {shell.split('/').pop()}
                  </Button>
                ))}
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {terminalContainerId && (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading terminal...
                  </div>
                }
              >
                <LazyTerminalPanel
                  key={`${terminalContainerId}-${manualShell ? terminalShell : 'auto'}`}
                  containerId={terminalContainerId}
                  sessionId={
                    activeTerminalSessionKey != null &&
                    terminalResumeSession?.key === activeTerminalSessionKey
                      ? terminalResumeSession.sessionId
                      : undefined
                  }
                  dockerServerId={serverId}
                  shell={manualShell ? terminalShell : undefined}
                  onSessionEstablished={sessionId => {
                    if (activeTerminalSessionKey) {
                      setTerminalResumeSession({ key: activeTerminalSessionKey, sessionId })
                    }
                  }}
                  onSessionInvalidated={sessionId => {
                    setTerminalResumeSession(current => {
                      if (
                        current &&
                        current.sessionId === sessionId &&
                        current.key === activeTerminalSessionKey
                      ) {
                        return null
                      }
                      return current
                    })
                  }}
                  className="h-full"
                />
              </Suspense>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
