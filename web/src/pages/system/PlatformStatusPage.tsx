import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CalendarDays, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SharedTimeRangeSelector } from '@/components/monitor/SharedTimeRangeSelector'
import { TimeSeriesChart } from '@/components/monitor/TimeSeriesChart'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  fetchActiveServices,
  type ServiceItem,
} from '@/pages/platform-components/platform-component-status-shared'
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
import { getRejectedSections, warnDegradedSections } from '@/lib/degraded-sections'
import i18n from '@/lib/i18n'
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

type MonitorLatestResponse = {
  targetType: string
  targetId: string
  cadenceSeconds?: number
  series: MonitorSeries[]
}

type RangeOption = '1m' | '5m' | '15m' | '0.5h' | '1h' | '5h' | '12h' | '24h' | '7d' | 'custom'

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

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

type AvailabilitySummary = {
  level: SignalLevel
  title: string
  description: string
  primaryReason: string
  lastChecked: string
  capabilities: AvailabilityCapability[]
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

const PLATFORM_PERFORMANCE_SERIES_QUERY = 'cpu,memory,disk_usage,disk,network,network_traffic'
const PLATFORM_LATEST_QUERY = 'cpu,memory,disk_usage,disk,network,network_traffic'
const LATEST_STAT_ORDER = ['cpu', 'memory', 'disk_usage', 'disk', 'network', 'network_traffic']
const RANGE_OPTIONS: Array<{ value: RangeOption; label: string }> = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '0.5h', label: '0.5h' },
  { value: '1h', label: '1h' },
  { value: '5h', label: '5h' },
  { value: '12h', label: '12h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: 'custom', label: 'custom' },
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
    return i18n.t('system:platformStatus.performance.customRange.invalid', {
      defaultValue: 'Choose a valid custom range.',
    })
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
  if (normalized === 'network_traffic') return 'Network Traffic'
  return formatStatusLabel(value)
}

function numericSummaryValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildPlatformSummaryFallbackSeries(
  summary?: Record<string, unknown>,
  observedAt?: string
): MonitorSeries[] {
  if (!summary) return []
  const timestamp = (() => {
    const parsed = observedAt ? new Date(observedAt) : null
    if (parsed && !Number.isNaN(parsed.getTime())) return Math.floor(parsed.getTime() / 1000)
    return Math.floor(Date.now() / 1000)
  })()
  const cpuPercent = numericSummaryValue(summary.cpu_percent)
  const memoryUsed = numericSummaryValue(summary.memory_bytes)
  const memoryAvailable = numericSummaryValue(summary.memory_available_bytes)
  const items: MonitorSeries[] = []

  if (cpuPercent !== null) {
    items.push({ name: 'cpu', unit: 'percent', points: [[timestamp, cpuPercent]] })
  }
  if (memoryUsed !== null) {
    items.push({
      name: 'memory',
      unit: 'bytes',
      segments: [
        { name: 'used', points: [[timestamp, memoryUsed]] },
        ...(memoryAvailable !== null
          ? [{ name: 'available', points: [[timestamp, memoryAvailable]] }]
          : []),
      ],
    })
  }

  return items
}

function hasUsableSeriesData(series: MonitorSeries | undefined): boolean {
  if (!series) return false
  if ((series.points ?? []).some(point => Number.isFinite(point[1] ?? NaN))) {
    return true
  }
  return (series.segments ?? []).some(segment =>
    segment.points.some(point => Number.isFinite(point[1] ?? NaN))
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

function latestTimestamp(points: number[][]): number | null {
  const timestamps = points.map(point => point[0]).filter(value => Number.isFinite(value))
  return timestamps.length > 0 ? timestamps[timestamps.length - 1] * 1000 : null
}

function latestMetricTimestamp(item: MonitorSeries): number | null {
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

function latestStatsUpdatedAt(series: MonitorSeries[]): {
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

function latestSegmentValue(item: MonitorSeries, name: string): number | null {
  const segment = item.segments?.find(candidate => candidate.name === name)
  return segment ? latestValue(segment.points) : null
}

function metricPercent(item: MonitorSeries): number | null {
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
    const used = latestSegmentValue(item, 'used')
    const free = latestSegmentValue(item, 'free')
    if (used !== null && free !== null && used + free > 0) {
      return clampPercent((used / (used + free)) * 100)
    }
  }
  return null
}

function formatSeriesLatestLabel(item: MonitorSeries): string {
  const latest = latestValue(item.points ?? [])
  const latestUsed = latestSegmentValue(item, 'used')
  const latestAvailable = latestSegmentValue(item, 'available')
  const latestFree = latestSegmentValue(item, 'free')
  const latestRead = latestSegmentValue(item, 'read')
  const latestWrite = latestSegmentValue(item, 'write')
  const latestInbound = latestSegmentValue(item, 'in')
  const latestOutbound = latestSegmentValue(item, 'out')

  if (latest !== null) {
    return formatTrendValue(item.unit, item.name, latest)
  }
  if (item.name === 'memory' && latestUsed !== null) {
    if (latestAvailable !== null) {
      const limit = latestUsed + latestAvailable
      return `${formatBytes(latestUsed)} ${i18n.t('system:platformStatus.shared.used', { defaultValue: 'used' })} / ${formatBytes(limit)} ${i18n.t('system:platformStatus.shared.limit', { defaultValue: 'limit' })}`
    }
    return `${formatBytes(latestUsed)} ${i18n.t('system:platformStatus.shared.used', { defaultValue: 'used' })}`
  }
  if (item.name === 'disk_usage' && (latestUsed !== null || latestFree !== null)) {
    return `${latestUsed === null ? '—' : formatBytes(latestUsed)} ${i18n.t('system:platformStatus.shared.used', { defaultValue: 'used' })}${latestFree === null ? '' : ` / ${formatBytes(latestFree)} ${i18n.t('system:platformStatus.shared.free', { defaultValue: 'free' })}`}`
  }
  if (item.name === 'disk' && (latestRead !== null || latestWrite !== null)) {
    return `${latestRead === null ? '—' : `${formatBytes(latestRead)}/s`} ${i18n.t('system:platformStatus.shared.read', { defaultValue: 'read' })}${latestWrite === null ? '' : ` / ${formatBytes(latestWrite)}/s ${i18n.t('system:platformStatus.shared.write', { defaultValue: 'write' })}`}`
  }
  if (item.name === 'network' && (latestInbound !== null || latestOutbound !== null)) {
    return `${latestInbound === null ? '—' : `${formatBytes(latestInbound)}/s`} ${i18n.t('system:platformStatus.shared.in', { defaultValue: 'in' })}${latestOutbound === null ? '' : ` / ${formatBytes(latestOutbound)}/s ${i18n.t('system:platformStatus.shared.out', { defaultValue: 'out' })}`}`
  }
  if (item.name === 'network_traffic' && (latestInbound !== null || latestOutbound !== null)) {
    return `${latestInbound === null ? '—' : formatBytes(latestInbound)} ${i18n.t('system:platformStatus.shared.in', { defaultValue: 'in' })}${latestOutbound === null ? '' : ` / ${formatBytes(latestOutbound)} ${i18n.t('system:platformStatus.shared.out', { defaultValue: 'out' })}`}`
  }
  return '—'
}

function comparisonBars(item: MonitorSeries) {
  const pairs =
    item.name === 'disk'
      ? [
          {
            key: 'read',
            label: i18n.t('system:platformStatus.shared.read', { defaultValue: 'Read' }),
            value: latestSegmentValue(item, 'read'),
          },
          {
            key: 'write',
            label: i18n.t('system:platformStatus.shared.write', { defaultValue: 'Write' }),
            value: latestSegmentValue(item, 'write'),
          },
        ]
      : [
          {
            key: 'in',
            label: i18n.t('system:platformStatus.shared.in', { defaultValue: 'In' }),
            value: latestSegmentValue(item, 'in'),
          },
          {
            key: 'out',
            label: i18n.t('system:platformStatus.shared.out', { defaultValue: 'Out' }),
            value: latestSegmentValue(item, 'out'),
          },
        ]
  const maxValue = Math.max(...pairs.map(pair => Math.abs(pair.value ?? 0)), 0)

  return pairs.map(pair => ({
    ...pair,
    display:
      pair.value === null
        ? '—'
        : item.unit === 'bytes/s'
          ? `${formatBytes(pair.value)}/s`
          : formatTrendValue(item.unit, `${item.name}_${pair.key}`, pair.value),
    percent:
      pair.value === null || maxValue <= 0
        ? 0
        : Math.max(10, clampPercent((Math.abs(pair.value) / maxValue) * 100)),
  }))
}

function buildLatestStatItems(series: MonitorSeries[]): LatestStatItem[] {
  const supported = LATEST_STAT_ORDER.map(name => series.find(item => item.name === name)).filter(
    (item): item is MonitorSeries => Boolean(item)
  )

  return supported.map(item => ({
    key: item.name,
    label: formatSeriesLabel(item.name),
    value: formatSeriesLatestLabel(item),
    unit: item.unit,
    variant: ['cpu', 'memory', 'disk_usage'].includes(item.name) ? 'gauge' : 'bars',
    updatedAt: latestMetricTimestamp(item),
    percent: metricPercent(item),
    bars: comparisonBars(item),
  }))
}

function buildSummaryFallbackLatestStatItems(summary?: Record<string, unknown>): LatestStatItem[] {
  if (!summary) return []
  const cpuPercent = numericSummaryValue(summary.cpu_percent)
  const memoryUsed = numericSummaryValue(summary.memory_bytes)
  const memoryAvailable = numericSummaryValue(summary.memory_available_bytes)
  const items: LatestStatItem[] = []

  if (cpuPercent !== null) {
    items.push({
      key: 'cpu',
      label: formatSeriesLabel('cpu'),
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
      label: formatSeriesLabel('memory'),
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
      ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { hour: '2-digit', minute: '2-digit', second: '2-digit' }
  )
}

function formatUpdatedAtText(timestamps: { oldest: number | null; newest: number | null }): string {
  if (timestamps.newest === null) {
    return i18n.t('system:platformStatus.shared.updatedAtEmpty', { defaultValue: 'Updated at —' })
  }
  const newestDate = new Date(timestamps.newest)
  const oldestDate = timestamps.oldest === null ? null : new Date(timestamps.oldest)
  const includeDate =
    newestDate.toDateString() !== new Date().toDateString() ||
    (oldestDate !== null && oldestDate.toDateString() !== newestDate.toDateString())
  if (timestamps.oldest !== null && timestamps.oldest !== timestamps.newest) {
    return i18n.t('system:platformStatus.shared.updatedAtRange', {
      start: formatUpdatedAtValue(timestamps.oldest, includeDate),
      end: formatUpdatedAtValue(timestamps.newest, includeDate),
      defaultValue: `Updated at ${formatUpdatedAtValue(timestamps.oldest, includeDate)} - ${formatUpdatedAtValue(timestamps.newest, includeDate)}`,
    })
  }
  return i18n.t('system:platformStatus.shared.updatedAt', {
    time: formatUpdatedAtValue(timestamps.newest, includeDate),
    defaultValue: `Updated at ${formatUpdatedAtValue(timestamps.newest, includeDate)}`,
  })
}

function latestSeriesSummary(series: MonitorSeries): string {
  const latest = latestValue(series.points ?? [])
  const used = series.segments?.find(segment => segment.name === 'used')
  const available = series.segments?.find(segment => segment.name === 'available')
  const free = series.segments?.find(segment => segment.name === 'free')
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
      if (latestAvailable !== null) {
        const limit = latestUsed + latestAvailable
        const percent = limit > 0 ? (latestUsed / limit) * 100 : null
        return `${formatBytes(latestUsed)} / ${formatBytes(limit)}${percent === null ? '' : ` (${formatTrendValue('percent', 'memory_percent', percent)})`}`
      }
      return `${formatBytes(latestUsed)} ${i18n.t('system:platformStatus.shared.used', { defaultValue: 'used' })}`
    }
  }

  if (series.name === 'disk_usage') {
    const latestUsed = latestValue(used?.points ?? [])
    const latestFree = latestValue(free?.points ?? [])
    if (latestUsed !== null || latestFree !== null) {
        return `${latestUsed === null ? '—' : formatBytes(latestUsed)} ${i18n.t('system:platformStatus.shared.used', { defaultValue: 'used' })}${latestFree === null ? '' : ` / ${formatBytes(latestFree)} ${i18n.t('system:platformStatus.shared.free', { defaultValue: 'free' })}`}`
    }
  }

  if (series.name === 'network') {
    const latestInbound = latestValue(inbound?.points ?? [])
    const latestOutbound = latestValue(outbound?.points ?? [])
    if (latestInbound !== null || latestOutbound !== null) {
        return `${latestInbound === null ? '—' : `${formatBytes(latestInbound)}/s`} ${i18n.t('system:platformStatus.shared.in', { defaultValue: 'in' })}${latestOutbound === null ? '' : ` / ${formatBytes(latestOutbound)}/s ${i18n.t('system:platformStatus.shared.out', { defaultValue: 'out' })}`}`
    }
  }

  if (series.name === 'network_traffic') {
    const latestInbound = latestValue(inbound?.points ?? [])
    const latestOutbound = latestValue(outbound?.points ?? [])
    if (latestInbound !== null || latestOutbound !== null) {
        return `${latestInbound === null ? '—' : formatBytes(latestInbound)} ${i18n.t('system:platformStatus.shared.in', { defaultValue: 'in' })}${latestOutbound === null ? '' : ` / ${formatBytes(latestOutbound)} ${i18n.t('system:platformStatus.shared.out', { defaultValue: 'out' })}`}`
    }
  }

  if (series.name === 'disk') {
    const latestRead = latestValue(read?.points ?? [])
    const latestWrite = latestValue(write?.points ?? [])
    if (latestRead !== null || latestWrite !== null) {
        return `${latestRead === null ? '—' : `${formatBytes(latestRead)}/s`} ${i18n.t('system:platformStatus.shared.read', { defaultValue: 'read' })}${latestWrite === null ? '' : ` / ${formatBytes(latestWrite)}/s ${i18n.t('system:platformStatus.shared.write', { defaultValue: 'write' })}`}`
    }
  }

  return '—'
}

function orderedPlatformPerformanceSeries(input: MonitorSeries[] | undefined): MonitorSeries[] {
  const items = Array.isArray(input) ? input : []
  const cpu = items.find(item => item.name === 'cpu')
  const memory = items.find(item => item.name === 'memory')
  const diskUsage = items.find(item => item.name === 'disk_usage')
  const disk = items.find(item => item.name === 'disk')
  const network = items.find(item => item.name === 'network')
  const networkTraffic = items.find(item => item.name === 'network_traffic')

  return [cpu, memory, diskUsage, disk, network, networkTraffic].filter(
    (item): item is MonitorSeries => Boolean(item)
  )
}

function summarizePlatformTarget(item: MonitorOverviewItem): string {
  if (item.reason) return item.reason
  const firstSummaryEntry = Object.entries(item.summary ?? {}).find(([key]) => !key.endsWith('_at'))
  if (!firstSummaryEntry) {
    return i18n.t('system:platformStatus.shared.noActiveIssue', {
      defaultValue: 'No active issue reported.',
    })
  }
  return `${formatStatusLabel(firstSummaryEntry[0])}: ${formatSummaryValue(firstSummaryEntry[0], firstSummaryEntry[1])}`
}

function platformTargetDetailEntries(item: MonitorOverviewItem): Array<[string, unknown]> {
  return Object.entries(item.summary ?? {})
    .filter(
      ([key, value]) =>
        !key.endsWith('_at') && value !== null && value !== undefined && value !== ''
    )
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

function availabilityBadgeVariant(
  level: SignalLevel
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (level === 'healthy') return 'default'
  if (level === 'unavailable') return 'destructive'
  if (level === 'degraded') return 'outline'
  return 'secondary'
}

function buildRangeQuery(range: RangeOption): URLSearchParams {
  return new URLSearchParams({
    window: range,
    series: PLATFORM_PERFORMANCE_SERIES_QUERY,
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
    series: PLATFORM_PERFORMANCE_SERIES_QUERY,
  })
}

function latestObservedAt(platformItems: MonitorOverviewItem[], services: ServiceItem[]): string {
  const timestamps = [
    ...platformItems.map(item => item.lastTransitionAt),
    ...services.map(item => item.last_detected_at),
  ]
    .map(value => new Date(value).getTime())
    .filter(value => Number.isFinite(value))

  if (timestamps.length === 0) return i18n.t('system:shared.emptyDash', { defaultValue: '—' })
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
      label: i18n.t('system:platformStatus.capabilities.consoleAccess', { defaultValue: 'Console Access' }),
      targetIds: ['appos-core'],
      serviceNames: [],
      fallbackReason: i18n.t('system:platformStatus.capabilityReasons.consoleAccessOk', { defaultValue: 'Core runtime signals are responding normally.' }),
    },
    {
      label: i18n.t('system:platformStatus.capabilities.applicationManagement', { defaultValue: 'Application Management' }),
      targetIds: ['appos-core'],
      serviceNames: ['redis'],
      fallbackReason: i18n.t('system:platformStatus.capabilityReasons.applicationManagementOk', { defaultValue: 'Core management services are available.' }),
    },
    {
      label: i18n.t('system:platformStatus.capabilities.backgroundJobs', { defaultValue: 'Background Jobs' }),
      targetIds: ['worker', 'scheduler'],
      serviceNames: [],
      fallbackReason: i18n.t('system:platformStatus.capabilityReasons.backgroundJobsOk', { defaultValue: 'Worker and scheduler signals are healthy.' }),
    },
    {
      label: i18n.t('system:platformStatus.capabilities.monitoring', { defaultValue: 'Monitoring' }),
      targetIds: ['appos-core'],
      serviceNames: ['victoria-metrics'],
      fallbackReason: i18n.t('system:platformStatus.capabilityReasons.monitoringOk', { defaultValue: 'Monitoring storage and the AppOS self-collector are available.' }),
    },
  ]

  const capabilities = capabilityDefinitions.map(definition => {
    const targetSignals = definition.targetIds.map(targetId => {
      const item = platformMap.get(targetId)
      return {
        level: toSignalLevelFromTarget(item?.status),
        reason:
          item?.reason ||
          i18n.t('system:platformStatus.capabilityReasons.signalNotReporting', {
            target: formatStatusLabel(targetId),
            defaultValue: `${formatStatusLabel(targetId)} signal is not reporting normally.`,
          }),
      }
    })
    const serviceSignals = definition.serviceNames.map(serviceName => {
      const service = serviceMap.get(serviceName)
      return {
        level: toSignalLevelFromService(service?.state),
        reason: service
          ? i18n.t('system:platformStatus.capabilityReasons.serviceState', {
              name: service.name,
              state: service.state,
              defaultValue: `${service.name} is ${service.state}.`,
            })
          : i18n.t('system:platformStatus.capabilityReasons.serviceMissing', {
              name: serviceName,
              defaultValue: `${serviceName} is not detected in active services.`,
            }),
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
    capabilities.find(item => item.level === 'unavailable')?.reason ??
    capabilities.find(item => item.level === 'limited')?.reason ??
    i18n.t('system:platformStatus.capabilityReasons.allHealthy', {
      defaultValue: 'All core platform capabilities are reporting healthy signals.',
    })

  const description =
    overallLevel === 'healthy'
      ? i18n.t('system:platformStatus.availabilityDescriptions.available', {
          defaultValue: 'The platform is available for normal operations.',
        })
      : overallLevel === 'unavailable'
        ? i18n.t('system:platformStatus.availabilityDescriptions.unavailable', {
            defaultValue: 'Core management is unavailable. Immediate operator attention is required.',
          })
        : i18n.t('system:platformStatus.availabilityDescriptions.degraded', {
            defaultValue:
              'Core management remains available, but some capabilities are operating with reduced confidence.',
          })

  return {
    level: overallLevel,
    title:
      overallLevel === 'healthy'
        ? i18n.t('system:platformStatus.availability.available', { defaultValue: 'Available' })
        : overallLevel === 'unavailable'
          ? i18n.t('system:platformStatus.availability.unavailable', {
              defaultValue: 'Unavailable',
            })
          : i18n.t('system:platformStatus.availability.degraded', { defaultValue: 'Degraded' }),
    description,
    primaryReason,
    lastChecked: latestObservedAt(platformItems, services),
    capabilities,
  }
}

export function PlatformStatusPage() {
  const { t } = useTranslation('system')
  const [documentVisible, setDocumentVisible] = useState(isDocumentVisible)
  const previousDocumentVisible = useRef(documentVisible)
  const [overview, setOverview] = useState<MonitorOverviewResponse>(() =>
    normalizeOverviewResponse(undefined)
  )
  const [services, setServices] = useState<ServiceItem[]>([])
  const [platformPerformance, setPlatformPerformance] = useState<MonitorSeriesResponse | null>(null)
  const [platformLatest, setPlatformLatest] = useState<MonitorLatestResponse | null>(null)
  const [selectedRange, setSelectedRange] = useState<RangeOption>('1h')
  const [draftCustomRange, setDraftCustomRange] = useState<CustomRangeState>(() =>
    createDefaultCustomRange()
  )
  const [appliedCustomRange, setAppliedCustomRange] = useState<CustomRangeState>(() =>
    createDefaultCustomRange()
  )
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [trendLoading, setTrendLoading] = useState(true)
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
      const [overviewResult, servicesResult, platformLatestResult] = await Promise.allSettled([
        pb.send<MonitorOverviewResponse>('/api/monitor/overview', { method: 'GET' }),
        fetchActiveServices(),
        pb.send<MonitorLatestResponse>(
          `/api/monitor/targets/platform/appos-core/latest?${new URLSearchParams({ series: PLATFORM_LATEST_QUERY }).toString()}`,
          { method: 'GET' }
        ),
      ])

      const failures = getRejectedSections([
        { section: 'overview', result: overviewResult },
        { section: 'services', result: servicesResult },
        { section: 'platformLatest', result: platformLatestResult },
      ])

      if (failures.length === 3) {
        throw new Error('Failed to load platform status')
      }

      if (failures.length > 0) {
        warnDegradedSections('Platform status', failures)
        setError('Some status sections are temporarily unavailable.')
      }

      if (overviewResult.status === 'fulfilled') {
        setOverview(normalizeOverviewResponse(overviewResult.value))
      }
      if (servicesResult.status === 'fulfilled') {
        setServices(servicesResult.value)
      }
      if (platformLatestResult.status === 'fulfilled') {
        setPlatformLatest({
          ...platformLatestResult.value,
          series: Array.isArray(platformLatestResult.value.series)
            ? platformLatestResult.value.series
            : [],
        })
      } else {
        setPlatformLatest(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform status')
      setPlatformLatest(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadTrend = useCallback(async () => {
    setTrendLoading(true)
    try {
      const rangeQuery =
        selectedRange === 'custom'
          ? buildCustomRangeQuery(appliedCustomRange)
          : buildRangeQuery(selectedRange)
      const result = await pb.send<MonitorSeriesResponse>(
        `/api/monitor/targets/platform/appos-core/series?${(rangeQuery ?? buildRangeQuery('1h')).toString()}`,
        { method: 'GET' }
      )
      setPlatformPerformance({
        ...result,
        series: Array.isArray(result.series) ? result.series : [],
      })
    } catch {
      setPlatformPerformance(null)
    } finally {
      setTrendLoading(false)
    }
  }, [selectedRange, appliedCustomRange])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    void loadTrend()
  }, [loadTrend])

  useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(isDocumentVisible())
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    if (!documentVisible) return
    const timer = window.setInterval(() => {
      void loadStatus(true)
      void loadTrend()
    }, 30000)
    return () => window.clearInterval(timer)
  }, [documentVisible, loadStatus, loadTrend])

  useEffect(() => {
    if (!documentVisible) return
    const cadenceSeconds = Math.max(platformLatest?.cadenceSeconds ?? 10, 1)
    const timer = window.setInterval(() => {
      void pb
        .send<MonitorLatestResponse>(
          `/api/monitor/targets/platform/appos-core/latest?${new URLSearchParams({ series: PLATFORM_LATEST_QUERY }).toString()}`,
          { method: 'GET' }
        )
        .then(response => {
          setPlatformLatest({
            ...response,
            series: Array.isArray(response.series) ? response.series : [],
          })
        })
        .catch(() => {
          setPlatformLatest(null)
        })
    }, cadenceSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [documentVisible, platformLatest?.cadenceSeconds])

  useEffect(() => {
    const becameVisible = !previousDocumentVisible.current && documentVisible
    previousDocumentVisible.current = documentVisible
    if (!becameVisible) return
    void loadStatus(true)
    void loadTrend()
  }, [documentVisible, loadStatus, loadTrend])

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

  const platformPerformanceSeries = useMemo(() => {
    const apposCore = overview.platformItems.find(item => item.targetId === 'appos-core')
    const primary = (
      Array.isArray(platformPerformance?.series) ? platformPerformance.series : []
    ).filter(item => !['cpu', 'memory'].includes(item.name) || hasUsableSeriesData(item))
    const existing = new Set(
      primary
        .filter(item => !['cpu', 'memory'].includes(item.name) || hasUsableSeriesData(item))
        .map(item => item.name)
    )
    const fallback = buildPlatformSummaryFallbackSeries(
      apposCore?.summary,
      apposCore?.lastTransitionAt
    ).filter(item => !existing.has(item.name))
    return orderedPlatformPerformanceSeries([...primary, ...fallback])
  }, [overview.platformItems, platformPerformance])

  const latestStatItems = useMemo(() => {
    const apposCore = overview.platformItems.find(item => item.targetId === 'appos-core')
    const latestSeries = (platformLatest?.series ?? []).filter(
      item => !['cpu', 'memory'].includes(item.name) || hasUsableSeriesData(item)
    )
    const items = buildLatestStatItems(latestSeries)
    if (!apposCore?.summary) return items
    const existingKeys = new Set(items.map(item => item.key))
    const fallback = buildSummaryFallbackLatestStatItems(apposCore.summary).filter(
      item => !existingKeys.has(item.key)
    )
    if (fallback.length === 0) return items
    return LATEST_STAT_ORDER.map(
      name => items.find(item => item.key === name) ?? fallback.find(item => item.key === name)
    ).filter((item): item is LatestStatItem => Boolean(item))
  }, [overview.platformItems, platformLatest?.series])

  const latestStatUpdatedAt = useMemo(
    () => latestStatsUpdatedAt(platformLatest?.series ?? []),
    [platformLatest?.series]
  )

  const handleRangeChange = useCallback(
    (nextRange: RangeOption) => {
      if (nextRange === 'custom') {
        setDraftCustomRange(appliedCustomRange)
        setCustomRangeOpen(current => !current)
        return
      }

      setCustomRangeOpen(false)
      setSelectedRange(nextRange)
    },
    [appliedCustomRange]
  )

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
          <h1 className="text-2xl font-bold tracking-tight">
            {t('platformStatus.title', 'Status')}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t(
              'platformStatus.description',
              'Unified status for the AppOS control plane and monitoring surfaces.'
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('platformStatus.actions.refresh', 'Refresh status')}
          onClick={() => void loadStatus(true)}
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

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{t('platformStatus.availability.title', 'Platform Availability')}</CardTitle>
              <CardDescription>{availability.description}</CardDescription>
            </div>
            <Badge variant={availabilityBadgeVariant(availability.level)}>
              {availability.title}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            {availability.capabilities.map(item => (
              <div key={item.label} className="rounded-lg border bg-background px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  <Badge
                    variant={
                      item.level === 'available'
                        ? 'default'
                        : item.level === 'unavailable'
                          ? 'destructive'
                          : 'outline'
                    }
                  >
                    {item.level === 'available'
                      ? t('platformStatus.availability.available', 'Available')
                      : item.level === 'unavailable'
                        ? t('platformStatus.availability.unavailable', 'Unavailable')
                        : t('platformStatus.availability.limited', 'Limited')}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.reason}</p>
              </div>
            ))}
          </div>
          <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
            <div>
               <div className="text-sm font-medium text-foreground">
                 {t('platformStatus.availability.primaryReason', 'Primary reason')}
               </div>
              <p className="mt-2 text-sm text-muted-foreground">{availability.primaryReason}</p>
            </div>
            <div>
               <div className="text-sm font-medium text-foreground">
                 {t('platformStatus.availability.lastChecked', 'Last checked')}
               </div>
              <p className="mt-2 text-sm text-muted-foreground">{availability.lastChecked}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('platformStatus.performance.title', 'Platform performance')}</CardTitle>
          <CardDescription>
            {t(
              'platformStatus.performance.description',
              'Control-plane self metrics for the AppOS runtime container, including memory usage versus container limit.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <section className="rounded-lg border bg-muted/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t('platformStatus.performance.latestStat', 'Latest Stat')}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t(
                      'platformStatus.performance.latestStatDescription',
                      'Latest observed values sampled at monitor cadence.'
                    )}
                  </div>
                </div>
                {latestStatItems.length > 0 && (
                  <div className="shrink-0 rounded-md border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                    {formatUpdatedAtText(latestStatUpdatedAt)}
                  </div>
                )}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {loading && latestStatItems.length === 0
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex h-full flex-col rounded-md border bg-background px-4 py-4 animate-pulse"
                      >
                        <div className="h-2.5 w-14 rounded bg-muted mb-2" />
                        <div className="h-4 w-24 rounded bg-muted" />
                        <div className="mt-4 h-24 rounded bg-muted" />
                      </div>
                    ))
                  : latestStatItems.map(item => (
                      <PlatformLatestStatCard key={item.key} item={item} />
                    ))}
              </div>
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t('platformStatus.performance.trend', 'Trend')}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t(
                      'platformStatus.performance.trendDescription',
                      'Historical self-metrics across the selected time range.'
                    )}
                  </div>
                </div>
                <div ref={customRangeRef} className="relative flex flex-col items-end gap-2">
                  <SharedTimeRangeSelector
                    value={selectedRange}
                    options={RANGE_OPTIONS}
                    onChange={handleRangeChange}
                    isOptionActive={(option, current) => {
                      if (option === 'custom') return customRangeOpen || current === 'custom'
                      return !customRangeOpen && current === option
                    }}
                    ariaLabel={t(
                      'platformStatus.performance.timeRangeAria',
                      'Platform performance time range'
                    )}
                    className="justify-end gap-1.5"
                    buttonSize="xs"
                    buttonClassName="text-[11px]"
                  />
                  {customRangeOpen ? (
                    <div className="absolute right-0 top-full z-20 mt-2 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-5 shadow-lg">
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label
                            className="text-sm font-medium text-foreground"
                            htmlFor="platformPerfStart"
                          >
                            {t('platformStatus.performance.customRange.start', 'Start')}
                          </label>
                          <div className="relative">
                            <Input
                              ref={startInputRef}
                              id="platformPerfStart"
                              type="datetime-local"
                              value={draftCustomRange.startLocal}
                              onChange={event =>
                                setDraftCustomRange(current => ({
                                  ...current,
                                  startLocal: event.target.value,
                                }))
                              }
                              max={draftCustomRange.endLocal || undefined}
                              className="pr-12 text-left [appearance:textfield] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full"
                            />
                            <button
                              type="button"
                               aria-label={t(
                                 'platformStatus.performance.customRange.openStartPicker',
                                 'Open start date picker'
                               )}
                              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                              onClick={() => openNativePicker(startInputRef.current)}
                            >
                              <CalendarDays className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label
                            className="text-sm font-medium text-foreground"
                            htmlFor="platformPerfEnd"
                          >
                            {t('platformStatus.performance.customRange.end', 'End')}
                          </label>
                          <div className="relative">
                            <Input
                              ref={endInputRef}
                              id="platformPerfEnd"
                              type="datetime-local"
                              value={draftCustomRange.endLocal}
                              onChange={event =>
                                setDraftCustomRange(current => ({
                                  ...current,
                                  endLocal: event.target.value,
                                }))
                              }
                              min={draftCustomRange.startLocal || undefined}
                              className="pr-12 text-left [appearance:textfield] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full"
                            />
                            <button
                              type="button"
                               aria-label={t(
                                 'platformStatus.performance.customRange.openEndPicker',
                                 'Open end date picker'
                               )}
                              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                              onClick={() => openNativePicker(endInputRef.current)}
                            >
                              <CalendarDays className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatCustomRangeDescription(draftCustomRange)}
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={cancelCustomRange}>
                            {t('platformStatus.performance.customRange.cancel', 'Cancel')}
                          </Button>
                          <Button
                            onClick={applyCustomRange}
                            disabled={!isValidCustomRange(draftCustomRange)}
                          >
                            {t('platformStatus.performance.customRange.apply', 'Apply')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {trendLoading && platformPerformanceSeries.length === 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-lg border bg-background p-4 animate-pulse">
                      <div className="mb-3 h-4 w-20 rounded bg-muted" />
                      <div className="h-32 rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : platformPerformanceSeries.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  {t(
                    'platformStatus.performance.empty',
                    'Platform self metrics are not available yet.'
                  )}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {platformPerformanceSeries.map(item => (
                    <div key={item.name} className="rounded-lg border bg-background p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Activity className="h-4 w-4 text-muted-foreground" />
                            {formatSeriesLabel(item.name)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {latestSeriesSummary(item)}
                          </div>
                        </div>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {item.unit}
                        </span>
                      </div>
                      <TimeSeriesChart
                        name={item.name}
                        unit={item.unit}
                        window={platformPerformance?.window ?? '1h'}
                        rangeStartAt={platformPerformance?.rangeStartAt}
                        rangeEndAt={platformPerformance?.rangeEndAt}
                        stepSeconds={platformPerformance?.stepSeconds}
                        points={item.points}
                        segments={item.segments}
                        formatValue={formatTrendValue}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{t('platformStatus.targets.title', 'Platform Targets')}</CardTitle>
              <CardDescription>
                {t(
                  'platformStatus.targets.description',
                  'Control-plane runtime health as secondary evidence for availability.'
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && overview.platformItems.length === 0 ? (
            <div className="grid gap-4 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-background px-4 py-4 animate-pulse">
                  <div className="mb-2 h-4 w-28 rounded bg-muted" />
                  <div className="mb-4 h-3 w-16 rounded bg-muted" />
                  <div className="mb-2 h-4 w-full rounded bg-muted" />
                  <div className="h-4 w-3/4 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : overview.platformItems.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
              {t('platformStatus.targets.empty', 'Platform self-observation has not reported yet.')}
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
                      <Badge variant={statusVariant(item.status)}>
                        {formatStatusLabel(item.status)}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {summarizePlatformTarget(item)}
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      {detailEntries.map(([key, value]) => (
                        <div key={key} className="px-0 py-1">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {formatStatusLabel(key)}
                          </div>
                          <div className="mt-1 text-sm text-foreground">
                            {formatSummaryValue(key, value)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 text-xs text-muted-foreground">
                      Updated {formatTimestamp(item.lastTransitionAt)}
                    </div>
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

function PlatformLatestGauge({ itemKey, percent }: { itemKey: string; percent: number | null }) {
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

function PlatformLatestBarComparison({
  itemKey,
  bars,
}: {
  itemKey: string
  bars: LatestStatItem['bars']
}) {
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

function PlatformLatestStatCard({ item }: { item: LatestStatItem }) {
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
          <PlatformLatestGauge itemKey={item.key} percent={item.percent} />
        ) : (
          <PlatformLatestBarComparison itemKey={item.key} bars={item.bars} />
        )}
      </div>
    </div>
  )
}
