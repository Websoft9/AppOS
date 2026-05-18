import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertTriangle, CheckCircle2, Clock3, Dot, Radio } from 'lucide-react'

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
  if (state === 'online') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (state === 'awaiting_connection' || state === 'not_configured') {
    return <Clock3 className="h-4 w-4 text-amber-600" />
  }
  return <AlertTriangle className="h-4 w-4 text-amber-700" />
}

function heroTone(state: ServerConnectionPresentationSpec['state']): string {
  if (state === 'online') {
    return 'border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))]'
  }
  if (state === 'awaiting_connection' || state === 'not_configured') {
    return 'border-amber-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.14),_transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,250,249,0.96))]'
  }
  return 'border-amber-300/70 bg-[radial-gradient(circle_at_top_left,_rgba(217,119,6,0.14),_transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,250,249,0.96))]'
}

function badgeTone(state: ServerConnectionPresentationSpec['state']): 'default' | 'secondary' | 'outline' {
  if (state === 'online') return 'default'
  if (state === 'awaiting_connection' || state === 'not_configured') return 'outline'
  return 'secondary'
}

function heroTitle(
  presentation: ServerConnectionPresentationSpec,
  isTunnel: boolean
): string {
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

export function ServerConnectionTab({
  item,
  presentation,
  isTunnel,
  tunnel,
  onExecutePrimaryAction,
}: ServerConnectionTabProps) {
  const statusLabel = compactStateLabel(presentation.state)
  const summary = compactReason(presentation, isTunnel, tunnel)
  const recentActivity = [...presentation.timeline].reverse().slice(0, 4)
  const title = heroTitle(presentation, isTunnel)
  const helper = subline(presentation, isTunnel, summary)

  return (
    <div className="space-y-4">
      <Card className={`overflow-hidden py-0 shadow-none ${heroTone(presentation.state)}`}>
        <CardContent className="px-0">
          <section className="space-y-6 p-5 sm:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badgeTone(presentation.state)}>
                    {statusLabel}
                  </Badge>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-white/75 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur-sm">
                    <Radio className="h-3 w-3" />
                    {presentation.modeLabel}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                    {statusIcon(presentation.state)}
                    <span>{title}</span>
                  </div>
                  <p className="max-w-2xl text-sm text-foreground/80">{summary}</p>
                  <p className="max-w-2xl text-sm text-muted-foreground">{helper}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                <div className="font-medium uppercase tracking-wide text-foreground/80">
                  Last activity
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {presentation.lastActivityLabel}
                </div>
              </div>
            </div>

            <div>
              <Button
                className="rounded-full px-5"
                onClick={() => onExecutePrimaryAction(item, presentation.primaryAction.id)}
              >
                {presentation.primaryAction.label}
              </Button>
            </div>
          </section>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
        </div>
        <div>
          {recentActivity.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
              No recent activity is available yet.
            </div>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-white/70 p-4 shadow-sm">
              <div className="space-y-0">
                {recentActivity.map((event, index) => (
                <div
                  key={`${event.label}:${event.at}`}
                  className="grid grid-cols-[auto_1fr_auto] items-start gap-3 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <div className="flex h-5 items-start justify-center pt-0.5 text-muted-foreground">
                    {index === 0 ? (
                      <span className="flex h-2.5 w-2.5 rounded-full bg-foreground/80 ring-4 ring-muted/40" />
                    ) : (
                      <Dot className="h-5 w-5" />
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <div className="font-medium text-foreground">
                      {compactActivityLabel(event.label, isTunnel)}
                    </div>
                    {index === 0 ? (
                      <div className="text-xs text-muted-foreground">Most recent event</div>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground sm:text-sm">{event.at}</div>
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
