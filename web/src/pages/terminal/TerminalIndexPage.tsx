import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Server,
  ArrowRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Clock,
  Plus,
  LogOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { loadConnectWorkspaceSnapshot, type RestoreWorkspaceSession } from '@/lib/connect-session'
import {
  listServers,
  listTerminalSessions,
  deleteTerminalSession,
  checkServerStatus,
  getConnectTerminalSettings,
  type ConnectTerminalSettings,
  type Server as ServerType,
  type TerminalSessionSummary,
} from '@/lib/connect-api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

const DEFAULT_CONNECT_SETTINGS: ConnectTerminalSettings = {
  idleTimeoutSeconds: 1800,
  maxConnections: 0,
}

type RestoreWorkspaceItem = RestoreWorkspaceSession & {
  lastActiveAt: number
}

function getSessionCountLabel(count: number) {
  return count === 1 ? '1 session' : `${count} sessions`
}

function isSessionIdle(updatedAt: number | null, idleTimeoutSeconds: number) {
  if (updatedAt == null) return false
  const timeoutMs = Math.max(60, idleTimeoutSeconds) * 1000
  return Date.now() - updatedAt >= timeoutMs
}

function getSessionUpdatedAt(session: TerminalSessionSummary): number | null {
  const ts = Date.parse(session.last_active_at)
  return Number.isFinite(ts) ? ts : null
}

function isServerOnline(server: ServerType) {
  const connectType = String(server.connect_type ?? 'direct')
    .trim()
    .toLowerCase()
  if (connectType === 'tunnel') {
    return String(server.tunnel_status ?? '') === 'online'
  }
  return String(server.access_status ?? '') === 'available'
}

// ─── Connecting dialog ────────────────────────────────────────────────────────

interface ConnectingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: string
  phase: 'checking' | 'offline'
  detail: string
}

function ConnectingDialog({ open, onOpenChange, target, phase, detail }: ConnectingDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (phase === 'checking' && !o) return
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connecting…</DialogTitle>
          <DialogDescription>
            {target ? `Target: ${target}` : 'Preparing connection'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 text-sm">
          {phase === 'checking' ? (
            <div className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {detail || 'Establishing secure connection…'}
            </div>
          ) : (
            <div className="text-destructive">{detail}</div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={phase === 'checking'}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Server card ──────────────────────────────────────────────────────────────

interface ServerCardProps {
  server: ServerType
  isConnected?: boolean
  isIdle?: boolean
  lastSessionMin?: number
  sessionCount?: number
  onConnect: (server: ServerType) => void
}

function ServerCard({
  server,
  isConnected,
  isIdle,
  lastSessionMin,
  sessionCount,
  onConnect,
}: ServerCardProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Server className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{server.name || server.host}</span>
            {isConnected && (
              <>
                <Badge
                  variant={isIdle ? 'outline' : 'secondary'}
                  className={cn(
                    'text-xs h-4 px-1.5 shrink-0',
                    isIdle ? 'border-amber-200 text-amber-700 bg-amber-50' : undefined
                  )}
                >
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-green-500" />
                  {isIdle ? 'Idle' : 'Connected'}
                </Badge>
                {sessionCount != null && sessionCount > 1 && (
                  <Badge variant="outline" className="text-xs h-4 px-1.5 shrink-0">
                    {getSessionCountLabel(sessionCount)}
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {server.name && (
              <span className="text-xs text-muted-foreground truncate">{server.host}</span>
            )}
            {isConnected && sessionCount != null && sessionCount === 1 && (
              <span className="text-xs text-muted-foreground truncate">1 active session</span>
            )}
            {lastSessionMin != null && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                Last active {lastSessionMin} min ago
              </span>
            )}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onConnect(server)}
      >
        Open Terminal
        <ArrowRight className="h-3.5 w-3.5 ml-1" />
      </Button>
    </div>
  )
}

interface ActiveSessionCardProps {
  session: TerminalSessionSummary
  server: ServerType
  idleTimeoutSeconds: number
  nowTs: number
  isClosing: boolean
  sessionCount: number
  onResume: (session: TerminalSessionSummary, server: ServerType) => void
  onExit: (session: TerminalSessionSummary) => void
}

function ActiveSessionCard({
  session,
  server,
  idleTimeoutSeconds,
  nowTs,
  isClosing,
  sessionCount,
  onResume,
  onExit,
}: ActiveSessionCardProps) {
  const updatedAt = getSessionUpdatedAt(session)
  const idle = isSessionIdle(updatedAt, idleTimeoutSeconds)
  const sessionMinAgo =
    updatedAt != null ? Math.max(1, Math.floor((nowTs - updatedAt) / 60000)) : null

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Server className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{server.name || server.host}</span>
            <Badge
              variant={idle ? 'outline' : 'secondary'}
              className={cn(
                'text-xs h-4 px-1.5 shrink-0',
                idle ? 'border-amber-200 text-amber-700 bg-amber-50' : undefined
              )}
            >
              <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-green-500" />
              {idle ? 'Idle' : 'Connected'}
            </Badge>
            <Badge variant="outline" className="text-xs h-4 px-1.5 shrink-0">
              {session.state === 'attached' ? 'Live' : 'Detached'}
            </Badge>
            {sessionCount > 1 && (
              <Badge variant="outline" className="text-xs h-4 px-1.5 shrink-0">
                {getSessionCountLabel(sessionCount)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {server.name && (
              <span className="text-xs text-muted-foreground truncate">{server.host}</span>
            )}
            <span className="text-xs font-mono text-muted-foreground">
              {session.id.slice(0, 8)}
            </span>
            {sessionMinAgo != null && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                Last active {sessionMinAgo} min ago
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="sm" variant="outline" onClick={() => onExit(session)} disabled={isClosing}>
          {isClosing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5 mr-1" />
          )}
          Exit
        </Button>
        <Button size="sm" variant="default" onClick={() => onResume(session, server)}>
          Resume
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  )
}

// ─── Servers panel ────────────────────────────────────────────────────────────

interface ServersPanelProps {
  servers: ServerType[]
  loading: boolean
  error: string | null
  onRetry: () => void
  sessionItems: TerminalSessionSummary[]
  sessionCounts: Map<string, number>
  sessionUpdatedAt: number | null
  idleTimeoutSeconds: number
  nowTs: number
  onConnect: (server: ServerType) => void
  onRestoreWorkspace: () => void
  onResumeSession: (session: TerminalSessionSummary, server: ServerType) => void
  onExitSession: (session: TerminalSessionSummary) => void
  closingSessionId: string | null
}

function ServersPanel({
  servers,
  loading,
  error,
  onRetry,
  sessionItems,
  sessionCounts,
  sessionUpdatedAt,
  idleTimeoutSeconds,
  nowTs,
  onConnect,
  onRestoreWorkspace,
  onResumeSession,
  onExitSession,
  closingSessionId,
}: ServersPanelProps) {
  const onlineServers = servers.filter(isServerOnline)
  const serverById = new Map(servers.map(server => [server.id, server]))
  const latestSessionByServer = sessionItems.reduce((sessions, session) => {
    if (!sessions.has(session.resource_id)) {
      sessions.set(session.resource_id, session)
    }
    return sessions
  }, new Map<string, TerminalSessionSummary>())
  const activeSessions = sessionItems
    .map(session => ({ session, server: serverById.get(session.resource_id) }))
    .filter(
      (entry): entry is { session: TerminalSessionSummary; server: ServerType } =>
        entry.server != null
    )
  const idle = isSessionIdle(sessionUpdatedAt, idleTimeoutSeconds)

  const sessionMinAgo =
    sessionUpdatedAt != null ? Math.max(1, Math.floor((nowTs - sessionUpdatedAt) / 60000)) : null

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pt-6 xl:overflow-hidden">
      <div className="grid gap-6 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="space-y-2 min-w-0 xl:flex xl:min-h-0 xl:flex-col">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Available Servers
              {onlineServers.length > 0 && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({onlineServers.length})
                </span>
              )}
            </h3>
          </div>

          <div className="xl:flex-1 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
            {servers.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                <Server className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">No servers configured</p>
                <p className="text-xs text-muted-foreground">
                  Add a server in Resources to get started
                </p>
              </div>
            ) : onlineServers.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                <Server className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">No online servers</p>
                <p className="text-xs text-muted-foreground">
                  Only servers that are currently online are shown here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {onlineServers.map(server => {
                  const latestSession = latestSessionByServer.get(server.id)
                  const lastSessionUpdatedAt = latestSession
                    ? getSessionUpdatedAt(latestSession)
                    : null
                  const lastSessionMin =
                    lastSessionUpdatedAt != null
                      ? Math.max(1, Math.floor((nowTs - lastSessionUpdatedAt) / 60000))
                      : undefined

                  return (
                    <ServerCard
                      key={server.id}
                      server={server}
                      isConnected={sessionCounts.has(server.id)}
                      isIdle={
                        latestSession
                          ? isSessionIdle(lastSessionUpdatedAt, idleTimeoutSeconds)
                          : false
                      }
                      lastSessionMin={lastSessionMin}
                      sessionCount={sessionCounts.get(server.id)}
                      onConnect={onConnect}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-2 min-w-0 xl:flex xl:min-h-0 xl:flex-col">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Active Sessions</h3>
            <div className="flex items-center gap-2">
              {activeSessions.length > 0 && (
                <Button size="sm" variant="outline" onClick={onRestoreWorkspace}>
                  Restore Workspace
                </Button>
              )}
              {idle && (
                <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700">
                  Idle session
                </Badge>
              )}
              {sessionMinAgo != null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                  <Clock className="h-3 w-3" />
                  Last active {sessionMinAgo} min ago
                </span>
              )}
            </div>
          </div>

          <div className="xl:flex-1 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
            {activeSessions.length > 0 ? (
              <div className="space-y-2">
                {activeSessions.map(({ session, server }) => (
                  <ActiveSessionCard
                    key={session.id}
                    session={session}
                    server={server}
                    idleTimeoutSeconds={idleTimeoutSeconds}
                    nowTs={nowTs}
                    isClosing={closingSessionId === session.id}
                    sessionCount={sessionCounts.get(server.id) ?? 1}
                    onResume={onResumeSession}
                    onExit={onExitSession}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                <Clock className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">No active sessions</p>
                <p className="text-xs text-muted-foreground">
                  Open a server terminal to keep a resumable session here.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const CONNECT_MIN_FEEDBACK_MS = 2000

export function TerminalIndexPage() {
  const [servers, setServers] = useState<ServerType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionItems, setSessionItems] = useState<TerminalSessionSummary[]>([])
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<number | null>(null)
  const [connectSettings, setConnectSettings] =
    useState<ConnectTerminalSettings>(DEFAULT_CONNECT_SETTINGS)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null)

  // Connecting dialog state
  const [connectingOpen, setConnectingOpen] = useState(false)
  const [connectingTarget, setConnectingTarget] = useState('')
  const [connectingPhase, setConnectingPhase] = useState<'checking' | 'offline'>('checking')
  const [connectingDetail, setConnectingDetail] = useState('')

  const navigate = useNavigate()

  const syncSessionSnapshot = useCallback(async () => {
    try {
      const sessions = await listTerminalSessions()
      const serverSessions = sessions.filter(
        session => session.resource_type === 'server' && session.session_type === 'ssh'
      )
      setSessionItems(serverSessions)
      const updatedAt = serverSessions.reduce<number | null>((latest, session) => {
        const ts = Date.parse(session.last_active_at)
        if (!Number.isFinite(ts)) return latest
        return latest == null || ts > latest ? ts : latest
      }, null)
      setSessionUpdatedAt(updatedAt)
    } catch {
      setSessionItems([])
      setSessionUpdatedAt(null)
    }
  }, [])

  const sessionCounts = sessionItems.reduce((counts, session) => {
    counts.set(session.resource_id, (counts.get(session.resource_id) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  const fetchServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listServers()
      setServers(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchServers()
    getConnectTerminalSettings()
      .then(setConnectSettings)
      .catch(() => {})
  }, [fetchServers])

  useEffect(() => {
    syncSessionSnapshot()
  }, [syncSessionSnapshot])

  useEffect(() => {
    const syncFromWindow = () => {
      void syncSessionSnapshot()
    }
    const syncFromVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncSessionSnapshot()
      }
    }

    window.addEventListener('focus', syncFromWindow)
    document.addEventListener('visibilitychange', syncFromVisibility)

    return () => {
      window.removeEventListener('focus', syncFromWindow)
      document.removeEventListener('visibilitychange', syncFromVisibility)
    }
  }, [syncSessionSnapshot])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const handleResumeSession = useCallback(
    (session: TerminalSessionSummary, server: ServerType) => {
      const workspace = session.workspace ?? {}
      navigate({
        to: '/terminal/server/$serverId',
        params: { serverId: server.id },
        search: {
          sessionId: session.id,
          panel: workspace.side_panel === 'files' ? 'files' : undefined,
          path: workspace.file_path || undefined,
          lockedRoot: workspace.locked_root || undefined,
          split:
            typeof workspace.split_ratio === 'number' && Number.isFinite(workspace.split_ratio)
              ? workspace.split_ratio
              : undefined,
        },
      })
    },
    [navigate]
  )

  const handleRestoreWorkspace = useCallback(() => {
    const serverById = new Map(servers.map(server => [server.id, server]))
    const liveRestoreSessions: RestoreWorkspaceItem[] = sessionItems
      .map((session): RestoreWorkspaceItem | null => {
        const server = serverById.get(session.resource_id)
        if (!server) return null
        const workspace = session.workspace ?? {}
        return {
          sessionId: session.id,
          serverId: server.id,
          title: server.name || server.host || server.id,
          panel: workspace.side_panel === 'files' ? 'files' : undefined,
          path: workspace.file_path || undefined,
          lockedRoot: workspace.locked_root || undefined,
          split:
            typeof workspace.split_ratio === 'number' && Number.isFinite(workspace.split_ratio)
              ? workspace.split_ratio
              : undefined,
          lastActiveAt: Date.parse(session.last_active_at),
        }
      })
      .filter((item): item is NonNullable<typeof item> => item != null)
    const workspaceSnapshot = loadConnectWorkspaceSnapshot()

    let restoreSessions = liveRestoreSessions.slice().sort((left, right) => {
      const leftTs = Number.isFinite(left.lastActiveAt) ? left.lastActiveAt : 0
      const rightTs = Number.isFinite(right.lastActiveAt) ? right.lastActiveAt : 0
      return rightTs - leftTs
    })

    let activeSessionId: string | undefined = restoreSessions[0]?.sessionId

    if (workspaceSnapshot) {
      const liveBySessionId = new Map(liveRestoreSessions.map(item => [item.sessionId, item]))
      const orderedFromSnapshot = workspaceSnapshot.tabs
        .map(tab => {
          const live = liveBySessionId.get(tab.sessionId)
          if (!live) return null
          const savedWorkspace = workspaceSnapshot.workspaceBySessionId[tab.sessionId]
          return {
            ...live,
            title: tab.title || live.title,
            panel: savedWorkspace?.panel ?? live.panel,
            path: savedWorkspace?.path ?? live.path,
            lockedRoot: savedWorkspace?.lockedRoot ?? live.lockedRoot,
            split: savedWorkspace?.split ?? live.split,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item != null)

      const orderedIds = new Set(orderedFromSnapshot.map(item => item.sessionId))
      const remaining = restoreSessions.filter(item => !orderedIds.has(item.sessionId))
      if (orderedFromSnapshot.length > 0) {
        restoreSessions = [...orderedFromSnapshot, ...remaining]
      }

      if (
        workspaceSnapshot.activeSessionId &&
        restoreSessions.some(item => item.sessionId === workspaceSnapshot.activeSessionId)
      ) {
        activeSessionId = workspaceSnapshot.activeSessionId
      }
    }

    const primary = restoreSessions[0]
    if (!primary) return

    const activeTarget = restoreSessions.find(item => item.sessionId === activeSessionId) ?? primary

    navigate({
      to: '/terminal/server/$serverId',
      params: { serverId: activeTarget.serverId },
      search: {
        activeSessionId,
        restoreSessions: restoreSessions.map(({ lastActiveAt: _lastActiveAt, ...item }) => item),
      },
    })
  }, [navigate, servers, sessionItems])

  const handleExitSession = useCallback(
    async (session: TerminalSessionSummary) => {
      setClosingSessionId(session.id)
      try {
        await deleteTerminalSession(session.id)
        await syncSessionSnapshot()
      } finally {
        setClosingSessionId(current => (current === session.id ? null : current))
      }
    },
    [syncSessionSnapshot]
  )

  const handleConnect = useCallback(
    async (server: ServerType) => {
      const label = server.name || server.host || server.id
      setConnectingTarget(label)
      setConnectingPhase('checking')
      setConnectingDetail('Establishing secure connection…')
      setConnectingOpen(true)
      try {
        const minDelay = new Promise<void>(resolve =>
          window.setTimeout(resolve, CONNECT_MIN_FEEDBACK_MS)
        )
        const [status] = await Promise.all([checkServerStatus(server), minDelay])
        if (status?.status === 'offline') {
          setConnectingPhase('offline')
          setConnectingDetail(status.reason || 'Server is offline.')
          return
        }
        setConnectingOpen(false)
        navigate({ to: '/terminal/server/$serverId', params: { serverId: server.id }, search: {} })
      } catch (err) {
        setConnectingPhase('offline')
        setConnectingDetail(err instanceof Error ? err.message : 'Connection check failed.')
      }
    },
    [navigate]
  )

  const handleAddServer = useCallback(() => {
    void navigate({ to: '/resources/servers', search: { create: '1' } as never })
  }, [navigate])

  const handleRefresh = useCallback(async () => {
    await Promise.all([fetchServers(), syncSessionSnapshot()])
  }, [fetchServers, syncSessionSnapshot])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Top: page header ── */}
      <div className="shrink-0 pb-4 border-b">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Server Terminal</h1>
            <p className="text-muted-foreground mt-1">
              Open, resume, and manage server terminals with shell and files.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              onClick={() => void handleRefresh()}
              aria-label="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : undefined)} />
            </Button>
            <Button size="sm" variant="outline" onClick={handleAddServer}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Server
            </Button>
          </div>
        </div>
      </div>

      <main className="flex-1 min-w-0 overflow-hidden">
        <ServersPanel
          servers={servers}
          loading={loading}
          error={error}
          onRetry={fetchServers}
          sessionItems={sessionItems}
          sessionCounts={sessionCounts}
          sessionUpdatedAt={sessionUpdatedAt}
          idleTimeoutSeconds={connectSettings.idleTimeoutSeconds}
          nowTs={nowTs}
          onConnect={handleConnect}
          onRestoreWorkspace={handleRestoreWorkspace}
          onResumeSession={handleResumeSession}
          onExitSession={handleExitSession}
          closingSessionId={closingSessionId}
        />
      </main>

      {/* Connecting dialog */}
      <ConnectingDialog
        open={connectingOpen}
        onOpenChange={setConnectingOpen}
        target={connectingTarget}
        phase={connectingPhase}
        detail={connectingDetail}
      />
    </div>
  )
}
