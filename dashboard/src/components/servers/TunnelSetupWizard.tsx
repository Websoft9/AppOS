import { useEffect, useRef, useState } from "react"
import { pb } from "@/lib/pb"

interface SetupInfo {
  token?: string
  autossh_cmd: string
  systemd_unit: string
  setup_script_url: string
}

interface Props {
  serverId: string
  onClose: () => void
}

// Module-level constant — no reason to recreate on every render.
const UNINSTALL_SCRIPT = `#!/bin/bash
# Uninstall appos tunnel service
set -e
systemctl stop appos-tunnel 2>/dev/null || true
systemctl disable appos-tunnel 2>/dev/null || true
rm -f /etc/systemd/system/appos-tunnel.service
systemctl daemon-reload
echo "Done: appos-tunnel service removed."`

export function TunnelSetupWizard({ serverId, onClose }: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [setup, setSetup] = useState<SetupInfo | null>(null)
  const [status, setStatus] = useState<"waiting" | "connected" | "error">("waiting")
  const statusRef = useRef<"waiting" | "connected" | "error">("waiting")
  const [errorMsg, setErrorMsg] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep ref in sync with state so realtime callbacks see the current value.
  useEffect(() => { statusRef.current = status }, [status])

  // ── Fetch setup info (no token rotation) ─────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        let setupRes: SetupInfo
        try {
          // GET /setup returns the existing token without rotation.
          setupRes = await pb.send(`/api/ext/tunnel/servers/${serverId}/setup`, {
            method: "GET",
          }) as SetupInfo
        } catch {
          // Server has no token yet — create one (idempotent, no disconnect).
          await pb.send(`/api/ext/tunnel/servers/${serverId}/token`, { method: "POST" })
          setupRes = await pb.send(`/api/ext/tunnel/servers/${serverId}/setup`, {
            method: "GET",
          }) as SetupInfo
        }

        if (cancelled) return
        setToken(setupRes.token ?? null)
        setSetup(setupRes)
      } catch (e) {
        if (!cancelled) {
          setStatus("error")
          setErrorMsg(e instanceof Error ? e.message : "Failed to load tunnel setup")
        }
      }
    }

    void init()
    return () => { cancelled = true }
  }, [serverId])

  // ── Subscribe to realtime server updates ──────────────────────────────────
  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    pb.collection("servers")
      .subscribe(serverId, (ev) => {
        const rec = ev.record as Record<string, unknown>
        if (rec.tunnel_status === "online" && statusRef.current !== "connected") {
          setStatus("connected")
          // Auto-close after 2 s
          closeTimerRef.current = setTimeout(() => onClose(), 2000)
        }
      })
      .then((fn) => { unsubscribe = fn })
      .catch(() => {/* realtime unavailable */})

    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      unsubscribe?.()
      pb.collection("servers").unsubscribe(serverId).catch(() => {})
    }
  }, [serverId, onClose])

  // ── Copy helper (with HTTP fallback) ─────────────────────────────────────
  function copy(text: string, key: string) {
    const doSet = () => {
      setCopied(key)
      setTimeout(() => setCopied(prev => prev === key ? null : prev), 2000)
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(doSet).catch(() => copyFallback(text, doSet))
    } else {
      copyFallback(text, doSet)
    }
  }

  function copyFallback(text: string, onSuccess: () => void) {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try {
      document.execCommand("copy")
      onSuccess()
    } finally {
      document.body.removeChild(ta)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 space-y-5">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold">Connect Tunnel Server</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Run the setup script on the remote machine to establish the reverse SSH tunnel.
          </p>
        </div>

        {/* Error state */}
        {status === "error" && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {errorMsg}
          </div>
        )}

        {/* Loading setup info */}
        {!setup && status !== "error" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="animate-spin text-base">⟳</span>
            Generating token…
          </div>
        )}

        {/* Setup commands */}
        {setup && (
          <div className="space-y-4">
            {/* One-liner install */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Quick setup (run as root)</label>
              <div className="relative">
                <pre className="text-xs bg-muted rounded-md px-4 py-3 overflow-x-auto pr-20">
                  {`curl -sSL ${window.location.origin}${setup.setup_script_url} | bash`}
                </pre>
                <button
                  onClick={() => copy(`curl -sSL ${window.location.origin}${setup.setup_script_url} | bash`, "curl")}
                  className="absolute right-2 top-2 text-xs px-2 py-1 rounded bg-background border border-input hover:bg-accent"
                >
                  {copied === "curl" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* autossh command */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Manual autossh command</label>
              <div className="relative">
                <pre className="text-xs bg-muted rounded-md px-4 py-3 overflow-x-auto pr-20 whitespace-pre-wrap">
                  {setup.autossh_cmd}
                </pre>
                <button
                  onClick={() => copy(setup.autossh_cmd, "autossh")}
                  className="absolute right-2 top-2 text-xs px-2 py-1 rounded bg-background border border-input hover:bg-accent"
                >
                  {copied === "autossh" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Token (for reference) */}
            {token && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Token</label>
                <div className="relative">
                  <pre className="text-xs bg-muted rounded-md px-4 py-3 overflow-x-auto pr-20 font-mono break-all whitespace-pre-wrap">
                    {token}
                  </pre>
                  <button
                    onClick={() => copy(token, "token")}
                    className="absolute right-2 top-2 text-xs px-2 py-1 rounded bg-background border border-input hover:bg-accent"
                  >
                    {copied === "token" ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {/* Uninstall script */}
            <details className="group">
              <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground select-none">
                Uninstall script ▸
              </summary>
              <div className="relative mt-1">
                <pre className="text-xs bg-muted rounded-md px-4 py-3 overflow-x-auto pr-20 whitespace-pre-wrap">{UNINSTALL_SCRIPT}</pre>
                <button
                  onClick={() => copy(UNINSTALL_SCRIPT, "uninstall")}
                  className="absolute right-2 top-2 text-xs px-2 py-1 rounded bg-background border border-input hover:bg-accent"
                >
                  {copied === "uninstall" ? "Copied!" : "Copy"}
                </button>
              </div>
            </details>
          </div>
        )}

        {/* Connection status indicator */}
        <div className="flex items-center gap-2 text-sm">
          {status === "waiting" && (
            <>
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-muted-foreground">Waiting for connection…</span>
            </>
          )}
          {status === "connected" && (
            <>
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
              <span className="text-green-600 font-medium">Connected! Closing…</span>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-md border border-input hover:bg-accent"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
