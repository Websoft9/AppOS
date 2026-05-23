import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  KeyRound,
  Loader2,
  Radar,
  RefreshCw,
  Rocket,
  ServerCog,
  ShieldAlert,
  SquareActivity,
  Waypoints,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TimeSeriesChart } from '@/components/monitor/TimeSeriesChart'
import { useAuth } from '@/contexts/AuthContext'
import { getRejectedSections, warnDegradedSections } from '@/lib/degraded-sections'
import { type AppInstance, formatTime, runtimeVariant } from '@/pages/apps/types'
import type { TunnelOverviewResponse } from '@/pages/system/tunnel-types'

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

type ServerOverviewRecord = {
  id: string
  name?: string
  connect_type?: string
  tunnel_status?: string
}

type SecretOverviewRecord = {
  id: string
  name: string
  status?: string
  expires_at?: string
}

type CertificateOverviewRecord = {
  id: string
  name: string
  domain?: string
  status?: string
  expires_at?: string
}

type OverviewData = {
  apps: AppInstance[]
  servers: ServerOverviewRecord[]
  secrets: SecretOverviewRecord[]
  certificates: CertificateOverviewRecord[]
  monitor: MonitorOverviewResponse
  tunnels: TunnelOverviewResponse
}

type MonitorSeries = {
  name: string
  unit: string
  points?: number[][]
  segments?: Array<{
    name: string
    points: number[][]
  }>
  metadata?: Record<string, string>
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
  series: MonitorSeries[]
}

type IssueItem = {
  id: string
  title: string
  description: string
  kind: 'monitor' | 'tunnel' | 'certificate' | 'secret'
  href: string
  severity: 'critical' | 'warning' | 'info'
}

const EMPTY_DATA: OverviewData = {
  apps: [],
  servers: [],
  secrets: [],
  certificates: [],
  monitor: {
    counts: {},
    unhealthyItems: [],
    platformItems: [],
  },
  tunnels: {
    summary: {
      total: 0,
      online: 0,
      offline: 0,
      waiting_for_first_connect: 0,
    },
    items: [],
  },
}

const QUICK_LINKS = [
  {
    title: 'Deploy App',
    description: 'Start a new deployment workflow.',
    href: '/deploy',
    icon: Rocket,
  },
  {
    title: 'Open Monitor',
    description: 'Inspect platform and unhealthy targets.',
    href: '/status',
    icon: Radar,
  },
  {
    title: 'Manage Servers',
    description: 'Review connected hosts and monitor agent rollout.',
    href: '/resources/servers',
    icon: ServerCog,
  },
  {
    title: 'Review Credentials',
    description: 'Check secrets and certificates that may need action.',
    href: '/secrets',
    icon: KeyRound,
  },
] as const

const APPOS_CORE_OVERVIEW_SERIES_QUERY = 'cpu,memory,disk_usage,disk,network'

const APPOS_CORE_OVERVIEW_SERIES_ORDER = ['cpu', 'memory', 'disk_usage', 'disk', 'network'] as const

function formatStatusLabel(value: string): string {
  return value
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

function formatDurationSeconds(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value < 60) return `${Math.round(value)}s`
  if (value < 3600) return `${Math.round(value / 60)}m`
  if (value < 86400) return `${(value / 3600).toFixed(value >= 36000 ? 0 : 1)}h`
  return `${(value / 86400).toFixed(value >= 864000 ? 0 : 1)}d`
}

function formatSummaryValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    if (key.endsWith('_bytes')) return formatBytes(value)
    if (key.endsWith('_seconds')) return formatDurationSeconds(value)
    return Number.isInteger(value) ? String(value) : Number(value).toFixed(2)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value.includes('T') ? formatTime(value) : value
  return JSON.stringify(value)
}

function formatTrendValue(unit: string, name: string, value: number): string {
  if (unit === 'bytes') return formatSummaryValue(`${name}_bytes`, value)
  if (unit === 'bytes/s') return `${formatBytes(value)}/s`
  return formatSummaryValue(name, value)
}

function formatSeriesLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'cpu') return 'CPU'
  if (normalized === 'disk') return 'Disk IO'
  if (normalized === 'network') return 'Network Speed'
  return formatStatusLabel(value)
}

function latestValue(points: number[][]): number | null {
  const values = points.map(point => point[1]).filter(value => Number.isFinite(value))
  return values.length > 0 ? values[values.length - 1] : null
}

function latestSeriesSummary(series: MonitorSeries): string {
  const latest = latestValue(series.points ?? [])
  const used = series.segments?.find(segment => segment.name === 'used')
  const available = series.segments?.find(segment => segment.name === 'available')
  const free = series.segments?.find(segment => segment.name === 'free')
  const inbound = series.segments?.find(segment => segment.name === 'in')
  const outbound = series.segments?.find(segment => segment.name === 'out')

  if (latest !== null) {
    return formatTrendValue(series.unit, series.name, latest)
  }

  if (series.name === 'memory' && used) {
    const latestUsed = latestValue(used.points)
    const latestAvailable = latestValue(available?.points ?? [])
    if (latestUsed !== null) {
      const total = latestUsed + (latestAvailable ?? 0)
      return `${formatBytes(latestUsed)} used / ${formatBytes(total)} total`
    }
  }

  if (series.name === 'disk_usage') {
    const latestUsed = latestValue(used?.points ?? [])
    const latestFree = latestValue(free?.points ?? [])
    if (latestUsed !== null || latestFree !== null) {
      return `${latestUsed === null ? '—' : formatBytes(latestUsed)} used${latestFree === null ? '' : ` / ${formatBytes(latestFree)} free`}`
    }
  }

  if (series.name === 'network') {
    const latestInbound = latestValue(inbound?.points ?? [])
    const latestOutbound = latestValue(outbound?.points ?? [])
    if (latestInbound !== null || latestOutbound !== null) {
      return `${latestInbound === null ? '—' : `${formatBytes(latestInbound)}/s`} in${latestOutbound === null ? '' : ` / ${formatBytes(latestOutbound)}/s out`}`
    }
  }

  if (series.name === 'disk') {
    const read = series.segments?.find(segment => segment.name === 'read')
    const write = series.segments?.find(segment => segment.name === 'write')
    const latestRead = latestValue(read?.points ?? [])
    const latestWrite = latestValue(write?.points ?? [])
    if (latestRead !== null || latestWrite !== null) {
      return `${latestRead === null ? '—' : `${formatBytes(latestRead)}/s`} read${latestWrite === null ? '' : ` / ${formatBytes(latestWrite)}/s write`}`
    }
  }

  return '—'
}

function orderedOverviewSeries(input: MonitorSeries[] | undefined): MonitorSeries[] {
  const items = Array.isArray(input) ? input : []
  return APPOS_CORE_OVERVIEW_SERIES_ORDER.map(name =>
    items.find(item => item.name === name)
  ).filter((item): item is MonitorSeries => Boolean(item))
}

function isExpiringSoon(iso?: string, warnBeforeDays = 30): boolean {
  if (!iso) return false
  const expiresAt = new Date(iso)
  if (Number.isNaN(expiresAt.getTime())) return false
  const diff = expiresAt.getTime() - Date.now()
  return diff > 0 && diff <= warnBeforeDays * 24 * 60 * 60 * 1000
}

function isExpired(iso?: string): boolean {
  if (!iso) return false
  const expiresAt = new Date(iso)
  if (Number.isNaN(expiresAt.getTime())) return false
  return expiresAt.getTime() <= Date.now()
}

function issueBadgeVariant(
  severity: IssueItem['severity']
): 'destructive' | 'outline' | 'secondary' {
  switch (severity) {
    case 'critical':
      return 'destructive'
    case 'warning':
      return 'outline'
    default:
      return 'secondary'
  }
}

function normalizeMonitorOverview(
  input: MonitorOverviewResponse | null | undefined
): MonitorOverviewResponse {
  return {
    counts: input?.counts ?? {},
    unhealthyItems: Array.isArray(input?.unhealthyItems) ? input.unhealthyItems : [],
    platformItems: Array.isArray(input?.platformItems) ? input.platformItems : [],
  }
}

function normalizeTunnelOverview(
  input: TunnelOverviewResponse | null | undefined
): TunnelOverviewResponse {
  return {
    summary: {
      total: input?.summary?.total ?? 0,
      online: input?.summary?.online ?? 0,
      offline: input?.summary?.offline ?? 0,
      waiting_for_first_connect: input?.summary?.waiting_for_first_connect ?? 0,
    },
    items: Array.isArray(input?.items) ? input.items : [],
  }
}

function normalizeCollectionItems<T>(input: unknown): T[] {
  if (Array.isArray(input)) return input as T[]
  if (input && typeof input === 'object' && Array.isArray((input as { items?: unknown[] }).items)) {
    return (input as { items: T[] }).items
  }
  return []
}

function buildIssueItems(data: OverviewData): IssueItem[] {
  const monitorIssues: IssueItem[] = data.monitor.unhealthyItems.map(item => ({
    id: `monitor:${item.targetType ?? 'target'}:${item.targetId}`,
    title: item.displayName,
    description: item.reason || `${formatStatusLabel(item.status)} requires attention.`,
    kind: 'monitor',
    href: item.detailHref || '/status',
    severity:
      item.status === 'offline' ||
      item.status === 'unreachable' ||
      item.status === 'credential_invalid'
        ? 'critical'
        : 'warning',
  }))

  const tunnelIssues: IssueItem[] = data.tunnels.items
    .filter(item => item.status === 'offline' || item.waiting_for_first_connect)
    .map(item => ({
      id: `tunnel:${item.id}`,
      title: item.name,
      description: item.waiting_for_first_connect
        ? 'Waiting for first tunnel connection.'
        : 'Tunnel is offline.',
      kind: 'tunnel',
      href: '/tunnels',
      severity: item.waiting_for_first_connect ? 'info' : 'critical',
    }))

  const certificateIssues: IssueItem[] = data.certificates.flatMap((item): IssueItem[] => {
    if (item.status === 'revoked' || item.status === 'expired' || isExpired(item.expires_at)) {
      return [
        {
          id: `certificate:${item.id}`,
          title: item.domain || item.name,
          description: 'Certificate is expired or revoked.',
          kind: 'certificate' as const,
          href: '/certificates',
          severity: 'critical' as const,
        },
      ]
    }
    if (isExpiringSoon(item.expires_at)) {
      return [
        {
          id: `certificate:${item.id}`,
          title: item.domain || item.name,
          description: 'Certificate is expiring within 30 days.',
          kind: 'certificate' as const,
          href: '/certificates',
          severity: 'warning' as const,
        },
      ]
    }
    return []
  })

  const secretIssues: IssueItem[] = data.secrets.flatMap((item): IssueItem[] => {
    if (item.status === 'revoked' || isExpired(item.expires_at)) {
      return [
        {
          id: `secret:${item.id}`,
          title: item.name,
          description: 'Secret is expired or revoked.',
          kind: 'secret' as const,
          href: '/secrets',
          severity: 'critical' as const,
        },
      ]
    }
    if (isExpiringSoon(item.expires_at)) {
      return [
        {
          id: `secret:${item.id}`,
          title: item.name,
          description: 'Secret is expiring within 30 days.',
          kind: 'secret' as const,
          href: '/secrets',
          severity: 'warning' as const,
        },
      ]
    }
    return []
  })

  return [...monitorIssues, ...tunnelIssues, ...certificateIssues, ...secretIssues].slice(0, 8)
}

function KpiCard({
  title,
  value,
  description,
  accent,
}: {
  title: string
  value: string
  description: string
  accent: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription>{title}</CardDescription>
            <CardTitle className="text-2xl">{value}</CardTitle>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2 text-muted-foreground">{accent}</div>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  )
}

export function OverviewPage() {
  const { user } = useAuth()
  const isSuperuser = user?.collectionName === '_superusers'
  const [data, setData] = useState<OverviewData>(EMPTY_DATA)
  const [trendSeries, setTrendSeries] = useState<MonitorSeriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadOverview = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError('')
      try {
        const [
          appsResult,
          monitorResult,
          tunnelsResult,
          serversResult,
          secretsResult,
          certificatesResult,
        ] = await Promise.allSettled([
          pb.send<AppInstance[]>('/api/apps', { method: 'GET' }),
          pb.send<MonitorOverviewResponse>('/api/monitor/overview', { method: 'GET' }),
          pb.send<TunnelOverviewResponse>('/api/tunnel/overview', { method: 'GET' }),
          isSuperuser
            ? pb.collection('servers').getFullList<ServerOverviewRecord>({ sort: 'name' })
            : Promise.resolve<ServerOverviewRecord[]>([]),
          isSuperuser
            ? pb.collection('secrets').getFullList<SecretOverviewRecord>({ sort: '-created' })
            : Promise.resolve<SecretOverviewRecord[]>([]),
          isSuperuser
            ? pb
                .collection('certificates')
                .getFullList<CertificateOverviewRecord>({ sort: '-created' })
            : Promise.resolve<CertificateOverviewRecord[]>([]),
        ])

        const coreFailures = getRejectedSections([
          { section: 'apps', result: appsResult },
          { section: 'monitor', result: monitorResult },
          { section: 'tunnels', result: tunnelsResult },
        ])
        if (coreFailures.length === 3) {
          throw new Error(coreFailures[0].message)
        }

        const collectionFailures = getRejectedSections([
          { section: 'servers', result: serversResult },
          { section: 'secrets', result: secretsResult },
          { section: 'certificates', result: certificatesResult },
        ])

        if (coreFailures.length > 0 || collectionFailures.length > 0) {
          warnDegradedSections('Overview', [...coreFailures, ...collectionFailures])
          setError('Some overview sections are temporarily unavailable.')
        }

        const normalizedMonitor = normalizeMonitorOverview(
          monitorResult.status === 'fulfilled' ? monitorResult.value : undefined
        )
        const nextServers =
          serversResult.status === 'fulfilled'
            ? normalizeCollectionItems<ServerOverviewRecord>(serversResult.value)
            : []
        const apposTrendResult = await Promise.allSettled([
          normalizedMonitor.platformItems.some(item => item.targetId === 'appos-core')
            ? pb.send<MonitorSeriesResponse>(
                `/api/monitor/targets/platform/appos-core/series?${new URLSearchParams({
                  window: '1h',
                  series: APPOS_CORE_OVERVIEW_SERIES_QUERY,
                }).toString()}`,
                { method: 'GET' }
              )
            : Promise.resolve(null),
        ])

        warnDegradedSections(
          'Overview trends',
          getRejectedSections([{ section: 'appos', result: apposTrendResult[0] }])
        )

        setData({
          apps:
            appsResult.status === 'fulfilled' && Array.isArray(appsResult.value)
              ? appsResult.value
              : [],
          monitor: normalizedMonitor,
          tunnels: normalizeTunnelOverview(
            tunnelsResult.status === 'fulfilled' ? tunnelsResult.value : undefined
          ),
          servers: nextServers,
          secrets:
            secretsResult.status === 'fulfilled'
              ? normalizeCollectionItems<SecretOverviewRecord>(secretsResult.value)
              : [],
          certificates:
            certificatesResult.status === 'fulfilled'
              ? normalizeCollectionItems<CertificateOverviewRecord>(certificatesResult.value)
              : [],
        })
        setTrendSeries(
          apposTrendResult[0].status === 'fulfilled' && apposTrendResult[0].value
            ? apposTrendResult[0].value
            : null
        )
      } catch (err) {
        setTrendSeries(null)
        setError(err instanceof Error ? err.message : 'Failed to load overview')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [isSuperuser]
  )

  useEffect(() => {
    void loadOverview()
    const timer = window.setInterval(() => {
      void loadOverview(true)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [loadOverview])

  const appSummary = useMemo(() => {
    const running = data.apps.filter(item => item.runtime_status === 'running').length
    const error = data.apps.filter(item => item.runtime_status === 'error').length
    return {
      total: data.apps.length,
      running,
      error,
      stopped: data.apps.filter(item => item.runtime_status === 'stopped').length,
    }
  }, [data.apps])

  const serverSummary = useMemo(() => {
    const tunnelServers = data.servers.filter(item => item.connect_type === 'tunnel')
    const online = tunnelServers.filter(
      item => String(item.tunnel_status ?? '').toLowerCase() === 'online'
    ).length
    const offline = tunnelServers.filter(
      item => String(item.tunnel_status ?? '').toLowerCase() !== 'online'
    ).length
    return {
      total: data.servers.length,
      tunnelOnline: online,
      tunnelOffline: offline,
      direct: data.servers.filter(item => item.connect_type !== 'tunnel').length,
    }
  }, [data.servers])

  const credentialSummary = useMemo(() => {
    const certificateRisk = data.certificates.filter(
      item =>
        item.status === 'revoked' ||
        item.status === 'expired' ||
        isExpired(item.expires_at) ||
        isExpiringSoon(item.expires_at)
    ).length
    const secretRisk = data.secrets.filter(
      item =>
        item.status === 'revoked' || isExpired(item.expires_at) || isExpiringSoon(item.expires_at)
    ).length
    return {
      total: data.secrets.length + data.certificates.length,
      atRisk: certificateRisk + secretRisk,
      certificates: certificateRisk,
      secrets: secretRisk,
    }
  }, [data.certificates, data.secrets])

  const issueItems = useMemo(() => buildIssueItems(data), [data])

  const recentApps = useMemo(
    () =>
      [...data.apps]
        .sort((left, right) =>
          String(right.updated ?? '').localeCompare(String(left.updated ?? ''))
        )
        .slice(0, 5),
    [data.apps]
  )

  const apposTrendSeries = useMemo(() => orderedOverviewSeries(trendSeries?.series), [trendSeries])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh overview"
          onClick={() => void loadOverview(true)}
          disabled={loading || refreshing}
        >
          {loading || refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Applications"
          value={String(appSummary.total)}
          description={`${appSummary.running} running · ${appSummary.error} error · ${appSummary.stopped} stopped`}
          accent={<SquareActivity className="h-4 w-4" />}
        />
        <KpiCard
          title="Servers"
          value={String(serverSummary.total)}
          description={`${serverSummary.tunnelOnline} tunnel online · ${serverSummary.tunnelOffline} tunnel offline · ${serverSummary.direct} direct`}
          accent={<Waypoints className="h-4 w-4" />}
        />
        <KpiCard
          title="Attention Needed"
          value={String(issueItems.length)}
          description={`${data.monitor.unhealthyItems.length} monitor issues · ${data.tunnels.summary.offline} offline tunnels`}
          accent={<AlertTriangle className="h-4 w-4" />}
        />
        <KpiCard
          title="Credentials Risk"
          value={String(credentialSummary.atRisk)}
          description={`${credentialSummary.certificates} certificate risks · ${credentialSummary.secrets} secret risks`}
          accent={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
            <CardDescription>
              Prioritized operational items collected from monitor, tunnel, and credential state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading current issues...
              </div>
            ) : issueItems.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No urgent issues right now.
              </div>
            ) : (
              issueItems.map(item => (
                <Link
                  key={item.id}
                  to={item.href as never}
                  className="flex items-start justify-between gap-3 rounded-lg border bg-background px-4 py-3 transition-colors hover:bg-muted/20"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.title}</span>
                      <Badge variant={issueBadgeVariant(item.severity)}>
                        {formatStatusLabel(item.kind)}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">{item.description}</div>
                  </div>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="relative pr-16">
            <CardTitle>1H Trends</CardTitle>
            <CardDescription>AppOS control-plane CPU, memory, disk, and network over the last hour.</CardDescription>
            <Link
              to="/status"
              aria-label="View system status"
              className="absolute right-2 top-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading AppOS self metrics...
              </div>
            ) : apposTrendSeries.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                AppOS self metrics have not reported yet.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {apposTrendSeries.map(item => (
                  <div key={item.name} className="rounded-lg border bg-background p-3">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {formatSeriesLabel(item.name)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {latestSeriesSummary(item)}
                        </div>
                      </div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {item.unit}
                      </div>
                    </div>
                    <TimeSeriesChart
                      name={item.name}
                      unit={item.unit}
                      window={trendSeries?.window ?? '1h'}
                      rangeStartAt={trendSeries?.rangeStartAt}
                      rangeEndAt={trendSeries?.rangeEndAt}
                      stepSeconds={trendSeries?.stepSeconds}
                      points={item.points}
                      segments={item.segments}
                      formatValue={formatTrendValue}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent App Changes</CardTitle>
            <CardDescription>
              Most recently updated application instances across the workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading applications...
              </div>
            ) : recentApps.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No applications deployed yet.
              </div>
            ) : (
              recentApps.map(app => (
                <Link
                  key={app.id}
                  to="/apps/$appId"
                  params={{ appId: app.id }}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 transition-colors hover:bg-muted/20"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{app.name}</span>
                      <Badge variant={runtimeVariant(app.runtime_status)}>
                        {formatStatusLabel(app.runtime_status || 'unknown')}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {app.health_summary || app.runtime_reason || app.project_dir}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <div>Updated</div>
                    <div>{formatTime(app.updated)}</div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Jump directly into the most common operational workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {QUICK_LINKS.map(item => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  to={item.href as never}
                  className="rounded-lg border bg-background px-4 py-3 transition-colors hover:bg-muted/20"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg border bg-muted/30 p-2 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{item.title}</div>
                        <div className="text-sm text-muted-foreground">{item.description}</div>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
