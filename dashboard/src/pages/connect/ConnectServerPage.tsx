import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Maximize,
  Minimize,
  Server,
  ChevronDown,
  FolderOpen,
  ScrollText,
  Plus,
  Container,
  PanelsLeftRight,
  Search,
  XCircle,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TerminalPanel, type TerminalPanelHandle } from '@/components/connect/TerminalPanel'
import { FileManagerPanel } from '@/components/connect/FileManagerPanel'
import { DockerPanel } from '@/components/connect/DockerPanel'
import { listServers, listScripts, type Server as ServerType, type Script } from '@/lib/connect-api'
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
  const navigate = useNavigate()
  const [servers, setServers] = useState<ServerType[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [serverQuery, setServerQuery] = useState('')
  const [serverMenuOpen, setServerMenuOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sidePanel, setSidePanel] = useState<'none' | 'files' | 'docker'>('none')
  const [splitRatio, setSplitRatio] = useState(loadSplitRatio)
  const [isResizing, setIsResizing] = useState(false)
  const terminalRef = useRef<TerminalPanelHandle>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const serverSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listServers().then(setServers).catch(() => {})
    listScripts().then(setScripts).catch(() => {})
  }, [])

  const currentServer = servers.find((s) => s.id === serverId)
  const filteredServers = useMemo(() => {
    const keyword = serverQuery.trim().toLowerCase()
    if (!keyword) return servers
    return servers.filter((server) => {
      const connectType = String((server as Record<string, unknown>).connect_type || 'direct')
      const label = `${server.name || ''} ${server.host || ''} ${server.id} ${connectType}`.toLowerCase()
      return label.includes(keyword)
    })
  }, [serverQuery, servers])

  const connectTypeLabel = useCallback((server: ServerType) => {
    const raw = String((server as Record<string, unknown>).connect_type || 'direct').toLowerCase()
    return raw === 'tunnel' ? 'Tunnel' : 'Direct SSH'
  }, [])

  const handleServerSwitch = useCallback(
    (id: string) => {
      navigate({ to: '/connect/server/$serverId', params: { serverId: id } })
    },
    [navigate],
  )

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
                onClick={() => handleServerSwitch(s.id)}
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
          onClick={() => setSidePanel((value) => (value === 'files' ? 'none' : 'files'))}
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
                <DropdownMenuItem onClick={() => applySplitPreset(0.7)}>70 / 30</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applySplitPreset(0.5)}>50 / 50</DropdownMenuItem>
                <DropdownMenuItem onClick={() => applySplitPreset(0.3)}>30 / 70</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => applySplitPreset(0.5)}>Reset</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>Layout {Math.round(splitRatio * 100)} / {Math.round((1 - splitRatio) * 100)}</TooltipContent>
          </Tooltip>
        )}

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>

      <div ref={contentRef} className={cn('flex-1 flex min-h-0 overflow-hidden', isResizing && 'select-none cursor-col-resize')}>
        <div
          className={cn('h-full min-w-0 overflow-hidden flex flex-col relative', sidePanel === 'none' && 'flex-1')}
          style={sidePanel === 'none' ? undefined : { width: `${Math.round(splitRatio * 100)}%` }}
        >
          <div className="flex-1 min-h-0">
            <TerminalPanel ref={terminalRef} serverId={serverId} className="h-full" />
          </div>
          <div className={cn('absolute z-10 left-2 bottom-2', sidePanel !== 'none' && 'opacity-90')}>
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
                <FileManagerPanel serverId={serverId} className="h-full" />
              ) : (
                <DockerPanel serverId={serverId} className="h-full p-3" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
