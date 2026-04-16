import { useEffect, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type TimeSeriesChartProps = {
  name: string
  unit: string
  window: string
  rangeStartAt?: string
  rangeEndAt?: string
  stepSeconds?: number
  points?: number[][]
  segments?: Array<{
    name: string
    points: number[][]
  }>
  formatValue: (unit: string, name: string, value: number) => string
}

type TimeSeriesDatum = {
  timestamp: number
  [key: string]: number | null
}

const WINDOW_STEP_MS: Record<string, number> = {
  '1h': 60 * 1000,
  '5h': 5 * 60 * 1000,
  '12h': 10 * 60 * 1000,
  '1d': 15 * 60 * 1000,
  '24h': 15 * 60 * 1000,
  '7d': 60 * 60 * 1000,
}

const WINDOW_DURATION_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '5h': 5 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

const SERIES_PALETTE: Record<string, { stroke: string; fill: string }> = {
  cpu: { stroke: '#2563eb', fill: '#60a5fa' },
  memory: { stroke: '#059669', fill: '#34d399' },
  disk_usage: { stroke: '#7c3aed', fill: '#a78bfa' },
  disk: { stroke: '#d97706', fill: '#fbbf24' },
  network: { stroke: '#dc2626', fill: '#f87171' },
  network_traffic: { stroke: '#0f766e', fill: '#2dd4bf' },
}

const SEGMENT_PALETTE: Record<string, Record<string, { stroke: string; fill: string }>> = {
  memory: {
    used: { stroke: '#2563eb', fill: '#60a5fa' },
    available: { stroke: '#0f766e', fill: '#34d399' },
  },
  disk_usage: {
    used: { stroke: '#c2410c', fill: '#fb923c' },
    free: { stroke: '#0f766e', fill: '#2dd4bf' },
  },
  disk: {
    read: { stroke: '#7e22ce', fill: '#c084fc' },
    write: { stroke: '#ea580c', fill: '#fb923c' },
  },
  network: {
    in: { stroke: '#0f766e', fill: '#2dd4bf' },
    out: { stroke: '#1d4ed8', fill: '#60a5fa' },
  },
  network_traffic: {
    in: { stroke: '#0f766e', fill: '#2dd4bf' },
    out: { stroke: '#1d4ed8', fill: '#60a5fa' },
  },
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

function getRangeDurationMs(window: string, rangeStartAt?: string, rangeEndAt?: string): number {
  const rangeStart = rangeStartAt ? new Date(rangeStartAt) : null
  const rangeEnd = rangeEndAt ? new Date(rangeEndAt) : null
  if (rangeStart && rangeEnd && !Number.isNaN(rangeStart.getTime()) && !Number.isNaN(rangeEnd.getTime())) {
    return Math.max(rangeEnd.getTime() - rangeStart.getTime(), 0)
  }
  return WINDOW_DURATION_MS[window] ?? WINDOW_DURATION_MS['1h']
}

function formatAxisTime(timestamp: number, window: string, rangeStartAt?: string, rangeEndAt?: string): string {
  const durationMs = getRangeDurationMs(window, rangeStartAt, rangeEndAt)
  const format = durationMs > 24 * 60 * 60 * 1000
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } as const
    : { hour: '2-digit', minute: '2-digit' } as const
  return new Intl.DateTimeFormat(undefined, format).format(new Date(timestamp))
}

function defaultTickFormatter(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const absolute = Math.abs(value)
  if (absolute >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)}G`
  if (absolute >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}M`
  if (absolute >= 1024) return `${(value / 1024).toFixed(1)}K`
  if (absolute >= 100) return `${Math.round(value)}`
  if (absolute >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

function normalizeBucket(timestampMs: number, stepMs: number): number {
  return Math.round(timestampMs / stepMs) * stepMs
}

function buildWindowTimeline(window: string, rangeStartAt?: string, rangeEndAt?: string, stepSeconds?: number): number[] {
  const stepMs = (stepSeconds && stepSeconds > 0 ? stepSeconds * 1000 : WINDOW_STEP_MS[window]) ?? WINDOW_STEP_MS['1h']
  const durationMs = WINDOW_DURATION_MS[window] ?? WINDOW_DURATION_MS['1h']
  const rangeStart = rangeStartAt ? new Date(rangeStartAt) : null
  const rangeEnd = rangeEndAt ? new Date(rangeEndAt) : null
  const start = rangeStart && !Number.isNaN(rangeStart.getTime())
    ? Math.floor(rangeStart.getTime() / stepMs) * stepMs
    : Math.floor((Date.now() - durationMs) / stepMs) * stepMs
  const end = rangeEnd && !Number.isNaN(rangeEnd.getTime())
    ? Math.ceil(rangeEnd.getTime() / stepMs) * stepMs
    : Math.floor(Date.now() / stepMs) * stepMs
  const timestamps: number[] = []
  for (let current = start; current <= end; current += stepMs) {
    timestamps.push(current)
  }
  return timestamps
}

function mergeSeriesData(
  window: string,
  rangeStartAt?: string,
  rangeEndAt?: string,
  stepSeconds?: number,
  points?: number[][],
  segments?: TimeSeriesChartProps['segments']
): TimeSeriesDatum[] {
  const stepMs = (stepSeconds && stepSeconds > 0 ? stepSeconds * 1000 : WINDOW_STEP_MS[window]) ?? WINDOW_STEP_MS['1h']
  const timeline = buildWindowTimeline(window, rangeStartAt, rangeEndAt, stepSeconds)
  const merged = new Map<number, TimeSeriesDatum>()

  for (const timestamp of timeline) {
    merged.set(timestamp, { timestamp })
  }

  if (segments && segments.length > 0) {
    for (const segment of segments) {
      for (const point of segment.points) {
        if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          continue
        }
        const timestamp = normalizeBucket(point[0] * 1000, stepMs)
        const current = merged.get(timestamp) ?? { timestamp }
        current[segment.name] = point[1]
        merged.set(timestamp, current)
      }
    }

    return Array.from(merged.values())
      .sort((left, right) => left.timestamp - right.timestamp)
      .map(item => {
        const normalized: TimeSeriesDatum = { timestamp: item.timestamp }
        for (const segment of segments) {
          normalized[segment.name] = item[segment.name] ?? null
        }
        return normalized
      })
  }

  for (const point of points ?? []) {
    if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      continue
    }
    const timestamp = normalizeBucket(point[0] * 1000, stepMs)
    const current = merged.get(timestamp) ?? { timestamp }
    current.value = point[1]
    merged.set(timestamp, current)
  }

  return Array.from(merged.values())
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(item => ({
      timestamp: item.timestamp,
      value: item.value ?? null,
    }))
}

export function TimeSeriesChart({ name, unit, window, rangeStartAt, rangeEndAt, stepSeconds, points, segments, formatValue }: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [chartWidth, setChartWidth] = useState(320)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width || element.clientWidth || 320)
      if (nextWidth > 0) {
        setChartWidth(nextWidth)
      }
    }

    updateWidth()

    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  const data = mergeSeriesData(window, rangeStartAt, rangeEndAt, stepSeconds, points, segments)
  const shouldStackSegments = name === 'memory' || name === 'disk_usage'

  const tooltipFormatter = (value: unknown, entryName: unknown, item: { payload?: Record<string, number> }) => {
  const numericValue = Number(value ?? 0)
  const seriesName = String(entryName ?? 'value')
  if (name === 'disk_usage' && item?.payload) {
    const used = Number(item.payload.used ?? 0)
    const free = Number(item.payload.free ?? 0)
    const total = used + free
    const percentage = total > 0 ? (numericValue / total) * 100 : 0
    const label = seriesName === 'used'
      ? `Used (${percentage.toFixed(1)}%)`
      : seriesName === 'free'
        ? `Free (${percentage.toFixed(1)}%)`
        : formatLabel(seriesName)
    return [formatValue(unit, `${name}_${seriesName}`, numericValue), label]
  }
  return [formatValue(unit, `${name}_${seriesName}`, numericValue), seriesName === 'value' ? formatLabel(name) : formatLabel(seriesName)]
  }

  const actualPointCount = segments && segments.length > 0
    ? data.filter(item => segments.some(segment => Number.isFinite(item[segment.name] ?? NaN))).length
    : data.filter(item => Number.isFinite(item.value ?? NaN)).length

  if (actualPointCount < 2) {
    return <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">No trend yet</div>
  }

  const palette = SERIES_PALETTE[name] ?? { stroke: '#475569', fill: '#94a3b8' }
  const resolvedWidth = Math.max(chartWidth, 240)

  return (
    <div ref={containerRef} className="h-24 w-full" role="img" aria-label={`${name} time series chart`}>
      <AreaChart width={resolvedWidth} height={96} data={data} margin={{ top: 6, right: 2, bottom: 0, left: 8 }}>
        <defs>
          {(segments && segments.length > 0 ? segments : [{ name: 'value', points: points ?? [] }]).map(segment => {
            const segmentPalette = SEGMENT_PALETTE[name]?.[segment.name] ?? palette
            const gradientId = `monitor-series-${name}-${segment.name}`
            return (
              <linearGradient key={gradientId} id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={segmentPalette.fill} stopOpacity={0.35} />
                <stop offset="100%" stopColor={segmentPalette.fill} stopOpacity={0.02} />
              </linearGradient>
            )
          })}
        </defs>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis
          axisLine={false}
          dataKey="timestamp"
          minTickGap={24}
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickFormatter={value => formatAxisTime(value, window, rangeStartAt, rangeEndAt)}
          tickLine={false}
          type="number"
          domain={[data[0].timestamp, data[data.length - 1].timestamp]}
        />
        <YAxis
          axisLine={false}
          orientation="left"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickFormatter={defaultTickFormatter}
          tickLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            borderRadius: '0.75rem',
            borderColor: '#e2e8f0',
            fontSize: '12px',
          }}
          formatter={tooltipFormatter}
          labelFormatter={label => new Date(Number(label ?? 0)).toLocaleString()}
        />
        {segments && segments.length > 0 ? (
          segments.map(segment => {
            const segmentPalette = SEGMENT_PALETTE[name]?.[segment.name] ?? palette
            const gradientId = `monitor-series-${name}-${segment.name}`
            return (
              <Area
                key={segment.name}
                type="monotone"
                dataKey={segment.name}
                stackId={shouldStackSegments ? `${name}-stack` : undefined}
                stroke={segmentPalette.stroke}
                strokeWidth={1.75}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: segmentPalette.stroke }}
                isAnimationActive={false}
              />
            )
          })
        ) : (
          <Area
            type="monotone"
            dataKey="value"
            stroke={palette.stroke}
            strokeWidth={2}
            fill={`url(#monitor-series-${name}-value)`}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: palette.stroke }}
            isAnimationActive={false}
          />
        )}
      </AreaChart>
    </div>
  )
}