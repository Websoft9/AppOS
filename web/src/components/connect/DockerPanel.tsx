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
  TerminalSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { ContainersTab } from '@/components/docker/ContainersTab'
import { ImagesTab } from '@/components/docker/ImagesTab'
import { NetworksTab } from '@/components/docker/NetworksTab'
import { VolumesTab } from '@/components/docker/VolumesTab'
import { ComposeTab } from '@/components/docker/ComposeTab'
import { TerminalPanel } from '@/components/connect/TerminalPanel'
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

function OverviewTab({ serverId, disabled }: { serverId: string; disabled: boolean }) {
  const containersQuery = useQuery<OverviewContainer[]>({
    queryKey: ['docker', 'containers', serverId],
    queryFn: async () => {
      const res = await pb.send(`/api/ext/docker/containers?server_id=${serverId}`, {
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
      const res = await pb.send(`/api/ext/docker/images?server_id=${serverId}`, {
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
      const res = await pb.send(`/api/ext/docker/volumes?server_id=${serverId}`, {
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
      const res = await pb.send(`/api/ext/docker/networks?server_id=${serverId}`, {
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
      const res = await pb.send(`/api/ext/docker/compose/ls?server_id=${serverId}`, {
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
    <div className="flex min-h-0 flex-col gap-4 pt-4">
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

export function DockerPanel({ serverId, className, onOpenFilesAtPath }: DockerPanelProps) {
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
  const [containerPage, setContainerPage] = useState(1)
  const [containerPageSize, setContainerPageSize] = useState<ContainerPageSize>(loadGlobalPageSize)
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
    pb.send('/api/ext/docker/servers', { method: 'GET' })
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
        icon: LayoutDashboard,
      },
      containers: {
        label: 'Containers',
        description: 'Inspect runtime containers, status, ports, and container-level actions.',
        icon: Container,
      },
      images: {
        label: 'Images',
        description: 'Manage cached images and review image usage.',
        icon: Box,
      },
      volumes: {
        label: 'Volumes',
        description: 'Track persistent storage and linked containers.',
        icon: HardDrive,
      },
      networks: {
        label: 'Networks',
        description: 'Review Docker networks and connectivity surface.',
        icon: Network,
      },
      compose: {
        label: 'Compose',
        description: 'Manage compose projects and open linked containers.',
        icon: Boxes,
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
    <div
      ref={rootRef}
      className={cn('flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden', className)}
    >
      <Tabs
        value={activeTab}
        onValueChange={value =>
          setActiveTab(
            value as 'overview' | 'containers' | 'images' | 'volumes' | 'networks' | 'compose'
          )
        }
        orientation="vertical"
        className="flex flex-1 min-h-0 min-w-0 overflow-hidden"
      >
        <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-3 md:flex-row">
          <div
            className={cn(
              'relative shrink-0 rounded-xl border bg-muted/20 p-2 transition-all md:min-h-0 md:self-stretch',
              navCollapsed ? 'md:w-14' : 'md:w-48'
            )}
          >
            <div
              className={cn(
                'relative mb-2 flex h-10 items-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground',
                navCollapsed ? 'justify-center px-2' : 'justify-start px-3 pr-8'
              )}
            >
              <div className="flex items-center gap-2">
                <Box className="h-4 w-4 shrink-0" />
                {!navCollapsed && <span>Docker</span>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-1/2 hidden h-5 w-5 -translate-y-1/2 translate-x-1/2 p-0 hover:bg-transparent md:inline-flex"
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
            </div>

            <TabsList
              variant="line"
              className="flex w-full flex-col items-stretch gap-1 bg-transparent p-0"
            >
              {tabItems.map(item => {
                const Icon = item.icon
                return (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    disabled={dockerDisabled}
                    className={cn(
                      'h-10 rounded-lg border px-3 text-sm after:hidden',
                      navCollapsed && 'justify-center px-2'
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

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
            {activeTab === 'containers' ? null : (
              <div className="flex shrink-0 flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <activeTabMeta.icon className="h-4 w-4 text-muted-foreground" />
                    <div className="text-sm font-medium">{activeTabMeta.label}</div>
                    {activeTab === 'overview' && !dockerDisabled ? (
                      <Badge variant="outline" className="text-[11px]">
                        {activeHost?.label ?? 'Docker host'}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{activeTabMeta.description}</p>
                </div>

                <div className="flex min-w-0 flex-col gap-2 sm:items-end">
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={refreshDockerData}
                      disabled={dockerDisabled || refreshing}
                      title="Refresh Docker data"
                      aria-label="Refresh Docker data"
                    >
                      <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'containers' ? null : <div className="border-t" />}

            {dockerDisabled && (
              <div className="mx-3 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Docker is disabled for current server: {dockerDisabledReason}
              </div>
            )}

            {refreshError && (
              <Alert variant="destructive" className="mx-3 mt-3">
                <AlertDescription>{refreshError}</AlertDescription>
              </Alert>
            )}

            <div className="min-h-0 flex-1 overflow-hidden">
              <TabsContent
                value="overview"
                className="mt-0 min-h-0 min-w-0 overflow-y-auto p-4 data-[state=active]:block"
                data-docker-active-panel={activeTab === 'overview' ? 'true' : 'false'}
              >
                <OverviewTab serverId={serverId} disabled={dockerDisabled} />
              </TabsContent>
              <TabsContent
                value="containers"
                className="mt-0 min-h-0 min-w-0 overflow-y-auto data-[state=active]:block"
                data-docker-active-panel={activeTab === 'containers' ? 'true' : 'false'}
              >
                <ContainersTab
                  serverId={serverId}
                  searchQuery={containerFilter}
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
                  onPageSizeChange={next => {
                    setContainerPageSize(next)
                    setContainerPage(1)
                  }}
                  onVisibleColumnsChange={setContainerVisibleColumns}
                  onRefresh={refreshDockerData}
                  onOpenComposeFilter={name => {
                    if (!name || name === '-') return
                    setComposeFilter(name)
                    setActiveTab('compose')
                  }}
                  onOpenTerminal={id => setTerminalContainerId(id)}
                />
              </TabsContent>
              <TabsContent
                value="images"
                className="mt-0 min-h-0 min-w-0 overflow-y-auto p-4 data-[state=active]:block"
                data-docker-active-panel={activeTab === 'images' ? 'true' : 'false'}
              >
                <ImagesTab serverId={serverId} />
              </TabsContent>
              <TabsContent
                value="volumes"
                className="mt-0 min-h-0 min-w-0 overflow-y-auto p-4 data-[state=active]:block"
                data-docker-active-panel={activeTab === 'volumes' ? 'true' : 'false'}
              >
                <VolumesTab
                  serverId={serverId}
                  refreshSignal={refreshSignal}
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
                className="mt-0 min-h-0 min-w-0 overflow-y-auto p-4 data-[state=active]:block"
                data-docker-active-panel={activeTab === 'networks' ? 'true' : 'false'}
              >
                <NetworksTab serverId={serverId} refreshSignal={refreshSignal} />
              </TabsContent>
              <TabsContent
                value="compose"
                className="mt-0 min-h-0 min-w-0 overflow-y-auto p-4 data-[state=active]:block"
                data-docker-active-panel={activeTab === 'compose' ? 'true' : 'false'}
              >
                <ComposeTab
                  serverId={serverId}
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
