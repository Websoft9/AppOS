import { Fragment, useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { pb } from "@/lib/pb"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
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
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  Copy,
  Download,
  Loader2,
} from "lucide-react"
import { getApiErrorMessage } from "@/lib/api-error"

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

function parseContainers(output: string): Container[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split("\n")
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean) as Container[]
}

function parseInspect(output: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed[0]) return parsed[0] as Record<string, any>
    return null
  } catch {
    return null
  }
}

function parseProjects(output: string): ComposeProject[] {
  if (!output.trim()) return []
  try {
    // docker compose ls --format json returns a JSON array
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed)) return parsed
    return [parsed]
  } catch {
    // fallback: try NDJSON (one JSON object per line)
    return output
      .trim()
      .split("\n")
      .map((line) => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean) as ComposeProject[]
  }
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status?.toLowerCase().includes("running")) return "default"
  if (status?.toLowerCase().includes("exited") || status?.toLowerCase().includes("dead"))
    return "destructive"
  return "secondary"
}

export function ComposeTab({
  serverId,
  filterPreset,
  onClearFilterPreset,
  onOpenContainerFilter,
}: {
  serverId: string
  filterPreset?: string
  onClearFilterPreset?: () => void
  onOpenContainerFilter?: (containerName: string) => void
}) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState("")
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [inlineConfig, setInlineConfig] = useState<Record<string, string>>({})
  const [inlineConfigLoading, setInlineConfigLoading] = useState<Record<string, boolean>>({})
  const [projectContainers, setProjectContainers] = useState<Record<string, Container[]>>({})
  const [projectContainersLoading, setProjectContainersLoading] = useState<Record<string, boolean>>({})
  const [projectContainersHydrated, setProjectContainersHydrated] = useState(false)
  const [sortKey, setSortKey] = useState<'project' | 'status' | 'config'>(() => {
    try {
      const raw = localStorage.getItem(COMPOSE_SORT_KEY)
      if (!raw) return 'project'
      const parsed = JSON.parse(raw) as { key?: 'project' | 'status' | 'config' }
      return parsed.key || 'project'
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
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(COMPOSE_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(pageSize))
  }, [pageSize])

  useEffect(() => {
    if (!filterPreset) return
    setFilter(filterPreset)
  }, [filterPreset])

  // Logs viewer state
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsProject, setLogsProject] = useState("")
  const [logsContent, setLogsContent] = useState("")
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsActionTip, setLogsActionTip] = useState("")
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Config editor state
  const [configOpen, setConfigOpen] = useState(false)
  const [configProject, setConfigProject] = useState("")
  const [configContent, setConfigContent] = useState("")
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

  const {
    data: projects = [],
    isLoading: loading,
    error,
  } = useQuery<ComposeProject[]>({
    queryKey: ['docker', 'compose', serverId],
    queryFn: async () => {
      const res = await pb.send(`/api/ext/docker/compose/ls?server_id=${serverId}`, { method: "GET" })
      return parseProjects(res.output)
    },
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
    [projectContainersLoading],
  )

  const loadProjectContainers = useCallback(async (projectName: string) => {
    if (projectContainersHydrated || projectContainersLoading[projectName]) {
      return
    }

    setProjectContainersLoading(() => {
      const next: Record<string, boolean> = {}
      for (const project of projects) {
        next[project.Name] = true
      }
      return next
    })
    try {
      const containersRes = await pb.send(`/api/ext/docker/containers?server_id=${serverId}`, { method: "GET" })
      const containers = parseContainers(containersRes.output)
      const inspectEntries = await Promise.all(
        containers.map(async (container) => {
          try {
            const inspectRes = await pb.send(`/api/ext/docker/containers/${container.ID}?server_id=${serverId}`, { method: "GET" })
            return [container, parseInspect(inspectRes.output)] as const
          } catch {
            return [container, null] as const
          }
        }),
      )

      const grouped: Record<string, Container[]> = {}
      for (const project of projects) {
        grouped[project.Name] = []
      }
      for (const [container, inspect] of inspectEntries) {
        const labels = inspect?.Config?.Labels as Record<string, string> | undefined
        const composeProject = labels?.['com.docker.compose.project']
        if (!composeProject) continue
        if (!grouped[composeProject]) grouped[composeProject] = []
        grouped[composeProject].push(container)
      }

      if (!grouped[projectName]) {
        grouped[projectName] = []
      }
      setProjectContainers(grouped)
      setProjectContainersHydrated(true)
    } finally {
      setProjectContainersLoading((state) => {
        const next = { ...state }
        for (const key of Object.keys(next)) {
          next[key] = false
        }
        return next
      })
    }
  }, [projectContainersHydrated, projectContainersLoading, projects, serverId])

  useEffect(() => {
    if (!projectContainersHydrated || projects.length === 0) return
    setProjectContainers((state) => {
      const next = { ...state }
      for (const project of projects) {
        if (!next[project.Name]) next[project.Name] = []
      }
      return next
    })
  }, [projectContainersHydrated, projects])

  const toggleProjectDetail = useCallback((projectName: string) => {
    setExpandedProject((name) => {
      if (name === projectName) return null
      if (!projectContainersHydrated) {
        void loadProjectContainers(projectName)
      }
      return projectName
    })
  }, [loadProjectContainers, projectContainersHydrated])

  // ── Compose Actions ──

  const composeAction = async (
    action: string,
    projectDir: string,
    method: string = "POST",
  ) => {
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/compose/${action}?server_id=${serverId}`, {
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

  // ── Logs Viewer ──

  const openLogs = async (projectDir: string) => {
    setLogsProject(projectDir)
    setLogsContent("")
    setLogsOpen(true)
    setLogsLoading(true)
    try {
      const res = await pb.send("/api/ext/docker/compose/logs", {
        method: "GET",
        query: { projectDir, tail: "200", server_id: serverId },
      })
      setLogsContent(res.output || "No logs available")
    } catch (err) {
      setLogsContent(getApiErrorMessage(err, 'Failed to load logs'))
    } finally {
      setLogsLoading(false)
    }
  }

  const copyLogs = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logsContent || "")
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
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logsContent])

  // ── Config Editor ──

  const openConfig = async (projectDir: string) => {
    setConfigProject(projectDir)
    setConfigContent("")
    setConfigOpen(true)
    setConfigLoading(true)
    try {
      const res = await pb.send("/api/ext/docker/compose/config", {
        method: "GET",
        query: { projectDir },
      })
      setConfigContent(res.content || "")
    } catch (err) {
      setConfigContent(getApiErrorMessage(err, 'Failed to load config'))
    } finally {
      setConfigLoading(false)
    }
  }

  const openInlineConfig = async (projectName: string, projectDir: string) => {
    setInlineConfigLoading((state) => ({ ...state, [projectName]: true }))
    try {
      const res = await pb.send("/api/ext/docker/compose/config", {
        method: "GET",
        query: { projectDir },
      })
      setInlineConfig((state) => ({ ...state, [projectName]: res.content || "" }))
    } catch (err) {
      setInlineConfig((state) => ({ ...state, [projectName]: getApiErrorMessage(err, 'Failed to load config') }))
    } finally {
      setInlineConfigLoading((state) => ({ ...state, [projectName]: false }))
    }
  }

  const saveConfig = async () => {
    setConfigSaving(true)
    try {
      setActionError(null)
      await pb.send("/api/ext/docker/compose/config", {
        method: "PUT",
        body: { projectDir: configProject, content: configContent },
      })
      setConfigOpen(false)
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to save config'))
    } finally {
      setConfigSaving(false)
    }
  }

  // ── Rendering ──

  const filtered = projects.filter((p) => {
    const textMatched = p.Name?.toLowerCase().includes(filter.toLowerCase())
    if (!textMatched) return false
    if (filterPreset) return p.Name === filterPreset
    return true
  })

  const sorted = useMemo(() => {
    const items = [...filtered]
    items.sort((left, right) => {
      const leftValue = (() => {
        switch (sortKey) {
          case 'status': return left.Status || ''
          case 'config': return left.ConfigFiles || ''
          default: return left.Name || ''
        }
      })().toLowerCase()
      const rightValue = (() => {
        switch (sortKey) {
          case 'status': return right.Status || ''
          case 'config': return right.ConfigFiles || ''
          default: return right.Name || ''
        }
      })().toLowerCase()
      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [filtered, sortDir, sortKey])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [page, pageSize, sorted])

  useEffect(() => {
    setPage(1)
  }, [filter, sortDir, sortKey, pageSize, serverId, filterPreset])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const toggleSort = (key: 'project' | 'status' | 'config') => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: 'project' | 'status' | 'config' }) => (
    <Button variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-xs" onClick={() => toggleSort(keyName)}>
      {label}
      {sortKey !== keyName ? (
        <ArrowUpDown className="h-3 w-3 ml-1" />
      ) : sortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3 ml-1" />
      ) : (
        <ArrowDown className="h-3 w-3 ml-1" />
      )}
    </Button>
  )

  const loadError = error ? getApiErrorMessage(error, 'Failed to load compose projects') : null

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 pt-4">
      {(loadError || actionError) && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{loadError || actionError}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="text"
          placeholder="Filter projects..."
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex-1" />
        {filterPreset && onClearFilterPreset && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilter('')
              onClearFilterPreset()
            }}
          >
            Clear linked filter
          </Button>
        )}

      </div>
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {filterPreset && <Badge variant="outline">Linked project: {filterPreset}</Badge>}
        {hasProjectContainerLoading && <Badge variant="outline">Loading project containers...</Badge>}
      </div>

      <div data-docker-scroll-root="true" className="h-0 flex-1 min-h-0 overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead><SortHead label="Project" keyName="project" /></TableHead>
            <TableHead><SortHead label="Status" keyName="status" /></TableHead>
            <TableHead><SortHead label="Config" keyName="config" /></TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </span>
              </TableCell>
            </TableRow>
          )}
          {paged.map((p) => {
            const dir = p.ConfigFiles
              ? p.ConfigFiles.split(",")[0].replace(/\/[^/]+$/, "")
              : p.Name
            return (
              <Fragment key={p.Name}>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">
                    <Button
                      variant="link"
                      className="h-auto p-0 text-left font-mono text-xs gap-1"
                      onClick={() => toggleProjectDetail(p.Name)}
                    >
                      {expandedProject === p.Name ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {p.Name}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(p.Status)} className="text-xs">
                      {p.Status || "unknown"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[250px]">
                    <Button
                      variant="link"
                      className="h-auto p-0 text-xs font-mono"
                      onClick={() => {
                        setExpandedProject(p.Name)
                        void loadProjectContainers(p.Name)
                        void openInlineConfig(p.Name, dir)
                      }}
                    >
                      {p.ConfigFiles}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => composeAction("up", dir)}>
                          <ArrowUp className="h-4 w-4 mr-2" /> Up
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => composeAction("start", dir)}>
                          <Play className="h-4 w-4 mr-2" /> Start
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => composeAction("stop", dir)}>
                          <Square className="h-4 w-4 mr-2" /> Stop
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => composeAction("restart", dir)}>
                          <RotateCw className="h-4 w-4 mr-2" /> Restart
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => composeAction("down", dir)}>
                          <ArrowDown className="h-4 w-4 mr-2" /> Down
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openLogs(dir)}>
                          <FileText className="h-4 w-4 mr-2" /> Logs
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openConfig(dir)}
                          disabled={serverId !== "local"}
                          title={serverId !== "local" ? "Config editing is only available for local server" : undefined}
                        >
                          <Settings2 className="h-4 w-4 mr-2" /> Config
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setActionError(null)
                            pb.send(`/api/ext/docker/compose/down?server_id=${serverId}`, {
                              method: "POST",
                              body: { projectDir: dir, removeVolumes: true },
                            })
                              .then(() => queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] }))
                              .catch((err) => setActionError(getApiErrorMessage(err, 'Compose down + remove failed')))
                          }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Down + Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                {expandedProject === p.Name && (
                  <TableRow>
                    <TableCell colSpan={4} className="bg-muted/20 px-4 py-3">
                      <div className="rounded-lg border bg-background p-4 shadow-sm space-y-4">
                        <div className="text-sm font-medium">Compose Project Details</div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-2">Containers</div>
                          {projectContainersLoading[p.Name] || (!projectContainersHydrated && !(p.Name in projectContainers)) ? (
                            <div className="text-xs text-muted-foreground">Loading containers...</div>
                          ) : (projectContainers[p.Name] || []).length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {(projectContainers[p.Name] || []).map((container) => (
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
                          <div className="text-xs font-medium text-muted-foreground mb-2">Compose Config</div>
                          {inlineConfigLoading[p.Name] ? (
                            <div className="text-xs text-muted-foreground">Loading config...</div>
                          ) : inlineConfig[p.Name] ? (
                            <pre className="text-xs font-mono bg-muted/40 rounded-md border p-3 overflow-auto max-h-[280px] whitespace-pre-wrap">{inlineConfig[p.Name]}</pre>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => openInlineConfig(p.Name, dir)}>
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
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No compose projects found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="text-xs text-muted-foreground">
          {sorted.length === 0 ? '0 items' : `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, sorted.length)} of ${sorted.length}`}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={pageSize}
            onChange={(e) => {
              const next = Number(e.target.value) as 25 | 50 | 100
              setPageSize(next)
              setPage(1)
            }}
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground w-16 text-center">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      </div>

      {/* Logs Dialog */}
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
              {logsLoading ? "Loading logs..." : logsContent}
            </pre>
            <div ref={logsEndRef} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Config Editor Dialog */}
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
              onChange={(e) => setConfigContent(e.target.value)}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveConfig} disabled={configSaving}>
              {configSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
