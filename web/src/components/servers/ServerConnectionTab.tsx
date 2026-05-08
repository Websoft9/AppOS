import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import type {
  ServerConnectionActionId,
  ServerConnectionPresentationSpec,
  ServerDetailTab,
} from './server-connection-presentation'
import type { TunnelService } from './server-detail-shared'
import { formatTimestamp, tunnelStateLabel } from './server-detail-shared'

type ServerConnectionTabProps = {
  item: Record<string, unknown>
  presentation: ServerConnectionPresentationSpec
  isTunnel: boolean
  tunnelState: string
  tunnel: Record<string, unknown> | null
  services: TunnelService[]
  onExecutePrimaryAction: (item: Record<string, unknown>, actionId: ServerConnectionActionId) => void
  onOpenTab: (item: Record<string, unknown>, tab?: ServerDetailTab) => void
}

const detailSectionTitleClassName = 'text-sm font-semibold text-foreground'

export function ServerConnectionTab({
  item,
  presentation,
  isTunnel,
  tunnelState,
  tunnel,
  services,
  onExecutePrimaryAction,
  onOpenTab,
}: ServerConnectionTabProps) {
  return (
    <div className="space-y-4">
      <section className="space-y-4">
        <div>
          <h3 className={detailSectionTitleClassName}>Connection Summary</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Current connection state, reason, endpoint, and next action.
          </p>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Mode</div>
            <div className="mt-1">{presentation.modeLabel}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Connection Status
            </div>
            <div className="mt-1">
              <Badge
                variant={
                  presentation.state === 'online'
                    ? 'default'
                    : presentation.state === 'paused' ||
                        presentation.state === 'needs_attention'
                      ? 'secondary'
                      : 'outline'
                }
              >
                {presentation.stateLabel}
              </Badge>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Reason</div>
            <div className="mt-1">{presentation.reason}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Last Check or Last Seen
            </div>
            <div className="mt-1">{presentation.lastActivityLabel}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Primary Action
            </div>
            <div className="mt-1">
              <Button size="sm" onClick={() => onExecutePrimaryAction(item, presentation.primaryAction.id)}>
                {presentation.primaryAction.label}
              </Button>
            </div>
          </div>
          <div className="sm:col-span-2 xl:col-span-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Current Endpoint
            </div>
            <div className="mt-1">{presentation.endpointSummary}</div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className={detailSectionTitleClassName}>Primary Next Step</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {presentation.primaryActionDescription}
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onExecutePrimaryAction(item, presentation.primaryAction.id)}>
              {presentation.primaryAction.label}
            </Button>
            {presentation.secondaryActions.map(action => (
              <Button
                key={action.label}
                variant="outline"
                onClick={() => onOpenTab(item, action.tab)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className={detailSectionTitleClassName}>Mode-Specific Setup or Recovery</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {isTunnel
              ? 'Tunnel lifecycle guidance covers setup, runtime session, and recovery.'
              : 'Direct SSH lifecycle guidance covers configuration, verification, and recovery.'}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {isTunnel ? (
            <>
              <div className="text-sm">
                <div className="font-medium">Setup</div>
                <div className="mt-2 text-muted-foreground">
                  {presentation.state === 'not_configured'
                    ? 'Tunnel setup has not started yet.'
                    : 'Tunnel setup is already prepared in AppOS.'}
                </div>
              </div>
              <div className="text-sm">
                <div className="font-medium">Runtime Session</div>
                <div className="mt-2 text-muted-foreground">
                  State: {tunnelStateLabel(tunnelState)} · Last seen: {formatTimestamp(tunnel?.last_seen)}
                </div>
              </div>
              <div className="text-sm">
                <div className="font-medium">Recovery</div>
                <div className="mt-2 text-muted-foreground">
                  {String(tunnel?.reason ?? '').trim() ||
                    'No tunnel-specific recovery issue is currently reported.'}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm">
                <div className="font-medium">Configuration</div>
                <div className="mt-2 text-muted-foreground">
                  Host {String(item.host || '—')} · Port {String(item.port || '22')} · User{' '}
                  {String(item.user || '—')}
                </div>
              </div>
              <div className="text-sm">
                <div className="font-medium">Verification</div>
                <div className="mt-2 text-muted-foreground">
                  Latest check: {presentation.lastActivityLabel} · Source:{' '}
                  {presentation.diagnostics.evidenceSource}
                </div>
              </div>
              <div className="text-sm">
                <div className="font-medium">Recovery</div>
                <div className="mt-2 text-muted-foreground">
                  {presentation.state === 'needs_attention'
                    ? presentation.reason
                    : 'No SSH recovery action is currently required.'}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {isTunnel ? (
        <section className="space-y-4">
          <div>
            <h3 className={detailSectionTitleClassName}>Tunnel Services</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Service mappings exposed through this tunnel connection.
            </p>
          </div>
          <div>
            {services.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No tunnel service mapping exposed for this server.
              </div>
            ) : (
              <div className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                {services.map(service => (
                  <div key={`${service.service_name}:${service.tunnel_port}`}>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {service.service_name}
                    </div>
                    <div className="mt-1 font-medium">Port {service.tunnel_port}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <div>
          <h3 className={detailSectionTitleClassName}>Diagnostics</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Evidence that supports the current recommendation.
          </p>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Latest Check Result
            </div>
            <div className="mt-1">{presentation.diagnostics.latestCheckResult}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Evidence Source
            </div>
            <div className="mt-1">{presentation.diagnostics.evidenceSource}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Latest Failure Reason
            </div>
            <div className="mt-1">{presentation.diagnostics.latestFailureReason}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Latest Tunnel Callback or Heartbeat
            </div>
            <div className="mt-1">{presentation.diagnostics.latestTunnelCallbackOrHeartbeat}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Pause Until</div>
            <div className="mt-1">{presentation.diagnostics.pauseUntil}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Reason</div>
            <div className="mt-1">{presentation.diagnostics.currentReason}</div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className={detailSectionTitleClassName}>Activity Timeline</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Compact lifecycle milestones for this server.
          </p>
        </div>
        <div>
          {presentation.timeline.length === 0 ? (
            <div className="text-sm text-muted-foreground">No lifecycle events are available yet.</div>
          ) : (
            <div className="space-y-3">
              {presentation.timeline.map(event => (
                <div
                  key={`${event.label}:${event.at}`}
                  className="flex items-start justify-between gap-4 text-sm"
                >
                  <div className="font-medium">{event.label}</div>
                  <div className="text-muted-foreground">{event.at}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}