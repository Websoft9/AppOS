import { useEffect, useRef, useCallback, useState, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { sshWebSocketUrl, dockerWebSocketUrl, loadPreferences } from '@/lib/connect-api'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import {
  AlertCircle,
  KeyRound,
  WifiOff,
  ShieldX,
  Settings,
  ServerCrash,
  Unplug,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TerminalPanelProps {
  /** Server ID for SSH connection */
  serverId?: string
  /** Existing resumable SSH session ID */
  sessionId?: string
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
  /** Called when the backend confirms the active session id */
  onSessionEstablished?: (sessionId: string) => void
  /** Called when a previously stored session id is no longer resumable */
  onSessionInvalidated?: (sessionId: string) => void
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
  auth_failed: { icon: KeyRound, label: 'Authentication Failed' },
  network_unreachable: { icon: WifiOff, label: 'Network Unreachable' },
  connection_refused: { icon: ShieldX, label: 'Connection Refused' },
  credential_invalid: { icon: Settings, label: 'Credential Config Error' },
  session_failed: { icon: ServerCrash, label: 'Session Setup Failed' },
  server_disconnected: { icon: Unplug, label: 'Server Disconnected' },
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
  /** Explicitly close the terminal session instead of detaching it. */
  disconnect: () => void
}

const TERMINAL_FRAME_PADDING = {
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
} as const

const TERMINAL_SCREEN_PADDING = '1em 1ch 8px 10px'

// ─── Component ────────────────────────────────────────────────────────────────

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel(
    {
      serverId,
      sessionId,
      containerId,
      shell,
      dockerServerId,
      className,
      isActive,
      onSessionEstablished,
      onSessionInvalidated,
    },
    ref
  ) {
    const frameRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const fitRef = useRef<FitAddon | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [errorCategory, setErrorCategory] = useState<ConnectErrorCategory | null>(null)
    const [warning, setWarning] = useState<string | null>(null)
    const [connecting, setConnecting] = useState(false)
    const fitTimersRef = useRef<number[]>([])
    const isActiveRef = useRef(!!isActive)
    const structuredErrorRef = useRef(false)
    const connectionAttemptRef = useRef(0)
    const latestSessionIdRef = useRef<string | undefined>(sessionId)
    const onSessionEstablishedRef = useRef(onSessionEstablished)
    const onSessionInvalidatedRef = useRef(onSessionInvalidated)

    useEffect(() => {
      isActiveRef.current = !!isActive
    }, [isActive])

    useEffect(() => {
      latestSessionIdRef.current = sessionId
    }, [sessionId])

    useEffect(() => {
      onSessionEstablishedRef.current = onSessionEstablished
    }, [onSessionEstablished])

    useEffect(() => {
      onSessionInvalidatedRef.current = onSessionInvalidated
    }, [onSessionInvalidated])

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
      const xterm = termRef.current.querySelector('.xterm') as HTMLElement | null
      const screen = termRef.current.querySelector('.xterm-screen') as HTMLElement | null
      const viewport = termRef.current.querySelector('.xterm-viewport') as HTMLElement | null
      if (xterm) {
        xterm.style.width = '100%'
        xterm.style.height = '100%'
        xterm.style.boxSizing = 'border-box'
        xterm.style.padding = TERMINAL_SCREEN_PADDING
      }
      if (!screen) return
      screen.style.boxSizing = 'border-box'
      screen.style.width = '100%'
      screen.style.height = '100%'
      screen.style.maxWidth = '100%'
      screen.style.maxHeight = '100%'
      if (viewport) {
        viewport.style.width = '100%'
        viewport.style.height = '100%'
        viewport.style.maxWidth = '100%'
        viewport.style.maxHeight = '100%'
        viewport.style.boxSizing = 'border-box'
        viewport.style.padding = TERMINAL_SCREEN_PADDING
      }
    }, [])

    const disposeTerminal = useCallback(() => {
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
      if (termRef.current) {
        termRef.current.replaceChildren()
      }
    }, [])

    const detachSocketHandlers = useCallback((ws: WebSocket | null) => {
      if (!ws) return
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
    }, [])

    const disposeSocket = useCallback(
      (closeCode = 1000, reason = 'dispose') => {
        const ws = wsRef.current
        if (!ws) return
        detachSocketHandlers(ws)
        wsRef.current = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(closeCode, reason)
        }
      },
      [detachSocketHandlers]
    )

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
        disconnect: () => {
          disposeSocket(1000, 'disconnect')
        },
      }),
      [disposeSocket, scheduleFitAndSync]
    )

    const connect = useCallback(() => {
      if (!termRef.current) return

      const attemptId = connectionAttemptRef.current + 1
      connectionAttemptRef.current = attemptId
      setError(null)
      setErrorCategory(null)
      setWarning(null)
      setConnecting(true)
      structuredErrorRef.current = false
      disposeSocket(1000, 'reconnect')
      disposeTerminal()

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

      const requestedSessionId = latestSessionIdRef.current
      const url = new URL(wsUrl)
      if (requestedSessionId && (serverId || containerId)) {
        url.searchParams.set('session_id', requestedSessionId)
      }
      if (containerId) {
        url.searchParams.set('_', String(Date.now()))
        if (shell) {
          url.searchParams.set('shell', shell)
        }
        if (dockerServerId) {
          url.searchParams.set('server_id', dockerServerId)
        }
      }

      const token = pb.authStore.token
      if (token) {
        url.searchParams.set('token', token)
      }

      const prefs = loadPreferences()
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

      const fitAddon = new FitAddon()
      fitRef.current = fitAddon
      terminal.loadAddon(fitAddon)

      terminal.open(termRef.current)
      applyViewportInset()
      window.setTimeout(() => scheduleFitAndSync(), 0)

      const ws = new WebSocket(url.toString())
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      const isStaleAttempt = () => connectionAttemptRef.current !== attemptId

      ws.onopen = () => {
        if (isStaleAttempt()) {
          detachSocketHandlers(ws)
          ws.close(1000, 'stale-open')
          return
        }
        setConnecting(false)
        terminal.focus()
        ws.send(makeResizeFrame(terminal.cols, terminal.rows))
      }

      ws.onmessage = event => {
        if (isStaleAttempt()) return

        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          if (bytes.length > 0 && bytes[0] === 0x00) {
            try {
              const ctrl = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as {
                type: string
                session_id?: string
                category?: string
                message?: string
              }
              if (ctrl.type === 'session' && typeof ctrl.session_id === 'string') {
                onSessionEstablishedRef.current?.(ctrl.session_id)
                return
              }
              if (ctrl.type === 'warning') {
                setWarning(ctrl.message ?? 'Terminal warning')
                return
              }
              if (ctrl.type === 'error' || ctrl.type === 'close') {
                if (requestedSessionId && ctrl.message === 'terminal session not found') {
                  latestSessionIdRef.current = undefined
                  onSessionInvalidatedRef.current?.(requestedSessionId)
                  structuredErrorRef.current = false
                  setError(null)
                  setErrorCategory(null)
                  if (wsRef.current === ws) {
                    wsRef.current = null
                  }
                  detachSocketHandlers(ws)
                  ws.close(1000, 'stale-session')
                  window.setTimeout(() => {
                    if (!isStaleAttempt()) {
                      connect()
                    }
                  }, 0)
                  return
                }

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
              // Ignore malformed control frames.
            }
            return
          }

          terminal.write(bytes)
          scrollToBottom()
          return
        }

        terminal.write(event.data)
        scrollToBottom()
      }

      ws.onclose = event => {
        if (isStaleAttempt()) return
        if (wsRef.current === ws) {
          wsRef.current = null
        }
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
        if (isStaleAttempt()) return
        setConnecting(false)
        setError('WebSocket connection failed')
        setErrorCategory(null)
      }

      terminal.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data))
        }
      })

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
        disposeSocket(1000, 'detach')
        disposeTerminal()
      }
    }, [connect, clearFitTimers, disposeSocket, disposeTerminal])

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
        {warning && !error && !connecting ? (
          <div className="absolute inset-x-3 top-3 z-10 rounded-md border border-amber-500/40 bg-amber-500/12 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <p className="font-medium text-amber-200">Proxy warning</p>
                  <p className="mt-0.5 leading-relaxed text-amber-100/90">{warning}</p>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-amber-200/90 hover:bg-amber-500/10 hover:text-amber-100"
                onClick={() => setWarning(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {/* Terminal container */}
        <div
          ref={frameRef}
          data-terminal-frame
          className="flex-1 min-h-0 overflow-hidden bg-[#1a1b26]"
          style={TERMINAL_FRAME_PADDING}
        >
          <div ref={termRef} className="h-full min-h-0 w-full overflow-hidden" />
        </div>

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
                          <span className="text-sm font-medium">
                            {meta?.label ?? 'Connection Error'}
                          </span>
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
