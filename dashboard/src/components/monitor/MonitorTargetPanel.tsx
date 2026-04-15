import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { pb } from '@/lib/pb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TimeSeriesChart } from '@/components/monitor/TimeSeriesChart'

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

const SERIES_WINDOWS = [
  { value: '1h', label: '1H', description: 'Last hour trends from the monitoring time-series backend.' },
  { value: '6h', label: '6H', description: 'Last six hours trends from the monitoring time-series backend.' },
  { value: '24h', label: '24H', description: 'Last twenty-four hours trends from the monitoring time-series backend.' },
] as const

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
  if (unit === 'bytes/s') return `${formatBytes(value)}/s`
  return formatValue(name, value)
}

function seriesQueryForTargetType(targetType: string): string {
  if (targetType === 'server') {
    return 'cpu,memory,disk_usage,disk,network,network_traffic'
  }
  return 'cpu,memory'
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

export function MonitorTargetPanel({
  targetType,
  targetId,
  emptyMessage,
}: {
  targetType: string
  targetId: string
  emptyMessage?: string
}) {
  const [data, setData] = useState<MonitorTargetResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [series, setSeries] = useState<MonitorSeriesResponse | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [selectedWindow, setSelectedWindow] = useState<(typeof SERIES_WINDOWS)[number]['value']>('1h')
  const [selectedNetworkInterface, setSelectedNetworkInterface] = useState('all')

  const load = useCallback(async (silent = false) => {
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
        { method: 'GET' }
      )
      setData(response)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Failed to load monitor target')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [targetId, targetType])

  const loadSeries = useCallback(async () => {
    if (!targetId || (targetType !== 'server' && targetType !== 'platform' && targetType !== 'app')) {
      setSeries(null)
      return
    }
    setSeriesLoading(true)
    try {
      const requestedSeries = seriesQueryForTargetType(targetType)
      const params = new URLSearchParams({
        window: selectedWindow,
        series: requestedSeries,
      })
      if (targetType === 'server' && selectedNetworkInterface !== 'all') {
        params.set('networkInterface', selectedNetworkInterface)
      }
      const response = await pb.send<MonitorSeriesResponse>(
        `/api/monitor/targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/series?${params.toString()}`,
        { method: 'GET' }
      )
      if (targetType === 'server' && response.selectedNetworkInterface && response.selectedNetworkInterface !== selectedNetworkInterface) {
        setSelectedNetworkInterface(response.selectedNetworkInterface)
      }
      setSeries(response)
    } catch {
      setSeries(null)
    } finally {
      setSeriesLoading(false)
    }
  }, [selectedNetworkInterface, selectedWindow, targetId, targetType])

  const selectedWindowMeta = SERIES_WINDOWS.find(window => window.value === selectedWindow) ?? SERIES_WINDOWS[0]

  const handleRefresh = useCallback(async () => {
    await Promise.all([load(true), loadSeries()])
  }, [load, loadSeries])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

  useEffect(() => {
    setSelectedNetworkInterface('all')
  }, [targetId, targetType])

  const summaryEntries = Object.entries(data?.summary ?? {})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Monitor Status</h3>
          <p className="text-sm text-muted-foreground">
            Latest normalized monitoring state for this target.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={loading || refreshing || seriesLoading || !targetId}>
          {loading || refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span>{data.displayName}</span>
                <Badge variant={statusVariant(data.status)}>{formatStatusLabel(data.status)}</Badge>
              </CardTitle>
              <CardDescription>{data.reason || 'No active issue reported.'}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                ['Signal Source', formatStatusLabel(data.signalSource)],
                ['Last Transition', formatValue('last_transition_at', data.lastTransitionAt)],
                ['Last Success', formatValue('last_success_at', data.lastSuccessAt)],
                ['Last Failure', formatValue('last_failure_at', data.lastFailureAt)],
                ['Last Check', formatValue('last_checked_at', data.lastCheckedAt)],
                ['Last Reported', formatValue('last_reported_at', data.lastReportedAt)],
                ['Consecutive Failures', formatValue('consecutive_failures', data.consecutiveFailures)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border bg-background px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
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
                    No persisted monitor heartbeat yet. Showing current server inventory and monitor setup readiness instead.
                  </AlertDescription>
                </Alert>
              ) : null}
              {summaryEntries.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                  No summary details available yet.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
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

          {seriesLoading || (series && series.series.length > 0) ? (
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base">Short Window Trends</CardTitle>
                  <CardDescription>{selectedWindowMeta.description}</CardDescription>
                </div>
                <div className="inline-flex items-center rounded-lg border bg-muted/20 p-1" role="tablist" aria-label="trend window selector">
                  {SERIES_WINDOWS.map(window => {
                    const active = window.value === selectedWindow
                    return (
                      <Button
                        key={window.value}
                        type="button"
                        size="xs"
                        variant={active ? 'secondary' : 'ghost'}
                        aria-pressed={active}
                        onClick={() => setSelectedWindow(window.value)}
                        disabled={seriesLoading}
                      >
                        {window.label}
                      </Button>
                    )
                  })}
                </div>
              </CardHeader>
              <CardContent>
                {seriesLoading ? (
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading trend data...
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {series?.series.map(item => (
                      <TrendCard
                        key={item.name}
                        name={item.name}
                        unit={item.unit}
                        points={item.points ?? []}
                        segments={item.segments}
                        metadata={item.metadata}
                        availableNetworkInterfaces={item.name === 'network' || item.name === 'network_traffic' ? series.availableNetworkInterfaces : undefined}
                        selectedNetworkInterface={item.name === 'network' || item.name === 'network_traffic' ? selectedNetworkInterface : undefined}
                        onNetworkInterfaceChange={item.name === 'network' || item.name === 'network_traffic' ? setSelectedNetworkInterface : undefined}
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

function TrendCard({
  name,
  unit,
  points,
  segments,
  metadata,
  availableNetworkInterfaces,
  selectedNetworkInterface,
  onNetworkInterfaceChange,
}: {
  name: string
  unit: string
  points: number[][]
  segments?: Array<{ name: string; points: number[][] }>
  metadata?: Record<string, string>
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
      const total = latestUsed + (latestAvailable ?? 0)
      return `${formatBytes(latestUsed)} used / ${formatBytes(total)} total`
    }
    if (name === 'disk_usage' && (latestUsed !== null || latestFree !== null)) {
      return `${latestUsed === null ? '—' : formatBytes(latestUsed)} used${latestFree === null ? '' : ` / ${formatBytes(latestFree)} free`}`
    }
    if (name === 'disk' && (latestRead !== null || latestWrite !== null)) {
      return `${latestRead === null ? '—' : `${formatBytes(latestRead)}/s`} read${latestWrite === null ? '' : ` / ${formatBytes(latestWrite)}/s write`}`
    }
    if (name === 'network_traffic' && (latestInbound !== null || latestOutbound !== null)) {
      return `${latestInbound === null ? '—' : `${formatBytes(latestInbound)}/s`} in${latestOutbound === null ? '' : ` / ${formatBytes(latestOutbound)}/s out`}`
    }
    return '—'
  })()
  const networkInterfaceLabel = metadata?.network_interface && metadata.network_interface !== 'all'
    ? `Interface ${metadata.network_interface}`
    : unit

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{formatLabel(name)}</div>
          <div className="text-xs text-muted-foreground">{name === 'network' ? networkInterfaceLabel : unit}</div>
        </div>
        <div className="flex items-center gap-3">
          {name === 'network_traffic' && availableNetworkInterfaces && availableNetworkInterfaces.length > 0 && onNetworkInterfaceChange ? (
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
        <TimeSeriesChart name={name} unit={unit} points={points} segments={segments} formatValue={formatTrendValue} />
      </div>
    </div>
  )
}