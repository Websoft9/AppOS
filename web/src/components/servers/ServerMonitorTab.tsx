import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MonitorTargetPanel } from '@/components/monitor/MonitorTargetPanel'
import { getSystemdStatus } from '@/lib/connect-api'
import { getLocale } from '@/lib/i18n'
import { pb } from '@/lib/pb'

const MONITOR_COLLECTOR_SERVICE = 'appos-monitor.service'
const noAutoCancel = { requestKey: null }

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

type MonitorTargetStatusSummary = {
  monitoringState: string
  hasData: boolean
  reason: string
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function stateBadgeVariant(
  state: MonitorChainState
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (state === 'ok') return 'default'
  if (state === 'attention') return 'destructive'
  if (state === 'checking') return 'secondary'
  return 'outline'
}

function stateLabel(state: MonitorChainState, t: Translate): string {
  if (state === 'ok') return t('servers.monitorTab.state.ok')
  if (state === 'attention') return t('servers.monitorTab.state.attention')
  if (state === 'checking') return t('servers.monitorTab.state.checking')
  return t('servers.monitorTab.state.review')
}

function conclusionIcon(state: MonitorChainState) {
  if (state === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (state === 'attention') return <AlertTriangle className="h-4 w-4 text-amber-600" />
  if (state === 'checking')
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  return <Activity className="h-4 w-4 text-muted-foreground" />
}

function formatConclusionTime(value: string, t: Translate): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return t('servers.monitorTab.time.updatedUnknown')
  return t('servers.monitorTab.time.updatedAt', {
    time: parsed.toLocaleTimeString(getLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  })
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

function monitorTargetSummaryFromResponse(response: unknown): MonitorTargetStatusSummary {
  const payload =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {}
  const summary =
    payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
      ? (payload.summary as Record<string, unknown>)
      : {}
  return {
    monitoringState: String(summary.monitoring_state ?? '')
      .trim()
      .toLowerCase(),
    hasData: Boolean(payload.hasData),
    reason: String(payload.reason ?? '')
      .trim()
      .toLowerCase(),
  }
}

function useMonitorTargetSummary(serverId: string) {
  const [summary, setSummary] = useState<MonitorTargetStatusSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setSummary(null)
      return
    }
    setLoading(true)
    try {
      const response = await pb.send(
        `/api/monitor/targets/server/${encodeURIComponent(serverId)}`,
        { method: 'GET', ...noAutoCancel }
      )
      setSummary(monitorTargetSummaryFromResponse(response))
    } catch {
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { summary, loading, refresh }
}

function useMonitorAgentStatus(serverId: string, t: Translate) {
  const [status, setStatus] = useState<Record<string, string> | null>(null)
  const [statusError, setStatusError] = useState('')
  const [loadingStatus, setLoadingStatus] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) return
    setLoadingStatus(true)
    setStatusError('')
    try {
      const response = await getSystemdStatus(serverId, MONITOR_COLLECTOR_SERVICE)
      setStatus(response.status)
    } catch (error) {
      setStatus(null)
      setStatusError(
        error instanceof Error
          ? error.message
          : t('servers.monitorTab.errors.collectorStatusUnavailable')
      )
    } finally {
      setLoadingStatus(false)
    }
  }, [serverId, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeState = String(status?.ActiveState || '').toLowerCase()
  const subState = String(status?.SubState || '')
  const connected = activeState === 'active' && !statusError
  const action = inferMonitorAgentAction(status, statusError)
  const actionLabel =
    action === 'install'
      ? t('servers.monitorTab.actions.installMonitorAgent')
      : t('servers.monitorTab.actions.fixMonitorAgent')

  return {
    statusError,
    loadingStatus,
    connected,
    action,
    actionLabel,
    subState,
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
  const { t } = useTranslation('resources')
  const serverConnected = isServerConnected(connectionStatus)
  const conclusions = useMemo<MonitorConclusion[]>(() => {
    if (!checkingMonitoring && !monitoringConnected) {
      return []
    }
    const observedAt = new Date().toISOString()
    return [
      {
        id: 'control-reachability',
        label: t('servers.monitorTab.conclusions.controlReachable.label'),
        state: serverConnected ? 'ok' : 'attention',
        summary: serverConnected
          ? t('servers.monitorTab.conclusions.controlReachable.summaryOk')
          : t('servers.monitorTab.conclusions.controlReachable.summaryAttention'),
        detail: serverConnected
          ? t('servers.monitorTab.conclusions.controlReachable.detailOk', { name: serverName })
          : t('servers.monitorTab.conclusions.controlReachable.detailAttention', {
              name: serverName,
            }),
        nextStep: serverConnected
          ? t('servers.monitorTab.conclusions.controlReachable.nextOk')
          : t('servers.monitorTab.conclusions.controlReachable.nextAttention'),
        observedAt,
      },
      {
        id: 'metrics-freshness',
        label: t('servers.monitorTab.conclusions.trendDataAvailable.label'),
        state: checkingMonitoring ? 'checking' : 'info',
        summary: checkingMonitoring
          ? t('servers.monitorTab.conclusions.trendDataAvailable.summaryChecking')
          : t('servers.monitorTab.conclusions.trendDataAvailable.summaryReady'),
        detail: checkingMonitoring
          ? t('servers.monitorTab.conclusions.trendDataAvailable.detailChecking')
          : t('servers.monitorTab.conclusions.trendDataAvailable.detailReady'),
        nextStep: t('servers.monitorTab.conclusions.trendDataAvailable.nextStep'),
        observedAt,
      },
      {
        id: 'resource-pressure',
        label: t('servers.monitorTab.conclusions.resourcePressure.label'),
        state: 'info',
        summary: t('servers.monitorTab.conclusions.resourcePressure.summary'),
        detail: t('servers.monitorTab.conclusions.resourcePressure.detail'),
        nextStep: t('servers.monitorTab.conclusions.resourcePressure.nextStep'),
        observedAt,
      },
    ]
  }, [checkingMonitoring, monitoringConnected, serverConnected, serverName, t])
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
      aria-label={t('servers.monitorTab.conclusions.regionLabel')}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t('servers.monitorTab.conclusions.title')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('servers.monitorTab.conclusions.subtitle')}
        </p>
      </div>

      {conclusions.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">
            {t('servers.monitorTab.conclusions.emptyTitle')}
          </div>
          <div className="mt-1">
            {t('servers.monitorTab.conclusions.emptyBody')}
          </div>
        </div>
      ) : visibleConclusions.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">
            {t('servers.monitorTab.conclusions.dismissedTitle')}
          </div>
          <div className="mt-1">{t('servers.monitorTab.conclusions.dismissedBody')}</div>
        </div>
      ) : (
        <>
          <div
            className="space-y-1"
            role="list"
            aria-label={t('servers.monitorTab.conclusions.listLabel')}
          >
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
                    aria-label={t('servers.monitorTab.conclusions.openItem', { label: item.label })}
                  >
                    <span className="mt-0.5 shrink-0">{conclusionIcon(item.state)}</span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.summary}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground/80">
                        {formatConclusionTime(item.observedAt, t)}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 self-start pt-0.5">
                    <Badge variant={stateBadgeVariant(item.state)} className="shrink-0 text-[11px]">
                      {stateLabel(item.state, t)}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      aria-label={t('servers.monitorTab.conclusions.deleteItem', { label: item.label })}
                      title={t('servers.monitorTab.conclusions.deleteTitle')}
                      onClick={() => dismissConclusion(item.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
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
                  {formatConclusionTime(selected.observedAt, t)}
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
  const { t } = useTranslation('resources')
  const monitorAgent = useMonitorAgentStatus(serverId, t)
  const monitorTarget = useMonitorTargetSummary(serverId)
  const awaitingFirstSample =
    monitorTarget.summary?.monitoringState === 'awaiting_control_plane_pull' ||
    (!monitorTarget.summary?.hasData &&
      monitorTarget.summary?.reason === 'server monitoring has not collected evidence yet')
  const hasMonitorData = monitorTarget.summary?.hasData === true
  const monitorEmptyMessage = hasMonitorData
    ? undefined
    : t('servers.monitorTab.empty.noDataYet', {
        name: serverName,
        status: connectionStatus,
      })
  const monitoringConnected = monitorAgent.connected || hasMonitorData || awaitingFirstSample
  const monitoringNeedsIntervention =
    !monitorAgent.loadingStatus && !monitorTarget.loading && !monitoringConnected
  const monitorHint = monitorAgent.loadingStatus
    ? t('servers.monitorTab.hints.checking')
    : awaitingFirstSample
      ? t('servers.monitorTab.hints.awaitingFirstSample')
      : monitoringConnected
        ? t('servers.monitorTab.hints.active', {
            subState:
              monitorAgent.connected && monitorAgent.subState
                ? ` · ${monitorAgent.subState}`
                : '',
          })
        : t('servers.monitorTab.hints.notConnected')
  const refreshMonitorStatus = useCallback(() => {
    void monitorAgent.refresh()
    void monitorTarget.refresh()
  }, [monitorAgent, monitorTarget])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t('servers.monitorTab.heading')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('servers.monitorTab.description')}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          {monitorAgent.loadingStatus || monitorTarget.loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          <span>{monitorHint}</span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={refreshMonitorStatus}
            disabled={monitorAgent.loadingStatus || monitorTarget.loading}
            aria-label={t('servers.monitorTab.actions.refreshStatus')}
            title={t('servers.monitorTab.actions.refreshStatus')}
          >
            {monitorAgent.loadingStatus || monitorTarget.loading ? (
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
              <div className="font-medium">{t('servers.monitorTab.alert.notConnectedTitle')}</div>
              <div className="mt-1 text-sm">
                {t('servers.monitorTab.alert.notConnectedBody')}
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
                {t('servers.monitorTab.actions.openComponents')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section
          className="space-y-4"
          aria-label={t('servers.monitorTab.currentValuesRegion')}
        >
          <MonitorTargetPanel
            targetType="server"
            targetId={serverId}
            emptyMessage={monitorEmptyMessage}
            layout="detail"
            metricsPipelineAction={
              onMonitorAgentAction
                ? {
                    label: t('servers.monitorTab.actions.repairMonitorAgent'),
                    description: t('servers.monitorTab.actions.repairMonitorAgentDescription'),
                    onClick: () => onMonitorAgentAction('reinstall'),
                  }
                : onOpenComponents
                  ? {
                      label: t('servers.monitorTab.actions.openComponents'),
                      description: t('servers.monitorTab.actions.openComponentsDescription'),
                      onClick: onOpenComponents,
                    }
                  : undefined
            }
          />
        </section>
        <ServerMonitorConclusions
          serverName={serverName}
          connectionStatus={connectionStatus}
          monitoringConnected={monitoringConnected}
          checkingMonitoring={monitorAgent.loadingStatus || monitorTarget.loading}
        />
      </div>
    </div>
  )
}
