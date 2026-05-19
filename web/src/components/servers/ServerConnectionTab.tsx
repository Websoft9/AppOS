import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertTriangle, CheckCircle2, Clock3, Radio } from 'lucide-react'
import { loadConnectSession } from '@/lib/connect-session'

import type {
  ServerConnectionActionId,
  ServerConnectionPresentationSpec,
  ServerDetailTab,
} from './server-connection-presentation'
import { formatTimestamp, type TunnelService } from './server-detail-shared'

type ServerConnectionTabProps = {
  item: Record<string, unknown>
  presentation: ServerConnectionPresentationSpec
  isTunnel: boolean
  tunnelState: string
  tunnel: Record<string, unknown> | null
  services: TunnelService[]
  onExecutePrimaryAction: (
    item: Record<string, unknown>,
    actionId: ServerConnectionActionId
  ) => void
  onOpenTab: (item: Record<string, unknown>, tab?: ServerDetailTab) => void
}

function compactStateLabel(state: ServerConnectionPresentationSpec['state']): string {
  if (state === 'online') return 'Connected'
  if (state === 'awaiting_connection' || state === 'not_configured') return 'Connecting'
  return 'Needs Attention'
}

function compactReason(
  presentation: ServerConnectionPresentationSpec,
  isTunnel: boolean,
  tunnel: Record<string, unknown> | null
): string {
  const reason = presentation.reason.trim()

  if (presentation.state === 'online' && isTunnel) {
    const lastSeen = formatTimestamp(tunnel?.last_seen)
    return lastSeen === '—' ? 'Tunnel active' : `Last heartbeat ${lastSeen}`
  }

  if (reason === 'Tunnel session is active.') return 'Tunnel active'
  if (reason === 'SSH access is reachable.') return 'SSH verified'
  if (reason === 'Waiting for the first tunnel callback.') return 'Waiting for first connection'
  if (reason === 'Configuration is ready for verification.') return 'Ready to test connection'
  if (reason === 'Tunnel setup has not started.') return 'Tunnel setup required'
  if (reason === 'Complete SSH details before verification.') return 'Complete connection setup'
  if (reason === 'Reconnect is intentionally paused.') return 'Connection paused'
  if (reason === 'AppOS cannot reach this server.') return 'Connection lost'
  if (reason === 'Tunnel session is offline.') return 'Connection lost'
  if (reason === 'Tunnel session is unavailable.') return 'Connection unavailable'

  return reason
}

function compactActivityLabel(label: string, isTunnel: boolean): string {
  const normalized = label.trim().toLowerCase()

  if (normalized === 'server created') return 'Server registered'
  if (normalized === 'credential attached') return 'Connection updated'
  if (normalized === 'setup started') return 'Tunnel setup started'
  if (normalized === 'verification or callback observed') {
    return isTunnel ? 'Connected' : 'SSH verified'
  }
  if (normalized === 'last healthy seen') {
    return isTunnel ? 'Heartbeat received' : 'Last healthy check'
  }
  if (normalized === 'pause window updated') return 'Pause updated'
  if (normalized === 'last failure observed') return 'Connection failed'
  if (normalized === 'record updated') return 'Settings updated'

  return label
}

function statusIcon(state: ServerConnectionPresentationSpec['state']) {
  if (state === 'online') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (state === 'awaiting_connection' || state === 'not_configured') {
    return <Clock3 className="h-4 w-4 text-amber-500" />
  }
  return <AlertTriangle className="h-4 w-4 text-amber-500" />
}

function heroTone(state: ServerConnectionPresentationSpec['state']): string {
  if (state === 'online') {
    return 'border-emerald-500/30 bg-emerald-500/[0.03]'
  }
  if (state === 'awaiting_connection' || state === 'not_configured') {
    return 'border-amber-500/30 bg-amber-500/[0.03]'
  }
  return 'border-amber-500/35 bg-amber-500/[0.04]'
}

function badgeTone(
  state: ServerConnectionPresentationSpec['state']
): 'default' | 'secondary' | 'outline' {
  if (state === 'online') return 'default'
  if (state === 'awaiting_connection' || state === 'not_configured') return 'outline'
  return 'secondary'
}

function heroTitle(presentation: ServerConnectionPresentationSpec, isTunnel: boolean): string {
  if (presentation.state === 'online') {
    return isTunnel ? 'Tunnel connection is live' : 'Direct SSH is ready'
  }
  if (presentation.state === 'awaiting_connection' || presentation.state === 'not_configured') {
    return isTunnel ? 'Waiting for the first tunnel callback' : 'Connection setup is in progress'
  }
  return isTunnel ? 'Tunnel connection needs attention' : 'Connection needs attention'
}

function subline(
  presentation: ServerConnectionPresentationSpec,
  isTunnel: boolean,
  summary: string
): string {
  if (presentation.state === 'online') {
    return isTunnel ? 'Remote access is available now.' : 'The server is reachable now.'
  }
  if (presentation.state === 'awaiting_connection' || presentation.state === 'not_configured') {
    return summary
  }
  return 'Take the next action to restore access.'
}

function modeSummary(modeLabel: ServerConnectionPresentationSpec['modeLabel']): string {
  return modeLabel === 'Tunnel' ? 'Tunnel via AppOS relay' : 'Direct SSH'
}

function formatSessionLabel(count: number): string {
  if (count <= 0) return 'None'
  return count === 1 ? '1 active session' : `${count} active sessions`
}

export function ServerConnectionTab({
  item,
  presentation,
  isTunnel,
  tunnel,
  onExecutePrimaryAction,
}: ServerConnectionTabProps) {
  const serverId = String(item.id ?? '')
  const statusLabel = compactStateLabel(presentation.state)
  const summary = compactReason(presentation, isTunnel, tunnel)
  const recentActivity = [...presentation.timeline].reverse().slice(0, 4)
  const title = heroTitle(presentation, isTunnel)
  const helper = subline(presentation, isTunnel, summary)
  const [sessionCount, setSessionCount] = useState(0)

  useEffect(() => {
    const refreshSessionCount = () => {
      if (!serverId || typeof window === 'undefined') {
        setSessionCount(0)
        return
      }
      const snapshot = loadConnectSession()
      if (!snapshot) {
        setSessionCount(0)
        return
      }
      setSessionCount(snapshot.tabs.filter(tab => tab.serverId === serverId).length)
    }

    refreshSessionCount()
    window.addEventListener('focus', refreshSessionCount)
    window.addEventListener('storage', refreshSessionCount)

    return () => {
      window.removeEventListener('focus', refreshSessionCount)
      window.removeEventListener('storage', refreshSessionCount)
    }
  }, [serverId])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(340px,0.95fr)_minmax(0,1.25fr)]">
      <Card className={`overflow-hidden rounded-xl py-0 shadow-none ${heroTone(presentation.state)}`}>
        <CardContent className="px-0">
          <section className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-3">
              <Badge variant={badgeTone(presentation.state)} className="rounded-md px-2 py-0.5">
                {statusLabel}
              </Badge>
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Radio className="h-3 w-3" />
                {presentation.modeLabel}
              </span>
            </div>

            <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground sm:text-lg">
              {statusIcon(presentation.state)}
              <span>{title}</span>
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-background/90 p-3">
              <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Connection Status
                </div>
                <div className="font-medium text-foreground">{summary}</div>
              </div>
              <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Mode
                </div>
                <div className="font-medium text-foreground">{modeSummary(presentation.modeLabel)}</div>
              </div>
              <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Interactive Session
                </div>
                <div className="font-medium text-foreground">{formatSessionLabel(sessionCount)}</div>
              </div>
              <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Last Activity
                </div>
                <div className="font-mono text-foreground">{presentation.lastActivityLabel}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Recommended Action
              </div>
              <div className="text-sm text-muted-foreground">{helper}</div>
              <Button
                className="h-9 rounded-md px-4"
                onClick={() => onExecutePrimaryAction(item, presentation.primaryAction.id)}
              >
                {presentation.primaryAction.label}
              </Button>
            </div>
          </section>
        </CardContent>
      </Card>

      <section className="space-y-3 rounded-xl border border-border/60 bg-background/90 p-4 sm:p-5">
        <div className="border-b border-border/50 pb-3">
          <h3 className="text-sm font-semibold text-foreground">Activity Log</h3>
        </div>
        <div>
          {recentActivity.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
              No recent activity is available yet.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 bg-background/95">
              <div className="divide-y divide-border/50">
                {recentActivity.map((event, index) => (
                  <div
                    key={`${event.label}:${event.at}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-sm"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="truncate font-medium text-foreground">
                        {compactActivityLabel(event.label, isTunnel)}
                      </div>
                      {index === 0 ? (
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Most recent event
                        </div>
                      ) : null}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground sm:text-sm">
                      {event.at}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
