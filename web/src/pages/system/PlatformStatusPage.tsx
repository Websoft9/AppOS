import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CalendarDays, Loader2, RefreshCw } from 'lucide-react'
import { SharedTimeRangeSelector } from '@/components/monitor/SharedTimeRangeSelector'
import { TimeSeriesChart } from '@/components/monitor/TimeSeriesChart'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ActiveServicesContent } from '@/pages/components/ComponentsPage'
import {
  fetchActiveServices,
  fetchInstalledComponents,
  formatComponentStatusTime,
  type ComponentItem,
  type ServiceItem,
} from '@/pages/components/component-status-shared'
import {
  formatBytes,
  formatStatusLabel,
  formatSummaryValue,
  formatTimestamp,
  normalizeOverviewResponse,
  statusVariant,
  type MonitorOverviewItem,
  type MonitorOverviewResponse,
} from '@/pages/system/monitor-overview-shared'
import { pb } from '@/lib/pb'

type MonitorSeries = {
  name: string
  unit: string
  points?: number[][]
  segments?: Array<{
    name: string
    points: number[][]
  }>
}

type MonitorSeriesResponse = {
  targetType: string
  targetId: string
  window: string
  rangeStartAt?: string
  rangeEndAt?: string
  stepSeconds?: number
  series: MonitorSeries[]
}

type RangeOption = '1h' | '6h' | '24h' | '7d' | 'custom'
type CapabilityLevel = 'available' | 'limited' | 'unavailable'
type SignalLevel = 'healthy' | 'degraded' | 'unavailable' | 'unknown'
type CustomRangeState = {
  startLocal: string
  endLocal: string
}

type AvailabilityCapability = {
  label: string
  level: CapabilityLevel
  reason: string
}

type AvailabilitySummary = {
  level: SignalLevel
  title: string
  description: string
  primaryReason: string
  lastChecked: string
  capabilities: AvailabilityCapability[]
}

const INFRASTRUCTURE_SERIES_QUERY = 'cpu,memory,disk,network'
const RANGE_OPTIONS: Array<{ value: RangeOption; label: string }> = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: 'custom', label: 'Custom' },
]

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
    return 'Choose a valid custom range.'
  }
  return `${start.toLocaleString()} - ${end.toLocaleString()}`
}

function formatTrendValue(unit: string, name: string, value: number): string {
  if (unit === 'percent') return `${value.toFixed(value >= 10 ? 0 : 1)}%`
  if (unit === 'bytes') return formatSummaryValue(`${name}_bytes`, value)
  if (unit === 'bytes/s') return `${formatBytes(value)}/s`
  return formatSummaryValue(name, value)
}

function formatSeriesLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'cpu') return 'CPU %'
  if (normalized === 'memory') return 'MEM USAGE / LIMIT'
  if (normalized === 'memory_percent') return 'MEM %'
  if (normalized === 'disk') return 'BLOCK I/O'
  if (normalized === 'network') return 'NET I/O'
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
  const inbound = series.segments?.find(segment => segment.name === 'in')
  const outbound = series.segments?.find(segment => segment.name === 'out')
  const read = series.segments?.find(segment => segment.name === 'read')
  const write = series.segments?.find(segment => segment.name === 'write')

  if (latest !== null) {
    return formatTrendValue(series.unit, series.name, latest)
  }

  if (series.name === 'memory' && used) {
    const latestUsed = latestValue(used.points)
    const latestAvailable = latestValue(available?.points ?? [])
    if (latestUsed !== null) {
      const total = latestUsed + (latestAvailable ?? 0)
      const percent = total > 0 ? (latestUsed / total) * 100 : null
      return `${formatBytes(latestUsed)} / ${formatBytes(total)}${percent === null ? '' : ` (${formatTrendValue('percent', 'memory_percent', percent)})`}`
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
    const latestRead = latestValue(read?.points ?? [])
    const latestWrite = latestValue(write?.points ?? [])
    if (latestRead !== null || latestWrite !== null) {
      return `${latestRead === null ? '—' : `${formatBytes(latestRead)}/s`} read${latestWrite === null ? '' : ` / ${formatBytes(latestWrite)}/s write`}`
    }
  }

  return '—'
}

function orderedInfrastructureSeries(input: MonitorSeries[] | undefined): MonitorSeries[] {
  const items = Array.isArray(input) ? input : []
  const cpu = items.find(item => item.name === 'cpu')
  const memory = items.find(item => item.name === 'memory')
  const network = items.find(item => item.name === 'network')
  const disk = items.find(item => item.name === 'disk')

  return [cpu, memory, network, disk].filter((item): item is MonitorSeries => Boolean(item))
}

function BundleComponentsSheetContent({ onClose }: { onClose: () => void }) {
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const sorted = useMemo(() => [...components].sort((a, b) => a.name.localeCompare(b.name)), [components])

  const loadComponents = useCallback(async (force = false) => {
    setLoading(true)
    try {
      setComponents(await fetchInstalledComponents(force))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load components')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadComponents()
  }, [loadComponents])

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="gap-3 border-b pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SheetTitle>Bundle components</SheetTitle>
            <SheetDescription>
              Inspect bundled tools available inside the AppOS runtime container.
            </SheetDescription>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => void loadComponents(true)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <SheetClose asChild>
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </SheetClose>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-auto px-4 pb-4 pt-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">Loading installed components...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">No installed components were detected.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[2fr_1fr_1.2fr_1fr] gap-4 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div>Name</div>
              <div>Version</div>
              <div>Updated</div>
              <div>CLI</div>
            </div>
            <div className="space-y-2">
              {sorted.map(component => (
                <div key={component.id} className="grid grid-cols-[2fr_1fr_1.2fr_1fr] gap-4 px-2 py-2 text-sm">
                  <div className="font-medium text-foreground">{component.name}</div>
                  <div className="text-muted-foreground">{component.version || 'unknown'}</div>
                  <div className="text-muted-foreground">{formatComponentStatusTime(component.updated_at)}</div>
                  <div className="text-muted-foreground">{component.available ? 'Available' : 'Unavailable'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function summarizePlatformTarget(item: MonitorOverviewItem): string {
  if (item.reason) return item.reason
  const firstSummaryEntry = Object.entries(item.summary ?? {}).find(([key]) => !key.endsWith('_at'))
  if (!firstSummaryEntry) return 'No active issue reported.'
  return `${formatStatusLabel(firstSummaryEntry[0])}: ${formatSummaryValue(firstSummaryEntry[0], firstSummaryEntry[1])}`
}

function platformTargetDetailEntries(item: MonitorOverviewItem): Array<[string, unknown]> {
  return Object.entries(item.summary ?? {})
    .filter(([key, value]) => !key.endsWith('_at') && value !== null && value !== undefined && value !== '')
    .slice(0, 4)
}

function toSignalLevelFromTarget(status?: string): SignalLevel {
  switch (status) {
    case 'healthy':
      return 'healthy'
    case 'degraded':
      return 'degraded'
    case 'offline':
    case 'unreachable':
    case 'credential_invalid':
      return 'unavailable'
    default:
      return status ? 'degraded' : 'unknown'
  }
}

function toSignalLevelFromService(state?: string): SignalLevel {
  switch (state) {
    case 'running':
      return 'healthy'
    case 'starting':
    case 'backoff':
    case 'restarting':
      return 'degraded'
    case 'fatal':
    case 'exited':
    case 'unknown':
    case 'missing':
    case 'stopped':
      return 'unavailable'
    default:
      return state ? 'degraded' : 'unknown'
  }
}

function combineSignalLevels(levels: SignalLevel[]): SignalLevel {
  const known = levels.filter(level => level !== 'unknown')
  if (known.length === 0) return 'unknown'
  if (known.includes('unavailable')) return 'unavailable'
  if (known.includes('degraded')) return 'degraded'
  return 'healthy'
}

function capabilityLevelFromSignal(level: SignalLevel): CapabilityLevel {
  if (level === 'healthy') return 'available'
  if (level === 'unavailable') return 'unavailable'
  return 'limited'
}

function availabilityBadgeVariant(level: SignalLevel): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (level === 'healthy') return 'default'
  if (level === 'unavailable') return 'destructive'
  if (level === 'degraded') return 'outline'
  return 'secondary'
}

function buildRangeQuery(range: RangeOption): URLSearchParams {
  if (range === '6h') {
    const endAt = new Date()
    const startAt = new Date(endAt.getTime() - 6 * 60 * 60 * 1000)
    return new URLSearchParams({
      window: 'custom',
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      series: INFRASTRUCTURE_SERIES_QUERY,
    })
  }

  return new URLSearchParams({
    window: range,
    series: INFRASTRUCTURE_SERIES_QUERY,
  })
}

function buildCustomRangeQuery(range: CustomRangeState): URLSearchParams | null {
  const startAt = toUtcIsoString(range.startLocal)
  const endAt = toUtcIsoString(range.endLocal)
  if (!startAt || !endAt || !isValidCustomRange(range)) return null
  return new URLSearchParams({
    window: 'custom',
    startAt,
    endAt,
    series: INFRASTRUCTURE_SERIES_QUERY,
  })
}

function latestObservedAt(platformItems: MonitorOverviewItem[], services: ServiceItem[]): string {
  const timestamps = [
    ...platformItems.map(item => item.lastTransitionAt),
    ...services.map(item => item.last_detected_at),
  ]
    .map(value => new Date(value).getTime())
    .filter(value => Number.isFinite(value))

  if (timestamps.length === 0) return '—'
  return new Date(Math.max(...timestamps)).toLocaleString()
}

function derivePlatformAvailability(
  platformItems: MonitorOverviewItem[],
  services: ServiceItem[]
): AvailabilitySummary {
  const platformMap = new Map(platformItems.map(item => [item.targetId, item]))
  const serviceMap = new Map(services.map(item => [item.name, item]))

  const capabilityDefinitions = [
    {
      label: 'Console Access',
      targetIds: ['appos-core'],
      serviceNames: ['appos-core', 'nginx'],
      fallbackReason: 'Core runtime and proxy are responding normally.',
    },
    {
      label: 'Application Management',
      targetIds: ['appos-core'],
      serviceNames: ['appos-core', 'redis'],
      fallbackReason: 'Core management services are available.',
    },
    {
      label: 'Background Jobs',
      targetIds: ['worker', 'scheduler'],
      serviceNames: ['appos-worker', 'appos-scheduler'],
      fallbackReason: 'Worker and scheduler signals are healthy.',
    },
    {
      label: 'Monitoring',
      targetIds: [],
      serviceNames: ['victoria-metrics', 'netdata'],
      fallbackReason: 'Monitoring collectors and storage are available.',
    },
  ]

  const capabilities = capabilityDefinitions.map(definition => {
    const targetSignals = definition.targetIds.map(targetId => {
      const item = platformMap.get(targetId)
      return {
        level: toSignalLevelFromTarget(item?.status),
        reason: item?.reason || `${formatStatusLabel(targetId)} signal is not reporting normally.`,
      }
    })
    const serviceSignals = definition.serviceNames.map(serviceName => {
      const service = serviceMap.get(serviceName)
      return {
        level: toSignalLevelFromService(service?.state),
        reason: service
          ? `${service.name} is ${service.state}.`
          : `${serviceName} is not detected in active services.`,
      }
    })

    const level = combineSignalLevels([
      ...targetSignals.map(signal => signal.level),
      ...serviceSignals.map(signal => signal.level),
    ])
    const blockingReason = [...targetSignals, ...serviceSignals].find(signal => {
      if (level === 'unavailable') return signal.level === 'unavailable'
      if (level === 'degraded') return signal.level === 'degraded' || signal.level === 'unavailable'
      return false
    })

    return {
      label: definition.label,
      level: capabilityLevelFromSignal(level),
      reason: blockingReason?.reason ?? definition.fallbackReason,
    }
  })

  const overallLevel = combineSignalLevels(
    capabilities.map(item => {
      if (item.level === 'available') return 'healthy'
      if (item.level === 'unavailable') return 'unavailable'
      return 'degraded'
    })
  )

  const primaryReason =
    capabilities.find(item => item.level === 'unavailable')?.reason
    ?? capabilities.find(item => item.level === 'limited')?.reason
    ?? 'All core platform capabilities are reporting healthy signals.'

  const description =
    overallLevel === 'healthy'
      ? 'The platform is available for normal operations.'
      : overallLevel === 'unavailable'
        ? 'Core management is unavailable. Immediate operator attention is required.'
        : 'Core management remains available, but some capabilities are operating with reduced confidence.'

  return {
    level: overallLevel,
    title: overallLevel === 'healthy' ? 'Available' : overallLevel === 'unavailable' ? 'Unavailable' : 'Degraded',
    description,
    primaryReason,
    lastChecked: latestObservedAt(platformItems, services),
    capabilities,
  }
}

export function PlatformStatusPage() {
  const [overview, setOverview] = useState<MonitorOverviewResponse>(() => normalizeOverviewResponse(undefined))
  const [services, setServices] = useState<ServiceItem[]>([])
  const [infrastructure, setInfrastructure] = useState<MonitorSeriesResponse | null>(null)
  const [selectedRange, setSelectedRange] = useState<RangeOption>('1h')
  const [draftCustomRange, setDraftCustomRange] = useState<CustomRangeState>(() => createDefaultCustomRange())
  const [appliedCustomRange, setAppliedCustomRange] = useState<CustomRangeState>(() => createDefaultCustomRange())
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [componentsOpen, setComponentsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const customRangeRef = useRef<HTMLDivElement | null>(null)
  const startInputRef = useRef<HTMLInputElement | null>(null)
  const endInputRef = useRef<HTMLInputElement | null>(null)

  const loadStatus = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError('')

    try {
      const rangeQuery = selectedRange === 'custom'
        ? buildCustomRangeQuery(appliedCustomRange)
        : buildRangeQuery(selectedRange)
      const [overviewResult, servicesResult, infrastructureResult] = await Promise.allSettled([
        pb.send<MonitorOverviewResponse>('/api/monitor/overview', { method: 'GET' }),
        fetchActiveServices(),
        pb.send<MonitorSeriesResponse>(
          `/api/monitor/targets/platform/appos-core/series?${(rangeQuery ?? buildRangeQuery('1h')).toString()}`,
          { method: 'GET' }
        ),
      ])

      const failedCount = [overviewResult, servicesResult, infrastructureResult].filter(
        result => result.status === 'rejected'
      ).length

      if (failedCount === 3) {
        throw new Error('Failed to load platform status')
      }

      if (failedCount > 0) {
        setError('Some status sections are temporarily unavailable.')
      }

      if (overviewResult.status === 'fulfilled') {
        setOverview(normalizeOverviewResponse(overviewResult.value))
      }
      if (servicesResult.status === 'fulfilled') {
        setServices(servicesResult.value)
      }
      if (infrastructureResult.status === 'fulfilled') {
        setInfrastructure({
          ...infrastructureResult.value,
          series: Array.isArray(infrastructureResult.value.series) ? infrastructureResult.value.series : [],
        })
      } else {
        setInfrastructure(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform status')
      setInfrastructure(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [appliedCustomRange, selectedRange])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadStatus(true)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [loadStatus])

  useEffect(() => {
    if (!customRangeOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (customRangeRef.current?.contains(event.target as Node)) return
      setCustomRangeOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [customRangeOpen])

  const availability = useMemo(
    () => derivePlatformAvailability(overview.platformItems, services),
    [overview.platformItems, services]
  )

  const infrastructureSeries = useMemo(
    () => orderedInfrastructureSeries(infrastructure?.series),
    [infrastructure]
  )

  const handleRangeChange = useCallback((nextRange: RangeOption) => {
    if (nextRange === 'custom') {
      setDraftCustomRange(appliedCustomRange)
      setCustomRangeOpen(current => !current)
      return
    }

    setCustomRangeOpen(false)
    setSelectedRange(nextRange)
  }, [appliedCustomRange])

  const applyCustomRange = useCallback(() => {
    if (!isValidCustomRange(draftCustomRange)) return
    setAppliedCustomRange(draftCustomRange)
    setSelectedRange('custom')
    setCustomRangeOpen(false)
  }, [draftCustomRange])

  const cancelCustomRange = useCallback(() => {
    setDraftCustomRange(appliedCustomRange)
    setCustomRangeOpen(false)
  }, [appliedCustomRange])

  const openNativePicker = useCallback((input: HTMLInputElement | null) => {
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void }
    pickerInput.showPicker?.()
    input?.focus()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Status</h1>
          <p className="mt-1 text-muted-foreground">
            Unified platform status for AppOS runtime, services, and infrastructure.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh status"
          onClick={() => void loadStatus(true)}
          disabled={loading || refreshing}
        >
          {loading || refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Platform Availability</CardTitle>
              <CardDescription>{availability.description}</CardDescription>
            </div>
            <Badge variant={availabilityBadgeVariant(availability.level)}>{availability.title}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            {availability.capabilities.map(item => (
              <div key={item.label} className="rounded-lg border bg-background px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  <Badge variant={item.level === 'available' ? 'default' : item.level === 'unavailable' ? 'destructive' : 'outline'}>
                    {item.level === 'available' ? 'Available' : item.level === 'unavailable' ? 'Unavailable' : 'Limited'}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.reason}</p>
              </div>
            ))}
          </div>
          <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
            <div>
              <div className="text-sm font-medium text-foreground">Primary reason</div>
              <p className="mt-2 text-sm text-muted-foreground">{availability.primaryReason}</p>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">Last checked</div>
              <p className="mt-2 text-sm text-muted-foreground">{availability.lastChecked}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Platform performance</CardTitle>
              <CardDescription>Runtime performance trends.</CardDescription>
            </div>
            <div ref={customRangeRef} className="relative flex flex-col items-end gap-3">
              <SharedTimeRangeSelector
                value={selectedRange}
                options={RANGE_OPTIONS}
                onChange={handleRangeChange}
                isOptionActive={(option, current) => {
                  if (option === 'custom') return customRangeOpen || current === 'custom'
                  return !customRangeOpen && current === option
                }}
                ariaLabel="Platform performance time range"
              />
              {customRangeOpen ? (
                <div className="absolute right-0 top-full z-20 mt-2 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-5 shadow-lg">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground" htmlFor="platformPerfStart">
                        Start
                      </label>
                      <div className="relative">
                        <Input
                          ref={startInputRef}
                          id="platformPerfStart"
                          type="datetime-local"
                          value={draftCustomRange.startLocal}
                          onChange={event => setDraftCustomRange(current => ({ ...current, startLocal: event.target.value }))}
                          max={draftCustomRange.endLocal || undefined}
                          className="pr-12 text-left [appearance:textfield] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full"
                        />
                        <button
                          type="button"
                          aria-label="Open start date picker"
                          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => openNativePicker(startInputRef.current)}
                        >
                          <CalendarDays className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground" htmlFor="platformPerfEnd">
                        End
                      </label>
                      <div className="relative">
                        <Input
                          ref={endInputRef}
                          id="platformPerfEnd"
                          type="datetime-local"
                          value={draftCustomRange.endLocal}
                          onChange={event => setDraftCustomRange(current => ({ ...current, endLocal: event.target.value }))}
                          min={draftCustomRange.startLocal || undefined}
                          className="pr-12 text-left [appearance:textfield] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full"
                        />
                        <button
                          type="button"
                          aria-label="Open end date picker"
                          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => openNativePicker(endInputRef.current)}
                        >
                          <CalendarDays className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">{formatCustomRangeDescription(draftCustomRange)}</div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={cancelCustomRange}>
                        Cancel
                      </Button>
                      <Button onClick={applyCustomRange} disabled={!isValidCustomRange(draftCustomRange)}>
                        Apply
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && infrastructureSeries.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading infrastructure trends...
            </div>
          ) : infrastructureSeries.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
              Infrastructure trends are not available yet.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              {infrastructureSeries.map(item => (
                <div key={item.name} className="rounded-lg border bg-background p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Activity className="h-4 w-4 text-muted-foreground" />
                        {formatSeriesLabel(item.name)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{latestSeriesSummary(item)}</div>
                    </div>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.unit}</span>
                  </div>
                  <TimeSeriesChart
                    name={item.name}
                    unit={item.unit}
                    window={infrastructure?.window ?? '1h'}
                    rangeStartAt={infrastructure?.rangeStartAt}
                    rangeEndAt={infrastructure?.rangeEndAt}
                    stepSeconds={infrastructure?.stepSeconds}
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

      <Sheet open={componentsOpen} onOpenChange={setComponentsOpen}>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Bundled services</CardTitle>
                <CardDescription>Core runtime and bundled services remain the main diagnostic table.</CardDescription>
              </div>
              <a
                href="#bundle-components"
                className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                onClick={event => {
                  event.preventDefault()
                  setComponentsOpen(true)
                }}
              >
                Bundle &gt;
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <ActiveServicesContent />
          </CardContent>
        </Card>

        <SheetContent side="right" showCloseButton={false} className="w-full sm:max-w-4xl overflow-y-auto p-0">
          <BundleComponentsSheetContent onClose={() => setComponentsOpen(false)} />
        </SheetContent>
      </Sheet>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Platform Targets</CardTitle>
              <CardDescription>Control-plane runtime health as secondary evidence for availability.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && overview.platformItems.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading platform targets...
            </div>
          ) : overview.platformItems.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
              Platform self-observation has not reported yet.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              {overview.platformItems.map(item => {
                const detailEntries = platformTargetDetailEntries(item)

                return (
                  <div key={item.targetId} className="rounded-lg border bg-background px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{item.displayName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.targetId}</div>
                      </div>
                      <Badge variant={statusVariant(item.status)}>{formatStatusLabel(item.status)}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{summarizePlatformTarget(item)}</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      {detailEntries.map(([key, value]) => (
                        <div key={key} className="px-0 py-1">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {formatStatusLabel(key)}
                          </div>
                          <div className="mt-1 text-sm text-foreground">{formatSummaryValue(key, value)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 text-xs text-muted-foreground">Updated {formatTimestamp(item.lastTransitionAt)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}