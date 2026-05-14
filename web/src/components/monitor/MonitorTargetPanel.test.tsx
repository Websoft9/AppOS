import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorTargetPanel } from './MonitorTargetPanel'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/monitor/TimeSeriesChart', () => ({
  TimeSeriesChart: ({ name }: { name: string }) => (
    <div aria-label={`${name} time series chart`}>{name} chart</div>
  ),
}))

describe('MonitorTargetPanel', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders target detail fields and summary', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'server',
        targetId: 'srv-1',
        displayName: 'prod-01',
        status: 'healthy',
        reason: null,
        signalSource: 'agent',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: null,
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {
          heartbeat_state: 'fresh',
          agent_version: '0.1.0',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-1',
        window: '1h',
        availableNetworkInterfaces: ['eth0', 'ens3'],
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 32.1],
              [1713096060, 30.8],
            ],
          },
          {
            name: 'memory',
            unit: 'bytes',
            segments: [
              {
                name: 'used',
                points: [
                  [1713096000, 104857600],
                  [1713096060, 125829120],
                ],
              },
              {
                name: 'available',
                points: [
                  [1713096000, 419430400],
                  [1713096060, 398458880],
                ],
              },
            ],
          },
          {
            name: 'disk_usage',
            unit: 'bytes',
            segments: [
              {
                name: 'used',
                points: [
                  [1713096000, 72 * 1024 * 1024 * 1024],
                  [1713096060, 73 * 1024 * 1024 * 1024],
                ],
              },
              {
                name: 'free',
                points: [
                  [1713096000, 28 * 1024 * 1024 * 1024],
                  [1713096060, 27 * 1024 * 1024 * 1024],
                ],
              },
            ],
          },
          {
            name: 'disk',
            unit: 'bytes/s',
            segments: [
              {
                name: 'read',
                points: [
                  [1713096000, 4096],
                  [1713096060, 8192],
                ],
              },
              {
                name: 'write',
                points: [
                  [1713096000, 2048],
                  [1713096060, 1024],
                ],
              },
            ],
          },
          {
            name: 'network',
            unit: 'bytes/s',
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 1024],
                  [1713096060, 1536],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 1024],
                  [1713096060, 1536],
                ],
              },
            ],
          },
          {
            name: 'network_traffic',
            unit: 'GB',
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 0.06],
                  [1713096060, 0.09],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 0.06],
                  [1713096060, 0.09],
                ],
              },
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-1" />)

    expect(await screen.findByText('prod-01')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('Heartbeat State')).toBeInTheDocument()
    expect(await screen.findByText('Trend History')).toBeInTheDocument()
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('Disk Usage')).toBeInTheDocument()
    expect(screen.getByText('Disk IO')).toBeInTheDocument()
    expect(screen.getByText('Network Traffic')).toBeInTheDocument()
    expect(screen.getByText('Network Speed')).toBeInTheDocument()
    expect(screen.getByLabelText('Network interface')).toBeInTheDocument()
    expect(screen.getByLabelText('cpu time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('disk_usage time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('disk time series chart')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-1', { method: 'GET' })
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/server/srv-1/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
      { method: 'GET' }
    )
  }, 15000)

  it('renders synthesized fallback detail before first heartbeat', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: false,
        targetType: 'server',
        targetId: 'srv-404',
        displayName: 'test',
        status: 'unknown',
        reason: 'monitor agent token is ready, waiting for first heartbeat',
        signalSource: 'appos_inventory',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: null,
        lastFailureAt: null,
        lastCheckedAt: null,
        lastReportedAt: null,
        consecutiveFailures: 0,
        summary: {
          monitoring_state: 'awaiting_first_heartbeat',
          agent_token_configured: true,
          connectivity_status: 'online',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-404',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [],
      })

    render(
      <MonitorTargetPanel
        targetType="server"
        targetId="srv-404"
        emptyMessage="No server monitor yet."
      />
    )

    await waitFor(() => {
      expect(
        screen.getByText('Fallback monitor context shown before the first agent heartbeat arrives.')
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText(
        'No persisted monitor heartbeat yet. Showing current server inventory and monitor setup readiness instead.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Connectivity Status')).toBeInTheDocument()
  })

  it('loads short-window trends for app targets', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'app',
        targetId: 'app-1',
        displayName: 'Demo App',
        status: 'healthy',
        reason: null,
        signalSource: 'agent',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: '2026-04-14T12:03:00Z',
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {
          runtime_state: 'running',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'app',
        targetId: 'app-1',
        window: '1h',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 12.5],
              [1713096060, 11.8],
            ],
          },
          {
            name: 'memory',
            unit: 'bytes',
            points: [
              [1713096000, 268435456],
              [1713096060, 272629760],
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="app" targetId="app-1" />)

    expect(await screen.findByText('Demo App')).toBeInTheDocument()
    expect(await screen.findByText('Trend History')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/app/app-1', { method: 'GET' })
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/app/app-1/series?window=1h&series=cpu%2Cmemory',
      { method: 'GET' }
    )
  })

  it('loads extended resource trends for appos-core platform targets', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'platform',
        targetId: 'appos-core',
        displayName: 'AppOS Core',
        status: 'healthy',
        reason: null,
        signalSource: 'appos_self',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: '2026-04-14T12:03:00Z',
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {
          runtime_state: 'running',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'platform',
        targetId: 'appos-core',
        window: '1h',
        availableNetworkInterfaces: ['eth0', 'docker0'],
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 12.5],
              [1713096060, 11.8],
            ],
          },
          {
            name: 'memory',
            unit: 'bytes',
            points: [
              [1713096000, 268435456],
              [1713096060, 272629760],
            ],
          },
          {
            name: 'disk_usage',
            unit: 'bytes',
            segments: [
              {
                name: 'used',
                points: [
                  [1713096000, 72 * 1024 * 1024 * 1024],
                  [1713096060, 73 * 1024 * 1024 * 1024],
                ],
              },
              {
                name: 'free',
                points: [
                  [1713096000, 28 * 1024 * 1024 * 1024],
                  [1713096060, 27 * 1024 * 1024 * 1024],
                ],
              },
            ],
          },
          {
            name: 'network_traffic',
            unit: 'GB',
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 0.06],
                  [1713096060, 0.09],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 0.06],
                  [1713096060, 0.09],
                ],
              },
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="platform" targetId="appos-core" />)

    expect(await screen.findByText('AppOS Core')).toBeInTheDocument()
    expect(await screen.findByText('Trend History')).toBeInTheDocument()
    expect(screen.getByText('Disk Usage')).toBeInTheDocument()
    expect(screen.getByText('Network Traffic')).toBeInTheDocument()
    expect(screen.getByLabelText('Network interface')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/platform/appos-core', {
      method: 'GET',
    })
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/platform/appos-core/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
      { method: 'GET' }
    )
  })

  it('keeps compact trend queries for non-core platform targets', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'platform',
        targetId: 'worker',
        displayName: 'Worker',
        status: 'healthy',
        reason: null,
        signalSource: 'appos_self',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: '2026-04-14T12:03:00Z',
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {
          runtime_state: 'running',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'platform',
        targetId: 'worker',
        window: '1h',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 12.5],
              [1713096060, 11.8],
            ],
          },
          {
            name: 'memory',
            unit: 'bytes',
            points: [
              [1713096000, 268435456],
              [1713096060, 272629760],
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="platform" targetId="worker" />)

    expect(await screen.findByText('Worker')).toBeInTheDocument()
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/platform/worker/series?window=1h&series=cpu%2Cmemory',
        { method: 'GET' }
      )
    })
    expect(screen.queryByLabelText('Network interface')).not.toBeInTheDocument()
  })

  it('switches trend windows and refetches series', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'server',
        targetId: 'srv-2',
        displayName: 'prod-02',
        status: 'healthy',
        reason: null,
        signalSource: 'agent',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: null,
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {
          heartbeat_state: 'fresh',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 32.1],
              [1713096060, 30.8],
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: '5h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 34.1],
              [1713110400, 29.4],
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: '12h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 40.1],
              [1713182400, 28.4],
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: '24h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 39.7],
              [1713182400, 26.8],
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: '7d',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 44.2],
              [1713697200, 31.2],
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: 'custom',
        rangeStartAt: '2026-04-16T00:11:00.000Z',
        rangeEndAt: '2026-04-16T01:11:00.000Z',
        stepSeconds: 60,
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713226260, 27.2],
              [1713229860, 24.1],
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: 'custom',
        rangeStartAt: '2026-04-14T08:00:00.000Z',
        rangeEndAt: '2026-04-14T20:00:00.000Z',
        stepSeconds: 600,
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713081600, 27.2],
              [1713124800, 24.1],
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-2" />)

    expect(await screen.findByText('prod-02')).toBeInTheDocument()
    expect(await screen.findByText('Trend History')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '5h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=5h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
        { method: 'GET' }
      )
    })

    expect(
      screen.getByText('Last five hours trends from the monitoring time-series backend.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '12h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=12h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
        { method: 'GET' }
      )
    })
    expect(
      screen.getByText('Last twelve hours trends from the monitoring time-series backend.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=24h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
        { method: 'GET' }
      )
    })

    fireEvent.click(screen.getByRole('button', { name: '7d' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=7d&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
        { method: 'GET' }
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))

    expect(screen.getByText('Custom time range')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Trend range start'), {
      target: { value: '2026-04-14T08:00' },
    })
    fireEvent.change(screen.getByLabelText('Trend range end'), {
      target: { value: '2026-04-14T20:00' },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(sendMock.mock.calls).toHaveLength(7)
    })
    const customSeriesRequest = sendMock.mock.calls.at(-1)?.[0]
    expect(customSeriesRequest).toEqual(
      expect.stringContaining(
        '/api/monitor/targets/server/srv-2/series?window=custom&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic'
      )
    )
    expect(customSeriesRequest).toEqual(expect.stringContaining('startAt='))
    expect(customSeriesRequest).toEqual(expect.stringContaining('endAt='))
    expect(screen.queryByText('Custom time range')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument()
  }, 15000)

  it('keeps current snapshot on a short window when trend window changes', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'server',
        targetId: 'srv-detail',
        displayName: 'detail-server',
        status: 'healthy',
        reason: null,
        signalSource: 'agent',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: null,
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {},
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-detail',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 20],
              [1713096060, 21],
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-detail',
        window: '15m',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096060, 28],
              [1713096120, 30],
            ],
          },
          {
            name: 'disk',
            unit: 'bytes/s',
            segments: [
              { name: 'read', points: [[1713096120, 8192]] },
              { name: 'write', points: [[1713096120, 4096]] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-detail',
        window: '24h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 22],
              [1713182400, 25],
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-detail" layout="detail" />)

    expect(await screen.findByText('Current Snapshot')).toBeInTheDocument()
    expect(await screen.findByText('Disk IO')).toBeInTheDocument()
    expect(screen.getByLabelText('Live current snapshot')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/server/srv-detail/series?window=15m&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
      { method: 'GET' }
    )
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/server/srv-detail/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
      { method: 'GET' }
    )

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-detail/series?window=24h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
        { method: 'GET' }
      )
    })
  })

  it('shows a write-path warning when monitor status reports missing metrics', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'server',
        targetId: 'srv-missing-metrics',
        displayName: 'stalled-server',
        status: 'unknown',
        reason: 'metrics missing',
        signalSource: 'appos_active_check',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: '2026-04-14T12:03:00Z',
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {
          metrics_freshness_state: 'missing',
          metrics_reason_code: 'metrics_missing',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-missing-metrics',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-missing-metrics',
        window: '15m',
        selectedNetworkInterface: 'all',
        series: [],
      })

    const onRepair = vi.fn()

    render(
      <MonitorTargetPanel
        targetType="server"
        targetId="srv-missing-metrics"
        layout="detail"
        metricsPipelineAction={{
          label: 'Repair monitor agent',
          description: 'Rewrites remote-write credentials and restarts Netdata.',
          onClick: onRepair,
        }}
      />
    )

    expect(
      await screen.findByText(
        'AppOS is not receiving usable metrics from this target. This usually indicates a monitor write-path or credential problem, not a chart rendering issue.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Repair monitor agent' }))
    expect(onRepair).toHaveBeenCalledTimes(1)
  })

  it('switches server network trends by interface', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'server',
        targetId: 'srv-3',
        displayName: 'prod-03',
        status: 'healthy',
        reason: null,
        signalSource: 'agent',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: null,
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: {
          heartbeat_state: 'fresh',
        },
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-3',
        window: '1h',
        availableNetworkInterfaces: ['eth0'],
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'network',
            unit: 'bytes/s',
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 1024],
                  [1713096060, 1536],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 1024],
                  [1713096060, 1536],
                ],
              },
            ],
          },
          {
            name: 'network_traffic',
            unit: 'GB',
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 0.06],
                  [1713096060, 0.09],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 0.06],
                  [1713096060, 0.09],
                ],
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-3',
        window: '1h',
        availableNetworkInterfaces: ['eth0'],
        selectedNetworkInterface: 'eth0',
        series: [
          {
            name: 'network',
            unit: 'bytes/s',
            metadata: { network_interface: 'eth0' },
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 512],
                  [1713096060, 768],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 512],
                  [1713096060, 768],
                ],
              },
            ],
          },
          {
            name: 'network_traffic',
            unit: 'GB',
            metadata: { network_interface: 'eth0' },
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 0.03],
                  [1713096060, 0.045],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 0.03],
                  [1713096060, 0.045],
                ],
              },
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-3" />)

    expect(await screen.findByText('prod-03')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Network interface'), { target: { value: 'eth0' } })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-3/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic&networkInterface=eth0',
        { method: 'GET' }
      )
    })
  })
})
