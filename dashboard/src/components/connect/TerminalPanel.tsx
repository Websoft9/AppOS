import { useEffect, useRef, useCallback, useState, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { sshWebSocketUrl, dockerWebSocketUrl, loadPreferences } from '@/lib/connect-api'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { AlertCircle, KeyRound, WifiOff, ShieldX, Settings, ServerCrash, Unplug, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TerminalPanelProps {
  /** Server ID for SSH connection */
  serverId?: string
  /** Container ID for Docker exec connection (Story 15.3) */
  containerId?: string
  /** Override shell for Docker exec (default: /bin/sh) */
  shell?: string
  /** Docker target server ID for container exec */
  dockerServerId?: string
  /** Additional CSS classes */
  className?: string
  /** Whether this terminal tab is currently active in UI */
  isActive?: boolean
}

// ─── Control frame helpers ────────────────────────────────────────────────────

// ─── Error category display helpers ───────────────────────────────────────────

type ConnectErrorCategory =
  | 'auth_failed'
  | 'network_unreachable'
  | 'connection_refused'
  | 'credential_invalid'
  | 'session_failed'
  | 'server_disconnected'

const categoryMeta: Record<ConnectErrorCategory, { icon: typeof AlertCircle; label: string }> = {
  auth_failed:         { icon: KeyRound,    label: 'Authentication Failed' },
  network_unreachable: { icon: WifiOff,     label: 'Network Unreachable' },
  connection_refused:  { icon: ShieldX,     label: 'Connection Refused' },
  credential_invalid:  { icon: Settings,    label: 'Credential Config Error' },
  session_failed:      { icon: ServerCrash, label: 'Session Setup Failed' },
  server_disconnected: { icon: Unplug,      label: 'Server Disconnected' },
}

function makeResizeFrame(cols: number, rows: number): Uint8Array {
  const json = JSON.stringify({ type: 'resize', cols, rows })
  const payload = new TextEncoder().encode(json)
  const frame = new Uint8Array(1 + payload.length)
  frame[0] = 0x00 // control frame prefix
  frame.set(payload, 1)
  return frame
}

// ─── Public handle ────────────────────────────────────────────────────────────

export interface TerminalPanelHandle {
  /** Send text data to the terminal WebSocket (as if typed). */
  sendData: (data: string) => void
  /** Force terminal fit + resize sync (for parent layout transitions). */
  requestFit: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel(
    { serverId, containerId, shell, dockerServerId, className, isActive },
    ref
  ) {
    const termRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const fitRef = useRef<FitAddon | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [errorCategory, setErrorCategory] = useState<ConnectErrorCategory | null>(null)
    const [connecting, setConnecting] = useState(false)
    const fitTimersRef = useRef<number[]>([])
    const isActiveRef = useRef(!!isActive)
    const structuredErrorRef = useRef(false)

    useEffect(() => {
      isActiveRef.current = !!isActive
    }, [isActive])

    const clearFitTimers = useCallback(() => {
      for (const timer of fitTimersRef.current) {
        window.clearTimeout(timer)
      }
      fitTimersRef.current = []
    }, [])

    const fitAndSync = useCallback(() => {
      const fitAddon = fitRef.current
      const terminal = terminalRef.current
      const ws = wsRef.current
      if (!fitAddon || !terminal) return
      fitAddon.fit()
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(makeResizeFrame(terminal.cols, terminal.rows))
      }
    }, [])

    const scheduleFitAndSync = useCallback(() => {
      clearFitTimers()
      fitAndSync()
      fitTimersRef.current.push(window.setTimeout(() => fitAndSync(), 80))
      fitTimersRef.current.push(window.setTimeout(() => fitAndSync(), 220))
    }, [clearFitTimers, fitAndSync])

    const applyViewportInset = useCallback(() => {
      if (!termRef.current) return
      const screen = termRef.current.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen) return
      screen.style.boxSizing = 'border-box'
      screen.style.padding = '8px 10px'
      screen.style.width = '100%'
    }, [])

    const scrollToBottom = useCallback(() => {
      if (!isActiveRef.current) return
      const terminal = terminalRef.current
      if (terminal) {
        terminal.scrollToBottom()
      }
      const viewport = termRef.current?.querySelector('.xterm-viewport') as HTMLElement | null
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }, [])

    // Expose sendData to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        sendData: (data: string) => {
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(data))
          }
        },
        requestFit: () => {
          scheduleFitAndSync()
        },
      }),
      [scheduleFitAndSync]
    )

    const connect = useCallback(() => {
      if (!termRef.current) return
      setError(null)
      setErrorCategory(null)
      setConnecting(true)
      structuredErrorRef.current = false

      // Determine WebSocket URL
      let wsUrl: string
      if (serverId) {
        wsUrl = sshWebSocketUrl(serverId)
      } else if (containerId) {
        wsUrl = dockerWebSocketUrl(containerId)
      } else {
        setError('No server or container specified')
        setConnecting(false)
        return
      }

      const url = new URL(wsUrl)
      if (containerId) {
        url.searchParams.set('_', String(Date.now()))
        if (shell) {
          url.searchParams.set('shell', shell)
        }
        if (dockerServerId) {
          url.searchParams.set('server_id', dockerServerId)
        }
      }

      // Append auth token as query param
      const token = pb.authStore.token
      if (token) {
        url.searchParams.set('token', token)
      }

      // Load preferences
      const prefs = loadPreferences()

      // Clean up previous terminal
      if (terminalRef.current) {
        terminalRef.current.dispose()
      }

      // Create terminal
      const terminal = new Terminal({
        fontSize: prefs.terminal_font_size,
        scrollback: prefs.terminal_scrollback,
        cursorBlink: true,
        theme: {
          background: '#1a1b26',
          foreground: '#c0caf5',
          cursor: '#c0caf5',
          selectionBackground: '#33467c',
        },
      })
      terminalRef.current = terminal

      // Fit addon
      const fitAddon = new FitAddon()
      fitRef.current = fitAddon
      terminal.loadAddon(fitAddon)

      // Mount terminal
      terminal.open(termRef.current)
      applyViewportInset()
      window.setTimeout(() => scheduleFitAndSync(), 0)

      // Open WebSocket
      const ws = new WebSocket(url.toString())
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        setConnecting(false)
        terminal.focus()
        // Send initial resize
        const { cols, rows } = terminal
        ws.send(makeResizeFrame(cols, rows))
      }

      ws.onmessage = event => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          // Control frame: 0x00 prefix + JSON payload (error/close sent by backend)
          if (bytes.length > 0 && bytes[0] === 0x00) {
            try {
              const ctrl = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as {
                type: string
                category?: string
                message?: string
              }
              if (ctrl.type === 'error' || ctrl.type === 'close') {
                structuredErrorRef.current = true
                setError(ctrl.message ?? `Connection ${ctrl.type}`)
                if (ctrl.category && ctrl.category in categoryMeta) {
                  setErrorCategory(ctrl.category as ConnectErrorCategory)
                } else {
                  setErrorCategory(null)
                }
                ws.close(1000)
              }
            } catch {
              // Not a valid control frame — ignore silently
            }
            return
          }
          terminal.write(bytes)
          scrollToBottom()
        } else {
          terminal.write(event.data)
          scrollToBottom()
        }
      }

      ws.onclose = event => {
        setConnecting(false)
        if (structuredErrorRef.current) {
          return
        }
        if (event.code !== 1000) {
          const detail = event.reason ? `: ${event.reason}` : ''
          setError(`Connection closed (code ${event.code}${detail})`)
          setErrorCategory(null)
        }
      }

      ws.onerror = () => {
        setConnecting(false)
        setError('WebSocket connection failed')
        setErrorCategory(null)
      }

      // Terminal → WebSocket
      terminal.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data))
        }
      })

      // Terminal resize → control frame
      terminal.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(makeResizeFrame(cols, rows))
        }
      })
    }, [
      serverId,
      containerId,
      shell,
      dockerServerId,
      scheduleFitAndSync,
      applyViewportInset,
      scrollToBottom,
    ])

    useEffect(() => {
      if (!isActive) return
      const timer = window.setTimeout(() => {
        scheduleFitAndSync()
        scrollToBottom()
      }, 0)
      return () => window.clearTimeout(timer)
    }, [isActive, scheduleFitAndSync, scrollToBottom])

    // Auto-connect on mount / serverId change
    useEffect(() => {
      // Defer to avoid synchronous setState in effect body
      const frame = requestAnimationFrame(() => connect())
      return () => {
        cancelAnimationFrame(frame)
        clearFitTimers()
        wsRef.current?.close(1000, 'unmount')
        terminalRef.current?.dispose()
      }
    }, [connect, clearFitTimers])

    // ResizeObserver for container resize → fit + sync
    useEffect(() => {
      const el = termRef.current
      if (!el) return

      const ro = new ResizeObserver(() => {
        scheduleFitAndSync()
      })
      ro.observe(el)

      const parent = el.parentElement
      if (parent) {
        ro.observe(parent)
      }

      const onWindowResize = () => scheduleFitAndSync()
      window.addEventListener('resize', onWindowResize)

      return () => {
        ro.disconnect()
        window.removeEventListener('resize', onWindowResize)
      }
    }, [scheduleFitAndSync])

    return (
      <div className={cn('relative flex flex-col h-full overflow-hidden', className)}>
        {/* Terminal container */}
        <div ref={termRef} className="flex-1 min-h-0 overflow-hidden" />

        {/* Error overlay */}
        {(error || connecting) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <div className="text-center space-y-3 max-w-md px-6">
              {connecting ? (
                <p className="text-muted-foreground text-sm">Connecting...</p>
              ) : (
                <>
                  {(() => {
                    const meta = errorCategory ? categoryMeta[errorCategory] : null
                    const Icon = meta?.icon ?? AlertCircle
                    return (
                      <>
                        <div className="flex items-center justify-center gap-2 text-destructive">
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="text-sm font-medium">{meta?.label ?? 'Connection Error'}</span>
                        </div>
                        <p className="text-muted-foreground text-xs leading-relaxed">{error}</p>
                      </>
                    )
                  })()}
                  <Button variant="outline" size="sm" onClick={connect}>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Reconnect
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }
)
