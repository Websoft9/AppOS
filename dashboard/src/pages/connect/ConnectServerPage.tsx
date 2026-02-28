import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Maximize,
  Minimize,
  Server,
  Cog,
  PenLine,
  Play,
  Square,
  RotateCw,
  Power,
  PowerOff,
  ChevronDown,
  FolderOpen,
  ScrollText,
  Plus,
  Container,
  PanelsLeftRight,
  Search,
  XCircle,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TerminalPanel, type TerminalPanelHandle } from '@/components/connect/TerminalPanel'
import { FileManagerPanel } from '@/components/connect/FileManagerPanel'
import { DockerPanel } from '@/components/connect/DockerPanel'
import {
  listServers,
  listScripts,
  checkServerStatus,
  listSystemdServices,
  getSystemdStatus,
  getSystemdLogs,
  getSystemdContent,
  getSystemdUnit,
  updateSystemdUnit,
  verifySystemdUnit,
  applySystemdUnit,
  controlSystemdService,
  type SystemdControlAction,
  type Server as ServerType,
  type Script,
  type SystemdService,
} from '@/lib/connect-api'
import { cn } from '@/lib/utils'

const CONNECT_SPLIT_KEY = 'connect.split.ratio'

function loadSplitRatio(): number {
  try {
    const raw = Number(localStorage.getItem(CONNECT_SPLIT_KEY) || '')
    if (Number.isFinite(raw) && raw >= 0.25 && raw <= 0.75) {
      return raw
    }
  } catch {
    // ignore invalid local storage
  }
  return 0.5
}

export function ConnectServerPage({ serverId }: { serverId: string }) {
  const opButtonClass = 'h-8 w-[116px] justify-start'
  const navigate = useNavigate()
  const [servers, setServers] = useState<ServerType[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [serverQuery, setServerQuery] = useState('')
  const [serverMenuOpen, setServerMenuOpen] = useState(false)
  const [connectingOpen, setConnectingOpen] = useState(false)
  const [connectingTarget, setConnectingTarget] = useState('')
  const [connectingPhase, setConnectingPhase] = useState<'checking' | 'offline'>('checking')
  const [connectingDetail, setConnectingDetail] = useState('')
  const [reconnectConfirmOpen, setReconnectConfirmOpen] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState<ServerType | null>(null)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sidePanel, setSidePanel] = useState<'none' | 'files' | 'docker'>('none')
  const [filePanelPath, setFilePanelPath] = useState('/')
  const [filePanelLockedRoot, setFilePanelLockedRoot] = useState<string | null>(null)
  const [filePanelNonce, setFilePanelNonce] = useState(0)
  const [splitRatio, setSplitRatio] = useState(loadSplitRatio)
  const [isResizing, setIsResizing] = useState(false)
  const [systemdOpen, setSystemdOpen] = useState(false)
  const [systemdQuery, setSystemdQuery] = useState('')
  const [systemdLoading, setSystemdLoading] = useState(false)
  const [systemdError, setSystemdError] = useState('')
  const [systemdHint, setSystemdHint] = useState('')
  const [systemdServices, setSystemdServices] = useState<SystemdService[]>([])
  const [systemdSelected, setSystemdSelected] = useState<string>('')
  const [systemdView, setSystemdView] = useState<'none' | 'status' | 'cat' | 'logs'>('none')
  const [systemdStatusDetails, setSystemdStatusDetails] = useState<Record<string, string>>({})
  const [systemdContentText, setSystemdContentText] = useState('')
  const [systemdLogs, setSystemdLogs] = useState<string[]>([])
  const [systemdUnitPath, setSystemdUnitPath] = useState('')
  const [systemdUnitContent, setSystemdUnitContent] = useState('')
  const [systemdUnitResult, setSystemdUnitResult] = useState('')
  const [systemdEditMode, setSystemdEditMode] = useState(false)
  const [systemdConfirmOpen, setSystemdConfirmOpen] = useState(false)
  const [systemdConfirmAction, setSystemdConfirmAction] = useState<SystemdControlAction | 'verify-unit' | 'apply-unit' | null>(null)
  const [systemdActionLoading, setSystemdActionLoading] = useState(false)
  const terminalRef = useRef<TerminalPanelHandle>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const serverSearchRef = useRef<HTMLInputElement>(null)
  const systemdSelectRequestSeq = useRef(0)

  useEffect(() => {
    listServers().then(setServers).catch(() => {})
    listScripts().then(setScripts).catch(() => {})
  }, [])

  const currentServer = servers.find((s) => s.id === serverId)
  const filteredServers = useMemo(() => {
    const keyword = serverQuery.trim().toLowerCase()
    if (!keyword) return servers
    return servers.filter((server) => {
      const connectType = String(server.connect_type || 'direct')
      const label = `${server.name || ''} ${server.host || ''} ${server.id} ${connectType}`.toLowerCase()
      return label.includes(keyword)
    })
  }, [serverQuery, servers])

  const connectTypeLabel = useCallback((server: ServerType) => {
    const raw = String(server.connect_type || 'direct').toLowerCase()
    return raw === 'tunnel' ? 'Tunnel' : 'Direct SSH'
  }, [])

  const handleServerSwitch = useCallback(
    async (targetServer: ServerType) => {
      if (connectingOpen) return
      if (String(targetServer.id) === String(serverId)) {
        setReconnectTarget(targetServer)
        setReconnectConfirmOpen(true)
        return
      }

      const id = String(targetServer.id)
      const targetLabel = targetServer.name || targetServer.host || id
      setConnectingTarget(targetLabel)
      setConnectingPhase('checking')
      setConnectingDetail('Running connectivity check...')
      setConnectingOpen(true)

      const status = await checkServerStatus(targetServer)
      if (status?.status === 'offline') {
        setConnectingPhase('offline')
        setConnectingDetail(status.reason || 'Server is offline.')
        return
      }
      setConnectingDetail('Server is online. Opening session...')
      setConnectingOpen(false)
      navigate({ to: '/connect/server/$serverId', params: { serverId: id } })
    },
    [connectingOpen, navigate, serverId],
  )

  const handleReconnectConfirm = useCallback(async () => {
    if (!reconnectTarget) return
    const targetLabel = reconnectTarget.name || reconnectTarget.host || reconnectTarget.id
    setReconnectConfirmOpen(false)
    setConnectingTarget(targetLabel)
    setConnectingPhase('checking')
    setConnectingDetail('Running connectivity check...')
    setConnectingOpen(true)

    const status = await checkServerStatus(reconnectTarget)
    if (status.status === 'offline') {
      setConnectingPhase('offline')
      setConnectingDetail(status.reason || 'Server is offline.')
      return
    }

    setConnectingDetail('Server is online. Reconnecting terminal...')
    setReconnectNonce((value) => value + 1)
    setConnectingOpen(false)
  }, [reconnectTarget])

  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      const handleFSChange = () => {
        setIsFullscreen(!!document.fullscreenElement)
      }
      document.addEventListener('fullscreenchange', handleFSChange)
      return () => document.removeEventListener('fullscreenchange', handleFSChange)
    },
    [],
  )

  const toggleFullscreen = useCallback(async () => {
    const el = document.getElementById('connect-container')
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Fullscreen not supported or denied
    }
  }, [])

  const handleRunScript = useCallback((script: Script) => {
    if (!terminalRef.current) return
    terminalRef.current.sendData(script.code + '\n')
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const onMove = (event: MouseEvent) => {
      const container = contentRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const ratio = (event.clientX - rect.left) / rect.width
      const clamped = Math.min(0.75, Math.max(0.25, ratio))
      setSplitRatio(clamped)
    }
    const onUp = () => setIsResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizing])

  useEffect(() => {
    localStorage.setItem(CONNECT_SPLIT_KEY, String(splitRatio))
  }, [splitRatio])

  useEffect(() => {
    if (isResizing) return
    const t1 = window.setTimeout(() => terminalRef.current?.requestFit(), 0)
    const t2 = window.setTimeout(() => terminalRef.current?.requestFit(), 140)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [sidePanel, splitRatio, isFullscreen, isResizing, serverId])

  const applySplitPreset = useCallback((ratio: number) => {
    const clamped = Math.min(0.75, Math.max(0.25, ratio))
    setSplitRatio(clamped)
  }, [])

  useEffect(() => {
    if (!systemdOpen) return

    const keyword = systemdQuery.trim()
    if (keyword === '') {
      setSystemdLoading(false)
      setSystemdError('')
      setSystemdServices([])
      setSystemdSelected('')
      setSystemdUnitPath('')
      setSystemdUnitContent('')
      setSystemdUnitResult('')
      setSystemdEditMode(false)
      return
    }

    let cancelled = false
    setSystemdLoading(true)
    setSystemdError('')
    const timer = window.setTimeout(async () => {
      try {
        const services = await listSystemdServices(serverId, keyword)
        if (cancelled) return
        setSystemdServices(services)
      } catch (error) {
        if (cancelled) return
        setSystemdError(error instanceof Error ? error.message : 'Failed to load services')
      } finally {
        if (!cancelled) {
          setSystemdLoading(false)
        }
      }
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [serverId, systemdOpen, systemdQuery])

  const runSystemdAction = useCallback(async (mode: 'status' | 'cat' | 'logs') => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    setSystemdEditMode(false)
    try {
      if (mode === 'logs') {
        const response = await getSystemdLogs(serverId, systemdSelected, 200)
        setSystemdLogs(Array.isArray(response.entries) ? response.entries : [])
        setSystemdView('logs')
        return
      }

      if (mode === 'cat') {
        const response = await getSystemdContent(serverId, systemdSelected)
        setSystemdContentText(response.content || '')
        setSystemdView('cat')
        return
      }

      const response = await getSystemdStatus(serverId, systemdSelected)
      setSystemdStatusDetails(response.status || {})
      setSystemdView(mode)
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Operation failed')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [serverId, systemdSelected])

  const runSystemdControlAction = useCallback(async (action: SystemdControlAction) => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    try {
      await controlSystemdService(serverId, systemdSelected, action)
      setSystemdHint(`Action ${action} applied. Next: check Status or Logs.`)
      const response = await getSystemdStatus(serverId, systemdSelected)
      setSystemdStatusDetails(response.status || {})
      setSystemdView('status')
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Operation failed')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [serverId, systemdSelected])

  const openSystemdUnitEditor = useCallback(async () => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    try {
      const response = await getSystemdUnit(serverId, systemdSelected)
      setSystemdUnitPath(response.path || '')
      setSystemdUnitContent(response.content || '')
      setSystemdEditMode(true)
      setSystemdView('cat')
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Failed to load unit file')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [serverId, systemdSelected])

  const validateSystemdUnitFromEditor = useCallback(async () => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    try {
      const saveRes = await updateSystemdUnit(serverId, systemdSelected, systemdUnitContent)
      const verifyRes = await verifySystemdUnit(serverId, systemdSelected)
      const output = [saveRes.output, verifyRes.verify_output].filter(Boolean).join('\n\n') || 'Validate passed.'
      setSystemdUnitResult(output)
      setSystemdView('cat')
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Failed to validate unit file')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [serverId, systemdSelected, systemdUnitContent])

  const applySystemdUnitFromEditor = useCallback(async () => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    try {
      const saveRes = await updateSystemdUnit(serverId, systemdSelected, systemdUnitContent)
      const applyRes = await applySystemdUnit(serverId, systemdSelected)
      const output = [saveRes.output, applyRes.reload_output, applyRes.apply_output].filter(Boolean).join('\n\n') || 'Apply completed.'
      setSystemdUnitResult(output)
      const statusRes = await getSystemdStatus(serverId, systemdSelected)
      setSystemdStatusDetails(statusRes.status || {})
      setSystemdEditMode(false)
      setSystemdView('status')
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Failed to apply unit file')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [serverId, systemdSelected, systemdUnitContent])

  const requestSystemdConfirm = useCallback((action: SystemdControlAction | 'verify-unit' | 'apply-unit') => {
    setSystemdConfirmAction(action)
    setSystemdConfirmOpen(true)
  }, [])

  const executeSystemdConfirm = useCallback(async () => {
    const action = systemdConfirmAction
    setSystemdConfirmOpen(false)
    if (!action) return
    if (action === 'verify-unit') {
      await validateSystemdUnitFromEditor()
      return
    }
    if (action === 'apply-unit') {
      await applySystemdUnitFromEditor()
      return
    }
    await runSystemdControlAction(action)
  }, [applySystemdUnitFromEditor, runSystemdControlAction, systemdConfirmAction, validateSystemdUnitFromEditor])

  useEffect(() => {
    if (!serverMenuOpen) {
      setServerQuery('')
      return
    }
    const timer = window.setTimeout(() => {
      serverSearchRef.current?.focus()
      serverSearchRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [serverMenuOpen])

  return (
    <div
      id="connect-container"
      ref={containerRef}
      className={cn(
        'flex flex-col h-full min-h-0 overflow-hidden',
        isFullscreen && 'bg-background',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <DropdownMenu open={serverMenuOpen} onOpenChange={setServerMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Server className="h-4 w-4" />
              <span className="truncate max-w-[150px]">
                {currentServer?.name || currentServer?.host || serverId}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[320px]">
            <DropdownMenuLabel className="pb-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={serverSearchRef}
                  value={serverQuery}
                  onChange={(event) => setServerQuery(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="Search server..."
                  className="w-full h-8 rounded-md border bg-background pl-7 pr-2 text-xs font-normal"
                />
              </div>
            </DropdownMenuLabel>
            {filteredServers.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => handleServerSwitch(s)}
                className={cn('items-start py-2', s.id === serverId && 'bg-accent')}
              >
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className={cn('text-sm truncate', s.id === serverId && 'font-medium')}>{s.name || s.host || s.id}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {(s.host || '-') + ' · ' + connectTypeLabel(s)}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            {filteredServers.length === 0 && (
              <DropdownMenuItem disabled>No servers</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: '/connect' })}>
              <XCircle className="h-4 w-4 mr-2" />
              Disconnect
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="/resources/servers?create=1">
                <Plus className="h-4 w-4 mr-2" />
                Add Server
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => navigate({ to: '/connect' })}
              aria-label="Disconnect"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Disconnect</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        <Button
          variant={sidePanel === 'none' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => setSidePanel('none')}
        >
          Terminal
        </Button>

        <Button
          variant={sidePanel === 'files' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => {
            if (sidePanel === 'files') {
              setSidePanel('none')
              return
            }
            setFilePanelPath('/')
            setFilePanelLockedRoot(null)
            setFilePanelNonce((value) => value + 1)
            setSidePanel('files')
          }}
        >
          <FolderOpen className="h-4 w-4" />
          Files
        </Button>

        <Button
          variant={sidePanel === 'docker' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => setSidePanel((value) => (value === 'docker' ? 'none' : 'docker'))}
        >
          <Container className="h-4 w-4" />
          Docker
        </Button>

        {sidePanel !== 'none' && (
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 relative" aria-label="Layout presets">
                    <PanelsLeftRight className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent align="end">
                <div className="grid grid-cols-2 gap-1 p-1 min-w-[180px]">
                  <Button variant="ghost" size="sm" className="justify-start" onClick={() => applySplitPreset(0.7)}>
                    <PanelsLeftRight className="h-4 w-4 mr-2" />70 / 30
                  </Button>
                  <Button variant="ghost" size="sm" className="justify-start" onClick={() => applySplitPreset(0.5)}>
                    <PanelsLeftRight className="h-4 w-4 mr-2" />50 / 50
                  </Button>
                  <Button variant="ghost" size="sm" className="justify-start" onClick={() => applySplitPreset(0.3)}>
                    <PanelsLeftRight className="h-4 w-4 mr-2" />30 / 70
                  </Button>
                  <Button variant="ghost" size="sm" className="justify-start" onClick={() => applySplitPreset(0.5)}>
                    <PanelsLeftRight className="h-4 w-4 mr-2" />Reset
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>Layout {Math.round(splitRatio * 100)} / {Math.round((1 - splitRatio) * 100)}</TooltipContent>
          </Tooltip>
        )}

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>

      <Dialog open={connectingOpen} onOpenChange={setConnectingOpen}>
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
                Running connectivity check...
              </div>
            ) : (
              <div className="text-destructive">
                {connectingDetail}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectingOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reconnectConfirmOpen} onOpenChange={setReconnectConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reconnect</DialogTitle>
            <DialogDescription>
              You selected the current server. Do you want to reconnect?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReconnectConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleReconnectConfirm()}>Reconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div ref={contentRef} className={cn('flex-1 flex min-h-0 overflow-hidden', isResizing && 'select-none cursor-col-resize')}>
        <div
          className={cn('h-full min-w-0 overflow-hidden flex flex-col relative', sidePanel === 'none' && 'flex-1')}
          style={sidePanel === 'none' ? undefined : { width: `${Math.round(splitRatio * 100)}%` }}
        >
          <div className="flex-1 min-h-0">
            <TerminalPanel key={`${serverId}-${reconnectNonce}`} ref={terminalRef} serverId={serverId} className="h-full" />
          </div>
          <div className={cn('absolute z-10 left-2 bottom-2', sidePanel !== 'none' && 'opacity-90')}>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" className="gap-1.5 h-7 shadow-sm px-2" title="Run Script">
                    <ScrollText className="h-4 w-4" />
                    {sidePanel === 'none' && <span>Run Script</span>}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[360px] max-h-[300px] overflow-y-auto">
                  <DropdownMenuLabel className="text-xs">Run script in terminal</DropdownMenuLabel>
                  {scripts.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => handleRunScript(s)}
                      className="flex items-start gap-2 py-2"
                    >
                      <ScrollText className="h-4 w-4 mt-0.5 shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-medium">{s.name}</span>
                        {s.description && (
                          <span className="text-xs text-muted-foreground line-clamp-2">{s.description}</span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                  {scripts.length === 0 && (
                    <DropdownMenuItem disabled>No scripts</DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href="/resources/scripts?create=1">
                      <Plus className="h-4 w-4 mr-2" />
                      New Script
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5 h-7 shadow-sm px-2"
                onClick={() => {
                  setSystemdOpen(true)
                  setSystemdQuery('')
                  setSystemdServices([])
                  setSystemdSelected('')
                  setSystemdView('none')
                  setSystemdError('')
                  setSystemdHint('')
                  setSystemdStatusDetails({})
                  setSystemdContentText('')
                  setSystemdLogs([])
                  setSystemdUnitPath('')
                  setSystemdUnitContent('')
                  setSystemdUnitResult('')
                  setSystemdEditMode(false)
                }}
              >
                <Cog className="h-4 w-4" />
                {sidePanel === 'none' && <span>Systemd</span>}
              </Button>
            </div>
          </div>
        </div>

        {sidePanel !== 'none' && (
          <>
            <div
              className="w-1 h-full border-l border-r bg-border/60 hover:bg-border cursor-col-resize"
              onMouseDown={(event) => {
                event.preventDefault()
                setIsResizing(true)
              }}
            />
            <div data-connect-side-panel="true" className="h-full min-h-0 min-w-0 overflow-hidden" style={{ width: `${Math.round((1 - splitRatio) * 100)}%` }}>
              {sidePanel === 'files' ? (
                <FileManagerPanel
                  key={`${serverId}-${filePanelNonce}`}
                  serverId={serverId}
                  initialPath={filePanelPath}
                  lockedRootPath={filePanelLockedRoot || undefined}
                  className="h-full"
                />
              ) : (
                <DockerPanel
                  serverId={serverId}
                  className="h-full p-3"
                  onOpenFilesAtPath={(targetPath, lockedRootPath) => {
                    setFilePanelPath(targetPath)
                    setFilePanelLockedRoot(lockedRootPath)
                    setFilePanelNonce((value) => value + 1)
                    setSidePanel('files')
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={systemdOpen} onOpenChange={setSystemdOpen}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Systemd</DialogTitle>
            <DialogDescription>Search service and run operations.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="shrink-0 space-y-2">
              <input
                value={systemdQuery}
                onChange={(event) => setSystemdQuery(event.target.value)}
                placeholder="Search service keyword..."
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
              <div className="border rounded-md max-h-[210px] overflow-auto">
                {systemdLoading ? (
                  <div className="p-3 text-sm text-muted-foreground inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading services...
                  </div>
                ) : systemdQuery.trim() === '' ? (
                  <div className="p-3 text-sm text-muted-foreground">Enter keyword to search services.</div>
                ) : systemdServices.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No matched services.</div>
                ) : (
                  <div className="p-1 space-y-1 min-w-0">
                    {systemdServices.map((service) => (
                      <button
                        type="button"
                        key={service.name}
                        onClick={() => {
                          const requestSeq = systemdSelectRequestSeq.current + 1
                          systemdSelectRequestSeq.current = requestSeq
                          setSystemdSelected(service.name)
                          setSystemdView('none')
                          setSystemdError('')
                          setSystemdHint('')
                          setSystemdStatusDetails({})
                          setSystemdContentText('')
                          setSystemdLogs([])
                          setSystemdUnitPath('')
                          setSystemdUnitContent('')
                          setSystemdUnitResult('')
                          setSystemdEditMode(false)
                          setSystemdActionLoading(true)
                          void getSystemdStatus(serverId, service.name)
                            .then((response) => {
                              if (systemdSelectRequestSeq.current !== requestSeq) return
                              setSystemdStatusDetails(response.status || {})
                              setSystemdView('status')
                            })
                            .catch((error) => {
                              if (systemdSelectRequestSeq.current !== requestSeq) return
                              setSystemdError(error instanceof Error ? error.message : 'Operation failed')
                            })
                            .finally(() => {
                              if (systemdSelectRequestSeq.current !== requestSeq) return
                              setSystemdActionLoading(false)
                            })
                        }}
                        className={cn(
                          'w-full text-left rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                          systemdSelected === service.name && 'bg-accent',
                        )}
                      >
                        <div className="font-medium truncate">{service.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{service.description}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border rounded-md p-2">
              <div className="flex flex-wrap gap-2 items-center">
                <Button size="sm" variant="outline" className={opButtonClass} disabled={!systemdSelected || systemdActionLoading} onClick={() => void runSystemdAction('cat')}><PenLine className="h-4 w-4 mr-1" />Cat</Button>
                <Button size="sm" variant="outline" className={opButtonClass} disabled={!systemdSelected || systemdActionLoading} onClick={() => void runSystemdAction('logs')}><ScrollText className="h-4 w-4 mr-1" />Logs</Button>
                {systemdView === 'cat' && !systemdEditMode && (
                  <Button size="sm" className={opButtonClass} disabled={!systemdSelected || systemdActionLoading} onClick={() => void openSystemdUnitEditor()}>
                    <Cog className="h-4 w-4 mr-1" />Edit
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className={opButtonClass} disabled={!systemdSelected || systemdActionLoading}>
                      Service Action
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => requestSystemdConfirm('start')}><Play className="h-4 w-4 mr-2" />Start</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => requestSystemdConfirm('restart')}><RotateCw className="h-4 w-4 mr-2" />Restart</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => requestSystemdConfirm('stop')}><Square className="h-4 w-4 mr-2" />Stop</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => requestSystemdConfirm('enable')}><Power className="h-4 w-4 mr-2" />Enable</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => requestSystemdConfirm('disable')}><PowerOff className="h-4 w-4 mr-2" />Disable</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex-1 min-h-0 border rounded-md p-3 overflow-auto">
                  {systemdActionLoading && (
                    <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </div>
                  )}

                  {!systemdActionLoading && systemdView === 'status' && (
                    <div className="space-y-1 text-sm">
                      {Object.keys(systemdStatusDetails).length === 0 ? (
                        <div className="text-muted-foreground">No status output.</div>
                      ) : Object.entries(systemdStatusDetails).map(([key, value]) => (
                        <div key={key} className="grid grid-cols-[160px_1fr] gap-2">
                          <span className="text-muted-foreground truncate">{key}</span>
                          <span className="break-words">{value || '-'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!systemdActionLoading && systemdView === 'cat' && (
                    <div className="space-y-3">
                      {!systemdEditMode ? (
                        <>
                          <pre className="text-xs whitespace-pre-wrap break-words">{systemdContentText || 'No service content.'}</pre>
                        </>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-xs text-muted-foreground">
                            Unit file: {systemdUnitPath || '-'}
                          </div>
                          <textarea
                            value={systemdUnitContent}
                            onChange={(event) => setSystemdUnitContent(event.target.value)}
                            className="w-full min-h-[260px] rounded-md border bg-background p-3 text-xs font-mono overflow-auto"
                            placeholder="[Unit]\nDescription=..."
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" disabled={!systemdSelected || systemdActionLoading} onClick={() => requestSystemdConfirm('verify-unit')}>Validate</Button>
                            <Button size="sm" disabled={!systemdSelected || systemdActionLoading} onClick={() => requestSystemdConfirm('apply-unit')}>Apply</Button>
                            <Button size="sm" variant="outline" disabled={systemdActionLoading} onClick={() => setSystemdEditMode(false)}>Cancel Edit</Button>
                          </div>
                          {systemdUnitResult && (
                            <pre className="text-xs whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3">{systemdUnitResult}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {!systemdActionLoading && systemdView === 'logs' && (
                    <pre className="text-xs whitespace-pre-wrap break-words">{systemdLogs.length ? systemdLogs.join('\n') : 'No logs.'}</pre>
                  )}

                  {!systemdActionLoading && systemdView === 'none' && systemdSelected && (
                    <div className="text-sm text-muted-foreground">Choose one operation above to continue.</div>
                  )}
                  {systemdHint && <div className="mt-3 text-xs text-emerald-600">{systemdHint}</div>}
            </div>

            {systemdError && <div className="text-sm text-destructive">{systemdError}</div>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSystemdOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={systemdConfirmOpen} onOpenChange={setSystemdConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {systemdConfirmAction === 'verify-unit'
                  ? 'Validate unit file?'
                  : systemdConfirmAction === 'apply-unit'
                    ? 'Apply unit changes?'
                    : 'Confirm service action?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {systemdConfirmAction === 'verify-unit'
                  ? `Service: ${systemdSelected || '-'}\nThis will run systemd-analyze verify.`
                : systemdConfirmAction === 'apply-unit'
                  ? `Service: ${systemdSelected || '-'}\nThis will save current editor content, then run daemon-reload and try-restart.`
                : `Service: ${systemdSelected || '-'}\nAction: ${systemdConfirmAction || '-'}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void executeSystemdConfirm() }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
