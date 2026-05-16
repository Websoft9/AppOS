import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Container,
  HardDrive,
  LayoutDashboard,
  Network,
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { ContainersTab } from '@/components/docker/ContainersTab'
import { ImagesTab } from '@/components/docker/ImagesTab'
import { NetworksTab } from '@/components/docker/NetworksTab'
import { VolumesTab } from '@/components/docker/VolumesTab'
import { ComposeTab } from '@/components/docker/ComposeTab'
import { TerminalPanel } from '@/components/connect/TerminalPanel'
import { dockerApiPath, dockerTargetsPath } from '@/lib/docker-api'
import { cn } from '@/lib/utils'

interface HostEntry {
  id: string
  label: string
  status: 'online' | 'offline'
  reason?: string
}

interface DockerPanelProps {
  serverId: string
  className?: string
  onOpenFilesAtPath?: (targetPath: string, lockedRootPath: string) => void
  showWorkspaceHeader?: boolean
}

type ContainerPageSize = 25 | 50 | 100

type ContainerVisibleColumns = {
  ports: boolean
  status: boolean
  cpu: boolean
  mem: boolean
  network: boolean
  compose: boolean
}

type ContainerStateFilter = 'all' | 'running' | 'exited' | 'paused' | 'created'

const DOCKER_PAGE_SIZE_KEY = 'docker.list.page_size'

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
  status: true,
  cpu: false,
  mem: false,
  network: false,
  compose: false,
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

function composeStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const value = status.toLowerCase()
  if (value.includes('running') || value.includes('healthy')) return 'default'
  if (value.includes('exit') || value.includes('dead') || value.includes('error')) {
    return 'destructive'
  }
  return 'secondary'
}

function statusTone(status: string): 'default' | 'secondary' | 'destructive' {
  const value = status.toLowerCase()
  if (value === 'running' || value.includes('healthy')) return 'default'
  if (value === 'exited' || value.includes('unhealthy')) return 'destructive'
  return 'secondary'
}

function OverviewTab({
  serverId,
  disabled,
  embeddedInWorkspace = false,
}: {
  serverId: string
  disabled: boolean
  embeddedInWorkspace?: boolean
}) {
  const containersQuery = useQuery<OverviewContainer[]>({
    queryKey: ['docker', 'containers', serverId],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/containers'), {
        method: 'GET',
      })
      return parseDockerJsonLines<OverviewContainer>(res.output)
    },
    enabled: !disabled,
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
    enabled: !disabled,
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
    enabled: !disabled,
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
    enabled: !disabled,
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
    enabled: !disabled,
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

  const runningCount = containers.filter(container => container.State === 'running').length
  const healthyCount = containers.filter(container =>
    (container.Status || '').toLowerCase().includes('healthy')
  ).length
  const unhealthyCount = containers.filter(container =>
    (container.Status || '').toLowerCase().includes('unhealthy')
  ).length
  const exitedCount = containers.filter(container => container.State === 'exited').length
  const pausedCount = containers.filter(container => container.State === 'paused').length
  const createdCount = containers.filter(container => container.State === 'created').length
  const projectsRunning = projects.filter(project =>
    (project.Status || '').toLowerCase().includes('running')
  ).length
  const taggedImages = images.filter(image => image.Tag && image.Tag !== '<none>').length
  const attentionContainers = containers
    .filter(container => {
      const status = (container.Status || '').toLowerCase()
      return (
        container.State !== 'running' || status.includes('unhealthy') || status.includes('dead')
      )
    })
    .slice(0, 6)

  const summaryCards = [
    {
      label: 'Compose Projects',
      value: projects.length,
      detail: `${projectsRunning} running`,
      icon: Boxes,
    },
    {
      label: 'Containers',
      value: containers.length,
      detail: `${runningCount} running`,
      icon: Container,
    },
    {
      label: 'Images',
      value: images.length,
      detail: `${taggedImages} tagged`,
      icon: Box,
    },
    {
      label: 'Storage Objects',
      value: volumes.length + networks.length,
      detail: `${volumes.length} volumes · ${networks.length} networks`,
      icon: HardDrive,
    },
  ]

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {getApiErrorMessage(loadError, 'Failed to load Docker overview')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-4', embeddedInWorkspace ? 'pt-0' : 'pt-4')}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(card => {
          const Icon = card.icon
          return (
            <Card key={card.label} className="gap-3 py-4">
              <CardHeader className="px-4 pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardDescription>{card.label}</CardDescription>
                    <CardTitle className="mt-2 text-3xl">{loading ? '...' : card.value}</CardTitle>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-2 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pt-0 text-sm text-muted-foreground">
                {loading ? 'Loading Docker inventory...' : card.detail}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="gap-4 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-base">Container Health</CardTitle>
            <CardDescription>Quick runtime breakdown for this Docker host.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 px-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Healthy</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? '...' : healthyCount}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Unhealthy</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? '...' : unhealthyCount}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Exited</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? '...' : exitedCount}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Paused</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? '...' : pausedCount}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Created</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? '...' : createdCount}</div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Networks</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? '...' : networks.length}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-base">Needs Attention</CardTitle>
            <CardDescription>
              Containers not fully healthy or not currently running.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading container states...</div>
            ) : attentionContainers.length > 0 ? (
              attentionContainers.map(container => (
                <div
                  key={container.ID}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {container.Names || container.ID.slice(0, 12)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {container.Image || '-'}
                    </div>
                  </div>
                  <Badge variant={statusTone(container.Status || container.State)}>
                    {container.State || 'unknown'}
                  </Badge>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-muted-foreground">
                All discovered containers are running without unhealthy status flags.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="gap-4 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-base">Compose Stacks</CardTitle>
            <CardDescription>Current compose projects on the selected server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading compose projects...</div>
            ) : projects.length > 0 ? (
              projects.slice(0, 8).map(project => (
                <div
                  key={project.Name}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{project.Name || '-'}</div>
                    <div className="text-xs text-muted-foreground">Compose service group</div>
                  </div>
                  <Badge variant={composeStatusVariant(project.Status || '')}>
                    {project.Status || 'unknown'}
                  </Badge>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No compose projects found.</div>
            )}
          </CardContent>
        </Card>

        <Card className="gap-4 py-4">
          <CardHeader className="px-4 pb-0">
            <CardTitle className="text-base">Inventory Split</CardTitle>
            <CardDescription>Resource counts across the Docker host.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            {[
              { label: 'Running containers', value: runningCount, total: containers.length },
              { label: 'Images', value: images.length, total: Math.max(images.length, 1) },
              {
                label: 'Volumes',
                value: volumes.length,
                total: Math.max(volumes.length + networks.length, 1),
              },
              {
                label: 'Networks',
                value: networks.length,
                total: Math.max(volumes.length + networks.length, 1),
              },
            ].map(item => {
              const width =
                item.total > 0 ? Math.max(8, Math.round((item.value / item.total) * 100)) : 8
              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{item.label}</span>
                    <span className="font-medium">{loading ? '...' : item.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function DockerPanel({
  serverId,
  className,
  onOpenFilesAtPath,
  showWorkspaceHeader = true,
}: DockerPanelProps) {
  const queryClient = useQueryClient()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [hosts, setHosts] = useState<HostEntry[]>([])
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [activeTab, setActiveTab] = useState<
    'overview' | 'containers' | 'images' | 'volumes' | 'networks' | 'compose'
  >('overview')
  const [containerFilter, setContainerFilter] = useState('')
  const [containerFilterNames, setContainerFilterNames] = useState<string[]>([])
  const [composeFilter, setComposeFilter] = useState('')
  const [imagesFilter, setImagesFilter] = useState('')
  const [imagesUsageFilter, setImagesUsageFilter] = useState<'all' | 'used' | 'unused'>('all')
  const [volumesFilter, setVolumesFilter] = useState('')
  const [networksFilter, setNetworksFilter] = useState('')
  const [containerPage, setContainerPage] = useState(1)
  const [containerPageSize, setContainerPageSize] = useState<ContainerPageSize>(loadGlobalPageSize)
  const [containerStateFilter, setContainerStateFilter] =
    useState<ContainerStateFilter>('all')
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
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    pb.send(dockerTargetsPath(), { method: 'GET' })
      .then(res => {
        if (Array.isArray(res)) setHosts(res as HostEntry[])
      })
      .catch(() => setHosts([]))
  }, [])

  const activeHost = hosts.find(h => h.id === serverId)
  const dockerDisabled = activeHost ? activeHost.status !== 'online' : false
  const dockerDisabledReason = activeHost?.reason || `${activeHost?.label ?? 'server'} is offline`
  const activeTabMeta = useMemo(() => {
    return {
      overview: {
        label: 'Overview',
        description: 'Dashboard summary across containers, compose stacks, and storage objects.',
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
    setContainerPage(1)
  }, [serverId])

  useEffect(() => {
    setContainerPage(1)
  }, [containerStateFilter])

  const refreshDockerData = async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'containers', serverId] }),
        queryClient.invalidateQueries({
          queryKey: ['docker', 'containers', 'details', serverId],
        }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] }),
      ])
    } catch (err) {
      setRefreshError(getApiErrorMessage(err, 'Failed to refresh Docker data'))
    } finally {
      setRefreshSignal(signal => signal + 1)
      setRefreshing(false)
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
                disabled={dockerDisabled || refreshing}
                title="Refresh Docker data"
                aria-label="Refresh Docker data"
              >
                {refreshing ? (
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
        onValueChange={value =>
          setActiveTab(
            value as 'overview' | 'containers' | 'images' | 'volumes' | 'networks' | 'compose'
          )
        }
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
                  <h3 className="text-sm font-semibold text-foreground">{activeTabMeta.label}</h3>
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
                      <option value="running">Running ({containerSummary.stateCounts.running})</option>
                      <option value="exited">Exited ({containerSummary.stateCounts.exited})</option>
                      <option value="paused">Paused ({containerSummary.stateCounts.paused})</option>
                      <option value="created">Created ({containerSummary.stateCounts.created})</option>
                    </select>
                    <div className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Total {containerSummary.totalItems} items</span>
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
                            setContainerPage(Math.min(containerSummary.totalPages, containerPage + 1))
                          }
                          disabled={containerPage >= containerSummary.totalPages}
                          aria-label="Next containers page"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
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
                          checked={containerVisibleColumns.cpu}
                          onCheckedChange={checked =>
                            setContainerVisibleColumns({
                              ...containerVisibleColumns,
                              cpu: checked === true,
                            })
                          }
                        >
                          CPU%
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
                          Mem
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
                      className="h-8 w-full min-w-[12rem] rounded-md border bg-background px-3 text-sm sm:w-[20ch]"
                    />
                    <select
                      value={imagesUsageFilter}
                      onChange={e => setImagesUsageFilter(e.target.value as 'all' | 'used' | 'unused')}
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="all">All images</option>
                      <option value="used">Used</option>
                      <option value="unused">Unused</option>
                    </select>
                  </div>
                ) : activeTab === 'volumes' ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <input
                      value={volumesFilter}
                      onChange={e => setVolumesFilter(e.target.value)}
                      placeholder="Filter volumes..."
                      className="h-8 w-full min-w-[12rem] rounded-md border bg-background px-3 text-sm sm:w-[20ch]"
                    />
                  </div>
                ) : activeTab === 'networks' ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <input
                      value={networksFilter}
                      onChange={e => setNetworksFilter(e.target.value)}
                      placeholder="Filter networks..."
                      className="h-8 w-full min-w-[12rem] rounded-md border bg-background px-3 text-sm sm:w-[20ch]"
                    />
                  </div>
                ) : activeTab === 'compose' ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <input
                      value={composeFilter}
                      onChange={e => setComposeFilter(e.target.value)}
                      placeholder="Filter projects..."
                      className="h-8 w-full min-w-[12rem] rounded-md border bg-background px-3 text-sm sm:w-[20ch]"
                    />
                    {composeFilter && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground"
                        onClick={() => setComposeFilter('')}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                ) : null}
                </div>
              </div>
            </div>

            {dockerDisabled && (
              <div className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Docker is disabled for current server: {dockerDisabledReason}
              </div>
            )}

            {refreshError && (
              <Alert variant="destructive" className="mx-4 mt-4">
                <AlertDescription>{refreshError}</AlertDescription>
              </Alert>
            )}

            <div className="min-h-0 flex-1">
              <TabsContent
                value="overview"
                className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                data-docker-active-panel={activeTab === 'overview' ? 'true' : 'false'}
              >
                <OverviewTab
                  serverId={serverId}
                  disabled={dockerDisabled}
                  embeddedInWorkspace
                />
              </TabsContent>
              <TabsContent
                value="containers"
                className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto data-[state=active]:flex data-[state=active]:flex-col"
                data-docker-active-panel={activeTab === 'containers' ? 'true' : 'false'}
              >
                <ContainersTab
                  serverId={serverId}
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
                  refreshing={refreshing}
                  onClearFilterPreset={() => setContainerFilter('')}
                  onClearIncludeNames={() => setContainerFilterNames([])}
                  onPageChange={setContainerPage}
                  onPageSizeChange={() => {}}
                  onVisibleColumnsChange={() => {}}
                  onSummaryChange={setContainerSummary}
                  onRefresh={refreshDockerData}
                  onOpenComposeFilter={name => {
                    if (!name || name === '-') return
                    setComposeFilter(name)
                    setActiveTab('compose')
                  }}
                  onOpenTerminal={id => setTerminalContainerId(id)}
                  showPanelChrome={false}
                />
              </TabsContent>
              <TabsContent
                value="images"
                className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                data-docker-active-panel={activeTab === 'images' ? 'true' : 'false'}
              >
                <ImagesTab
                  serverId={serverId}
                  embeddedInWorkspace
                  externalFilter={imagesFilter}
                  externalUsageFilter={imagesUsageFilter}
                />
              </TabsContent>
              <TabsContent
                value="volumes"
                className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                data-docker-active-panel={activeTab === 'volumes' ? 'true' : 'false'}
              >
                <VolumesTab
                  serverId={serverId}
                  refreshSignal={refreshSignal}
                  embeddedInWorkspace
                  externalFilter={volumesFilter}
                  onOpenContainerFilter={(_name, containerNames) => {
                    setContainerFilter('')
                    setContainerFilterNames(containerNames)
                    setActiveTab('containers')
                  }}
                  onOpenVolumePath={(targetPath, lockedRootPath) => {
                    onOpenFilesAtPath?.(targetPath, lockedRootPath)
                  }}
                />
              </TabsContent>
              <TabsContent
                value="networks"
                className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                data-docker-active-panel={activeTab === 'networks' ? 'true' : 'false'}
              >
                <NetworksTab
                  serverId={serverId}
                  refreshSignal={refreshSignal}
                  embeddedInWorkspace
                  externalFilter={networksFilter}
                />
              </TabsContent>
              <TabsContent
                value="compose"
                className="mt-0 min-h-0 min-w-0 h-full overflow-y-auto p-4 data-[state=active]:flex data-[state=active]:flex-col"
                data-docker-active-panel={activeTab === 'compose' ? 'true' : 'false'}
              >
                <ComposeTab
                  serverId={serverId}
                  embeddedInWorkspace
                  filterPreset={composeFilter}
                  onClearFilterPreset={() => setComposeFilter('')}
                  onOpenContainerFilter={containerName => {
                    if (!containerName) return
                    setContainerFilter(containerName)
                    setContainerFilterNames([])
                    setActiveTab('containers')
                  }}
                />
              </TabsContent>
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
              <TerminalPanel
                key={`${terminalContainerId}-${manualShell ? terminalShell : 'auto'}`}
                containerId={terminalContainerId}
                dockerServerId={serverId}
                shell={manualShell ? terminalShell : undefined}
                className="h-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
