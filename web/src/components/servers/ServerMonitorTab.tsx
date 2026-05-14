import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MonitorTargetPanel } from '@/components/monitor/MonitorTargetPanel'
import { getSystemdStatus } from '@/lib/connect-api'

type MonitorChainState = 'ok' | 'attention' | 'info' | 'checking'

type MonitorConclusion = {
  id: string
  label: string
  state: MonitorChainState
  summary: string
  detail: string
  nextStep: string
  observedAt: string
}

function stateBadgeVariant(
  state: MonitorChainState
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (state === 'ok') return 'default'
  if (state === 'attention') return 'destructive'
  if (state === 'checking') return 'secondary'
  return 'outline'
}

function stateLabel(state: MonitorChainState): string {
  if (state === 'ok') return 'OK'
  if (state === 'attention') return 'Action needed'
  if (state === 'checking') return 'Checking'
  return 'Review'
}

function conclusionIcon(state: MonitorChainState) {
  if (state === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (state === 'attention') return <AlertTriangle className="h-4 w-4 text-amber-600" />
  if (state === 'checking')
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  return <Activity className="h-4 w-4 text-muted-foreground" />
}

function formatConclusionTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Updated —'
  return `Updated ${parsed.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`
}

function isServerConnected(connectionStatus: string): boolean {
  const normalized = connectionStatus.trim().toLowerCase()
  return normalized === 'online' || normalized === 'connected'
}

function inferMonitorAgentAction(
  status: Record<string, string> | null,
  statusError: string
): 'install' | 'upgrade' {
  if (status) return 'upgrade'
  const normalized = statusError.toLowerCase()
  if (
    normalized.includes('not found') ||
    normalized.includes('no such') ||
    normalized.includes('could not be found') ||
    normalized.includes('not installed')
  ) {
    return 'install'
  }
  return 'upgrade'
}

function useMonitorAgentStatus(serverId: string) {
  const [status, setStatus] = useState<Record<string, string> | null>(null)
  const [statusError, setStatusError] = useState('')
  const [loadingStatus, setLoadingStatus] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) return
    setLoadingStatus(true)
    setStatusError('')
    try {
      const response = await getSystemdStatus(serverId, 'netdata')
      setStatus(response.status)
    } catch (error) {
      setStatus(null)
      setStatusError(
        error instanceof Error ? error.message : 'Unable to read monitor agent service status'
      )
    } finally {
      setLoadingStatus(false)
    }
  }, [serverId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeState = String(status?.ActiveState || '').toLowerCase()
  const subState = String(status?.SubState || '')
  const connected = activeState === 'active' && !statusError
  const action = inferMonitorAgentAction(status, statusError)
  const actionLabel = action === 'install' ? 'Install monitor agent' : 'Fix monitor agent'
  const hint = loadingStatus
    ? 'Checking monitoring'
    : connected
      ? `Monitoring active${subState ? ` · ${subState}` : ''}`
      : 'Monitoring not connected'

  return {
    statusError,
    loadingStatus,
    connected,
    action,
    actionLabel,
    hint,
    refresh,
  }
}

export function ServerMonitorConclusions({
  serverName,
  connectionStatus,
  monitoringConnected,
  checkingMonitoring,
}: {
  serverName: string
  connectionStatus: string
  monitoringConnected: boolean
  checkingMonitoring: boolean
}) {
  const serverConnected = isServerConnected(connectionStatus)
  const conclusions = useMemo<MonitorConclusion[]>(() => {
    if (!checkingMonitoring && !monitoringConnected) {
      return []
    }
    const observedAt = new Date().toISOString()
    return [
      {
        id: 'control-reachability',
        label: 'Control reachable',
        state: serverConnected ? 'ok' : 'attention',
        summary: serverConnected
          ? 'AppOS can reach this server.'
          : 'Server access needs attention.',
        detail: serverConnected
          ? `${serverName} is reachable through the current server connection.`
          : `${serverName} may not be reachable. Repair the connection before relying on live operations.`,
        nextStep: serverConnected ? 'No action needed.' : 'Open the Connection tab and fix access.',
        observedAt,
      },
      {
        id: 'metrics-freshness',
        label: 'Trend data available',
        state: checkingMonitoring ? 'checking' : 'info',
        summary: checkingMonitoring
          ? 'Checking monitor data path.'
          : 'Use charts to confirm freshness.',
        detail: checkingMonitoring
          ? 'AppOS is checking whether the monitor agent can provide usable trend data.'
          : 'Trend cards on the left are the source of truth for whether data is current and complete.',
        nextStep: 'If charts stay empty or stale, open Components to verify monitor-agent.',
        observedAt,
      },
      {
        id: 'resource-pressure',
        label: 'Resource pressure',
        state: 'info',
        summary: 'Review current values and trends.',
        detail:
          'CPU, memory, disk, and network cards show the current pressure and recent direction.',
        nextStep: 'Investigate only when values are high, rising, or missing unexpectedly.',
        observedAt,
      },
    ]
  }, [checkingMonitoring, monitoringConnected, serverConnected, serverName])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const visibleConclusions = useMemo(
    () => conclusions.filter(item => !dismissedIds.has(item.id)),
    [conclusions, dismissedIds]
  )
  const selected = visibleConclusions.find(item => item.id === selectedId) ?? visibleConclusions[0]

  useEffect(() => {
    setDismissedIds(current => {
      const activeIds = new Set(conclusions.map(item => item.id))
      const next = new Set([...current].filter(id => activeIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [conclusions])

  useEffect(() => {
    if (visibleConclusions.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId(current =>
      current && visibleConclusions.some(item => item.id === current)
        ? current
        : visibleConclusions[0].id
    )
  }, [visibleConclusions])

  const dismissConclusion = useCallback((id: string) => {
    setDismissedIds(current => {
      const next = new Set(current)
      next.add(id)
      return next
    })
  }, [])

  return (
    <section
      className="max-h-[calc(100vh-50px)] self-start overflow-auto space-y-4 rounded-md border p-4"
      aria-label="Monitor conclusions"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Conclusions</h3>
        <p className="text-xs text-muted-foreground">
          Compact server insights from usable monitor signals.
        </p>
      </div>

      {conclusions.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">No conclusions yet.</div>
          <div className="mt-1">
            Monitoring data is required before AppOS can analyze this server.
          </div>
        </div>
      ) : visibleConclusions.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">All conclusions dismissed.</div>
          <div className="mt-1">Refresh monitor data to rebuild the conclusion list.</div>
        </div>
      ) : (
        <>
          <div className="space-y-1" role="list" aria-label="Monitor conclusion list">
            {visibleConclusions.map(item => {
              const active = selected?.id === item.id
              return (
                <div
                  key={item.id}
                  role="listitem"
                  className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                    active ? 'border-primary/40 bg-muted/50' : 'bg-background hover:bg-muted/30'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    aria-label={`Open conclusion ${item.label}`}
                  >
                    <span className="mt-0.5 shrink-0">{conclusionIcon(item.state)}</span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {item.label}
                        </span>
                        <Badge
                          variant={stateBadgeVariant(item.state)}
                          className="shrink-0 text-[11px]"
                        >
                          {stateLabel(item.state)}
                        </Badge>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.summary}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground/80">
                        {formatConclusionTime(item.observedAt)}
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 h-6 w-6 shrink-0 self-start"
                    aria-label={`Delete conclusion ${item.label}`}
                    title="Delete conclusion"
                    onClick={() => dismissConclusion(item.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </div>

          {selected ? (
            <Card>
              <CardHeader className="space-y-2 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {conclusionIcon(selected.state)}
                  {selected.label}
                </CardTitle>
                <CardDescription>{selected.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div className="text-xs text-muted-foreground/80">
                  {formatConclusionTime(selected.observedAt)}
                </div>
                <div>{selected.detail}</div>
                <div className="font-medium text-foreground">{selected.nextStep}</div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </section>
  )
}

export function ServerMonitorTab({
  serverId,
  serverName,
  connectionStatus,
  onOpenComponents,
  onMonitorAgentAction,
}: {
  serverId: string
  serverName: string
  connectionStatus: string
  onOpenComponents?: () => void
  onMonitorAgentAction?: (action: 'install' | 'upgrade' | 'reinstall') => void
}) {
  const monitorAgent = useMonitorAgentStatus(serverId)
  const [refreshKey, setRefreshKey] = useState(0)
  const monitoringNeedsIntervention = !monitorAgent.loadingStatus && !monitorAgent.connected
  const refreshAll = useCallback(() => {
    setRefreshKey(current => current + 1)
    void monitorAgent.refresh()
  }, [monitorAgent])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Monitor</h2>
          <p className="text-sm text-muted-foreground">
            Review current resource signals, trend history, and compact server conclusions.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          {monitorAgent.loadingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <span>{monitorAgent.hint}</span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={refreshAll}
            disabled={monitorAgent.loadingStatus}
            aria-label="Refresh monitor data"
            title="Refresh monitor data"
          >
            {monitorAgent.loadingStatus ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {monitoringNeedsIntervention ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">Monitoring is not connected on this server.</div>
              <div className="mt-1 text-sm">
                Install or repair the monitor agent from Components before relying on monitor data.
                {monitorAgent.statusError ? ` ${monitorAgent.statusError}` : ''}
              </div>
            </div>
            {onMonitorAgentAction ? (
              <Button
                type="button"
                size="sm"
                onClick={() => onMonitorAgentAction(monitorAgent.action)}
                className="shrink-0"
              >
                {monitorAgent.actionLabel}
              </Button>
            ) : onOpenComponents ? (
              <Button type="button" size="sm" onClick={onOpenComponents} className="shrink-0">
                Open Components
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-4" aria-label="Monitor current values and trend history">
          <MonitorTargetPanel
            targetType="server"
            targetId={serverId}
            emptyMessage={`No monitoring data available yet for ${serverName}. Current connectivity status is ${connectionStatus}.`}
            layout="detail"
            refreshKey={refreshKey}
            metricsPipelineAction={
              onMonitorAgentAction
                ? {
                    label: 'Repair monitor agent',
                    description: 'Rewrites remote-write credentials and restarts Netdata.',
                    onClick: () => onMonitorAgentAction('reinstall'),
                  }
                : onOpenComponents
                  ? {
                      label: 'Open Components',
                      description: 'Use Repair on the Netdata Agent addon.',
                      onClick: onOpenComponents,
                    }
                  : undefined
            }
          />
        </section>
        <ServerMonitorConclusions
          serverName={serverName}
          connectionStatus={connectionStatus}
          monitoringConnected={monitorAgent.connected}
          checkingMonitoring={monitorAgent.loadingStatus}
        />
      </div>
    </div>
  )
}
