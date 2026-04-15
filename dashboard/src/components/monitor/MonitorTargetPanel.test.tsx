import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorTargetPanel } from './MonitorTargetPanel'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
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
          { name: 'cpu', unit: 'percent', points: [[1713096000, 32.1], [1713096060, 30.8]] },
          {
            name: 'memory',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [[1713096000, 104857600], [1713096060, 125829120]] },
              { name: 'available', points: [[1713096000, 419430400], [1713096060, 398458880]] },
            ],
          },
          {
            name: 'disk_usage',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [[1713096000, 72 * 1024 * 1024 * 1024], [1713096060, 73 * 1024 * 1024 * 1024]] },
              { name: 'free', points: [[1713096000, 28 * 1024 * 1024 * 1024], [1713096060, 27 * 1024 * 1024 * 1024]] },
            ],
          },
          {
            name: 'disk',
            unit: 'bytes/s',
            segments: [
              { name: 'read', points: [[1713096000, 4096], [1713096060, 8192]] },
              { name: 'write', points: [[1713096000, 2048], [1713096060, 1024]] },
            ],
          },
          { name: 'network', unit: 'bytes/s', points: [[1713096000, 2048], [1713096060, 3072]] },
          {
            name: 'network_traffic',
            unit: 'bytes/s',
            segments: [
              { name: 'in', points: [[1713096000, 1024], [1713096060, 1536]] },
              { name: 'out', points: [[1713096000, 1024], [1713096060, 1536]] },
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-1" />)

    expect(await screen.findByText('prod-01')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('Heartbeat State')).toBeInTheDocument()
    expect(await screen.findByText('Short Window Trends')).toBeInTheDocument()
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('Disk Usage')).toBeInTheDocument()
    expect(screen.getByText('Disk')).toBeInTheDocument()
    expect(screen.getByText('Network Traffic')).toBeInTheDocument()
    expect(screen.getByText('Network Speed')).toBeInTheDocument()
    expect(screen.getByLabelText('Network interface')).toBeInTheDocument()
    expect(screen.getByLabelText('cpu time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('disk_usage time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('disk time series chart')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-1', { method: 'GET' })
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-1/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic', { method: 'GET' })
  })

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

    render(<MonitorTargetPanel targetType="server" targetId="srv-404" emptyMessage="No server monitor yet." />)

    await waitFor(() => {
      expect(screen.getByText('Fallback monitor context shown before the first agent heartbeat arrives.')).toBeInTheDocument()
    })
    expect(screen.getByText('No persisted monitor heartbeat yet. Showing current server inventory and monitor setup readiness instead.')).toBeInTheDocument()
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
          { name: 'cpu', unit: 'percent', points: [[1713096000, 12.5], [1713096060, 11.8]] },
          { name: 'memory', unit: 'bytes', points: [[1713096000, 268435456], [1713096060, 272629760]] },
        ],
      })

    render(<MonitorTargetPanel targetType="app" targetId="app-1" />)

    expect(await screen.findByText('Demo App')).toBeInTheDocument()
    expect(await screen.findByText('Short Window Trends')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/app/app-1', { method: 'GET' })
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/app/app-1/series?window=1h&series=cpu%2Cmemory', { method: 'GET' })
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
          { name: 'cpu', unit: 'percent', points: [[1713096000, 32.1], [1713096060, 30.8]] },
        ],
      })
      .mockResolvedValueOnce({
        targetType: 'server',
        targetId: 'srv-2',
        window: '24h',
        selectedNetworkInterface: 'all',
        series: [
          { name: 'cpu', unit: 'percent', points: [[1713096000, 40.1], [1713182400, 28.4]] },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-2" />)

    expect(await screen.findByText('prod-02')).toBeInTheDocument()
    expect(await screen.findByText('Short Window Trends')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '24H' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-2/series?window=24h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic', { method: 'GET' })
    })
    expect(screen.getByText('Last twenty-four hours trends from the monitoring time-series backend.')).toBeInTheDocument()
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
          { name: 'network', unit: 'bytes/s', points: [[1713096000, 2048], [1713096060, 3072]] },
          {
            name: 'network_traffic',
            unit: 'bytes/s',
            segments: [
              { name: 'in', points: [[1713096000, 1024], [1713096060, 1536]] },
              { name: 'out', points: [[1713096000, 1024], [1713096060, 1536]] },
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
          { name: 'network', unit: 'bytes/s', points: [[1713096000, 1024], [1713096060, 1536]], metadata: { network_interface: 'eth0' } },
          {
            name: 'network_traffic',
            unit: 'bytes/s',
            metadata: { network_interface: 'eth0' },
            segments: [
              { name: 'in', points: [[1713096000, 512], [1713096060, 768]] },
              { name: 'out', points: [[1713096000, 512], [1713096060, 768]] },
            ],
          },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-3" />)

    expect(await screen.findByText('prod-03')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Network interface'), { target: { value: 'eth0' } })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-3/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic&networkInterface=eth0', { method: 'GET' })
    })
  })
})