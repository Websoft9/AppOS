import { Fragment, useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import { dockerApiPath } from '@/lib/docker-api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Play,
  Square,
  RotateCw,
  Trash2,
  MoreVertical,
  FileText,
  Settings2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Loader2,
  Filter,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Download,
} from 'lucide-react'
import { getApiErrorMessage } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { DockerTextDialog } from '@/components/docker/DockerTextDialog'

const COMPOSE_SORT_KEY = 'docker.compose.sort'
const DOCKER_PAGE_SIZE_KEY = 'docker.list.page_size'

function loadGlobalPageSize(): 25 | 50 | 100 {
  try {
    const raw = Number(localStorage.getItem(DOCKER_PAGE_SIZE_KEY) || '50')
    if (raw === 25 || raw === 50 || raw === 100) return raw
  } catch {
    // ignore invalid local storage
  }
  return 50
}

interface ComposeProject {
  Name: string
  Status: string
  ConfigFiles: string
}

interface Container {
  ID: string
  Names: string
  Image: string
  Status: string
}

interface ContainerListRow {
  ID: string
  Names: string
  Image: string
  State?: string
  Status: string
}

interface ComposeMetadataContainer {
  id?: string
  name?: string
  image?: string
  state?: string
  status?: string
}

interface ComposeMetadataResponse {
  items?: Record<string, { containers?: ComposeMetadataContainer[] }>
}

interface ComposePsPublisher {
  URL?: string
  TargetPort?: number
  PublishedPort?: number
  Protocol?: string
}

interface ComposePsRow {
  ID?: string
  Name?: string
  Service?: string
  State?: string
  Health?: string
  Publishers?: ComposePsPublisher[] | null
}

interface ContainerMetadataResponse {
  items?: Record<string, { compose_project?: string }>
}

type ComposeTextRequest = {
  kind: 'logs' | 'config'
  projectName: string
  projectDir: string
  configPath?: string
}

type ComposeOperationKey = 'pull' | 'up' | 'start' | 'stop' | 'restart' | 'down' | 'down-remove'

type ComposeOperationRequest = {
  key: ComposeOperationKey
  label: string
  projectName: string
  projectDir: string
  requestPath: string
  body?: Record<string, unknown>
}

export interface ComposeTabSummary {
  totalItems: number
  totalPages: number
  statusCounts: Array<{ status: string; count: number }>
}

function parseContainers(output: string): ContainerListRow[] {
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
    .filter(Boolean) as ContainerListRow[]
}

function normalizeComposeMetadataContainers(containers?: ComposeMetadataContainer[]): Container[] {
  if (!Array.isArray(containers)) return []
  return containers.map(container => ({
    ID: container.id || container.name || '',
    Names: container.name || container.id || '-',
    Image: container.image || '-',
    Status: container.status || container.state || '-',
  }))
}

function groupContainersByMetadata(
  projects: ComposeProject[],
  containers: ContainerListRow[],
  metadata?: ContainerMetadataResponse
): Record<string, Container[]> {
  const grouped: Record<string, Container[]> = {}
  const projectSet = new Set(projects.map(project => project.Name).filter(Boolean))
  for (const project of projects) grouped[project.Name] = []

  for (const container of containers) {
    const composeProject = metadata?.items?.[container.ID]?.compose_project
    if (!composeProject || !projectSet.has(composeProject)) continue
    grouped[composeProject].push({
      ID: container.ID,
      Names: container.Names?.replace(/^\/+/, '') || container.ID || '-',
      Image: container.Image || '-',
      Status: container.Status || container.State || '-',
    })
  }

  return grouped
}

function parseProjects(output: string): ComposeProject[] {
  if (!output.trim()) return []
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed)) return parsed
    return [parsed]
  } catch {
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
      .filter(Boolean) as ComposeProject[]
  }
}

function parseComposePs(output: string): ComposePsRow[] {
  if (!output.trim()) return []
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed)) return parsed as ComposePsRow[]
    if (parsed && typeof parsed === 'object') return [parsed as ComposePsRow]
  } catch {
    // fall through to line-based parsing
  }
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
    .filter(Boolean) as ComposePsRow[]
}

function formatComposePsPorts(publishers?: ComposePsPublisher[] | null): string {
  if (!publishers || publishers.length === 0) return '-'
  return publishers
    .map(publisher => {
      const host = publisher.URL || '0.0.0.0'
      const published = publisher.PublishedPort ?? '?'
      const target = publisher.TargetPort ?? '?'
      const protocol = (publisher.Protocol || 'tcp').toLowerCase()
      return `${host}:${published}->${target}/${protocol}`
    })
    .join(', ')
}

function composePsStateLabel(row: ComposePsRow): string {
  const parts = [row.State, row.Health].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : 'unknown'
}

function lastPathSegment(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status?.toLowerCase().includes('running')) return 'default'
  if (status?.toLowerCase().includes('exited') || status?.toLowerCase().includes('dead')) {
    return 'destructive'
  }
  return 'secondary'
}

export function ComposeTab({
  serverId,
  refreshSignal = 0,
  embeddedInWorkspace = false,
  externalFilter,
  externalStatusFilter,
  page: externalPage,
  pageSize: externalPageSize,
  onPageChange,
  onSummaryChange,
  onStatusFilterChange,
  onOpenContainerFilter,
  onOpenContainerNames,
}: {
  serverId: string
  refreshSignal?: number
  embeddedInWorkspace?: boolean
  externalFilter?: string
  externalStatusFilter?: string
  page?: number
  pageSize?: 25 | 50 | 100
  onPageChange?: (page: number) => void
  onSummaryChange?: (summary: ComposeTabSummary) => void
  onStatusFilterChange?: (status: string) => void
  onOpenContainerFilter?: (containerName: string) => void
  onOpenContainerNames?: (containerNames: string[]) => void
}) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [projectContainers, setProjectContainers] = useState<Record<string, Container[]>>({})
  const [projectContainersLoading, setProjectContainersLoading] = useState<Record<string, boolean>>(
    {}
  )
  const [projectPs, setProjectPs] = useState<Record<string, ComposePsRow[]>>({})
  const [projectPsLoading, setProjectPsLoading] = useState<Record<string, boolean>>({})
  const [projectContainersHydrated, setProjectContainersHydrated] = useState(false)
  const [sortKey, setSortKey] = useState<'project'>(() => {
    try {
      const raw = localStorage.getItem(COMPOSE_SORT_KEY)
      if (!raw) return 'project'
      const parsed = JSON.parse(raw) as { key?: 'project' }
      return parsed.key === 'project' ? 'project' : 'project'
    } catch {
      return 'project'
    }
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try {
      const raw = localStorage.getItem(COMPOSE_SORT_KEY)
      if (!raw) return 'asc'
      const parsed = JSON.parse(raw) as { dir?: 'asc' | 'desc' }
      return parsed.dir || 'asc'
    } catch {
      return 'asc'
    }
  })
  const [internalPageSize, setInternalPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [internalPage, setInternalPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)

  const effectivePage = externalPage ?? internalPage
  const effectivePageSize = externalPageSize ?? internalPageSize

  const changePage = (nextPage: number) => {
    setInternalPage(nextPage)
    onPageChange?.(nextPage)
  }

  const changePageSize = (nextPageSize: 25 | 50 | 100) => {
    if (externalPageSize !== undefined) return
    setInternalPageSize(nextPageSize)
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(nextPageSize))
    setInternalPage(1)
  }

  useEffect(() => {
    localStorage.setItem(COMPOSE_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useEffect(() => {
    if (externalFilter !== undefined) setFilter(externalFilter)
  }, [externalFilter])

  useEffect(() => {
    if (externalStatusFilter !== undefined) setStatusFilter(externalStatusFilter)
  }, [externalStatusFilter])

  const [textDialogOpen, setTextDialogOpen] = useState(false)
  const [textDialogRequest, setTextDialogRequest] = useState<ComposeTextRequest | null>(null)
  const [textDialogContent, setTextDialogContent] = useState('')
  const [textDialogLoading, setTextDialogLoading] = useState(false)
  const [operationDialogOpen, setOperationDialogOpen] = useState(false)
  const [operationRequest, setOperationRequest] = useState<ComposeOperationRequest | null>(null)
  const [operationOutput, setOperationOutput] = useState('')
  const [operationLoading, setOperationLoading] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)

  const {
    data: projects = [],
    isLoading: loading,
    error,
  } = useQuery<ComposeProject[]>({
    queryKey: ['docker', 'compose', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/compose/ls'), {
        method: 'GET',
      })
      return parseProjects(res.output)
    },
    placeholderData: previousData => previousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
  })

  useEffect(() => {
    setProjectContainers({})
    setProjectContainersLoading({})
    setProjectPs({})
    setProjectPsLoading({})
    setProjectContainersHydrated(false)
  }, [serverId])

  const hasProjectContainerLoading = useMemo(
    () => Object.values(projectContainersLoading).some(Boolean),
    [projectContainersLoading]
  )

  const projectNamesKey = useMemo(
    () => projects.map(project => project.Name).filter(Boolean).sort().join(','),
    [projects]
  )

  const loadProjectContainers = useCallback(
    async (projectName: string, options?: { force?: boolean }) => {
      if (!options?.force && projectContainersHydrated) return
      if (projectContainersLoading[projectName]) return

      setProjectContainersLoading(() => {
        const next: Record<string, boolean> = {}
        for (const project of projects) {
          next[project.Name] = true
        }
        return next
      })
      try {
        const projectNames = projects.map(project => project.Name).filter(Boolean)
        let grouped: Record<string, Container[]>
        try {
          const metadata = (await pb.send(dockerApiPath(serverId, '/compose/metadata'), {
            method: 'POST',
            body: { projects: projectNames },
          })) as ComposeMetadataResponse

          grouped = {}
          for (const project of projects) {
            grouped[project.Name] = normalizeComposeMetadataContainers(
              metadata.items?.[project.Name]?.containers
            )
          }
        } catch {
          const containersRes = await pb.send(dockerApiPath(serverId, '/containers'), {
            method: 'GET',
          })
          const containers = parseContainers(String(containersRes.output || ''))
          const ids = containers.map(container => container.ID).filter(Boolean)
          const metadata = ids.length > 0
            ? ((await pb.send(dockerApiPath(serverId, '/containers/metadata'), {
                method: 'POST',
                body: { ids },
              })) as ContainerMetadataResponse)
            : undefined
          grouped = groupContainersByMetadata(projects, containers, metadata)
        }
        if (!grouped[projectName]) grouped[projectName] = []
        setProjectContainers(grouped)
        setProjectContainersHydrated(true)
      } catch (err) {
        setActionError(getApiErrorMessage(err, 'Failed to load compose containers'))
      } finally {
        setProjectContainersLoading(state => {
          const next = { ...state }
          for (const key of Object.keys(next)) next[key] = false
          return next
        })
      }
    },
    [projectContainersHydrated, projectContainersLoading, projects, serverId]
  )

  const loadProjectPs = useCallback(
    async (projectName: string, projectDir: string, options?: { force?: boolean }) => {
      if (!options?.force && projectPs[projectName]) return
      if (projectPsLoading[projectName]) return

      setProjectPsLoading(state => ({ ...state, [projectName]: true }))
      try {
        const res = await pb.send(dockerApiPath(serverId, '/compose/ps'), {
          method: 'GET',
          query: { projectDir, projectName },
        })
        setProjectPs(state => ({
          ...state,
          [projectName]: parseComposePs(String(res.output || '')),
        }))
      } catch (err) {
        setActionError(getApiErrorMessage(err, 'Failed to load compose project details'))
      } finally {
        setProjectPsLoading(state => ({ ...state, [projectName]: false }))
      }
    },
    [projectPs, projectPsLoading, serverId]
  )

  useEffect(() => {
    if (projects.length === 0) return
    const hasMissingProject = projects.some(project => !(project.Name in projectContainers))
    if (!projectContainersHydrated) {
      void loadProjectContainers(projects[0].Name)
      return
    }
    if (hasMissingProject) {
      void loadProjectContainers(projects[0].Name, { force: true })
    }
  }, [loadProjectContainers, projectContainers, projectContainersHydrated, projectNamesKey, projects])

  useEffect(() => {
    if (!projectContainersHydrated || projects.length === 0) return
    setProjectContainers(state => {
      const next = { ...state }
      for (const project of projects) {
        if (!next[project.Name]) next[project.Name] = []
      }
      return next
    })
  }, [projectContainersHydrated, projects])

  const composeAction = async (request: ComposeOperationRequest) => {
    try {
      setActionError(null)
      setOperationRequest(request)
      setOperationDialogOpen(true)
      setOperationLoading(true)
      setOperationFailed(false)
      setOperationOutput('')
      const res = await pb.send(dockerApiPath(serverId, request.requestPath), {
        method: 'POST',
        body: request.body || { projectDir: request.projectDir },
      })
      setOperationOutput(String(res.output || 'Operation completed with no output.'))
      setProjectContainers({})
      setProjectContainersLoading({})
      setProjectPs({})
      setProjectPsLoading({})
      setProjectContainersHydrated(false)
      await queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] })
    } catch (err) {
      setOperationFailed(true)
      setOperationOutput(
        getApiErrorMessage(err, `${request.label} failed`)
      )
    }
    finally {
      setOperationLoading(false)
    }
  }

  const loadTextDialog = useCallback(
		async (request: ComposeTextRequest) => {
			setTextDialogLoading(true)
			setTextDialogContent('')
			try {
				if (request.kind === 'logs') {
					const res = await pb.send(dockerApiPath(serverId, '/compose/logs'), {
						method: 'GET',
						query: { projectDir: request.projectDir, tail: '200' },
					})
					setTextDialogContent(String(res.output || ''))
					return
				}

				const res = await pb.send(dockerApiPath(serverId, '/compose/config'), {
					method: 'GET',
					query: { projectDir: request.projectDir },
				})
				setTextDialogContent(String(res.content || ''))
			} catch (err) {
				setTextDialogContent(
					getApiErrorMessage(
						err,
						request.kind === 'logs' ? 'Failed to load logs' : 'Failed to load config'
					)
				)
			} finally {
				setTextDialogLoading(false)
			}
		},
		[serverId]
	)

  const openLogs = (projectName: string, projectDir: string) => {
		const request: ComposeTextRequest = { kind: 'logs', projectName, projectDir }
		setTextDialogRequest(request)
		setTextDialogOpen(true)
		void loadTextDialog(request)
	}

  const openConfig = (projectName: string, projectDir: string, configPath?: string) => {
		const request: ComposeTextRequest = { kind: 'config', projectName, projectDir, configPath }
		setTextDialogRequest(request)
		setTextDialogOpen(true)
		void loadTextDialog(request)
	}

  const pendingProjectName = operationLoading ? operationRequest?.projectName || null : null

  const runComposeAction = (request: ComposeOperationRequest) => {
    void composeAction(request)
  }

  const filtered = useMemo(() => {
    return projects.filter(project => {
      if (!project.Name?.toLowerCase().includes(filter.toLowerCase())) return false
      const normalizedStatus = (project.Status || 'unknown').trim() || 'unknown'
      if (statusFilter !== 'all' && normalizedStatus !== statusFilter) return false
      return true
    })
  }, [filter, projects, statusFilter])

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const project of projects) {
      const key = (project.Status || 'unknown').trim() || 'unknown'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([status, count]) => ({ status, count }))
  }, [projects])

  const sorted = useMemo(() => {
    const items = [...filtered]
    items.sort((left, right) => {
      const leftValue = (left.Name || '').toLowerCase()
      const rightValue = (right.Name || '').toLowerCase()
      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [filtered, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / effectivePageSize))
  const paged = useMemo(() => {
    const start = (effectivePage - 1) * effectivePageSize
    return sorted.slice(start, start + effectivePageSize)
  }, [effectivePage, effectivePageSize, sorted])

  useEffect(() => {
    changePage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sortDir, sortKey, effectivePageSize, serverId, statusFilter])

  useEffect(() => {
    if (effectivePage > totalPages) changePage(totalPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePage, totalPages])

  useEffect(() => {
    onSummaryChange?.({ totalItems: sorted.length, totalPages, statusCounts })
  }, [onSummaryChange, sorted.length, statusCounts, totalPages])

  const toggleSort = (key: 'project') => {
    if (sortKey === key) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: 'project' }) => (
    <button
      type="button"
      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded px-0 text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
      onClick={() => toggleSort(keyName)}
    >
      {label}
      {sortKey !== keyName ? (
        <ArrowUpDown className="h-3 w-3" />
      ) : sortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )}
    </button>
  )

  const loadError = error ? getApiErrorMessage(error, 'Failed to load compose projects') : null

  const toggleProjectExpansion = (projectName: string, projectDir: string) => {
    setExpandedProject(current => {
      const next = current === projectName ? null : projectName
      if (next === projectName) {
        void loadProjectContainers(projectName)
        void loadProjectPs(projectName, projectDir)
      }
      return next
    })
  }

  return (
    <div className={cn('h-full min-h-0 flex flex-col gap-4', embeddedInWorkspace ? 'pt-0' : 'pt-4')}>
      {(loadError || actionError) && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{loadError || actionError}</AlertDescription>
        </Alert>
      )}

      {!embeddedInWorkspace && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-lg border bg-muted/20 px-3 py-3">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search projects"
            className="h-8 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:mr-[5ch] sm:w-[20ch]"
          />
          <span className="text-xs text-muted-foreground">{sorted.length} total</span>
          <div className="flex items-center gap-0.5 text-xs">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => changePage(Math.max(1, effectivePage - 1))}
              disabled={effectivePage <= 1}
              aria-label="Previous compose page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="font-medium tabular-nums">{effectivePage}/{totalPages}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => changePage(Math.min(totalPages, effectivePage + 1))}
              disabled={effectivePage >= totalPages}
              aria-label="Next compose page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
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
              <DropdownMenuRadioGroup
                value={String(effectivePageSize)}
                onValueChange={value => changePageSize(Number(value) as 25 | 50 | 100)}
              >
                <DropdownMenuRadioItem value="25">25 / page</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="50">50 / page</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="100">100 / page</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {(hasProjectContainerLoading || operationLoading) && !embeddedInWorkspace && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/10 px-3 py-2">
          {hasProjectContainerLoading ? <Badge variant="outline">Loading project containers...</Badge> : null}
          {operationLoading && operationRequest ? (
            <Badge variant="outline" className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {operationRequest.label} {operationRequest.projectName}
            </Badge>
          ) : null}
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-background">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
              <TableRow>
                <TableHead className="min-w-[220px] pl-4 pr-2">
                  <div className="flex items-center">
                    <SortHead label="Project" keyName="project" />
                  </div>
                </TableHead>
                <TableHead className="min-w-[140px]">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-foreground">Status</span>
                    {!embeddedInWorkspace ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Filter compose status"
                            title={statusFilter === 'all' ? 'Filter compose status' : `Compose status: ${statusFilter}`}
                          >
                            <Filter className={cn('h-3.5 w-3.5', statusFilter !== 'all' && 'text-foreground')} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuRadioGroup
                            value={statusFilter}
                            onValueChange={value => {
                              setStatusFilter(value)
                              onStatusFilterChange?.(value)
                            }}
                          >
                            <DropdownMenuRadioItem value="all">All status</DropdownMenuRadioItem>
                            {statusCounts.map(({ status, count }) => (
                              <DropdownMenuRadioItem key={status} value={status}>
                                {status} ({count})
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : statusFilter !== 'all' ? (
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {statusFilter}
                      </Badge>
                    ) : null}
                  </div>
                </TableHead>
                <TableHead className="w-[160px] min-w-[160px] text-left text-xs font-medium text-foreground">Containers</TableHead>
                <TableHead className="min-w-[240px] text-xs font-medium text-foreground">Config</TableHead>
                <TableHead className="w-[52px] text-center text-xs font-medium text-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {paged.map(project => {
                const dir = project.ConfigFiles
                  ? project.ConfigFiles.split(',')[0].replace(/\/[^/]+$/, '')
                  : project.Name
                const primaryConfigPath = project.ConfigFiles?.split(',')[0] || ''
                const containers = projectContainers[project.Name] || []
                const psRows = projectPs[project.Name] || []
                const isExpanded = expandedProject === project.Name
                const rowBusy = pendingProjectName === project.Name
                return (
                  <Fragment key={project.Name}>
                    <TableRow className={cn('border-b border-border/60 align-middle transition-colors hover:bg-muted/30', isExpanded && 'bg-muted/20')}>
                      <TableCell
                        className="cursor-pointer pl-4 pr-3 py-3 text-xs"
                        onClick={event => {
                          const target = event.target as HTMLElement
                          if (target.closest('button')) return
                          toggleProjectExpansion(project.Name, dir)
                        }}
                      >
                        <button
                          type="button"
                          className="group inline-flex min-h-8 w-full items-center text-left"
                          onClick={() => toggleProjectExpansion(project.Name, dir)}
                          title={project.Name}
                        >
                          <span className="truncate text-xs font-semibold leading-tight text-foreground group-hover:underline">
                            {project.Name}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="py-3 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant={statusVariant(project.Status)} className="text-xs">
                            {project.Status || 'unknown'}
                          </Badge>
                          {rowBusy && operationRequest ? (
                            <Badge variant="outline" className="inline-flex items-center gap-1 text-[11px] font-normal">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {operationRequest.label}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="w-[160px] min-w-[160px] py-3 text-left text-xs align-middle">
                        <div className="flex h-8 items-center">
                          {projectContainersLoading[project.Name] || (!projectContainersHydrated && !(project.Name in projectContainers)) ? (
                            <span className="inline-flex h-8 items-center text-muted-foreground">...</span>
                          ) : containers.length > 0 ? (
                            <button
                              type="button"
                              className="inline-flex h-8 w-full items-center justify-start gap-1 text-left text-xs text-primary hover:underline"
                              title={containers.map(container => container.Names).join(', ')}
                              onClick={() => onOpenContainerNames?.(containers.map(container => container.Names).filter(Boolean))}
                            >
                              <span className="truncate">{containers.length} container{containers.length > 1 ? 's' : ''}</span>
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </button>
                          ) : projectContainersHydrated ? (
                            <span className="inline-flex h-8 items-center text-muted-foreground">-</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs">
                        <Button
                          variant="link"
                          className="h-auto max-w-full justify-start truncate p-0 font-mono text-xs"
                          onClick={() => openConfig(project.Name, dir, primaryConfigPath)}
                          title={project.ConfigFiles}
                        >
                          {project.ConfigFiles}
                        </Button>
                      </TableCell>
                      <TableCell className="py-3 text-center align-middle">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={operationLoading}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={operationLoading}
                              onSelect={() =>
                                setTimeout(
                                  () =>
                                    runComposeAction({
                                      key: 'pull',
                                      label: 'Pulling',
                                      projectName: project.Name,
                                      projectDir: dir,
                                      requestPath: '/compose/pull',
                                    }),
                                  0
                                )
                              }
                            >
                              <Download className="mr-2 h-4 w-4" /> Pull
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={operationLoading}
                              onSelect={() =>
                                setTimeout(
                                  () =>
                                    runComposeAction({
                                      key: 'up',
                                      label: 'Starting',
                                      projectName: project.Name,
                                      projectDir: dir,
                                      requestPath: '/compose/up',
                                    }),
                                  0
                                )
                              }
                            >
                              <ArrowUp className="mr-2 h-4 w-4" /> Up
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={operationLoading}
                              onSelect={() =>
                                setTimeout(
                                  () =>
                                    runComposeAction({
                                      key: 'start',
                                      label: 'Starting',
                                      projectName: project.Name,
                                      projectDir: dir,
                                      requestPath: '/compose/start',
                                    }),
                                  0
                                )
                              }
                            >
                              <Play className="mr-2 h-4 w-4" /> Start
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={operationLoading}
                              onSelect={() =>
                                setTimeout(
                                  () =>
                                    runComposeAction({
                                      key: 'stop',
                                      label: 'Stopping',
                                      projectName: project.Name,
                                      projectDir: dir,
                                      requestPath: '/compose/stop',
                                    }),
                                  0
                                )
                              }
                            >
                              <Square className="mr-2 h-4 w-4" /> Stop
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={operationLoading}
                              onSelect={() =>
                                setTimeout(
                                  () =>
                                    runComposeAction({
                                      key: 'restart',
                                      label: 'Restarting',
                                      projectName: project.Name,
                                      projectDir: dir,
                                      requestPath: '/compose/restart',
                                    }),
                                  0
                                )
                              }
                            >
                              <RotateCw className="mr-2 h-4 w-4" /> Restart
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={operationLoading}
                              onSelect={() =>
                                setTimeout(
                                  () =>
                                    runComposeAction({
                                      key: 'down',
                                      label: 'Stopping',
                                      projectName: project.Name,
                                      projectDir: dir,
                                      requestPath: '/compose/down',
                                    }),
                                  0
                                )
                              }
                            >
                              <ArrowDown className="mr-2 h-4 w-4" /> Down
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => openLogs(project.Name, dir), 0)}>
                              <FileText className="mr-2 h-4 w-4" /> Logs
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => openConfig(project.Name, dir, primaryConfigPath), 0)}>
                              <Settings2 className="mr-2 h-4 w-4" /> View Config
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={operationLoading}
                              onSelect={() =>
                                setTimeout(
                                  () =>
                                    runComposeAction({
                                      key: 'down-remove',
                                      label: 'Removing',
                                      projectName: project.Name,
                                      projectDir: dir,
                                      requestPath: '/compose/down',
                                      body: { projectDir: dir, removeVolumes: true },
                                    }),
                                  0
                                )
                              }
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Down + Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/20 px-4 py-3">
                          <div className="space-y-4 rounded-lg border bg-background p-4 shadow-sm">
                            <div>
                              <div className="mb-2 text-xs font-medium text-muted-foreground">Compose Services</div>
                              {projectPsLoading[project.Name] ? (
                                <div className="text-xs text-muted-foreground">Loading project status...</div>
                              ) : psRows.length > 0 ? (
                                <div className="overflow-x-auto rounded-md border">
                                  <table className="min-w-full text-xs">
                                    <thead className="bg-muted/30 text-muted-foreground">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium">Service</th>
                                        <th className="px-3 py-2 text-left font-medium">Container</th>
                                        <th className="px-3 py-2 text-left font-medium">State</th>
                                        <th className="px-3 py-2 text-left font-medium">Ports</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {psRows.map((row, index) => (
                                        <tr key={`${row.Name || row.Service || 'service'}-${index}`} className="border-t align-middle">
                                          <td className="px-3 py-2 font-medium text-foreground">{row.Service || '-'}</td>
                                          <td className="px-3 py-2 font-mono text-muted-foreground">
                                            {row.Name && onOpenContainerFilter ? (
                                              <button
                                                type="button"
                                                className="inline-flex items-center gap-1 text-left text-xs text-primary hover:underline"
                                                onClick={() => onOpenContainerFilter(row.Name || '')}
                                                title={row.Name}
                                              >
                                                <span className="truncate">{row.Name}</span>
                                                <ExternalLink className="h-3 w-3" />
                                              </button>
                                            ) : (
                                              row.Name || '-'
                                            )}
                                          </td>
                                          <td className="px-3 py-2">
                                            <Badge variant={statusVariant(row.State || composePsStateLabel(row))} className="text-[11px]">
                                              {composePsStateLabel(row)}
                                            </Badge>
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground">{formatComposePsPorts(row.Publishers)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">No services found for this project.</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
              {!loading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No compose projects found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <DockerTextDialog
        open={textDialogOpen}
        onOpenChange={open => {
          setTextDialogOpen(open)
          if (!open) setTextDialogRequest(null)
        }}
        title={
          textDialogRequest?.kind === 'config'
            ? `Compose Config: ${textDialogRequest.configPath || textDialogRequest.projectName || ''}`
            : `Compose Logs: ${textDialogRequest?.projectName || ''}`
        }
        description={
          textDialogRequest?.kind === 'config'
            ? 'docker-compose.yml content for this compose project.'
            : 'Recent docker compose logs for this project.'
        }
        content={textDialogContent}
        loading={textDialogLoading}
        loadingText={textDialogRequest?.kind === 'config' ? 'Loading config...' : 'Loading logs...'}
        emptyText={textDialogRequest?.kind === 'config' ? '(empty file)' : '(no output)'}
        onRefresh={textDialogRequest ? () => void loadTextDialog(textDialogRequest) : undefined}
        refreshDisabled={!textDialogRequest}
        downloadBaseName={
          textDialogRequest?.kind === 'config'
            ? lastPathSegment(textDialogRequest.configPath || 'docker-compose.yml')
            : `${textDialogRequest?.projectName || 'compose'}-logs`
        }
        downloadExtension={textDialogRequest?.kind === 'config' ? 'yml' : 'log'}
        copySuccessText={textDialogRequest?.kind === 'config' ? 'Config copied' : 'Logs copied'}
        copyFailureText={
          textDialogRequest?.kind === 'config' ? 'Failed to copy config' : 'Failed to copy logs'
        }
        downloadFailureText={
          textDialogRequest?.kind === 'config'
            ? 'Failed to download config'
            : 'Failed to download logs'
        }
      />

      <DockerTextDialog
        open={operationDialogOpen}
        onOpenChange={setOperationDialogOpen}
        title={
          operationRequest ? `Compose ${operationRequest.label}: ${operationRequest.projectName}` : 'Compose Operation'
        }
        description={
          operationRequest
            ? operationLoading
              ? 'This compose operation may take a while. The row status and this dialog will update when it finishes.'
              : operationFailed
                ? 'The operation failed. Review the output below.'
                : 'The operation finished. Review the output below.'
            : undefined
        }
        content={operationOutput}
        loading={operationLoading}
        loadingText={operationRequest ? `${operationRequest.label} ${operationRequest.projectName}...` : 'Running compose operation...'}
        emptyText={operationFailed ? '(operation failed without output)' : '(operation completed with no output)'}
        downloadBaseName={
          operationRequest
            ? `${operationRequest.projectName}-${operationRequest.key}`
            : 'compose-operation'
        }
        downloadExtension="log"
        copySuccessText="Operation output copied"
        copyFailureText="Failed to copy operation output"
        downloadFailureText="Failed to download operation output"
      />
    </div>
  )
}
