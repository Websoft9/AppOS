import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorOverviewContent } from './MonitorOverview'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('MonitorOverviewContent', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders counts, unhealthy targets, and platform targets', async () => {
    sendMock
      .mockResolvedValueOnce({
        counts: {
          healthy: 3,
          degraded: 1,
          offline: 1,
          unreachable: 0,
          credential_invalid: 0,
          unknown: 0,
        },
        unhealthyItems: [
          {
            targetType: 'server',
            targetId: 'srv-1',
            displayName: 'prod-01',
            status: 'offline',
            reason: 'heartbeat missing',
            lastTransitionAt: '2026-04-14T12:03:00Z',
            detailHref: '/servers/srv-1',
          },
        ],
        platformItems: [
          {
            targetType: 'platform',
            targetId: 'worker',
            displayName: 'Worker',
            status: 'healthy',
            reason: null,
            lastTransitionAt: '2026-04-14T12:00:00Z',
            detailHref: '/system/status',
            summary: {
              uptime_seconds: 3600,
              scheduler_running: true,
              memory_bytes: 104857600,
            },
          },
          {
            targetType: 'platform',
            targetId: 'scheduler',
            displayName: 'Scheduler',
            status: 'degraded',
            reason: 'tick stale',
            lastTransitionAt: '2026-04-14T12:01:00Z',
            detailHref: '/system/status',
          },
        ],
      })
      .mockResolvedValueOnce({
        hasData: true,
        targetType: 'platform',
        targetId: 'worker',
        displayName: 'Worker',
        status: 'healthy',
        reason: null,
        signalSource: 'appos_self',
        lastTransitionAt: '2026-04-14T12:00:00Z',
        lastSuccessAt: '2026-04-14T12:00:00Z',
        lastFailureAt: null,
        lastCheckedAt: '2026-04-14T12:00:00Z',
        lastReportedAt: '2026-04-14T12:00:00Z',
        consecutiveFailures: 0,
        summary: {
          uptime_seconds: 3600,
        },
      })
      .mockResolvedValueOnce({
        targetType: 'platform',
        targetId: 'worker',
        window: '1h',
        series: [{ name: 'cpu', unit: 'percent', points: [[1713096000, 12.4], [1713096060, 10.1]] }],
      })

    render(<MonitorOverviewContent />)

    expect(await screen.findByText('Monitor Overview')).toBeInTheDocument()
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0)
    expect(screen.getByText('prod-01')).toBeInTheDocument()
    expect(screen.getAllByText('Worker').length).toBeGreaterThan(0)
    expect(screen.getByText(/Uptime Seconds: 1.0h/i)).toBeInTheDocument()
    expect(await screen.findByText('Platform Detail')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Worker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scheduler' })).toBeInTheDocument()
    expect(sendMock).toHaveBeenCalledWith('/api/monitor/overview', { method: 'GET' })
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/platform/worker', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/monitor/targets/platform/worker/series?window=1h&series=cpu,memory', { method: 'GET' })
    })
  })

  it('allows manual refresh after an error', async () => {
    sendMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      counts: {
        healthy: 1,
        degraded: 0,
        offline: 0,
        unreachable: 0,
        credential_invalid: 0,
        unknown: 0,
      },
      unhealthyItems: [],
      platformItems: [],
    })

    render(<MonitorOverviewContent />)

    expect(await screen.findByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(screen.queryByText('boom')).not.toBeInTheDocument()
    })
    expect(sendMock).toHaveBeenCalledTimes(2)
  })
})