import { Fragment, useState, useEffect, useRef, useMemo, useCallback } from 'react'
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  Copy,
  Download,
  Loader2,
  Filter,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import { getApiErrorMessage } from '@/lib/api-error'
import { cn } from '@/lib/utils'

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

interface ContainerMetadataResponse {
  items?: Record<string, { compose_project?: string }>
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
  page: externalPage,
  pageSize: externalPageSize,
  onPageChange,
  onSummaryChange,
  onOpenContainerFilter,
  onOpenContainerNames,
}: {
  serverId: string
  refreshSignal?: number
  embeddedInWorkspace?: boolean
  externalFilter?: string
  page?: number
  pageSize?: 25 | 50 | 100
  onPageChange?: (page: number) => void
  onSummaryChange?: (summary: { totalItems: number; totalPages: number }) => void
  onOpenContainerFilter?: (containerName: string) => void
  onOpenContainerNames?: (containerNames: string[]) => void
}) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [inlineConfig, setInlineConfig] = useState<Record<string, string>>({})
  const [inlineConfigLoading, setInlineConfigLoading] = useState<Record<string, boolean>>({})
  const [projectContainers, setProjectContainers] = useState<Record<string, Container[]>>({})
  const [projectContainersLoading, setProjectContainersLoading] = useState<Record<string, boolean>>(
    {}
  )
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

  const [logsOpen, setLogsOpen] = useState(false)
  const [logsProject, setLogsProject] = useState('')
  const [logsContent, setLogsContent] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsActionTip, setLogsActionTip] = useState('')
  const logsEndRef = useRef<HTMLDivElement>(null)

  const [configOpen, setConfigOpen] = useState(false)
  const [configProject, setConfigProject] = useState('')
  const [configContent, setConfigContent] = useState('')
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

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

  const composeAction = async (action: string, projectDir: string, method: string = 'POST') => {
    try {
      setActionError(null)
      await pb.send(dockerApiPath(serverId, `/compose/${action}`), {
        method,
        body: { projectDir },
      })
      setProjectContainers({})
      setProjectContainersLoading({})
      setProjectContainersHydrated(false)
      await queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, `Compose ${action} failed`))
    }
  }

  const openLogs = async (projectDir: string) => {
    setLogsProject(projectDir)
    setLogsContent('')
    setLogsOpen(true)
    setLogsLoading(true)
    try {
      const res = await pb.send(dockerApiPath(serverId, '/compose/logs'), {
        method: 'GET',
        query: { projectDir, tail: '200' },
      })
      setLogsContent(res.output || 'No logs available')
    } catch (err) {
      setLogsContent(getApiErrorMessage(err, 'Failed to load logs'))
    } finally {
      setLogsLoading(false)
    }
  }

  const copyLogs = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logsContent || '')
      setLogsActionTip('Logs copied')
      window.setTimeout(() => setLogsActionTip(''), 1200)
    } catch {
      setLogsActionTip('Failed to copy logs')
      window.setTimeout(() => setLogsActionTip(''), 1200)
    }
  }, [logsContent])

  const downloadLogs = useCallback(() => {
    try {
      const safeName = (logsProject || 'compose').replace(/[^a-zA-Z0-9._-]/g, '_')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const blob = new Blob([logsContent || ''], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeName}-logs-${timestamp}.log`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      setLogsActionTip('Failed to download logs')
      window.setTimeout(() => setLogsActionTip(''), 1200)
    }
  }, [logsContent, logsProject])

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [logsContent])

  const openConfig = async (projectDir: string) => {
    setConfigProject(projectDir)
    setConfigContent('')
    setConfigOpen(true)
    setConfigLoading(true)
    try {
      const res = await pb.send(dockerApiPath(serverId, '/compose/config'), {
        method: 'GET',
        query: { projectDir },
      })
      setConfigContent(res.content || '')
    } catch (err) {
      setConfigContent(getApiErrorMessage(err, 'Failed to load config'))
    } finally {
      setConfigLoading(false)
    }
  }

  const openInlineConfig = async (projectName: string, projectDir: string) => {
    setInlineConfigLoading(state => ({ ...state, [projectName]: true }))
    try {
      const res = await pb.send(dockerApiPath(serverId, '/compose/config'), {
        method: 'GET',
        query: { projectDir },
      })
      setInlineConfig(state => ({ ...state, [projectName]: res.content || '' }))
    } catch (err) {
      setInlineConfig(state => ({
        ...state,
        [projectName]: getApiErrorMessage(err, 'Failed to load config'),
      }))
    } finally {
      setInlineConfigLoading(state => ({ ...state, [projectName]: false }))
    }
  }

  const saveConfig = async () => {
    setConfigSaving(true)
    try {
      setActionError(null)
      await pb.send(dockerApiPath(serverId, '/compose/config'), {
        method: 'PUT',
        body: { projectDir: configProject, content: configContent },
      })
      setConfigOpen(false)
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to save config'))
    } finally {
      setConfigSaving(false)
    }
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
    return Array.from(counts.entries()).sort((left, right) => left[0].localeCompare(right[0]))
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
    onSummaryChange?.({ totalItems: sorted.length, totalPages })
  }, [onSummaryChange, sorted.length, totalPages])

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
        if (!inlineConfig[projectName] && !inlineConfigLoading[projectName]) {
          void openInlineConfig(projectName, projectDir)
        }
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

      {hasProjectContainerLoading && !embeddedInWorkspace && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/10 px-3 py-2">
          <Badge variant="outline">Loading project containers...</Badge>
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
                        <DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
                          <DropdownMenuRadioItem value="all">All statuses ({projects.length})</DropdownMenuRadioItem>
                          {statusCounts.map(([status, count]) => (
                            <DropdownMenuRadioItem key={status} value={status}>
                              {status} ({count})
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead className="min-w-[120px] text-left text-xs font-medium text-foreground">Containers</TableHead>
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
                const containers = projectContainers[project.Name] || []
                const isExpanded = expandedProject === project.Name
                return (
                  <Fragment key={project.Name}>
                    <TableRow className={cn('border-b border-border/60 align-top transition-colors hover:bg-muted/30', isExpanded && 'bg-muted/20')}>
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
                          className="min-w-0 truncate text-left font-mono text-xs font-medium leading-tight text-foreground hover:underline"
                          onClick={() => toggleProjectExpansion(project.Name, dir)}
                          title={project.Name}
                        >
                          {project.Name}
                        </button>
                      </TableCell>
                      <TableCell className="py-3 text-xs">
                        <Badge variant={statusVariant(project.Status)} className="text-xs">
                          {project.Status || 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 text-left text-xs">
                        {containers.length > 0 ? (
                          <Button
                            variant="link"
                            className="h-auto justify-start p-0 text-left text-xs"
                            title={containers.map(container => container.Names).join(', ')}
                            onClick={() => onOpenContainerNames?.(containers.map(container => container.Names).filter(Boolean))}
                          >
                            <span className="truncate">{containers.length} container{containers.length > 1 ? 's' : ''}</span>
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        ) : projectContainersHydrated ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <span className="text-muted-foreground">...</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs">
                        <Button
                          variant="link"
                          className="h-auto max-w-full justify-start truncate p-0 font-mono text-xs"
                          onClick={() => toggleProjectExpansion(project.Name, dir)}
                        >
                          {project.ConfigFiles}
                        </Button>
                      </TableCell>
                      <TableCell className="py-3 text-center align-middle">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setTimeout(() => composeAction('up', dir), 0)}>
                              <ArrowUp className="mr-2 h-4 w-4" /> Up
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => composeAction('start', dir), 0)}>
                              <Play className="mr-2 h-4 w-4" /> Start
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => composeAction('stop', dir), 0)}>
                              <Square className="mr-2 h-4 w-4" /> Stop
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => composeAction('restart', dir), 0)}>
                              <RotateCw className="mr-2 h-4 w-4" /> Restart
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => composeAction('down', dir), 0)}>
                              <ArrowDown className="mr-2 h-4 w-4" /> Down
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => openLogs(dir), 0)}>
                              <FileText className="mr-2 h-4 w-4" /> Logs
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setTimeout(() => openConfig(dir), 0)}
                              disabled={serverId !== 'local'}
                              title={
                                serverId !== 'local'
                                  ? 'Config editing is only available for local server'
                                  : undefined
                              }
                            >
                              <Settings2 className="mr-2 h-4 w-4" /> Config
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                setTimeout(() => {
                                  setActionError(null)
                                  pb.send(dockerApiPath(serverId, '/compose/down'), {
                                    method: 'POST',
                                    body: { projectDir: dir, removeVolumes: true },
                                  })
                                    .then(() =>
                                      queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] })
                                    )
                                    .catch(err =>
                                      setActionError(getApiErrorMessage(err, 'Compose down + remove failed'))
                                    )
                                }, 0)
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
                              <div className="mb-2 text-xs font-medium text-muted-foreground">Containers</div>
                              {projectContainersLoading[project.Name] || (!projectContainersHydrated && !(project.Name in projectContainers)) ? (
                                <div className="text-xs text-muted-foreground">Loading containers...</div>
                              ) : containers.length > 0 ? (
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  {containers.map(container => (
                                    <div key={container.ID} className="rounded-md border bg-muted/20 p-3 text-xs">
                                      <Button
                                        variant="link"
                                        className="h-auto p-0 font-mono text-xs"
                                        onClick={() => onOpenContainerFilter?.(container.Names)}
                                      >
                                        {container.Names}
                                      </Button>
                                      <div className="text-muted-foreground">{container.Image}</div>
                                      <div className="text-muted-foreground">{container.Status}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">No containers found for this project.</div>
                              )}
                            </div>

                            <div>
                              <div className="mb-2 text-xs font-medium text-muted-foreground">Compose Config</div>
                              {inlineConfigLoading[project.Name] ? (
                                <div className="text-xs text-muted-foreground">Loading config...</div>
                              ) : inlineConfig[project.Name] ? (
                                <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                                  {inlineConfig[project.Name]}
                                </pre>
                              ) : (
                                <Button variant="outline" size="sm" onClick={() => openInlineConfig(project.Name, dir)}>
                                  Load Config
                                </Button>
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

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Logs — {logsProject}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 pb-1">
            <Button variant="outline" size="sm" onClick={copyLogs} disabled={logsLoading}>
              <Copy className="h-4 w-4 mr-1" /> Copy
            </Button>
            <Button variant="outline" size="sm" onClick={downloadLogs} disabled={logsLoading}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
            {logsActionTip && <span className="text-xs text-muted-foreground">{logsActionTip}</span>}
          </div>
          <div className="bg-muted rounded-md p-3 overflow-auto max-h-[55vh]">
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {logsLoading ? 'Loading logs...' : logsContent}
            </pre>
            <div ref={logsEndRef} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Config — {configProject}</DialogTitle>
          </DialogHeader>
          {configLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <textarea
              className="w-full h-[45vh] font-mono text-xs border rounded-md p-3 bg-background resize-none"
              value={configContent}
              onChange={e => setConfigContent(e.target.value)}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveConfig} disabled={configSaving}>
              {configSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
