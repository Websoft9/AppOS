import { useState, useCallback, useEffect, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Maximize,
  Minimize,
  Server,
  ChevronDown,
  FolderOpen,
  ScrollText,
  Plus,
  Container,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TerminalPanel, type TerminalPanelHandle } from '@/components/connect/TerminalPanel'
import { FileManagerPanel } from '@/components/connect/FileManagerPanel'
import { listServers, listScripts, type Server as ServerType, type Script } from '@/lib/connect-api'
import { cn } from '@/lib/utils'
import { Link } from '@tanstack/react-router'

// ─── Route definition ─────────────────────────────────────────────────────────

export const Route = createFileRoute('/_app/_auth/_superuser/connect/server/$serverId')({
  component: ConnectServerPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function ConnectServerPage() {
  const { serverId } = Route.useParams()
  const navigate = useNavigate()
  const [servers, setServers] = useState<ServerType[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const terminalRef = useRef<TerminalPanelHandle>(null)

  // Load server list and scripts for dropdowns
  useEffect(() => {
    listServers().then(setServers).catch(() => {})
    listScripts().then(setScripts).catch(() => {})
  }, [])

  const currentServer = servers.find((s) => s.id === serverId)

  // Server switch handler
  const handleServerSwitch = useCallback(
    (id: string) => {
      navigate({ to: '/connect/server/$serverId', params: { serverId: id } })
    },
    [navigate],
  )

  // Fullscreen toggle
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

  // Run script in terminal
  const handleRunScript = useCallback((script: Script) => {
    if (!terminalRef.current) return
    // Send the script code followed by a newline to execute it
    terminalRef.current.sendData(script.code + '\n')
  }, [])

  return (
    <div
      id="connect-container"
      ref={containerRef}
      className={cn(
        'flex flex-col h-full',
        isFullscreen && 'bg-background',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        {/* Server switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Server className="h-4 w-4" />
              <span className="truncate max-w-[150px]">
                {currentServer?.name || currentServer?.host || serverId}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {servers.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => handleServerSwitch(s.id)}
                className={cn(s.id === serverId && 'font-medium bg-accent')}
              >
                <Server className="h-4 w-4 mr-2" />
                {s.name || s.host}
              </DropdownMenuItem>
            ))}
            {servers.length === 0 && (
              <DropdownMenuItem disabled>No servers</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Script selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 h-7">
              <ScrollText className="h-4 w-4" />
              Scripts
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

        {/* Quick links: add server / add script */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" asChild>
                <a href="/resources/servers?create=1">
                  <Plus className="h-3.5 w-3.5" />
                  <Server className="h-3.5 w-3.5" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add Server</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1" />

        {/* Files toggle */}
        <Button
          variant={showFiles ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => setShowFiles((v) => !v)}
        >
          <FolderOpen className="h-4 w-4" />
          Files
        </Button>

        {/* Docker link */}
        <Button variant="ghost" size="sm" className="gap-1.5 h-7" asChild>
          <Link to="/docker" search={{ server: serverId }}>
            <Container className="h-4 w-4" />
            Docker
          </Link>
        </Button>

        {/* Fullscreen toggle */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>

      {/* Content: Terminal only, or split Terminal + Files side-by-side */}
      <div className="flex-1 flex min-h-0">
        {/* Terminal — always mounted */}
        <div className={cn('h-full min-w-0', showFiles ? 'w-1/2' : 'flex-1')}>
          <TerminalPanel ref={terminalRef} serverId={serverId} className="h-full" />
        </div>

        {/* Files — side-by-side when open */}
        {showFiles && (
          <div className="w-1/2 h-full min-w-0 border-l">
            <FileManagerPanel serverId={serverId} className="h-full" />
          </div>
        )}
      </div>
    </div>
  )
}
