import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformStatusPage } from './PlatformStatusPage'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/monitor/TimeSeriesChart', () => ({
  TimeSeriesChart: ({ name }: { name: string }) => <div>{name} chart</div>,
}))

describe('PlatformStatusPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the unified platform-first status page and opens bundle components as a secondary surface', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/monitor/overview') {
        return Promise.resolve({
          counts: {
            healthy: 2,
            degraded: 1,
            offline: 0,
            unreachable: 0,
            credential_invalid: 0,
            unknown: 0,
          },
          unhealthyItems: [],
          platformItems: [
            {
              targetType: 'platform',
              targetId: 'appos-core',
              displayName: 'AppOS Core',
              status: 'healthy',
              reason: null,
              lastTransitionAt: '2026-04-21T14:20:00Z',
              summary: { uptime_seconds: 7200 },
            },
            {
              targetType: 'platform',
              targetId: 'worker',
              displayName: 'Worker',
              status: 'healthy',
              reason: null,
              lastTransitionAt: '2026-04-21T14:20:00Z',
            },
            {
              targetType: 'platform',
              targetId: 'scheduler',
              displayName: 'Scheduler',
              status: 'degraded',
              reason: 'Scheduler heartbeat is stale.',
              lastTransitionAt: '2026-04-21T14:18:00Z',
            },
          ],
        })
      }

      if (path === '/api/components/services') {
        return Promise.resolve([
          {
            name: 'appos-core',
            state: 'running',
            pid: 101,
            uptime: 7200,
            cpu: 4.1,
            memory: 104857600,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
          {
            name: 'appos-worker',
            state: 'running',
            pid: 102,
            uptime: 7100,
            cpu: 2.3,
            memory: 73400320,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
          {
            name: 'appos-scheduler',
            state: 'running',
            pid: 103,
            uptime: 600,
            cpu: 1.2,
            memory: 52428800,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
          {
            name: 'nginx',
            state: 'running',
            pid: 201,
            uptime: 8200,
            cpu: 0.4,
            memory: 20971520,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
          {
            name: 'redis',
            state: 'running',
            pid: 202,
            uptime: 8200,
            cpu: 0.8,
            memory: 31457280,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
          {
            name: 'victoria-metrics',
            state: 'running',
            pid: 203,
            uptime: 8200,
            cpu: 0.3,
            memory: 26214400,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
          {
            name: 'netdata',
            state: 'running',
            pid: 204,
            uptime: 8200,
            cpu: 0.7,
            memory: 35651584,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
        ])
      }

      if (path.startsWith('/api/monitor/targets/platform/appos-core/series?')) {
        return Promise.resolve({
          targetType: 'platform',
          targetId: 'appos-core',
          window: path.includes('window=24h') ? '24h' : '1h',
          rangeStartAt: '2026-04-21T13:20:00Z',
          rangeEndAt: '2026-04-21T14:20:00Z',
          stepSeconds: 60,
          series: [
            {
              name: 'cpu',
              unit: 'percent',
              points: [
                [1713705600, 24],
                [1713705660, 32],
              ],
            },
            {
              name: 'memory',
              unit: 'bytes',
              segments: [
                {
                  name: 'used',
                  points: [
                    [1713705600, 2147483648],
                    [1713705660, 3221225472],
                  ],
                },
                {
                  name: 'available',
                  points: [
                    [1713705600, 2147483648],
                    [1713705660, 1073741824],
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
                    [1713705600, 1048576],
                    [1713705660, 2097152],
                  ],
                },
                {
                  name: 'write',
                  points: [
                    [1713705600, 524288],
                    [1713705660, 1048576],
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
                    [1713705600, 8388608],
                    [1713705660, 9437184],
                  ],
                },
                {
                  name: 'out',
                  points: [
                    [1713705600, 4194304],
                    [1713705660, 5242880],
                  ],
                },
              ],
            },
          ],
        })
      }

      if (path === '/api/components') {
        return Promise.resolve([
          {
            id: 'docker',
            name: 'Docker',
            version: '28.x',
            available: true,
            updated_at: '2026-04-21T14:00:00Z',
          },
        ])
      }

      return Promise.resolve([])
    })

    render(<PlatformStatusPage />)

    expect(await screen.findByText('Platform Availability')).toBeInTheDocument()
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()
    expect(screen.getByText('Platform performance')).toBeInTheDocument()
    expect(screen.getByText('Bundled services')).toBeInTheDocument()
    expect(screen.getByText('Platform Targets')).toBeInTheDocument()
    expect(screen.getByText('Background Jobs')).toBeInTheDocument()
    expect(screen.getByText('CPU %')).toBeInTheDocument()
    expect(screen.getByText('MEM USAGE / LIMIT')).toBeInTheDocument()
    expect(screen.queryByText('MEM %')).not.toBeInTheDocument()
    expect(screen.getByText(/3(\.0)? GB \/ 4(\.0)? GB \(75%\)/)).toBeInTheDocument()
    expect(screen.getByText('NET I/O')).toBeInTheDocument()
    expect(screen.getByText('BLOCK I/O')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bundle >' })).toBeInTheDocument()
    expect(screen.getAllByTitle('View Logs').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/monitor/targets/platform/appos-core/series?window=24h'),
        { method: 'GET' }
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    expect(screen.getByLabelText('End')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-04-21T10:00' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-04-21T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/monitor/targets/platform/appos-core/series?window=custom'),
        { method: 'GET' }
      )
    })

    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Bundle >' }))

    expect(await screen.findByText('Bundle components')).toBeInTheDocument()
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.getByText('CLI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(await screen.findByText('Docker')).toBeInTheDocument()
  }, 10000)
})
