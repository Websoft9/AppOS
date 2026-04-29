import { pb } from '@/lib/pb'

export type MonitorMetricSeriesSegment = {
  name: string
  points: number[][]
}

export type MonitorMetricSeries = {
  name: string
  unit: string
  points?: number[][]
  segments?: MonitorMetricSeriesSegment[]
}

export type MonitorContainerTelemetryItem = {
  containerId: string
  containerName?: string
  composeProject?: string
  composeService?: string
  latest: {
    cpuPercent?: number
    memoryBytes?: number
    networkRxBytesPerSecond?: number
    networkTxBytesPerSecond?: number
  }
  freshness: {
    state: 'fresh' | 'stale' | 'missing'
    observedAt?: string
  }
  series?: MonitorMetricSeries[]
}

export type MonitorContainerTelemetryResponse = {
  serverId: string
  window: string
  rangeStartAt?: string
  rangeEndAt?: string
  stepSeconds?: number
  items: MonitorContainerTelemetryItem[]
}

export async function getServerContainerTelemetry(
  serverId: string,
  containerIds: string[],
  window = '15m'
): Promise<MonitorContainerTelemetryResponse> {
  const params = new URLSearchParams()
  params.set('window', window)
  for (const containerId of containerIds) {
    const value = String(containerId || '').trim()
    if (!value) continue
    params.append('containerId', value)
  }
  return pb.send(
    `/api/monitor/servers/${encodeURIComponent(serverId)}/container-telemetry?${params.toString()}`,
    { method: 'GET' }
  ) as Promise<MonitorContainerTelemetryResponse>
}
