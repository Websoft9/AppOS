import { useState, useRef, useEffect, useCallback } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Server,
  ChevronDown,
  Play,
  Loader2,
  TerminalSquare,
  Trash2,
  RotateCw,
} from "lucide-react"
import { pb } from "@/lib/pb"
import { ContainersTab } from "@/components/docker/ContainersTab"
import { ImagesTab } from "@/components/docker/ImagesTab"
import { NetworksTab } from "@/components/docker/NetworksTab"
import { VolumesTab } from "@/components/docker/VolumesTab"
import { ComposeTab } from "@/components/docker/ComposeTab"
import { TerminalPanel } from "@/components/connect/TerminalPanel"

// ─── Types ───────────────────────────────────────────────

interface HostEntry {
  id: string
  label: string
  status: "online" | "offline"
}

interface CommandEntry {
  command: string
  output: string
  error?: string
  host: string
  timestamp: number
}



// ─── DockerPage ──────────────────────────────────────────

function DockerPage() {
  const { server: serverFromUrl } = Route.useSearch()

  // Hosts fetched from API
  const [hosts, setHosts] = useState<HostEntry[]>([
    { id: "local", label: "local", status: "online" },
  ])

  // Single active server — initialise from URL ?server= if provided
  const [serverId, setServerId] = useState(serverFromUrl || "local")
  const activeHost = hosts.find((h) => h.id === serverId) ?? hosts[0]

  // When hosts are loaded and a URL server param is present, validate it exists
  useEffect(() => {
    if (serverFromUrl && hosts.length > 0) {
      const match = hosts.find((h) => h.id === serverFromUrl)
      if (match) setServerId(match.id)
    }
  }, [hosts, serverFromUrl])

  // Fetch available servers on mount
  useEffect(() => {
    pb.send("/api/ext/docker/servers", { method: "GET" })
      .then((res) => {
        if (Array.isArray(res)) setHosts(res)
      })
      .catch(() => {})
  }, [])

  // Refresh signal for tabs
  const [refreshSignal, setRefreshSignal] = useState(0)

  // Command dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [cmdHost, setCmdHost] = useState("local")
  const [command, setCommand] = useState("")
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<CommandEntry[]>([])
  const outputEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Terminal dialog for docker exec
  const [terminalContainerId, setTerminalContainerId] = useState<string | null>(null)
  const [terminalShell, setTerminalShell] = useState<string>('/bin/sh')

  useEffect(() => {
    if (outputEndRef.current) {
      outputEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [history])

  // Focus input when dialog opens
  useEffect(() => {
    if (dialogOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [dialogOpen])

  const toggleHost = useCallback((hostId: string) => {
    setServerId(hostId)
  }, [])

  const runCommand = useCallback(async () => {
    const cmd = command.trim()
    if (!cmd || running) return

    setRunning(true)
    try {
      const res = await pb.send(`/api/ext/docker/exec?server_id=${cmdHost}`, {
        method: "POST",
        body: { command: cmd },
      })
      setHistory((prev) => [
        ...prev,
        {
          command: cmd,
          output: res.output || "",
          error: res.error || "",
          host: res.host || cmdHost,
          timestamp: Date.now(),
        },
      ])
      setCommand("")
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        {
          command: cmd,
          output: "",
          error: String(err),
          host: cmdHost,
          timestamp: Date.now(),
        },
      ])
    } finally {
      setRunning(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [command, running, cmdHost])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <h1 className="text-2xl font-bold">Docker</h1>

      {/* ── Resource tabs ── */}
      <Tabs defaultValue="containers">
        {/* ── Toolbar: server selector | tabs | spacer | refresh | run command ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Server selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Server className="h-4 w-4" />
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    activeHost?.status === "online" ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
                {activeHost?.label ?? serverId}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {hosts.map((h) => (
                <DropdownMenuCheckboxItem
                  key={h.id}
                  checked={serverId === h.id}
                  onCheckedChange={() => toggleHost(h.id)}
                >
                  <span
                    className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                      h.status === "online" ? "bg-green-500" : "bg-gray-400"
                    }`}
                  />
                  {h.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tab navigation labels */}
          <TabsList>
            <TabsTrigger value="containers">Containers</TabsTrigger>
            <TabsTrigger value="images">Images</TabsTrigger>
            <TabsTrigger value="volumes">Volumes</TabsTrigger>
            <TabsTrigger value="networks">Networks</TabsTrigger>
            <TabsTrigger value="compose">Compose</TabsTrigger>
          </TabsList>

          <div className="flex-1" />

          {/* Refresh button */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setRefreshSignal((s) => s + 1)}
          >
            <RotateCw className="h-4 w-4" />
            Refresh
          </Button>

          {/* Run Command button */}
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogOpen(true)}
          >
            <TerminalSquare className="h-4 w-4" />
            Run Command
          </Button>
        </div>

        <TabsContent value="containers">
          <ContainersTab
            serverId={serverId}
            refreshSignal={refreshSignal}
            onOpenTerminal={(id) => setTerminalContainerId(id)}
          />
        </TabsContent>
        <TabsContent value="images">
          <ImagesTab serverId={serverId} refreshSignal={refreshSignal} />
        </TabsContent>
        <TabsContent value="volumes">
          <VolumesTab serverId={serverId} refreshSignal={refreshSignal} />
        </TabsContent>
        <TabsContent value="networks">
          <NetworksTab serverId={serverId} refreshSignal={refreshSignal} />
        </TabsContent>
        <TabsContent value="compose">
          <ComposeTab serverId={serverId} refreshSignal={refreshSignal} />
        </TabsContent>
      </Tabs>

      {/* ── Command Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <TerminalSquare className="h-5 w-5" />
              Run Docker Command
            </DialogTitle>
          </DialogHeader>

          {/* Server + Input row */}
          <div className="flex items-center gap-2 px-5 pb-3">
            {/* Server picker for command target */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 shrink-0">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      hosts.find((h) => h.id === cmdHost)?.status === "online"
                        ? "bg-green-500"
                        : "bg-gray-400"
                    }`}
                  />
                  {cmdHost}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {hosts.map((h) => (
                  <DropdownMenuCheckboxItem
                    key={h.id}
                    checked={cmdHost === h.id}
                    onCheckedChange={() => setCmdHost(h.id)}
                  >
                    <span
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                        h.status === "online" ? "bg-green-500" : "bg-gray-400"
                      }`}
                    />
                    {h.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Badge variant="outline" className="font-mono text-xs shrink-0">
              docker
            </Badge>
            <input
              ref={inputRef}
              type="text"
              placeholder="ps -a, images, compose ls, network ls ..."
              className="flex-1 border rounded-md px-3 py-1.5 text-sm font-mono bg-background"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runCommand()}
              disabled={running}
            />
            <Button
              size="sm"
              onClick={runCommand}
              disabled={running || !command.trim()}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Output area */}
          <div className="flex-1 min-h-0 border-t bg-muted/30 overflow-auto px-5 py-4 font-mono text-xs max-h-[55vh]">
            {history.length === 0 ? (
              <p className="text-muted-foreground">
                Type a docker subcommand and press Enter.
                <br />
                <span className="opacity-60">
                  e.g. <code>ps -a</code> &middot; <code>images</code> &middot;{" "}
                  <code>compose ls</code> &middot; <code>stats --no-stream</code>
                </span>
              </p>
            ) : (
              <>
                {history.map((entry) => (
                  <div key={entry.timestamp} className="mb-3 last:mb-0">
                    <div className="text-blue-500">
                      $ docker {entry.command}
                      <span className="text-muted-foreground ml-2">
                        [{entry.host}]
                      </span>
                    </div>
                    {entry.output && (
                      <pre className="whitespace-pre-wrap mt-1">
                        {entry.output}
                      </pre>
                    )}
                    {entry.error && (
                      <pre className="whitespace-pre-wrap mt-1 text-destructive">
                        {entry.error}
                      </pre>
                    )}
                  </div>
                ))}
                <div ref={outputEndRef} />
              </>
            )}
          </div>

          {/* Footer */}
          {history.length > 0 && (
            <div className="flex justify-end px-5 py-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground gap-1"
                onClick={() => setHistory([])}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Docker Exec Terminal Dialog ── */}
      <Dialog
        open={!!terminalContainerId}
        onOpenChange={(open) => { if (!open) setTerminalContainerId(null) }}
      >
        <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <TerminalSquare className="h-5 w-5" />
              Container Terminal
              <span className="text-xs font-mono text-muted-foreground ml-2">
                {terminalContainerId?.slice(0, 12)}
              </span>
              {/* Shell selector */}
              <div className="ml-auto flex items-center gap-1">
                {['/bin/sh', '/bin/bash', '/bin/zsh'].map((sh) => (
                  <Button
                    key={sh}
                    variant={terminalShell === sh ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-6 px-2 text-xs font-mono"
                    onClick={() => setTerminalShell(sh)}
                  >
                    {sh.split('/').pop()}
                  </Button>
                ))}
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {terminalContainerId && (
              <TerminalPanel
                key={`${terminalContainerId}-${terminalShell}`}
                containerId={terminalContainerId}
                shell={terminalShell}
                className="h-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Route = createFileRoute("/_app/_auth/docker")({
  component: DockerPage,
  validateSearch: (search: Record<string, unknown>) => ({
    server: typeof search.server === 'string' ? search.server : undefined,
  }),
})
