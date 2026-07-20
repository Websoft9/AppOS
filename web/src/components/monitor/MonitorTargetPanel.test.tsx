import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorTargetPanel } from './MonitorTargetPanel'

const sendMock = vi.fn()
let visibilityStateValue: DocumentVisibilityState = 'visible'
const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'visibilityState'
)

Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibilityStateValue,
})

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
    visibilityStateValue = 'visible'
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  afterAll(() => {
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor)
    }
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
            unit: 'bytes',
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 64 * 1024 * 1024],
                  [1713096060, 160 * 1024 * 1024],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 64 * 1024 * 1024],
                  [1713096060, 160 * 1024 * 1024],
                ],
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-1',
        window: '1h',
        availableNetworkInterfaces: ['eth0', 'ens3'],
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'network_traffic',
            unit: 'bytes',
            segments: [
              {
                name: 'in',
                points: [
                  [1713096000, 64 * 1024 * 1024],
                  [1713096060, 160 * 1024 * 1024],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713096000, 64 * 1024 * 1024],
                  [1713096060, 160 * 1024 * 1024],
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
    expect(screen.getByRole('button', { name: '1m' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5m' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15m' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0.5h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '12h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '24h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'custom' })).toBeInTheDocument()
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('Disk Usage')).toBeInTheDocument()
    expect(screen.getByText('Disk IO')).toBeInTheDocument()
    expect(screen.getByText('Network Traffic')).toBeInTheDocument()
    expect(screen.getByText('Network Speed')).toBeInTheDocument()
    expect(screen.getByText('160 MB in / 160 MB out')).toBeInTheDocument()
    expect(screen.getByLabelText('Network interface')).toBeInTheDocument()
    expect(screen.getByLabelText('cpu time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('disk_usage time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('disk time series chart')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-1', {
      method: 'GET',
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/server/srv-1/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
      { method: 'GET', requestKey: null }
    )
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/server/srv-1/series?window=1h&series=network_traffic',
      { method: 'GET', requestKey: null }
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
            segments: [
              {
                name: 'used',
                points: [
                  [1713096000, 268435456],
                  [1713096060, 272629760],
                ],
              },
              {
                name: 'available',
                points: [
                  [1713096000, 805306368],
                  [1713096060, 801112064],
                ],
              },
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="app" targetId="app-1" />)

    expect(await screen.findByText('Demo App')).toBeInTheDocument()
    expect(await screen.findByText('Trend History')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/app/app-1', {
      method: 'GET',
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/app/app-1/series?window=1h&series=cpu%2Cmemory',
      { method: 'GET', requestKey: null }
    )
  })

  it('falls back to summary cpu and memory when latest series are empty', async () => {
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
          cpu_percent: 28,
          memory_bytes: 3221225472,
          memory_available_bytes: 1073741824,
        },
      })
      .mockResolvedValueOnce({
        targetType: 'platform',
        targetId: 'appos-core',
        window: '1h',
        series: [
          { name: 'cpu', unit: 'percent', points: [] },
          {
            name: 'memory',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [] },
              { name: 'available', points: [] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'platform',
        targetId: 'appos-core',
        cadenceSeconds: 10,
        series: [
          { name: 'cpu', unit: 'percent', points: [] },
          {
            name: 'memory',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [] },
              { name: 'available', points: [] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'platform',
        targetId: 'appos-core',
        window: '1h',
        series: [],
      })

    render(<MonitorTargetPanel targetType="platform" targetId="appos-core" layout="detail" />)

    expect(await screen.findByText('28')).toBeInTheDocument()
    expect(await screen.findByText('3.0 GB used / 4.0 GB limit')).toBeInTheDocument()
  })

  it('shows extended resource trends for appos-core platform targets', async () => {
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
                  [1713096000, 8589934592],
                  [1713096060, 9663676416],
                ],
              },
              {
                name: 'free',
                points: [
                  [1713096000, 21474836480],
                  [1713096060, 20401094656],
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
                  [1713096060, 4096],
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
                  [1713096000, 768],
                  [1713096060, 1280],
                ],
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'platform',
        targetId: 'appos-core',
        cadenceSeconds: 10,
        availableNetworkInterfaces: ['eth0'],
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [[1713096060, 11.8]],
          },
          {
            name: 'memory',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [[1713096060, 272629760]] },
              { name: 'available', points: [[1713096060, 801112064]] },
            ],
          },
          {
            name: 'disk_usage',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [[1713096060, 9663676416]] },
              { name: 'free', points: [[1713096060, 20401094656]] },
            ],
          },
          {
            name: 'disk',
            unit: 'bytes/s',
            segments: [
              { name: 'read', points: [[1713096060, 8192]] },
              { name: 'write', points: [[1713096060, 4096]] },
            ],
          },
          {
            name: 'network',
            unit: 'bytes/s',
            segments: [
              { name: 'in', points: [[1713096060, 1536]] },
              { name: 'out', points: [[1713096060, 1280]] },
            ],
          },
          {
            name: 'network_traffic',
            unit: 'bytes',
            segments: [
              { name: 'in', points: [[1713096060, 160 * 1024 * 1024]] },
              { name: 'out', points: [[1713096060, 96 * 1024 * 1024]] },
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
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/platform/appos-core/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
      { method: 'GET', requestKey: null }
    )
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/platform/appos-core/latest?series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
      { method: 'GET', requestKey: null }
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
        { method: 'GET', requestKey: null }
      )
    })
    expect(screen.queryByLabelText('Network interface')).not.toBeInTheDocument()
  })

  it('switches trend windows and refetches series', async () => {
    sendMock.mockImplementation((url: unknown) => {
      const request = String(url)
      if (request === '/api/monitor/targets/server/srv-2') {
        return Promise.resolve({
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
          summary: { heartbeat_state: 'fresh' },
        })
      }
      if (request.includes('series=network_traffic')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-2',
          window: request.includes('window=12h')
            ? '12h'
            : request.includes('window=24h')
              ? '24h'
              : request.includes('window=7d')
                ? '7d'
                : request.includes('window=custom')
                  ? 'custom'
                  : request.includes('window=5h')
                    ? '5h'
                    : '1h',
          availableNetworkInterfaces: ['eth0'],
          selectedNetworkInterface: 'all',
          series: [],
        })
      }
      const window = request.includes('window=12h')
        ? '12h'
        : request.includes('window=24h')
          ? '24h'
          : request.includes('window=7d')
            ? '7d'
            : request.includes('window=custom')
              ? 'custom'
              : request.includes('window=5h')
                ? '5h'
                : '1h'
      return Promise.resolve({
        targetType: 'server',
        targetId: 'srv-2',
        window,
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points:
              window === '5h'
                ? [
                    [1713096000, 34.1],
                    [1713110400, 29.4],
                  ]
                : window === '12h'
                  ? [
                      [1713096000, 40.1],
                      [1713182400, 28.4],
                    ]
                  : window === '24h'
                    ? [
                        [1713096000, 39.7],
                        [1713182400, 26.8],
                      ]
                    : window === '7d'
                      ? [
                          [1713096000, 44.2],
                          [1713697200, 31.2],
                        ]
                      : window === 'custom'
                        ? [
                            [1713081600, 27.2],
                            [1713124800, 24.1],
                          ]
                        : [
                            [1713096000, 32.1],
                            [1713096060, 30.8],
                          ],
          },
        ],
      })
    })

    render(<MonitorTargetPanel targetType="server" targetId="srv-2" />)

    expect(await screen.findByText('prod-02')).toBeInTheDocument()
    expect(await screen.findByText('Trend History')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '5h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=5h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
        { method: 'GET', requestKey: null }
      )
    })

    expect(
      screen.getByText('Last five hours trends from the monitoring time-series backend.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '12h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=12h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
        { method: 'GET', requestKey: null }
      )
    })
    expect(
      screen.getByText('Last twelve hours trends from the monitoring time-series backend.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=24h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
        { method: 'GET', requestKey: null }
      )
    })

    fireEvent.click(screen.getByRole('button', { name: '7d' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-2/series?window=7d&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
        { method: 'GET', requestKey: null }
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'custom' }))

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
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/monitor/targets/server/srv-2/series?window=custom&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork'
        ),
        { method: 'GET', requestKey: null }
      )
    })
    const customPrimaryRequest = sendMock.mock.calls
      .map(call => call[0])
      .find(
        call =>
          typeof call === 'string' &&
          call.includes(
            '/api/monitor/targets/server/srv-2/series?window=custom&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork'
          )
      )
    expect(customPrimaryRequest).toEqual(expect.stringContaining('startAt='))
    expect(customPrimaryRequest).toEqual(expect.stringContaining('endAt='))
    expect(screen.queryByText('Custom time range')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'custom' })).not.toBeInTheDocument()
  }, 15000)

  it('keeps latest stat independent when trend window changes', async () => {
    sendMock.mockImplementation((url: unknown) => {
      const request = String(url)
      if (request === '/api/monitor/targets/server/srv-detail') {
        return Promise.resolve({
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
      }
      if (request.includes('/latest?')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-detail',
          cadenceSeconds: 10,
          selectedNetworkInterface: 'all',
          series: [
            {
              name: 'cpu',
              unit: 'percent',
              points: [[1713096120, 21]],
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
      }
      if (request.includes('series=network_traffic')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-detail',
          window: request.includes('window=24h') ? '24h' : '1h',
          availableNetworkInterfaces: ['eth0'],
          selectedNetworkInterface: 'all',
          series: [],
        })
      }
      return Promise.resolve({
        targetType: 'server',
        targetId: 'srv-detail',
        window: request.includes('window=24h') ? '24h' : '1h',
        selectedNetworkInterface: 'all',
        series: request.includes('window=24h')
          ? [
              {
                name: 'cpu',
                unit: 'percent',
                points: [
                  [1713096000, 22],
                  [1713182400, 25],
                ],
              },
              {
                name: 'disk',
                unit: 'bytes/s',
                segments: [
                  { name: 'read', points: [[1713182400, 4096]] },
                  { name: 'write', points: [[1713182400, 2048]] },
                ],
              },
            ]
          : [
              {
                name: 'cpu',
                unit: 'percent',
                points: [
                  [1713096000, 20],
                  [1713096120, 21],
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
    })

    render(<MonitorTargetPanel targetType="server" targetId="srv-detail" layout="detail" />)

    expect(await screen.findByText('Latest Stat')).toBeInTheDocument()
    expect((await screen.findAllByText('Disk IO')).length).toBeGreaterThan(0)
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/server/srv-detail/latest?series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
      { method: 'GET', requestKey: null }
    )
    const initialUpdatedAt = screen.getByText(/Updated at /).textContent
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/server/srv-detail/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
      { method: 'GET', requestKey: null }
    )

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-detail/series?window=24h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
        { method: 'GET', requestKey: null }
      )
    })
    expect(
      sendMock.mock.calls.filter(call =>
        String(call[0]).includes('/api/monitor/targets/server/srv-detail/latest?')
      ).length
    ).toBe(1)
    expect(screen.getByText(initialUpdatedAt ?? 'Updated at —')).toBeInTheDocument()
  })

  it('keeps existing trend cards visible while a new detail window is loading', async () => {
    let resolveSeriesWindowChange: (value: unknown) => void = () => {
      throw new Error('expected pending trend series request resolver')
    }
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'server',
        targetId: 'srv-detail-loading',
        displayName: 'prod-loading',
        status: 'healthy',
        reason: null,
        signalSource: 'agent',
        lastTransitionAt: '2026-04-14T12:03:00Z',
        lastSuccessAt: '2026-04-14T12:03:00Z',
        lastFailureAt: null,
        lastCheckedAt: null,
        lastReportedAt: '2026-04-14T12:03:00Z',
        consecutiveFailures: 0,
        summary: { heartbeat_state: 'fresh' },
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-detail-loading',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 22],
              [1713096060, 25],
            ],
          },
        ],
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSeriesWindowChange = resolve
          })
      )

    render(<MonitorTargetPanel targetType="server" targetId="srv-detail-loading" layout="detail" />)

    expect(await screen.findByText('Trend History')).toBeInTheDocument()
    expect(screen.getAllByText('CPU').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    expect(screen.getAllByText('CPU').length).toBeGreaterThan(0)
    expect(screen.queryByText('Updating...')).not.toBeInTheDocument()

    resolveSeriesWindowChange({
      targetType: 'server',
      targetId: 'srv-detail-loading',
      window: '24h',
      selectedNetworkInterface: 'all',
      series: [
        {
          name: 'cpu',
          unit: 'percent',
          points: [
            [1713096000, 20],
            [1713182400, 21],
          ],
        },
      ],
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-detail-loading/series?window=24h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork',
        { method: 'GET', requestKey: null }
      )
    })
  })

  it('keeps trend history controls stable while refresh reloads chart data', async () => {
    let resolveTrendRefresh: (value: unknown) => void = () => {
      throw new Error('expected pending trend refresh resolver')
    }
    let primarySeriesRequestCount = 0

    sendMock.mockImplementation((url: unknown) => {
      const request = String(url)
      if (request === '/api/monitor/targets/server/srv-refresh-stable') {
        return Promise.resolve({
          hasData: true,
          targetType: 'server',
          targetId: 'srv-refresh-stable',
          displayName: 'refresh-stable',
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
      }
      if (request.includes('/latest?')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-refresh-stable',
          cadenceSeconds: 10,
          selectedNetworkInterface: 'all',
          series: [{ name: 'cpu', unit: 'percent', points: [[1713096120, 21]] }],
        })
      }
      if (request.includes('series=network_traffic')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-refresh-stable',
          window: '1h',
          availableNetworkInterfaces: ['eth0'],
          selectedNetworkInterface: 'all',
          series: [],
        })
      }
      if (request.includes('/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork')) {
        primarySeriesRequestCount += 1
        if (primarySeriesRequestCount > 1) {
          return new Promise(resolve => {
            resolveTrendRefresh = resolve
          })
        }
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-refresh-stable',
          window: '1h',
          selectedNetworkInterface: 'all',
          series: [
            {
              name: 'cpu',
              unit: 'percent',
              points: [
                [1713096000, 20],
                [1713096120, 21],
              ],
            },
          ],
        })
      }
      return Promise.resolve({
        targetType: 'server',
        targetId: 'srv-refresh-stable',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [],
      })
    })

    const { rerender } = render(
      <MonitorTargetPanel
        targetType="server"
        targetId="srv-refresh-stable"
        layout="detail"
        refreshKey={0}
      />
    )

    expect(await screen.findByText('Trend History')).toBeInTheDocument()
    const oneHourButton = screen.getByRole('button', { name: '1h' })
    const customButton = screen.getByRole('button', { name: 'custom' })

    expect(oneHourButton).toBeEnabled()
    expect(customButton).toBeEnabled()

    rerender(
      <MonitorTargetPanel
        targetType="server"
        targetId="srv-refresh-stable"
        layout="detail"
        refreshKey={1}
      />
    )

    expect(oneHourButton).toBeEnabled()
    expect(customButton).toBeEnabled()
    expect(screen.getAllByText('CPU').length).toBeGreaterThan(0)

    resolveTrendRefresh({
      targetType: 'server',
      targetId: 'srv-refresh-stable',
      window: '1h',
      selectedNetworkInterface: 'all',
      series: [
        {
          name: 'cpu',
          unit: 'percent',
          points: [
            [1713096000, 19],
            [1713096120, 22],
          ],
        },
      ],
    })

    await waitFor(() => {
      expect(
        sendMock.mock.calls.filter(call =>
          String(call[0]).includes(
            '/api/monitor/targets/server/srv-refresh-stable/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork'
          )
        ).length
      ).toBeGreaterThan(1)
    })
  })

  it('pauses latest stat polling while the document is hidden and resumes on visibility restore', async () => {
    visibilityStateValue = 'hidden'

    sendMock.mockImplementation((url: unknown) => {
      const request = String(url)
      if (request === '/api/monitor/targets/server/srv-hidden') {
        return Promise.resolve({
          hasData: true,
          targetType: 'server',
          targetId: 'srv-hidden',
          displayName: 'hidden-server',
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
      }
      if (request.includes('/latest?')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-hidden',
          cadenceSeconds: 10,
          selectedNetworkInterface: 'all',
          series: [{ name: 'cpu', unit: 'percent', points: [[1713096120, 21]] }],
        })
      }
      if (request.includes('series=network_traffic')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-hidden',
          window: '1h',
          availableNetworkInterfaces: ['eth0'],
          selectedNetworkInterface: 'all',
          series: [],
        })
      }
      return Promise.resolve({
        targetType: 'server',
        targetId: 'srv-hidden',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 20],
              [1713096120, 21],
            ],
          },
        ],
      })
    })

    render(<MonitorTargetPanel targetType="server" targetId="srv-hidden" layout="detail" />)

    expect(await screen.findByText('Latest Stat')).toBeInTheDocument()
    vi.useFakeTimers()
    const latestCallsBefore = sendMock.mock.calls.filter(call =>
      String(call[0]).includes('/latest?')
    ).length

    await vi.advanceTimersByTimeAsync(12000)

    expect(sendMock.mock.calls.filter(call => String(call[0]).includes('/latest?')).length).toBe(
      latestCallsBefore
    )

    visibilityStateValue = 'visible'
    fireEvent(document, new Event('visibilitychange'))

    await Promise.resolve()
    await Promise.resolve()

    expect(sendMock.mock.calls.filter(call => String(call[0]).includes('/latest?')).length).toBe(
      latestCallsBefore + 1
    )
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

  it('suppresses the write-path warning when usable series data is already present', async () => {
    sendMock
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'server',
        targetId: 'srv-warning-mismatch',
        displayName: 'prod-server',
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
        targetId: 'srv-warning-mismatch',
        window: '1h',
        selectedNetworkInterface: 'all',
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [
              [1713096000, 14],
              [1713099600, 18],
            ],
          },
        ],
      })

    render(
      <MonitorTargetPanel targetType="server" targetId="srv-warning-mismatch" layout="detail" />
    )

    await screen.findByText('Trend History')

    expect(
      screen.queryByText(
        'AppOS is not receiving usable metrics from this target. This usually indicates a monitor write-path or credential problem, not a chart rendering issue.'
      )
    ).not.toBeInTheDocument()
  })

  it('switches server network trends by interface', async () => {
    sendMock.mockImplementation((url: unknown) => {
      const request = String(url)
      if (request === '/api/monitor/targets/server/srv-3') {
        return Promise.resolve({
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
          summary: { heartbeat_state: 'fresh' },
        })
      }
      if (request.includes('series=network_traffic&networkInterface=eth0')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-3',
          window: '1h',
          availableNetworkInterfaces: ['all', 'eth0'],
          selectedNetworkInterface: 'eth0',
          series: [
            {
              name: 'network_traffic',
              unit: 'bytes',
              metadata: { network_interface: 'eth0' },
              segments: [
                {
                  name: 'in',
                  points: [
                    [1713096000, 32 * 1024 * 1024],
                    [1713096060, 80 * 1024 * 1024],
                  ],
                },
                {
                  name: 'out',
                  points: [
                    [1713096000, 32 * 1024 * 1024],
                    [1713096060, 80 * 1024 * 1024],
                  ],
                },
              ],
            },
          ],
        })
      }
      if (request.includes('series=network_traffic')) {
        return Promise.resolve({
          targetType: 'server',
          targetId: 'srv-3',
          window: '1h',
          availableNetworkInterfaces: ['all', 'eth0'],
          selectedNetworkInterface: 'all',
          series: [
            {
              name: 'network_traffic',
              unit: 'bytes',
              segments: [
                {
                  name: 'in',
                  points: [
                    [1713096000, 64 * 1024 * 1024],
                    [1713096060, 96 * 1024 * 1024],
                  ],
                },
                {
                  name: 'out',
                  points: [
                    [1713096000, 64 * 1024 * 1024],
                    [1713096060, 96 * 1024 * 1024],
                  ],
                },
              ],
            },
          ],
        })
      }
      return Promise.resolve({
        targetType: 'server',
        targetId: 'srv-3',
        window: '1h',
        availableNetworkInterfaces: ['all', 'eth0'],
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
        ],
      })
    })

    render(<MonitorTargetPanel targetType="server" targetId="srv-3" />)

    expect(await screen.findByText('prod-03')).toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText('Network interface'), {
      target: { value: 'eth0' },
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/server/srv-3/series?window=1h&series=network_traffic&networkInterface=eth0',
        { method: 'GET', requestKey: null }
      )
    })
  })
})
