import { useState, useEffect, useCallback, useRef } from "react"
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
} from "lucide-react"

interface ComposeProject {
  Name: string
  Status: string
  ConfigFiles: string
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

export function ComposeTab({ serverId, refreshSignal = 0 }: { serverId: string; refreshSignal?: number }) {
  const [projects, setProjects] = useState<ComposeProject[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [host, setHost] = useState("local")

  // Logs viewer state
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsProject, setLogsProject] = useState("")
  const [logsContent, setLogsContent] = useState("")
  const [logsLoading, setLogsLoading] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Config editor state
  const [configOpen, setConfigOpen] = useState(false)
  const [configProject, setConfigProject] = useState("")
  const [configContent, setConfigContent] = useState("")
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true)
      // docker compose ls --format json
      const res = await pb.send(`/api/ext/docker/compose/ls?server_id=${serverId}`, { method: "GET" })
      setProjects(parseProjects(res.output))
      if (res.host) setHost(res.host)
    } catch (err) {
      console.error("Failed to fetch compose projects:", err)
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects, refreshSignal])

  // ── Compose Actions ──

  const composeAction = async (
    action: string,
    projectDir: string,
    method: string = "POST",
  ) => {
    try {
      await pb.send(`/api/ext/docker/compose/${action}?server_id=${serverId}`, {
        method,
        body: { projectDir },
      })
      fetchProjects()
    } catch (err) {
      console.error(`Compose ${action} failed:`, err)
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
      setLogsContent(`Error fetching logs: ${err}`)
    } finally {
      setLogsLoading(false)
    }
  }

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
      setConfigContent(`Error loading config: ${err}`)
    } finally {
      setConfigLoading(false)
    }
  }

  const saveConfig = async () => {
    setConfigSaving(true)
    try {
      await pb.send("/api/ext/docker/compose/config", {
        method: "PUT",
        body: { projectDir: configProject, content: configContent },
      })
      setConfigOpen(false)
    } catch (err) {
      console.error("Failed to save config:", err)
    } finally {
      setConfigSaving(false)
    }
  }

  // ── Rendering ──

  const filtered = projects.filter((p) =>
    p.Name?.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter projects..."
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex-1" />

      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Config</TableHead>
            <TableHead>Host</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((p) => {
            const dir = p.ConfigFiles
              ? p.ConfigFiles.split(",")[0].replace(/\/[^/]+$/, "")
              : p.Name
            return (
              <TableRow key={p.Name}>
                <TableCell className="font-mono text-xs">{p.Name}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(p.Status)} className="text-xs">
                    {p.Status || "unknown"}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[250px]">
                  {p.ConfigFiles}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{host}</TableCell>
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
                          pb.send(`/api/ext/docker/compose/down?server_id=${serverId}`, {
                            method: "POST",
                            body: { projectDir: dir, removeVolumes: true },
                          }).then(fetchProjects).catch(console.error)
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Down + Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
          {!loading && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No compose projects found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Logs Dialog */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Logs — {logsProject}</DialogTitle>
          </DialogHeader>
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
