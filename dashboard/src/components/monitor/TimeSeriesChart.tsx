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
  points?: number[][]
  segments?: Array<{
    name: string
    points: number[][]
  }>
  formatValue: (unit: string, name: string, value: number) => string
}

type TimeSeriesDatum = {
  timestamp: number
  [key: string]: number
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
    read: { stroke: '#7c2d12', fill: '#fb923c' },
    write: { stroke: '#a16207', fill: '#facc15' },
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

function formatAxisTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
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

function mergeSeriesData(points?: number[][], segments?: TimeSeriesChartProps['segments']): TimeSeriesDatum[] {
  if (segments && segments.length > 0) {
    const merged = new Map<number, TimeSeriesDatum>()
    for (const segment of segments) {
      for (const point of segment.points) {
        if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          continue
        }
        const timestamp = point[0] * 1000
        const current = merged.get(timestamp) ?? { timestamp }
        current[segment.name] = point[1]
        merged.set(timestamp, current)
      }
    }
    return Array.from(merged.values()).sort((left, right) => left.timestamp - right.timestamp)
  }
  return (points ?? [])
    .filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map(point => ({
      timestamp: point[0] * 1000,
      value: point[1],
    }))
}

export function TimeSeriesChart({ name, unit, points, segments, formatValue }: TimeSeriesChartProps) {
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

  const data = mergeSeriesData(points, segments)

  if (data.length < 2) {
    return <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">No trend yet</div>
  }

  const palette = SERIES_PALETTE[name] ?? { stroke: '#475569', fill: '#94a3b8' }
  const resolvedWidth = Math.max(chartWidth, 240)

  return (
    <div ref={containerRef} className="h-24 w-full" role="img" aria-label={`${name} time series chart`}>
      <AreaChart width={resolvedWidth} height={96} data={data} margin={{ top: 6, right: 2, bottom: 0, left: 2 }}>
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
          tickFormatter={formatAxisTime}
          tickLine={false}
          type="number"
          domain={[data[0].timestamp, data[data.length - 1].timestamp]}
        />
        <YAxis
          axisLine={false}
          mirror
          orientation="right"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickFormatter={defaultTickFormatter}
          tickLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={{
            borderRadius: '0.75rem',
            borderColor: '#e2e8f0',
            fontSize: '12px',
          }}
          formatter={(value, entryName) => [formatValue(unit, `${name}_${String(entryName)}`, Number(value ?? 0)), entryName === 'value' ? formatLabel(name) : formatLabel(String(entryName))]}
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
                stackId={`${name}-stack`}
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