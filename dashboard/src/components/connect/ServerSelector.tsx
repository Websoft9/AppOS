import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Server,
  MonitorSmartphone,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { listServers, checkServerStatus, type Server as ServerType } from '@/lib/connect-api'
import { loadConnectSession } from '@/lib/connect-session'

const CONNECT_MIN_FEEDBACK_MS = 2000

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ServerSelectorProps {
  className?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ServerSelector({ className }: ServerSelectorProps) {
  const [servers, setServers] = useState<ServerType[]>([])
  const [selected, setSelected] = useState<ServerType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectingOpen, setConnectingOpen] = useState(false)
  const [connectingTarget, setConnectingTarget] = useState('')
  const [connectingPhase, setConnectingPhase] = useState<'checking' | 'offline'>('checking')
  const [connectingDetail, setConnectingDetail] = useState('')
  const [resumeServerId, setResumeServerId] = useState<string | null>(null)
  const [resumeUpdatedAt, setResumeUpdatedAt] = useState<number | null>(null)
  const navigate = useNavigate()

  const fetchServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listServers()
      setServers(result)
      // Auto-select when there is only one server
      if (result.length === 1) setSelected(result[0])
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
      setResumeServerId(null)
      setResumeUpdatedAt(null)
      return
    }
    const activeTab = session.tabs.find(tab => tab.id === session.activeTabId) || session.tabs[0]
    setResumeServerId(activeTab?.serverId || null)
    setResumeUpdatedAt(session.updatedAt)
  }, [])

  const resumeLabel = (() => {
    if (!resumeUpdatedAt) return null
    const minutes = Math.max(1, Math.floor((Date.now() - resumeUpdatedAt) / 60000))
    return `Last session saved ${minutes} min ago`
  })()

  const handleConnect = async () => {
    if (!selected) return
    const targetLabel = selected.name || selected.host || selected.id
    setConnectingTarget(targetLabel)
    setConnectingPhase('checking')
    setConnectingDetail('Establishing secure connection...')
    setConnectingOpen(true)
    try {
      const minDelay = new Promise<void>(resolve =>
        window.setTimeout(resolve, CONNECT_MIN_FEEDBACK_MS)
      )
      const [status] = await Promise.all([checkServerStatus(selected), minDelay])
      if (status?.status === 'offline') {
        setConnectingPhase('offline')
        setConnectingDetail(status.reason || 'Server is offline.')
        return
      }
      setConnectingOpen(false)
      navigate({ to: '/terminal/server/$serverId', params: { serverId: selected.id } })
    } catch (err) {
      setConnectingPhase('offline')
      setConnectingDetail(err instanceof Error ? err.message : 'Connection check failed.')
    }
  }

  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-2">
          <MonitorSmartphone className="h-12 w-12 mx-auto text-muted-foreground" />
          <h2 className="text-xl font-semibold">Connect to Server</h2>
          <p className="text-sm text-muted-foreground">
            Select a server to open the terminal for Shell, Docker,Files and Systemd management
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchServers}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No servers configured.{' '}
            <a
              href="/resources/servers?create=1"
              className="text-primary underline underline-offset-4 hover:text-primary/80"
            >
              Add a server
            </a>{' '}
            in Resources first.
          </div>
        ) : (
          <div className="space-y-3">
            {resumeServerId && (
              <div className="space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() =>
                    navigate({
                      to: '/terminal/server/$serverId',
                      params: { serverId: resumeServerId },
                    })
                  }
                >
                  <span className="truncate">Resume last session</span>
                  <ArrowRight className="h-4 w-4 ml-2 shrink-0" />
                </Button>
                {resumeLabel && <p className="text-xs text-muted-foreground">{resumeLabel}</p>}
              </div>
            )}

            {/* Dropdown picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between h-10">
                  <div className="flex items-center gap-2 min-w-0">
                    <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {selected ? (
                      <div className="flex flex-col items-start min-w-0">
                        <span className="truncate font-medium text-sm leading-none">
                          {selected.name || selected.host}
                        </span>
                        {selected.name && (
                          <span className="text-xs text-muted-foreground truncate mt-0.5">
                            {selected.host}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">Select a server...</span>
                    )}
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
                align="start"
              >
                {servers.map(s => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={cn(
                      'flex items-start gap-2 py-2',
                      selected?.id === s.id && 'font-medium bg-accent'
                    )}
                  >
                    <Server className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{s.name || s.host}</span>
                      {s.name && (
                        <span className="text-xs text-muted-foreground truncate">{s.host}</span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Connect button */}
            <Button className="w-full" onClick={handleConnect} disabled={!selected}>
              Connect
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>

            <Dialog
              open={connectingOpen}
              onOpenChange={open => {
                if (connectingPhase === 'checking' && !open) return
                setConnectingOpen(open)
              }}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Connecting...</DialogTitle>
                  <DialogDescription>
                    {connectingTarget ? `Target: ${connectingTarget}` : 'Preparing connection'}
                  </DialogDescription>
                </DialogHeader>
                <div className="py-2 text-sm">
                  {connectingPhase === 'checking' ? (
                    <div className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {connectingDetail || 'Establishing secure connection...'}
                    </div>
                  ) : (
                    <div className="text-destructive">{connectingDetail}</div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setConnectingOpen(false)}
                    disabled={connectingPhase === 'checking'}
                  >
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
    </div>
  )
}
