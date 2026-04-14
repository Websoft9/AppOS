import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
        series: [
          { name: 'cpu', unit: 'percent', points: [[1713096000, 32.1], [1713096060, 30.8]] },
          { name: 'memory', unit: 'bytes', points: [[1713096000, 104857600], [1713096060, 125829120]] },
        ],
      })

    render(<MonitorTargetPanel targetType="server" targetId="srv-1" />)

    expect(await screen.findByText('prod-01')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('Heartbeat State')).toBeInTheDocument()
    expect(await screen.findByText('Short Window Trends')).toBeInTheDocument()
    expect(screen.getByText('Cpu')).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-1', { method: 'GET' })
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/server/srv-1/series?window=1h&series=cpu,memory', { method: 'GET' })
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
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/app/app-1/series?window=1h&series=cpu,memory', { method: 'GET' })
  })
})