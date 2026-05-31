import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { pb } from '@/lib/pb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TimeSeriesChart } from '@/components/monitor/TimeSeriesChart'

const noAutoCancel = { requestKey: null }

type MonitorSeriesWindow =
  | '1m'
  | '5m'
  | '15m'
  | '0.5h'
  | '1h'
  | '5h'
  | '12h'
  | '24h'
  | '7d'
  | 'custom'

type CustomRangeState = {
  startLocal: string
  endLocal: string
}

type MonitorTargetResponse = {
  hasData: boolean
  targetType: string
  targetId: string
  displayName: string
  status: string
  reason: string | null
  signalSource: string
  lastTransitionAt: string
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastCheckedAt: string | null
  lastReportedAt: string | null
  consecutiveFailures: number
  summary?: Record<string, unknown>
}

type MonitorSeriesResponse = {
  targetType: string
  targetId: string
  window: string
  rangeStartAt?: string
  rangeEndAt?: string
  stepSeconds?: number
  availableNetworkInterfaces?: string[]
  selectedNetworkInterface?: string
  series: Array<{
    name: string
    unit: string
    points?: number[][]
    segments?: Array<{
      name: string
      points: number[][]
    }>
    metadata?: Record<string, string>
  }>
}

type MonitorLatestResponse = {
  targetType: string
  targetId: string
  cadenceSeconds?: number
  availableNetworkInterfaces?: string[]
  selectedNetworkInterface?: string
  series: Array<{
    name: string
    unit: string
    points?: number[][]
    segments?: Array<{
      name: string
      points: number[][]
    }>
    metadata?: Record<string, string>
  }>
}

type MonitorSeriesItem = MonitorSeriesResponse['series'][number]

const SERIES_WINDOWS = [
  {
    value: '1m',
    label: '1m',
    description: 'Last minute trends from the monitoring time-series backend.',
  },
  {
    value: '5m',
    label: '5m',
    description: 'Last five minutes trends from the monitoring time-series backend.',
  },
  {
    value: '15m',
    label: '15m',
    description: 'Last fifteen minutes trends from the monitoring time-series backend.',
  },
  {
    value: '0.5h',
    label: '0.5h',
    description: 'Last half hour trends from the monitoring time-series backend.',
  },
  {
    value: '1h',
    label: '1h',
    description: 'Last hour trends from the monitoring time-series backend.',
  },
  {
    value: '5h',
    label: '5h',
    description: 'Last five hours trends from the monitoring time-series backend.',
  },
  {
    value: '12h',
    label: '12h',
    description: 'Last twelve hours trends from the monitoring time-series backend.',
  },
  {
    value: '24h',
    label: '24h',
    description: 'Last 24 hours trends from the monitoring time-series backend.',
  },
  {
    value: '7d',
    label: '7d',
    description: 'Last seven days trends from the monitoring time-series backend.',
  },
  { value: 'custom', label: 'custom', description: 'Custom trends for a chosen time range.' },
] as const

const LIVE_SERIES_INTERVAL_MS = 2000
const DEFAULT_AGENT_METRIC_CADENCE_MS = 10000
const DEFAULT_SERIES_QUERY = 'cpu,memory'
const EXTENDED_SERIES_QUERY = 'cpu,memory,disk_usage,disk,network'
const NETWORK_TRAFFIC_SERIES_QUERY = 'network_traffic'
const LATEST_STAT_ORDER = ['cpu', 'memory', 'disk_usage', 'disk', 'network', 'network_traffic']
const LIVE_SERIES_WINDOWS: ReadonlySet<MonitorSeriesWindow> = new Set(['1m', '5m', '15m'])
function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function toLocalDateTimeInputValue(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function createDefaultCustomRange(): CustomRangeState {
  const end = new Date()
  const start = new Date(end.getTime() - 60 * 60 * 1000)
  return {
    startLocal: toLocalDateTimeInputValue(start),
    endLocal: toLocalDateTimeInputValue(end),
  }
}

function parseLocalDateTime(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isValidCustomRange(range: CustomRangeState): boolean {
  const start = parseLocalDateTime(range.startLocal)
  const end = parseLocalDateTime(range.endLocal)
  return start !== null && end !== null && end.getTime() > start.getTime()
}

function toUtcIsoString(value: string): string | null {
  const parsed = parseLocalDateTime(value)
  return parsed ? parsed.toISOString() : null
}

function formatCustomRangeDescription(range: CustomRangeState): string {
  const start = parseLocalDateTime(range.startLocal)
  const end = parseLocalDateTime(range.endLocal)
  if (!start || !end || end.getTime() <= start.getTime()) {
    return 'Choose a valid custom trend range.'
  }
  return `Custom trends from ${start.toLocaleString()} to ${end.toLocaleString()}.`
}

function formatCustomRangeLabel(range: CustomRangeState): string {
  const start = parseLocalDateTime(range.startLocal)
  const end = parseLocalDateTime(range.endLocal)
  if (!start || !end || end.getTime() <= start.getTime()) {
    return 'custom'
  }
  const sameDay = start.toDateString() === end.toDateString()
  const startText = start.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const endText = end.toLocaleString(
    undefined,
    sameDay
      ? {
          hour: '2-digit',
          minute: '2-digit',
        }
      : {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }
  )
  return `${startText} - ${endText}`
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let current = value / 1024
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatRateBytes(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const units = ['KB', 'MB', 'GB', 'TB']
  let current = value / 1024
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDurationSeconds(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value < 60) return `${Math.round(value)}s`
  if (value < 3600) return `${Math.round(value / 60)}m`
  if (value < 86400) return `${(value / 3600).toFixed(value >= 36000 ? 0 : 1)}h`
  return `${(value / 86400).toFixed(value >= 864000 ? 0 : 1)}d`
}

function formatLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'cpu') return 'CPU'
  if (normalized === 'disk') return 'Disk IO'
  if (normalized === 'network') return 'Network Speed'
  if (normalized === 'network_traffic') return 'Network Traffic'

  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatStatusLabel(status: string): string {
  return formatLabel(status)
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    if (key.endsWith('_bytes')) return formatBytes(value)
    if (key.endsWith('_seconds')) return formatDurationSeconds(value)
    if (String(value).includes('.')) return value.toFixed(2)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime()) && value.includes('T')) return date.toLocaleString()
    return value
  }
  return JSON.stringify(value)
}

function formatTrendValue(unit: string, name: string, value: number): string {
  if (unit === 'bytes') return formatValue(`${name}_bytes`, value)
  if (unit === 'bytes/s') return `${formatRateBytes(value)}/s`
  if (unit === 'GB') return `${value.toFixed(value >= 10 ? 1 : 2)} GB`
  return formatValue(name, value)
}

function supportsExtendedResourceSeries(targetType: string, targetId: string): boolean {
  return targetType === 'server' || (targetType === 'platform' && targetId === 'appos-core')
}

function supportsNetworkInterfaceSelection(targetType: string, targetId: string): boolean {
  return targetType === 'server' || (targetType === 'platform' && targetId === 'appos-core')
}

function seriesQueryForTarget(
  targetType: string,
  targetId: string,
  options?: { includeNetworkTraffic?: boolean }
): string {
  if (supportsExtendedResourceSeries(targetType, targetId)) {
    return options?.includeNetworkTraffic === false
      ? EXTENDED_SERIES_QUERY
      : `${EXTENDED_SERIES_QUERY},${NETWORK_TRAFFIC_SERIES_QUERY}`
  }
  return DEFAULT_SERIES_QUERY
}

function normalizeSeriesResponse(response: MonitorSeriesResponse, series: MonitorSeriesItem[]) {
  return {
    ...response,
    series,
  }
}

function mergeTrendSeries(
  primarySeries: MonitorSeriesResponse | null,
  networkTrafficSeries: MonitorSeriesResponse | null
): MonitorSeriesItem[] {
  const merged = (primarySeries?.series ?? []).filter(item => item.name !== 'network_traffic')
  const networkTrafficItems = (networkTrafficSeries?.series ?? []).filter(
    item => item.name === 'network_traffic'
  )

  return [...merged, ...networkTrafficItems]
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'healthy':
      return 'default'
    case 'offline':
    case 'unreachable':
    case 'credential_invalid':
      return 'destructive'
    case 'degraded':
      return 'outline'
    default:
      return 'secondary'
  }
}

function seriesHasUsableData(seriesResponse: MonitorSeriesResponse | null): boolean {
  if (!seriesResponse?.series?.length) return false

  return seriesResponse.series.some(item => {
    if (Array.isArray(item.points) && item.points.length > 0) {
      return true
    }
    if (Array.isArray(item.segments) && item.segments.some(segment => segment.points.length > 0)) {
      return true
    }
    return false
  })
}

function monitorMetricsPipelineWarning(
  data: MonitorTargetResponse | null,
  hasUsableSeriesData: boolean
): string | null {
  if (!data) return null
  const status = String(data.status ?? '')
    .trim()
    .toLowerCase()
  const reason = String(data.reason ?? '')
    .trim()
    .toLowerCase()
  const metricsFreshnessState = String(data.summary?.metrics_freshness_state ?? '')
    .trim()
    .toLowerCase()
  const metricsReasonCode = String(data.summary?.metrics_reason_code ?? '')
    .trim()
    .toLowerCase()

  const missingMetrics =
    reason.includes('metrics missing') ||
    metricsFreshnessState === 'missing' ||
    metricsReasonCode === 'metrics_missing'

  if (!missingMetrics || hasUsableSeriesData) return null

  if (status === 'unknown' || status === 'degraded' || status === 'healthy') {
    return 'AppOS is not receiving usable metrics from this target. This usually indicates a monitor write-path or credential problem, not a chart rendering issue.'
  }

  return null
}

export function MonitorTargetPanel({
  targetType,
  targetId,
  emptyMessage,
  layout = 'default',
  refreshKey = 0,
  metricsPipelineAction,
}: {
  targetType: string
  targetId: string
  emptyMessage?: string
  layout?: 'default' | 'detail'
  refreshKey?: number
  metricsPipelineAction?: {
    label: string
    description?: string
    onClick: () => void
  }
}) {
  const [documentVisible, setDocumentVisible] = useState(isDocumentVisible)
  const previousDocumentVisible = useRef(documentVisible)
  const [data, setData] = useState<MonitorTargetResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [series, setSeries] = useState<MonitorSeriesResponse | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [networkTrafficSeries, setNetworkTrafficSeries] = useState<MonitorSeriesResponse | null>(
    null
  )
  const [networkTrafficLoading, setNetworkTrafficLoading] = useState(false)
  const [latestStats, setLatestStats] = useState<MonitorLatestResponse | null>(null)
  const [latestStatsLoading, setLatestStatsLoading] = useState(false)
  const [selectedWindow, setSelectedWindow] = useState<MonitorSeriesWindow>('1h')
  const [selectedTrendNetworkInterface, setSelectedTrendNetworkInterface] = useState('all')
  const [draftCustomRange, setDraftCustomRange] = useState<CustomRangeState>(() =>
    createDefaultCustomRange()
  )
  const [appliedCustomRange, setAppliedCustomRange] = useState<CustomRangeState>(() =>
    createDefaultCustomRange()
  )
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const detailLayout = layout === 'detail'

  const load = useCallback(
    async (silent = false) => {
      if (!targetId) return
      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError('')
      try {
        const response = await pb.send<MonitorTargetResponse>(
          `/api/monitor/targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
          { method: 'GET', ...noAutoCancel }
        )
        setData(response)
      } catch (err) {
        setData(null)
        setError(err instanceof Error ? err.message : 'Failed to load monitor target')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [targetId, targetType]
  )

  const loadSeries = useCallback(async () => {
    if (
      !targetId ||
      (targetType !== 'server' && targetType !== 'platform' && targetType !== 'app')
    ) {
      setSeries(null)
      return
    }

    const params = new URLSearchParams({
      window: selectedWindow,
      series: seriesQueryForTarget(targetType, targetId, { includeNetworkTraffic: false }),
    })
    if (selectedWindow === 'custom') {
      const startAt = toUtcIsoString(appliedCustomRange.startLocal)
      const endAt = toUtcIsoString(appliedCustomRange.endLocal)
      if (!startAt || !endAt || !isValidCustomRange(appliedCustomRange)) {
        setSeries(null)
        return
      }
      params.set('startAt', startAt)
      params.set('endAt', endAt)
    }

    setSeriesLoading(true)
    try {
      const response = await pb.send<MonitorSeriesResponse>(
        `/api/monitor/targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/series?${params.toString()}`,
        { method: 'GET', ...noAutoCancel }
      )
      setSeries(
        normalizeSeriesResponse(response, Array.isArray(response.series) ? response.series : [])
      )
    } catch {
      setSeries(null)
    } finally {
      setSeriesLoading(false)
    }
  }, [appliedCustomRange, selectedWindow, targetId, targetType])

  const loadNetworkTrafficSeries = useCallback(async () => {
    if (
      !targetId ||
      !supportsNetworkInterfaceSelection(targetType, targetId) ||
      (targetType !== 'server' && targetType !== 'platform' && targetType !== 'app')
    ) {
      setNetworkTrafficSeries(null)
      return
    }

    const params = new URLSearchParams({
      window: selectedWindow,
      series: NETWORK_TRAFFIC_SERIES_QUERY,
    })
    if (selectedWindow === 'custom') {
      const startAt = toUtcIsoString(appliedCustomRange.startLocal)
      const endAt = toUtcIsoString(appliedCustomRange.endLocal)
      if (!startAt || !endAt || !isValidCustomRange(appliedCustomRange)) {
        setNetworkTrafficSeries(null)
        return
      }
      params.set('startAt', startAt)
      params.set('endAt', endAt)
    }
    if (selectedTrendNetworkInterface !== 'all') {
      params.set('networkInterface', selectedTrendNetworkInterface)
    }

    setNetworkTrafficLoading(true)
    try {
      const response = await pb.send<MonitorSeriesResponse>(
        `/api/monitor/targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/series?${params.toString()}`,
        { method: 'GET', ...noAutoCancel }
      )
      if (
        response.selectedNetworkInterface &&
        response.selectedNetworkInterface !== selectedTrendNetworkInterface
      ) {
        setSelectedTrendNetworkInterface(response.selectedNetworkInterface)
      }
      setNetworkTrafficSeries(
        normalizeSeriesResponse(
          response,
          Array.isArray(response.series)
            ? response.series.filter(item => item.name === 'network_traffic')
            : []
        )
      )
    } catch {
      setNetworkTrafficSeries(null)
    } finally {
      setNetworkTrafficLoading(false)
    }
  }, [appliedCustomRange, selectedTrendNetworkInterface, selectedWindow, targetId, targetType])

  const loadLatestStats = useCallback(async () => {
    if (
      !targetId ||
      (targetType !== 'server' && targetType !== 'platform' && targetType !== 'app')
    ) {
      setLatestStats(null)
      return
    }

    const params = new URLSearchParams({
      series: seriesQueryForTarget(targetType, targetId),
    })
    if (
      supportsNetworkInterfaceSelection(targetType, targetId) &&
      selectedTrendNetworkInterface !== 'all'
    ) {
      params.set('networkInterface', selectedTrendNetworkInterface)
    }

    setLatestStatsLoading(true)
    try {
      const response = await pb.send<MonitorLatestResponse>(
        `/api/monitor/targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/latest?${params.toString()}`,
        { method: 'GET', ...noAutoCancel }
      )
      if (
        response.selectedNetworkInterface &&
        response.selectedNetworkInterface !== selectedTrendNetworkInterface
      ) {
        setSelectedTrendNetworkInterface(response.selectedNetworkInterface)
      }
      setLatestStats({
        ...response,
        series: Array.isArray(response.series) ? response.series : [],
      })
    } catch {
      setLatestStats(null)
    } finally {
      setLatestStatsLoading(false)
    }
  }, [selectedTrendNetworkInterface, targetId, targetType])

  const selectedWindowMeta =
    selectedWindow === 'custom'
      ? {
          value: 'custom' as const,
          label: formatCustomRangeLabel(appliedCustomRange),
          description: formatCustomRangeDescription(appliedCustomRange),
        }
      : (SERIES_WINDOWS.find(window => window.value === selectedWindow) ?? SERIES_WINDOWS[0])

  const customRangeDirty =
    draftCustomRange.startLocal !== appliedCustomRange.startLocal ||
    draftCustomRange.endLocal !== appliedCustomRange.endLocal
  const trendSeries = mergeTrendSeries(series, networkTrafficSeries)
  const availableTrendNetworkInterfaces =
    networkTrafficSeries?.availableNetworkInterfaces ?? series?.availableNetworkInterfaces

  const handleRefresh = useCallback(async () => {
    await Promise.all([load(true), loadSeries(), loadNetworkTrafficSeries(), loadLatestStats()])
  }, [load, loadLatestStats, loadNetworkTrafficSeries, loadSeries])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

  useEffect(() => {
    void loadNetworkTrafficSeries()
  }, [loadNetworkTrafficSeries])

  useEffect(() => {
    void loadLatestStats()
  }, [loadLatestStats])

  useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(isDocumentVisible())
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    if (!detailLayout || !documentVisible || !LIVE_SERIES_WINDOWS.has(selectedWindow)) return
    const interval = window.setInterval(() => {
      void Promise.all([loadSeries(), loadNetworkTrafficSeries()])
    }, LIVE_SERIES_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [detailLayout, documentVisible, loadNetworkTrafficSeries, loadSeries, selectedWindow])

  useEffect(() => {
    if (!detailLayout || !documentVisible) return
    const interval = window.setInterval(
      () => {
        void loadLatestStats()
      },
      Math.max((latestStats?.cadenceSeconds ?? DEFAULT_AGENT_METRIC_CADENCE_MS / 1000) * 1000, 1000)
    )
    return () => window.clearInterval(interval)
  }, [detailLayout, documentVisible, latestStats?.cadenceSeconds, loadLatestStats])

  useEffect(() => {
    const becameVisible = !previousDocumentVisible.current && documentVisible
    previousDocumentVisible.current = documentVisible
    if (!becameVisible || !detailLayout) return
    void Promise.all([loadSeries(), loadNetworkTrafficSeries(), loadLatestStats()])
  }, [detailLayout, documentVisible, loadLatestStats, loadNetworkTrafficSeries, loadSeries])

  useEffect(() => {
    if (refreshKey > 0) {
      void handleRefresh()
    }
  }, [handleRefresh, refreshKey])

  useEffect(() => {
    setSelectedTrendNetworkInterface('all')
  }, [targetId, targetType])

  useEffect(() => {
    setCustomRangeOpen(false)
  }, [targetId, targetType])

  const summaryEntries = Object.entries(data?.summary ?? {})
  const latestStatItems = useMemo(() => {
    const items = buildLatestStatItems(latestStats?.series ?? []).filter(
      item =>
        !['cpu', 'memory'].includes(item.key) ||
        hasUsableSeriesData((latestStats?.series ?? []).find(series => series.name === item.key))
    )
    if (!data?.summary) return items
    const existingKeys = new Set(items.map(item => item.key))
    const fallback = buildSummaryFallbackLatestStatItems(data.summary).filter(
      item => !existingKeys.has(item.key)
    )
    if (fallback.length === 0) return items
    return LATEST_STAT_ORDER.map(
      name => items.find(item => item.key === name) ?? fallback.find(item => item.key === name)
    ).filter((item): item is LatestStatItem => Boolean(item))
  }, [data?.summary, latestStats?.series])
  const latestStatUpdatedAt = latestStatsUpdatedAt(latestStats?.series ?? [])
  const hasTrendSeries = trendSeries.length > 0
  const pipelineWarning = monitorMetricsPipelineWarning(
    data,
    seriesHasUsableData(series) || seriesHasUsableData(networkTrafficSeries)
  )

  if (detailLayout) {
    return (
      <div className="space-y-4">
        {error ? (
          <Alert>
            <AlertDescription>{emptyMessage || error}</AlertDescription>
          </Alert>
        ) : null}

        {pipelineWarning ? (
          <Alert>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{pipelineWarning}</span>
              {metricsPipelineAction ? (
                <span className="flex shrink-0 flex-col gap-1 sm:items-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={metricsPipelineAction.onClick}
                    className="h-7 px-2 text-xs"
                  >
                    {metricsPipelineAction.label}
                  </Button>
                  {metricsPipelineAction.description ? (
                    <span className="text-[10px] text-muted-foreground">
                      {metricsPipelineAction.description}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-sm">Latest Stat</CardTitle>
              <CardDescription>
                {data?.hasData
                  ? data.reason || 'Latest observed values sampled by the monitoring agent.'
                  : 'Unavailable until monitoring data is connected.'}
              </CardDescription>
            </div>
            <div className="shrink-0 rounded-md border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
              {formatUpdatedAtText(latestStatUpdatedAt)}
            </div>
          </CardHeader>
          <CardContent>
            {loading || (latestStatsLoading && latestStatItems.length === 0) ? (
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading latest stats...
              </div>
            ) : latestStatItems.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                {emptyMessage || 'Latest stats are unavailable until monitoring data arrives.'}
              </div>
            ) : (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
                {latestStatItems.map(item => (
                  <LatestStatCard key={item.key} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-sm">Trend History</CardTitle>
              <CardDescription>{selectedWindowMeta.description}</CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div
                className="inline-flex flex-wrap items-center rounded-lg border bg-muted/20 p-1"
                role="tablist"
                aria-label="trend window selector"
              >
                {SERIES_WINDOWS.filter(window => window.value !== 'custom').map(window => {
                  const active = window.value === selectedWindow
                  return (
                    <Button
                      key={window.value}
                      type="button"
                      size="xs"
                      variant={active ? 'secondary' : 'ghost'}
                      aria-pressed={active}
                      onClick={() => setSelectedWindow(window.value)}
                    >
                      {window.label}
                    </Button>
                  )
                })}
                <Popover open={customRangeOpen} onOpenChange={setCustomRangeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      size="xs"
                      variant={selectedWindow === 'custom' ? 'secondary' : 'ghost'}
                      aria-pressed={selectedWindow === 'custom'}
                    >
                      {selectedWindow === 'custom'
                        ? formatCustomRangeLabel(appliedCustomRange)
                        : 'custom'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] space-y-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Custom time range</div>
                      <div className="text-xs text-muted-foreground">
                        Choose start and end time, then apply them to the current trend charts.
                      </div>
                    </div>
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
                      <label className="space-y-1 text-sm">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          Start
                        </span>
                        <Input
                          aria-label="Trend range start"
                          type="datetime-local"
                          value={draftCustomRange.startLocal}
                          onChange={event =>
                            setDraftCustomRange(current => ({
                              ...current,
                              startLocal: event.target.value,
                            }))
                          }
                          max={draftCustomRange.endLocal || undefined}
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          End
                        </span>
                        <Input
                          aria-label="Trend range end"
                          type="datetime-local"
                          value={draftCustomRange.endLocal}
                          onChange={event =>
                            setDraftCustomRange(current => ({
                              ...current,
                              endLocal: event.target.value,
                            }))
                          }
                          min={draftCustomRange.startLocal || undefined}
                        />
                      </label>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        {formatCustomRangeDescription(draftCustomRange)}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setAppliedCustomRange(draftCustomRange)
                          setSelectedWindow('custom')
                          setCustomRangeOpen(false)
                        }}
                        disabled={
                          !isValidCustomRange(draftCustomRange) ||
                          (selectedWindow === 'custom' && !customRangeDirty)
                        }
                      >
                        Apply
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!hasTrendSeries ? (
              <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                {emptyMessage || 'Trend history is unavailable until monitoring data arrives.'}
              </div>
            ) : (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
                {trendSeries.map(item => (
                  <TrendCard
                    key={item.name}
                    name={item.name}
                    unit={item.unit}
                    window={selectedWindow}
                    points={item.points ?? []}
                    segments={item.segments}
                    metadata={item.metadata}
                    rangeStartAt={
                      item.name === 'network_traffic'
                        ? networkTrafficSeries?.rangeStartAt
                        : series?.rangeStartAt
                    }
                    rangeEndAt={
                      item.name === 'network_traffic'
                        ? networkTrafficSeries?.rangeEndAt
                        : series?.rangeEndAt
                    }
                    stepSeconds={
                      item.name === 'network_traffic'
                        ? networkTrafficSeries?.stepSeconds
                        : series?.stepSeconds
                    }
                    availableNetworkInterfaces={
                      item.name === 'network' || item.name === 'network_traffic'
                        ? availableTrendNetworkInterfaces
                        : undefined
                    }
                    selectedNetworkInterface={
                      item.name === 'network' || item.name === 'network_traffic'
                        ? selectedTrendNetworkInterface
                        : undefined
                    }
                    onNetworkInterfaceChange={
                      item.name === 'network_traffic' ? setSelectedTrendNetworkInterface : undefined
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Monitor Status</h3>
          <p className="text-sm text-muted-foreground">
            Latest normalized monitoring state for this target.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleRefresh()}
          disabled={
            loading ||
            refreshing ||
            seriesLoading ||
            networkTrafficLoading ||
            latestStatsLoading ||
            !targetId
          }
        >
          {loading || refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert>
          <AlertDescription>{emptyMessage || error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="rounded-lg border bg-muted/10 p-4 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading monitor status...
        </div>
      ) : data ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span>{data.displayName}</span>
                <Badge variant={statusVariant(data.status)}>{formatStatusLabel(data.status)}</Badge>
              </CardTitle>
              <CardDescription>{data.reason || 'No active issue reported.'}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
              {[
                ['Signal Source', formatStatusLabel(data.signalSource)],
                ['Last Transition', formatValue('last_transition_at', data.lastTransitionAt)],
                ['Last Success', formatValue('last_success_at', data.lastSuccessAt)],
                ['Last Failure', formatValue('last_failure_at', data.lastFailureAt)],
                ['Last Check', formatValue('last_checked_at', data.lastCheckedAt)],
                ['Last Reported', formatValue('last_reported_at', data.lastReportedAt)],
                [
                  'Consecutive Failures',
                  formatValue('consecutive_failures', data.consecutiveFailures),
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border bg-background px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-1 break-words">{value}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
              <CardDescription>
                {data.hasData
                  ? 'Compact monitoring summary attached to the latest status.'
                  : 'Fallback monitor context shown before the first agent heartbeat arrives.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.hasData ? (
                <Alert className="mb-3">
                  <AlertDescription>
                    No persisted monitor heartbeat yet. Showing current server inventory and monitor
                    setup readiness instead.
                  </AlertDescription>
                </Alert>
              ) : null}
              {summaryEntries.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                  No summary details available yet.
                </div>
              ) : (
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
                  {summaryEntries.map(([key, value]) => (
                    <div key={key} className="rounded-md border bg-background px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {formatLabel(key)}
                      </div>
                      <div className="mt-1 break-words text-sm">{formatValue(key, value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {seriesLoading || networkTrafficLoading || hasTrendSeries ? (
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base">Trend History</CardTitle>
                  <CardDescription>{selectedWindowMeta.description}</CardDescription>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div
                    className="inline-flex flex-wrap items-center rounded-lg border bg-muted/20 p-1"
                    role="tablist"
                    aria-label="trend window selector"
                  >
                    {SERIES_WINDOWS.filter(window => window.value !== 'custom').map(window => {
                      const active = window.value === selectedWindow
                      return (
                        <Button
                          key={window.value}
                          type="button"
                          size="xs"
                          variant={active ? 'secondary' : 'ghost'}
                          aria-pressed={active}
                          onClick={() => setSelectedWindow(window.value)}
                          disabled={seriesLoading || networkTrafficLoading}
                        >
                          {window.label}
                        </Button>
                      )
                    })}
                    <Popover open={customRangeOpen} onOpenChange={setCustomRangeOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          size="xs"
                          variant={selectedWindow === 'custom' ? 'secondary' : 'ghost'}
                          aria-pressed={selectedWindow === 'custom'}
                          disabled={seriesLoading || networkTrafficLoading}
                        >
                          {selectedWindow === 'custom'
                            ? formatCustomRangeLabel(appliedCustomRange)
                            : 'custom'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[min(24rem,calc(100vw-2rem))] space-y-3"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-medium">Custom time range</div>
                          <div className="text-xs text-muted-foreground">
                            Choose start and end time, then apply them to the current trend charts.
                          </div>
                        </div>
                        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
                          <label className="space-y-1 text-sm">
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">
                              Start
                            </span>
                            <Input
                              aria-label="Trend range start"
                              type="datetime-local"
                              value={draftCustomRange.startLocal}
                              onChange={event =>
                                setDraftCustomRange(current => ({
                                  ...current,
                                  startLocal: event.target.value,
                                }))
                              }
                              max={draftCustomRange.endLocal || undefined}
                            />
                          </label>
                          <label className="space-y-1 text-sm">
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">
                              End
                            </span>
                            <Input
                              aria-label="Trend range end"
                              type="datetime-local"
                              value={draftCustomRange.endLocal}
                              onChange={event =>
                                setDraftCustomRange(current => ({
                                  ...current,
                                  endLocal: event.target.value,
                                }))
                              }
                              min={draftCustomRange.startLocal || undefined}
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-muted-foreground">
                            {formatCustomRangeDescription(draftCustomRange)}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setAppliedCustomRange(draftCustomRange)
                              setSelectedWindow('custom')
                              setCustomRangeOpen(false)
                            }}
                            disabled={
                              seriesLoading ||
                              networkTrafficLoading ||
                              !isValidCustomRange(draftCustomRange) ||
                              (selectedWindow === 'custom' && !customRangeDirty)
                            }
                          >
                            Apply
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!hasTrendSeries ? (
                  <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                    {emptyMessage || 'Trend history is unavailable until monitoring data arrives.'}
                  </div>
                ) : (
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
                    {trendSeries.map(item => (
                      <TrendCard
                        key={item.name}
                        name={item.name}
                        unit={item.unit}
                        window={selectedWindow}
                        points={item.points ?? []}
                        segments={item.segments}
                        metadata={item.metadata}
                        rangeStartAt={
                          item.name === 'network_traffic'
                            ? networkTrafficSeries?.rangeStartAt
                            : series?.rangeStartAt
                        }
                        rangeEndAt={
                          item.name === 'network_traffic'
                            ? networkTrafficSeries?.rangeEndAt
                            : series?.rangeEndAt
                        }
                        stepSeconds={
                          item.name === 'network_traffic'
                            ? networkTrafficSeries?.stepSeconds
                            : series?.stepSeconds
                        }
                        availableNetworkInterfaces={
                          item.name === 'network' || item.name === 'network_traffic'
                            ? availableTrendNetworkInterfaces
                            : undefined
                        }
                        selectedNetworkInterface={
                          item.name === 'network' || item.name === 'network_traffic'
                            ? selectedTrendNetworkInterface
                            : undefined
                        }
                        onNetworkInterfaceChange={
                          item.name === 'network_traffic'
                            ? setSelectedTrendNetworkInterface
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : error ? null : (
        <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          {emptyMessage || 'No monitoring data available yet.'}
        </div>
      )}
    </div>
  )
}

function latestValue(points: number[][]): number | null {
  const values = points.map(point => point[1]).filter(value => Number.isFinite(value))
  return values.length > 0 ? values[values.length - 1] : null
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function latestSegmentValue(
  item: MonitorSeriesResponse['series'][number],
  name: string
): number | null {
  const segment = item.segments?.find(candidate => candidate.name === name)
  return segment ? latestValue(segment.points) : null
}

function metricPercent(item: MonitorSeriesResponse['series'][number]): number | null {
  const latest = latestValue(item.points ?? [])
  if (item.unit === 'percent' && latest !== null) return clampPercent(latest)
  if (item.name === 'memory') {
    const used = latestSegmentValue(item, 'used') ?? latest
    const available = latestSegmentValue(item, 'available')
    if (used !== null && available !== null && used + available > 0) {
      return clampPercent((used / (used + available)) * 100)
    }
  }
  if (item.name === 'disk_usage') {
    if (latest !== null) return clampPercent(latest)
    const used = latestSegmentValue(item, 'used')
    const free = latestSegmentValue(item, 'free')
    if (used !== null && free !== null && used + free > 0) {
      return clampPercent((used / (used + free)) * 100)
    }
  }
  return null
}

function latestTimestamp(points: number[][]): number | null {
  const timestamps = points.map(point => point[0]).filter(value => Number.isFinite(value))
  if (timestamps.length === 0) return null
  return timestamps[timestamps.length - 1] * 1000
}

function latestMetricTimestamp(item: MonitorSeriesResponse['series'][number]): number | null {
  const direct = latestTimestamp(item.points ?? [])
  const segmentLatest = (item.segments ?? []).reduce<number | null>((current, segment) => {
    const timestamp = latestTimestamp(segment.points)
    if (timestamp === null) return current
    if (current === null || timestamp > current) return timestamp
    return current
  }, null)
  if (direct === null) return segmentLatest
  if (segmentLatest === null) return direct
  return Math.max(direct, segmentLatest)
}

function latestStatsUpdatedAt(series: MonitorSeriesResponse['series']): {
  oldest: number | null
  newest: number | null
} {
  return series.reduce(
    (current, item) => {
      const timestamp = latestMetricTimestamp(item)
      if (timestamp === null) return current
      return {
        oldest: current.oldest === null || timestamp < current.oldest ? timestamp : current.oldest,
        newest: current.newest === null || timestamp > current.newest ? timestamp : current.newest,
      }
    },
    { oldest: null, newest: null } as { oldest: number | null; newest: number | null }
  )
}

function comparisonBars(item: MonitorSeriesResponse['series'][number]) {
  const pairs =
    item.name === 'disk'
      ? [
          { key: 'read', label: 'Read', value: latestSegmentValue(item, 'read') },
          { key: 'write', label: 'Write', value: latestSegmentValue(item, 'write') },
        ]
      : [
          { key: 'in', label: 'In', value: latestSegmentValue(item, 'in') },
          { key: 'out', label: 'Out', value: latestSegmentValue(item, 'out') },
        ]
  const maxValue = Math.max(...pairs.map(pair => Math.abs(pair.value ?? 0)), 0)

  return pairs.map(pair => ({
    ...pair,
    display:
      pair.value === null
        ? '—'
        : item.unit === 'bytes/s'
          ? `${formatRateBytes(pair.value)}/s`
          : formatTrendValue(item.unit, `${item.name}_${pair.key}`, pair.value),
    percent:
      pair.value === null || maxValue <= 0
        ? 0
        : Math.max(10, clampPercent((Math.abs(pair.value) / maxValue) * 100)),
  }))
}

type LatestStatItem = {
  key: string
  label: string
  value: string
  unit: string
  variant: 'gauge' | 'bars'
  updatedAt: number | null
  percent: number | null
  bars: Array<{
    key: string
    label: string
    display: string
    percent: number
  }>
}

function buildLatestStatItems(series: MonitorSeriesResponse['series']): LatestStatItem[] {
  const supported = LATEST_STAT_ORDER.map(name => series.find(item => item.name === name)).filter(
    (item): item is MonitorSeriesResponse['series'][number] => Boolean(item)
  )

  return supported.map(item => {
    const percent = metricPercent(item)
    return {
      key: item.name,
      label: formatLabel(item.name),
      value: formatSeriesLatestLabel(item),
      unit: item.unit,
      variant: ['cpu', 'memory', 'disk_usage'].includes(item.name) ? 'gauge' : 'bars',
      updatedAt: latestMetricTimestamp(item),
      percent,
      bars: comparisonBars(item),
    }
  })
}

function hasUsableSeriesData(
  item: Pick<MonitorSeriesItem, 'points' | 'segments'> | undefined
): boolean {
  if (!item) return false
  if ((item.points ?? []).some(point => Number.isFinite(point[1] ?? NaN))) {
    return true
  }
  return (item.segments ?? []).some(segment =>
    segment.points.some(point => Number.isFinite(point[1] ?? NaN))
  )
}

function buildSummaryFallbackLatestStatItems(summary?: Record<string, unknown>): LatestStatItem[] {
  if (!summary) return []

  const numericValue = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

  const cpuPercent = numericValue(summary.cpu_percent)
  const memoryUsed = numericValue(summary.memory_bytes)
  const memoryAvailable = numericValue(summary.memory_available_bytes)
  const items: LatestStatItem[] = []

  if (cpuPercent !== null) {
    items.push({
      key: 'cpu',
      label: formatLabel('cpu'),
      value: formatTrendValue('percent', 'cpu', cpuPercent),
      unit: 'percent',
      variant: 'gauge',
      updatedAt: null,
      percent: clampPercent(cpuPercent),
      bars: [],
    })
  }

  if (memoryUsed !== null) {
    const limit = memoryAvailable !== null ? memoryUsed + memoryAvailable : null
    items.push({
      key: 'memory',
      label: formatLabel('memory'),
      value:
        limit !== null
          ? `${formatBytes(memoryUsed)} used / ${formatBytes(limit)} limit`
          : `${formatBytes(memoryUsed)} used`,
      unit: 'bytes',
      variant: 'gauge',
      updatedAt: null,
      percent: limit !== null && limit > 0 ? clampPercent((memoryUsed / limit) * 100) : null,
      bars: [],
    })
  }

  return items
}

function formatUpdatedAtValue(timestamp: number, includeDate: boolean): string {
  return new Date(timestamp).toLocaleString(
    undefined,
    includeDate
      ? {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }
      : {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }
  )
}

function formatUpdatedAtText(timestamps: { oldest: number | null; newest: number | null }): string {
  if (timestamps.newest === null) return 'Updated at —'
  const newestDate = new Date(timestamps.newest)
  const oldestDate = timestamps.oldest === null ? null : new Date(timestamps.oldest)
  const includeDate =
    newestDate.toDateString() !== new Date().toDateString() ||
    (oldestDate !== null && oldestDate.toDateString() !== newestDate.toDateString())
  if (timestamps.oldest !== null && timestamps.oldest !== timestamps.newest) {
    return `Updated at ${formatUpdatedAtValue(timestamps.oldest, includeDate)} - ${formatUpdatedAtValue(timestamps.newest, includeDate)}`
  }
  return `Updated at ${formatUpdatedAtValue(timestamps.newest, includeDate)}`
}

function LatestGauge({ itemKey, percent }: { itemKey: string; percent: number | null }) {
  const clamped = percent === null ? 0 : clampPercent(percent)
  const radius = 46
  const centerX = 60
  const centerY = 60
  const arcPath = `M ${centerX - radius} ${centerY} A ${radius} ${radius} 0 0 1 ${centerX + radius} ${centerY}`
  const arcLength = Math.PI * radius
  const dashOffset = arcLength * (1 - clamped / 100)

  return (
    <div
      className="flex h-full flex-col justify-end gap-2"
      aria-label={`${itemKey} latest stat gauge`}
    >
      <svg
        viewBox="0 0 120 72"
        className="mx-auto h-24 w-full max-w-[10.5rem] overflow-visible"
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={arcPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          className="text-muted-foreground/20"
          strokeLinecap="round"
        />
        <path
          d={arcPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          className="text-primary/90"
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={dashOffset}
        />
        <text
          x="60"
          y="52"
          textAnchor="middle"
          className="fill-foreground text-[20px] font-semibold tabular-nums"
        >
          {percent === null ? '—' : `${Math.round(clamped)}%`}
        </text>
      </svg>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>0%</span>
        <span>100%</span>
      </div>
    </div>
  )
}

function LatestBarComparison({ itemKey, bars }: { itemKey: string; bars: LatestStatItem['bars'] }) {
  const [left, right] = bars
  return (
    <div className="space-y-3" aria-label={`${itemKey} latest stat comparison`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div className="space-y-1 text-right">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {left?.label ?? '—'}
          </div>
          <div className="text-xs font-medium text-foreground">{left?.display ?? '—'}</div>
        </div>
        <div className="h-16 w-px bg-border/80" />
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {right?.label ?? '—'}
          </div>
          <div className="text-xs font-medium text-foreground">{right?.display ?? '—'}</div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex justify-end">
          <div
            className="h-3 w-full max-w-32 rounded-l-full bg-primary/75 transition-all"
            style={{ width: `${left?.percent ?? 0}%` }}
          />
        </div>
        <div className="h-6 w-px bg-border/80" />
        <div className="flex">
          <div
            className="h-3 w-full max-w-32 rounded-r-full bg-primary/40 transition-all"
            style={{ width: `${right?.percent ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function LatestStatCard({ item }: { item: LatestStatItem }) {
  return (
    <div className="flex h-full flex-col rounded-md border bg-background px-4 py-4">
      <div className="flex min-h-[3.25rem] items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-1.5 break-words text-sm font-medium leading-snug text-foreground">
            {item.value}
          </div>
        </div>
        {item.variant === 'bars' ? (
          <div className="shrink-0 text-[11px] text-muted-foreground">{item.unit}</div>
        ) : null}
      </div>
      <div className="mt-4 flex-1">
        {item.variant === 'gauge' ? (
          <LatestGauge itemKey={item.key} percent={item.percent} />
        ) : (
          <LatestBarComparison itemKey={item.key} bars={item.bars} />
        )}
      </div>
    </div>
  )
}

function formatSeriesLatestLabel(item: MonitorSeriesResponse['series'][number]): string {
  const latest = latestValue(item.points ?? [])
  const used = item.segments?.find(segment => segment.name === 'used')
  const available = item.segments?.find(segment => segment.name === 'available')
  const free = item.segments?.find(segment => segment.name === 'free')
  const read = item.segments?.find(segment => segment.name === 'read')
  const write = item.segments?.find(segment => segment.name === 'write')
  const inbound = item.segments?.find(segment => segment.name === 'in')
  const outbound = item.segments?.find(segment => segment.name === 'out')
  const latestUsed = used ? latestValue(used.points) : null
  const latestAvailable = available ? latestValue(available.points) : null
  const latestFree = free ? latestValue(free.points) : null
  const latestRead = read ? latestValue(read.points) : null
  const latestWrite = write ? latestValue(write.points) : null
  const latestInbound = inbound ? latestValue(inbound.points) : null
  const latestOutbound = outbound ? latestValue(outbound.points) : null

  if (latest !== null) {
    return formatTrendValue(item.unit, item.name, latest)
  }
  if (item.name === 'memory' && latestUsed !== null) {
    if (latestAvailable !== null) {
      const limit = latestUsed + latestAvailable
      return `${formatBytes(latestUsed)} used / ${formatBytes(limit)} limit`
    }
    return `${formatBytes(latestUsed)} used`
  }
  if (item.name === 'disk_usage' && (latestUsed !== null || latestFree !== null)) {
    return `${latestUsed === null ? '—' : formatBytes(latestUsed)} used${latestFree === null ? '' : ` / ${formatBytes(latestFree)} free`}`
  }
  if (item.name === 'disk' && (latestRead !== null || latestWrite !== null)) {
    return `${latestRead === null ? '—' : `${formatRateBytes(latestRead)}/s`} read${latestWrite === null ? '' : ` / ${formatRateBytes(latestWrite)}/s write`}`
  }
  if (item.name === 'network' && (latestInbound !== null || latestOutbound !== null)) {
    return `${latestInbound === null ? '—' : `${formatRateBytes(latestInbound)}/s`} in${latestOutbound === null ? '' : ` / ${formatRateBytes(latestOutbound)}/s out`}`
  }
  if (item.name === 'network_traffic' && (latestInbound !== null || latestOutbound !== null)) {
    return `${latestInbound === null ? '—' : formatTrendValue(item.unit, `${item.name}_in`, latestInbound)} in${latestOutbound === null ? '' : ` / ${formatTrendValue(item.unit, `${item.name}_out`, latestOutbound)} out`}`
  }
  return '—'
}

function TrendCard({
  name,
  unit,
  window,
  points,
  segments,
  metadata,
  rangeStartAt,
  rangeEndAt,
  stepSeconds,
  availableNetworkInterfaces,
  selectedNetworkInterface,
  onNetworkInterfaceChange,
}: {
  name: string
  unit: string
  window: string
  points: number[][]
  segments?: Array<{ name: string; points: number[][] }>
  metadata?: Record<string, string>
  rangeStartAt?: string
  rangeEndAt?: string
  stepSeconds?: number
  availableNetworkInterfaces?: string[]
  selectedNetworkInterface?: string
  onNetworkInterfaceChange?: (value: string) => void
}) {
  const latest = latestValue(points)
  const used = segments?.find(segment => segment.name === 'used')
  const available = segments?.find(segment => segment.name === 'available')
  const free = segments?.find(segment => segment.name === 'free')
  const read = segments?.find(segment => segment.name === 'read')
  const write = segments?.find(segment => segment.name === 'write')
  const inbound = segments?.find(segment => segment.name === 'in')
  const outbound = segments?.find(segment => segment.name === 'out')
  const latestUsed = used ? latestValue(used.points) : null
  const latestAvailable = available ? latestValue(available.points) : null
  const latestFree = free ? latestValue(free.points) : null
  const latestRead = read ? latestValue(read.points) : null
  const latestWrite = write ? latestValue(write.points) : null
  const latestInbound = inbound ? latestValue(inbound.points) : null
  const latestOutbound = outbound ? latestValue(outbound.points) : null
  const latestLabel = (() => {
    if (latest !== null) {
      return formatTrendValue(unit, name, latest)
    }
    if (name === 'memory' && latestUsed !== null) {
      if (latestAvailable !== null) {
        const limit = latestUsed + latestAvailable
        return `${formatBytes(latestUsed)} used / ${formatBytes(limit)} limit`
      }
      return `${formatBytes(latestUsed)} used`
    }
    if (name === 'disk_usage' && (latestUsed !== null || latestFree !== null)) {
      return `${latestUsed === null ? '—' : formatBytes(latestUsed)} used${latestFree === null ? '' : ` / ${formatBytes(latestFree)} free`}`
    }
    if (name === 'disk' && (latestRead !== null || latestWrite !== null)) {
      return `${latestRead === null ? '—' : `${formatRateBytes(latestRead)}/s`} read${latestWrite === null ? '' : ` / ${formatRateBytes(latestWrite)}/s write`}`
    }
    if (name === 'network' && (latestInbound !== null || latestOutbound !== null)) {
      return `${latestInbound === null ? '—' : `${formatRateBytes(latestInbound)}/s`} in${latestOutbound === null ? '' : ` / ${formatRateBytes(latestOutbound)}/s out`}`
    }
    if (name === 'network_traffic' && (latestInbound !== null || latestOutbound !== null)) {
      return `${latestInbound === null ? '—' : formatTrendValue(unit, `${name}_in`, latestInbound)} in${latestOutbound === null ? '' : ` / ${formatTrendValue(unit, `${name}_out`, latestOutbound)} out`}`
    }
    return '—'
  })()
  const networkInterfaceLabel =
    metadata?.network_interface && metadata.network_interface !== 'all'
      ? `Interface ${metadata.network_interface}`
      : unit

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{formatLabel(name)}</div>
          <div className="text-xs text-muted-foreground">
            {name === 'network' ? networkInterfaceLabel : unit}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {name === 'network_traffic' &&
          availableNetworkInterfaces &&
          availableNetworkInterfaces.length > 0 &&
          onNetworkInterfaceChange ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Interface</span>
              <select
                aria-label="Network interface"
                className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
                value={selectedNetworkInterface ?? 'all'}
                onChange={event => onNetworkInterfaceChange(event.target.value)}
              >
                <option value="all">All interfaces</option>
                {availableNetworkInterfaces.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="text-right text-sm font-semibold">{latestLabel}</div>
        </div>
      </div>
      <div className="mt-3">
        <TimeSeriesChart
          name={name}
          unit={unit}
          window={window}
          rangeStartAt={rangeStartAt}
          rangeEndAt={rangeEndAt}
          stepSeconds={stepSeconds}
          points={points}
          segments={segments}
          formatValue={formatTrendValue}
        />
      </div>
    </div>
  )
}
