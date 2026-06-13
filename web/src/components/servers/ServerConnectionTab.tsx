import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

type Translate = (key: string, options?: Record<string, unknown>) => string

function compactStateLabel(state: ServerConnectionPresentationSpec['state'], t: Translate): string {
  if (state === 'online') return t('servers.connectionTab.state.connected')
  if (state === 'awaiting_connection' || state === 'not_configured') {
    return t('servers.connectionTab.state.connecting')
  }
  return t('servers.connectionTab.state.needsAttention')
}

function compactReason(
  presentation: ServerConnectionPresentationSpec,
  isTunnel: boolean,
  tunnel: Record<string, unknown> | null,
  t: Translate
): string {
  const reason = presentation.reason.trim()

  if (presentation.state === 'online' && isTunnel) {
    const lastSeen = formatTimestamp(tunnel?.last_seen)
    return lastSeen === '—'
      ? t('servers.connectionTab.reason.tunnelActive')
      : t('servers.connectionTab.reason.lastHeartbeat', { time: lastSeen })
  }

  if (reason === 'Tunnel session is active.') return t('servers.connectionTab.reason.tunnelActive')
  if (reason === 'SSH access is reachable.') return t('servers.connectionTab.reason.sshVerified')
  if (reason === 'Waiting for the first tunnel callback.') {
    return t('servers.connectionTab.reason.waitingFirstConnection')
  }
  if (reason === 'Configuration is ready for verification.') {
    return t('servers.connectionTab.reason.readyToTest')
  }
  if (reason === 'Tunnel setup has not started.') {
    return t('servers.connectionTab.reason.tunnelSetupRequired')
  }
  if (reason === 'Complete SSH details before verification.') {
    return t('servers.connectionTab.reason.completeSetup')
  }
  if (reason === 'Reconnect is intentionally paused.') {
    return t('servers.connectionTab.reason.connectionPaused')
  }
  if (reason === 'AppOS cannot reach this server.')
    return t('servers.connectionTab.reason.connectionLost')
  if (reason === 'Tunnel session is offline.')
    return t('servers.connectionTab.reason.connectionLost')
  if (reason === 'Tunnel session is unavailable.') {
    return t('servers.connectionTab.reason.connectionUnavailable')
  }

  return reason
}

function compactActivityLabel(label: string, isTunnel: boolean, t: Translate): string {
  const normalized = label.trim().toLowerCase()

  if (normalized === 'server created') return t('servers.connectionTab.activity.serverRegistered')
  if (normalized === 'credential attached')
    return t('servers.connectionTab.activity.connectionUpdated')
  if (normalized === 'setup started') return t('servers.connectionTab.activity.tunnelSetupStarted')
  if (normalized === 'verification or callback observed') {
    return isTunnel
      ? t('servers.connectionTab.activity.connected')
      : t('servers.connectionTab.activity.sshVerified')
  }
  if (normalized === 'last healthy seen') {
    return isTunnel
      ? t('servers.connectionTab.activity.heartbeatReceived')
      : t('servers.connectionTab.activity.lastHealthyCheck')
  }
  if (normalized === 'pause window updated') return t('servers.connectionTab.activity.pauseUpdated')
  if (normalized === 'last failure observed')
    return t('servers.connectionTab.activity.connectionFailed')
  if (normalized === 'record updated') return t('servers.connectionTab.activity.settingsUpdated')

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

function heroTitle(
  presentation: ServerConnectionPresentationSpec,
  isTunnel: boolean,
  t: Translate
): string {
  if (presentation.state === 'online') {
    return isTunnel
      ? t('servers.connectionTab.hero.tunnelLive')
      : t('servers.connectionTab.hero.directReady')
  }
  if (presentation.state === 'awaiting_connection' || presentation.state === 'not_configured') {
    return isTunnel
      ? t('servers.connectionTab.hero.waitingFirstTunnelCallback')
      : t('servers.connectionTab.hero.setupInProgress')
  }
  return isTunnel
    ? t('servers.connectionTab.hero.tunnelNeedsAttention')
    : t('servers.connectionTab.hero.connectionNeedsAttention')
}

function subline(
  presentation: ServerConnectionPresentationSpec,
  isTunnel: boolean,
  summary: string,
  t: Translate
): string {
  if (presentation.state === 'online') {
    return isTunnel
      ? t('servers.connectionTab.subline.remoteAccessAvailable')
      : t('servers.connectionTab.subline.serverReachable')
  }
  if (presentation.state === 'awaiting_connection' || presentation.state === 'not_configured') {
    return summary
  }
  return t('servers.connectionTab.subline.restoreAccess')
}

function modeSummary(
  modeLabel: ServerConnectionPresentationSpec['modeLabel'],
  t: Translate
): string {
  return modeLabel === 'Tunnel'
    ? t('servers.connectionTab.modeSummary.tunnelRelay')
    : t('servers.connectionTab.modeSummary.directSsh')
}

function formatSessionLabel(count: number, t: Translate): string {
  if (count <= 0) return t('servers.connectionTab.sessions.none')
  return count === 1
    ? t('servers.connectionTab.sessions.oneActive')
    : t('servers.connectionTab.sessions.manyActive', { count })
}

export function ServerConnectionTab({
  item,
  presentation,
  isTunnel,
  tunnel,
  onExecutePrimaryAction,
}: ServerConnectionTabProps) {
  const { t } = useTranslation('resources')
  const serverId = String(item.id ?? '')
  const statusLabel = compactStateLabel(presentation.state, t)
  const summary = compactReason(presentation, isTunnel, tunnel, t)
  const recentActivity = [...presentation.timeline].reverse().slice(0, 4)
  const title = heroTitle(presentation, isTunnel, t)
  const helper = subline(presentation, isTunnel, summary, t)
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
      <Card
        className={`overflow-hidden rounded-xl py-0 shadow-none ${heroTone(presentation.state)}`}
      >
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
                  {t('servers.connectionTab.fields.connectionStatus')}
                </div>
                <div className="font-medium text-foreground">{summary}</div>
              </div>
              <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('servers.connectionTab.fields.mode')}
                </div>
                <div className="font-medium text-foreground">
                  {modeSummary(presentation.modeLabel, t)}
                </div>
              </div>
              <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('servers.connectionTab.fields.interactiveSession')}
                </div>
                <div className="font-medium text-foreground">
                  {formatSessionLabel(sessionCount, t)}
                </div>
              </div>
              <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('servers.connectionTab.fields.lastActivity')}
                </div>
                <div className="font-mono text-foreground">{presentation.lastActivityLabel}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('servers.connectionTab.fields.recommendedAction')}
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

      <div className="space-y-4">
    <section className="space-y-3 rounded-xl border border-border/60 bg-background/90 p-4 sm:p-5">
      <div className="border-b border-border/50 pb-3">
      <h3 className="text-sm font-semibold text-foreground">
        {t('servers.connectionTab.activityLog.title')}
      </h3>
      </div>
      <div>
      {recentActivity.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
        {t('servers.connectionTab.activityLog.empty')}
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
              {compactActivityLabel(event.label, isTunnel, t)}
            </div>
            {index === 0 ? (
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('servers.connectionTab.activityLog.mostRecent')}
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
    </div>
  )
}
