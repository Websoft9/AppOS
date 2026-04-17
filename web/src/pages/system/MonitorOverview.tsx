import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { pb } from '@/lib/pb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { MonitorTargetPanel } from '@/components/monitor/MonitorTargetPanel'

type MonitorOverviewItem = {
  targetType?: string
  targetId: string
  displayName: string
  status: string
  reason: string | null
  lastTransitionAt: string
  detailHref?: string
  summary?: Record<string, unknown>
}

type MonitorOverviewResponse = {
  counts: Record<string, number>
  unhealthyItems: MonitorOverviewItem[]
  platformItems: MonitorOverviewItem[]
}

const COUNT_KEYS = [
  'healthy',
  'degraded',
  'offline',
  'unreachable',
  'credential_invalid',
  'unknown',
] as const

function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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

function formatSummaryValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    if (key.endsWith('_bytes')) return formatBytes(value)
    if (key.endsWith('_seconds')) {
      if (value < 60) return `${Math.round(value)}s`
      if (value < 3600) return `${Math.round(value / 60)}m`
      if (value < 86400) return `${(value / 3600).toFixed(value >= 36000 ? 0 : 1)}h`
      return `${(value / 86400).toFixed(value >= 864000 ? 0 : 1)}d`
    }
    return String(Number.isInteger(value) ? value : Number(value).toFixed(2))
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value.includes('T') ? formatTimestamp(value) : value
  return JSON.stringify(value)
}

function formatTimestamp(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
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

function normalizeOverviewResponse(input: MonitorOverviewResponse | null | undefined): MonitorOverviewResponse {
  return {
    counts: input?.counts ?? {},
    unhealthyItems: Array.isArray(input?.unhealthyItems) ? input!.unhealthyItems : [],
    platformItems: Array.isArray(input?.platformItems) ? input!.platformItems : [],
  }
}

function preferredPlatformTargetId(items: MonitorOverviewItem[]): string {
  const apposCore = items.find(item => item.targetId === 'appos-core')
  return apposCore?.targetId ?? items[0]?.targetId ?? ''
}

function OverviewItemRow({ item }: { item: MonitorOverviewItem }) {
  const summaryEntries = Object.entries(item.summary ?? {}).slice(0, item.targetType === 'platform' ? 8 : 4)
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{item.displayName}</span>
          <Badge variant={statusVariant(item.status)}>{formatStatusLabel(item.status)}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {(item.targetType ? formatStatusLabel(item.targetType) : 'Platform') + ' · ' + item.targetId}
        </div>
        <div className="text-sm text-muted-foreground">{item.reason || 'No active issue reported.'}</div>
        {summaryEntries.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {summaryEntries.map(([key, value]) => (
              <span key={key} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {formatStatusLabel(key)}: {formatSummaryValue(key, value)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 text-xs text-muted-foreground sm:items-end">
        <span>Transitioned {formatTimestamp(item.lastTransitionAt)}</span>
        {item.detailHref ? (
          <a className="text-xs font-medium text-foreground underline-offset-4 hover:underline" href={item.detailHref}>
            Open detail
          </a>
        ) : null}
      </div>
    </div>
  )
}

export function MonitorOverviewContent() {
  const [data, setData] = useState<MonitorOverviewResponse>(() =>
    normalizeOverviewResponse(undefined)
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [selectedPlatformTargetId, setSelectedPlatformTargetId] = useState('')

  const countCards = useMemo(
    () =>
      COUNT_KEYS.map(key => ({
        key,
        label: formatStatusLabel(key),
        value: data.counts[key] ?? 0,
      })),
    [data.counts]
  )

  const loadOverview = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError('')
    try {
      const response = await pb.send<MonitorOverviewResponse>('/api/monitor/overview', { method: 'GET' })
      setData(normalizeOverviewResponse(response))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitoring overview')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    if (data.platformItems.length === 0) {
      setSelectedPlatformTargetId('')
      return
    }
    setSelectedPlatformTargetId(current => {
      if (current && data.platformItems.some(item => item.targetId === current)) {
        return current
      }
      return preferredPlatformTargetId(data.platformItems)
    })
  }, [data.platformItems])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Monitor Overview</h2>
          <p className="text-sm text-muted-foreground">
            Live platform and unhealthy target status from the monitoring read model.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadOverview(true)} disabled={loading || refreshing}>
          {loading || refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {countCards.map(card => (
          <Card key={card.key}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-2xl">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Unhealthy Targets</CardTitle>
            <CardDescription>Cross-domain issues surfaced by the current latest-status projection.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading unhealthy targets...
              </div>
            ) : data.unhealthyItems.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No unhealthy targets right now.
              </div>
            ) : (
              data.unhealthyItems.map(item => <OverviewItemRow key={`${item.targetType}-${item.targetId}`} item={item} />)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Targets</CardTitle>
            <CardDescription>AppOS self-observation for core process, worker, and scheduler.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading platform status...
              </div>
            ) : data.platformItems.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                Platform self-observation has not reported yet.
              </div>
            ) : (
              data.platformItems.map(item => <OverviewItemRow key={item.targetId} item={item} />)
            )}
          </CardContent>
        </Card>
      </div>

      {data.platformItems.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Platform Detail</CardTitle>
            <CardDescription>
              Drill into one self-observed AppOS component with the same normalized status and short-window trend surface used elsewhere.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {data.platformItems.map(item => (
                <Button
                  key={item.targetId}
                  variant={selectedPlatformTargetId === item.targetId ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedPlatformTargetId(item.targetId)}
                >
                  {item.displayName}
                </Button>
              ))}
            </div>
            {selectedPlatformTargetId ? (
              <MonitorTargetPanel
                targetType="platform"
                targetId={selectedPlatformTargetId}
                emptyMessage="Platform self-observation has not produced detail for this target yet."
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}