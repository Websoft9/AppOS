import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Server,
  Cloud,
  Database,
  Globe,
  LayoutDashboard,
  ArrowRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Clock,
  Plus,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { listServers, checkServerStatus, type Server as ServerType } from '@/lib/connect-api'
import { loadConnectSession } from '@/lib/connect-session'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TabId = 'overview' | 'servers' | 'cloud' | 'databases' | 'apis'

interface Tab {
  id: TabId
  label: string
  icon: React.ReactNode
  available: boolean
}

const TABS: Tab[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <LayoutDashboard className="h-4 w-4" />,
    available: true,
  },
  {
    id: 'servers',
    label: 'Servers',
    icon: <Server className="h-4 w-4" />,
    available: true,
  },
  {
    id: 'cloud',
    label: 'Cloud',
    icon: <Cloud className="h-4 w-4" />,
    available: false,
  },
  {
    id: 'databases',
    label: 'Databases',
    icon: <Database className="h-4 w-4" />,
    available: false,
  },
  {
    id: 'apis',
    label: 'APIs',
    icon: <Globe className="h-4 w-4" />,
    available: false,
  },
]

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
  lastSessionMin?: number
  onConnect: (server: ServerType) => void
}

function ServerCard({ server, isConnected, lastSessionMin, onConnect }: ServerCardProps) {
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
              <Badge variant="secondary" className="text-xs h-4 px-1.5 shrink-0">
                <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-green-500" />
                Connected
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {server.name && (
              <span className="text-xs text-muted-foreground truncate">{server.host}</span>
            )}
            {lastSessionMin != null && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {lastSessionMin} min ago
              </span>
            )}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant={isConnected ? 'default' : 'outline'}
        className="shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onConnect(server)}
      >
        {isConnected ? 'Resume' : 'Connect'}
        <ArrowRight className="h-3.5 w-3.5 ml-1" />
      </Button>
    </div>
  )
}

// ─── Coming soon panel ────────────────────────────────────────────────────────

function ComingSoonPanel({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
      <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{label} Support</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          Connect to {label.toLowerCase()} resources directly from the Terminal.
          <br />
          This feature is coming soon.
        </p>
      </div>
      <Badge variant="outline" className="text-xs">
        Coming Soon
      </Badge>
    </div>
  )
}

// ─── Overview panel ───────────────────────────────────────────────────────────

interface OverviewPanelProps {
  servers: ServerType[]
  loading: boolean
  sessionServerIds: Set<string>
  sessionUpdatedAt: number | null
  nowTs: number
  onConnect: (server: ServerType) => void
  onTabChange: (tab: TabId) => void
}

function OverviewPanel({
  servers,
  loading,
  sessionServerIds,
  sessionUpdatedAt,
  nowTs,
  onConnect,
  onTabChange,
}: OverviewPanelProps) {
  const connectedServers = servers.filter(s => sessionServerIds.has(s.id))

  const sessionMinAgo =
    sessionUpdatedAt != null ? Math.max(1, Math.floor((nowTs - sessionUpdatedAt) / 60000)) : null

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Capability cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            id: 'servers' as TabId,
            icon: <Server className="h-5 w-5" />,
            label: 'Servers',
            desc: 'SSH terminal · SFTP · Docker',
            available: true,
          },
          {
            id: 'cloud' as TabId,
            icon: <Cloud className="h-5 w-5" />,
            label: 'Cloud',
            desc: 'AWS · GCP · Azure shells',
            available: false,
          },
          {
            id: 'databases' as TabId,
            icon: <Database className="h-5 w-5" />,
            label: 'Databases',
            desc: 'SQL & NoSQL clients',
            available: false,
          },
          {
            id: 'apis' as TabId,
            icon: <Globe className="h-5 w-5" />,
            label: 'APIs',
            desc: 'REST & GraphQL explorer',
            available: false,
          },
        ].map(cap => (
          <button
            key={cap.id}
            onClick={() => cap.available && onTabChange(cap.id)}
            className={cn(
              'flex flex-col items-start gap-2 p-3 rounded-lg border text-left transition-colors',
              cap.available ? 'hover:bg-accent/50 cursor-pointer' : 'opacity-60 cursor-default'
            )}
          >
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
              {cap.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{cap.label}</span>
                {!cap.available && (
                  <Badge variant="outline" className="text-[10px] h-3.5 px-1">
                    Soon
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{cap.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Connected Resources */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Connected Resources</h3>
          {sessionMinAgo != null && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last active {sessionMinAgo} min ago
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : connectedServers.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center space-y-2">
            <p className="text-sm text-muted-foreground">No active connections</p>
            <Button size="sm" variant="outline" onClick={() => onTabChange('servers')}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Connect to a server
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {connectedServers.map(server => (
              <ServerCard
                key={server.id}
                server={server}
                isConnected
                lastSessionMin={sessionMinAgo ?? undefined}
                onConnect={onConnect}
              />
            ))}
          </div>
        )}
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
  sessionServerIds: Set<string>
  sessionUpdatedAt: number | null
  nowTs: number
  onConnect: (server: ServerType) => void
}

function ServersPanel({
  servers,
  loading,
  error,
  onRetry,
  sessionServerIds,
  sessionUpdatedAt,
  nowTs,
  onConnect,
}: ServersPanelProps) {
  const connectedServers = servers.filter(s => sessionServerIds.has(s.id))
  const availableServers = servers.filter(s => !sessionServerIds.has(s.id))

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
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Active sessions */}
      {connectedServers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Active Sessions</h3>
            {sessionMinAgo != null && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {sessionMinAgo} min ago
              </span>
            )}
          </div>
          <div className="space-y-2">
            {connectedServers.map(s => (
              <ServerCard
                key={s.id}
                server={s}
                isConnected
                lastSessionMin={sessionMinAgo ?? undefined}
                onConnect={onConnect}
              />
            ))}
          </div>
        </div>
      )}

      {/* Available servers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Available Servers
            {servers.length > 0 && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({servers.length})
              </span>
            )}
          </h3>
          <Button size="sm" variant="outline" asChild>
            <a href="/resources/servers?create=1">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Server
            </a>
          </Button>
        </div>

        {servers.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
            <Server className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">No servers configured</p>
            <p className="text-xs text-muted-foreground">
              Add a server in Resources to get started
            </p>
            <Button size="sm" variant="outline" asChild className="mt-2">
              <a href="/resources/servers?create=1">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Server
              </a>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {availableServers.map(s => (
              <ServerCard key={s.id} server={s} onConnect={onConnect} />
            ))}
            {availableServers.length === 0 && connectedServers.length > 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">
                All configured servers have active sessions
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const CONNECT_MIN_FEEDBACK_MS = 2000

export function TerminalIndexPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [servers, setServers] = useState<ServerType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionServerIds, setSessionServerIds] = useState<Set<string>>(new Set())
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<number | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [navOpen, setNavOpen] = useState(false)

  // Auto-collapse nav when on overview
  useEffect(() => {
    if (activeTab === 'overview') setNavOpen(false)
  }, [activeTab])

  // Connecting dialog state
  const [connectingOpen, setConnectingOpen] = useState(false)
  const [connectingTarget, setConnectingTarget] = useState('')
  const [connectingPhase, setConnectingPhase] = useState<'checking' | 'offline'>('checking')
  const [connectingDetail, setConnectingDetail] = useState('')

  const navigate = useNavigate()

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
  }, [fetchServers])

  useEffect(() => {
    const session = loadConnectSession()
    if (!session || session.tabs.length === 0) {
      setSessionServerIds(new Set())
      setSessionUpdatedAt(null)
      return
    }
    setSessionServerIds(new Set(session.tabs.map(t => t.serverId)))
    setSessionUpdatedAt(session.updatedAt)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Top: page header ── */}
      <div className="shrink-0 px-6 py-4 border-b">
        <h1 className="text-2xl font-bold tracking-tight">Terminal</h1>
        <p className="text-muted-foreground mt-1">Connecting your remote resources at one place</p>
      </div>

      {/* ── Bottom: left tabs + right content ── */}
      <div className="flex-1 flex min-h-0">
        {/* Left vertical tab bar — collapsible */}
        <nav
          className={cn(
            'shrink-0 border-r bg-muted/30 flex flex-col transition-[width] duration-200 overflow-hidden',
            navOpen ? 'w-44' : 'w-12 cursor-pointer'
          )}
          onClick={!navOpen ? () => setNavOpen(true) : undefined}
        >
          {/* Toggle button */}
          <div
            className={cn('flex py-2 shrink-0', navOpen ? 'justify-end px-2' : 'justify-center')}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={e => {
                e.stopPropagation()
                setNavOpen(v => !v)
              }}
            >
              {navOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </Button>
          </div>

          {/* Tab buttons */}
          <div className={cn('flex flex-col gap-0.5 pb-3', navOpen ? 'px-2' : 'px-1.5')}>
            {TABS.map(tab => {
              const btn = (
                <button
                  key={tab.id}
                  disabled={!tab.available}
                  onClick={e => {
                    e.stopPropagation()
                    if (!navOpen) {
                      setNavOpen(true)
                      return
                    }
                    if (tab.available) setActiveTab(tab.id)
                  }}
                  className={cn(
                    'flex items-center rounded-md text-sm font-medium transition-colors',
                    navOpen ? 'gap-2.5 px-3 py-2 w-full text-left' : 'justify-center p-2 w-full',
                    tab.available ? 'cursor-pointer' : 'cursor-default opacity-50',
                    activeTab === tab.id
                      ? 'bg-background text-foreground shadow-sm'
                      : tab.available
                        ? 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        : 'text-muted-foreground'
                  )}
                >
                  {tab.icon}
                  {navOpen && <span className="truncate">{tab.label}</span>}
                  {navOpen && tab.id === 'servers' && servers.length > 0 && (
                    <span className="ml-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-normal">
                      {servers.length}
                    </span>
                  )}
                  {navOpen && !tab.available && (
                    <span className="ml-auto text-[9px] text-muted-foreground/60 font-normal">
                      soon
                    </span>
                  )}
                </button>
              )

              if (!navOpen) {
                return (
                  <Tooltip key={tab.id} delayDuration={300}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {tab.label}
                      {!tab.available && ' (Coming Soon)'}
                    </TooltipContent>
                  </Tooltip>
                )
              }
              return btn
            })}
          </div>
        </nav>

        {/* Right content panel */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {activeTab === 'overview' && (
            <OverviewPanel
              servers={servers}
              loading={loading}
              sessionServerIds={sessionServerIds}
              sessionUpdatedAt={sessionUpdatedAt}
              nowTs={nowTs}
              onConnect={handleConnect}
              onTabChange={setActiveTab}
            />
          )}
          {activeTab === 'servers' && (
            <ServersPanel
              servers={servers}
              loading={loading}
              error={error}
              onRetry={fetchServers}
              sessionServerIds={sessionServerIds}
              sessionUpdatedAt={sessionUpdatedAt}
              nowTs={nowTs}
              onConnect={handleConnect}
            />
          )}
          {activeTab === 'cloud' && (
            <ComingSoonPanel label="Cloud" icon={<Cloud className="h-6 w-6" />} />
          )}
          {activeTab === 'databases' && (
            <ComingSoonPanel label="Database" icon={<Database className="h-6 w-6" />} />
          )}
          {activeTab === 'apis' && (
            <ComingSoonPanel label="API" icon={<Globe className="h-6 w-6" />} />
          )}
        </main>
      </div>

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
