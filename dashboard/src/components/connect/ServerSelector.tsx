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
import { cn } from '@/lib/utils'
import { listServers, type Server as ServerType } from '@/lib/connect-api'

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

  const handleConnect = () => {
    if (!selected) return
    navigate({ to: '/connect/server/$serverId', params: { serverId: selected.id } })
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
                {servers.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={cn(
                      'flex items-start gap-2 py-2',
                      selected?.id === s.id && 'font-medium bg-accent',
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
          </div>
        )}
      </div>
    </div>
  )
}
