import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { pb } from '@/lib/pb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
  series: Array<{
    name: string
    unit: string
    points: number[][]
  }>
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

function formatDurationSeconds(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value < 60) return `${Math.round(value)}s`
  if (value < 3600) return `${Math.round(value / 60)}m`
  if (value < 86400) return `${(value / 3600).toFixed(value >= 36000 ? 0 : 1)}h`
  return `${(value / 86400).toFixed(value >= 864000 ? 0 : 1)}d`
}

function formatLabel(value: string): string {
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
      const response = await pb.send<MonitorSeriesResponse>(
        `/api/monitor/targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/series?window=1h&series=cpu,memory`,
        { method: 'GET' }
      )
      setSeries(response)
    } catch {
      setSeries(null)
    } finally {
      setSeriesLoading(false)
    }
  }, [targetId, targetType])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

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
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading || refreshing || !targetId}>
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
              <CardHeader>
                <CardTitle className="text-base">Short Window Trends</CardTitle>
                <CardDescription>Last hour trends from the monitoring time-series backend.</CardDescription>
              </CardHeader>
              <CardContent>
                {seriesLoading ? (
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading trend data...
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {series?.series.map(item => (
                      <TrendCard key={item.name} name={item.name} unit={item.unit} points={item.points} />
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

function TrendCard({ name, unit, points }: { name: string; unit: string; points: number[][] }) {
  const values = points.map(point => point[1]).filter(value => Number.isFinite(value))
  const latest = values.length > 0 ? values[values.length - 1] : null
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{formatLabel(name)}</div>
          <div className="text-xs text-muted-foreground">{unit}</div>
        </div>
        <div className="text-sm font-semibold">{latest === null ? '—' : formatValue(unit === 'bytes' ? `${name}_bytes` : name, latest)}</div>
      </div>
      <div className="mt-3">
        <Sparkline points={values} />
      </div>
    </div>
  )
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="h-16 rounded-md border border-dashed text-xs text-muted-foreground flex items-center justify-center">No trend yet</div>
  }
  const width = 240
  const height = 64
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width
      const y = height - ((point - min) / range) * (height - 8) - 4
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full overflow-visible" role="img" aria-label="trend chart">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/80" />
    </svg>
  )
}