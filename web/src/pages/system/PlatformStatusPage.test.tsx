import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformStatusPage } from './PlatformStatusPage'

const sendMock = vi.fn()
let warnSpy: ReturnType<typeof vi.spyOn>
let visibilityStateValue: DocumentVisibilityState = 'visible'
const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'visibilityState'
)

Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibilityStateValue,
})

function expectAppOSCorePlatformSeriesRequests() {
  const platformSeriesCalls = sendMock.mock.calls
    .map(call => String(call[0]))
    .filter(path => path.includes('/api/monitor/targets/platform/appos-core/series?'))

  for (const path of platformSeriesCalls) {
    const decoded = decodeURIComponent(path)
    expect(decoded).toContain('disk_usage')
    expect(decoded).toContain(',network')
    expect(decoded).not.toContain('&series=network_traffic')
    expect(decoded).toContain(',disk')
    expect(decoded).toContain(',network')
  }
}

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

function mockPlatformStatusResponses() {
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

    if (path === '/api/software/local/services') {
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
            name: 'disk_usage',
            unit: 'bytes',
            segments: [
              {
                name: 'used',
                points: [
                  [1713705600, 8589934592],
                  [1713705660, 9663676416],
                ],
              },
              {
                name: 'free',
                points: [
                  [1713705600, 21474836480],
                  [1713705660, 20401094656],
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
                  [1713705600, 4096],
                  [1713705660, 8192],
                ],
              },
              {
                name: 'write',
                points: [
                  [1713705600, 2048],
                  [1713705660, 4096],
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
                  [1713705600, 1024],
                  [1713705660, 1536],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713705600, 768],
                  [1713705660, 1280],
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
                  [1713705600, 4096],
                  [1713705660, 5632],
                ],
              },
              {
                name: 'out',
                points: [
                  [1713705600, 3072],
                  [1713705660, 4352],
                ],
              },
            ],
          },
        ],
      })
    }

    if (path.startsWith('/api/monitor/targets/platform/appos-core/latest?')) {
      return Promise.resolve({
        targetType: 'platform',
        targetId: 'appos-core',
        cadenceSeconds: 10,
        series: [
          {
            name: 'cpu',
            unit: 'percent',
            points: [[1713705660, 32]],
          },
          {
            name: 'memory',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [[1713705660, 3221225472]] },
              { name: 'available', points: [[1713705660, 1073741824]] },
            ],
          },
          {
            name: 'disk_usage',
            unit: 'bytes',
            segments: [
              { name: 'used', points: [[1713705660, 9663676416]] },
              { name: 'free', points: [[1713705660, 20401094656]] },
            ],
          },
          {
            name: 'disk',
            unit: 'bytes/s',
            segments: [
              { name: 'read', points: [[1713705660, 8192]] },
              { name: 'write', points: [[1713705660, 4096]] },
            ],
          },
          {
            name: 'network',
            unit: 'bytes/s',
            segments: [
              { name: 'in', points: [[1713705660, 1536]] },
              { name: 'out', points: [[1713705660, 1280]] },
            ],
          },
          {
            name: 'network_traffic',
            unit: 'bytes',
            segments: [
              { name: 'in', points: [[1713705660, 5632]] },
              { name: 'out', points: [[1713705660, 4352]] },
            ],
          },
        ],
      })
    }

    if (path === '/api/software/local') {
      return Promise.resolve({
        items: [
          {
            id: 'docker',
            name: 'Docker',
            version: '28.x',
            available: true,
            updated_at: '2026-04-21T14:00:00Z',
          },
        ],
      })
    }

    return Promise.resolve([])
  })
}

describe('PlatformStatusPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    visibilityStateValue = 'visible'
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  afterAll(() => {
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor)
    }
  })

  it('renders the unified platform-first status page', async () => {
    mockPlatformStatusResponses()

    render(<PlatformStatusPage />)

    expect(await screen.findByText('Platform Availability')).toBeInTheDocument()
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()
    expect(screen.getByText('Platform performance')).toBeInTheDocument()
    expect(screen.getByText('Latest Stat')).toBeInTheDocument()
    expect(screen.queryByText('Bundled services')).not.toBeInTheDocument()
    expect(screen.getByText('Platform Targets')).toBeInTheDocument()
    expect(screen.getByText('Background Jobs')).toBeInTheDocument()
    expect(screen.getAllByText('CPU %').length).toBeGreaterThan(0)
    expect(screen.getAllByText('MEM USAGE / LIMIT').length).toBeGreaterThan(0)
    expect(screen.queryByText('MEM %')).not.toBeInTheDocument()
    expect(screen.getByText(/3(\.0)? GB \/ 4(\.0)? GB \(75%\)/)).toBeInTheDocument()
    expect(screen.getAllByText('NET I/O').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Network Traffic').length).toBeGreaterThan(0)
    expect(screen.getAllByText('BLOCK I/O').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Disk Usage').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('cpu latest stat gauge')).toBeInTheDocument()
    expect(screen.getByLabelText('memory latest stat gauge')).toBeInTheDocument()
    expect(screen.getByLabelText('cpu time series chart')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1m' })).toHaveAttribute('data-size', 'xs')
    for (const label of ['1m', '5m', '15m', '0.5h', '1h', '5h', '12h', '24h', '7d', 'custom']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(sendMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/monitor/targets/platform/appos-core/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic'
      ),
      { method: 'GET' }
    )
    expect(sendMock).toHaveBeenCalledWith(
      '/api/monitor/targets/platform/appos-core/latest?series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
      { method: 'GET' }
    )
    expectAppOSCorePlatformSeriesRequests()
  })

  it('switches platform trend windows including custom range', async () => {
    mockPlatformStatusResponses()

    render(<PlatformStatusPage />)

    expect(await screen.findByText('Platform Availability')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/monitor/targets/platform/appos-core/series?window=24h'),
        { method: 'GET' }
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'custom' }))
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    expect(screen.getByLabelText('End')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'custom' }))
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'custom' }))
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
    expectAppOSCorePlatformSeriesRequests()
  }, 10000)

  it('falls back to summary cpu and memory when series return empty data', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/monitor/overview') {
        return Promise.resolve({
          counts: {
            healthy: 1,
            degraded: 0,
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
              summary: {
                cpu_percent: 42,
                memory_bytes: 3221225472,
                memory_available_bytes: 1073741824,
              },
            },
          ],
        })
      }

      if (path === '/api/software/local/services') {
        return Promise.resolve([])
      }

      if (path.startsWith('/api/monitor/targets/platform/appos-core/series?')) {
        return Promise.resolve({
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
      }

      return Promise.resolve([])
    })

    render(<PlatformStatusPage />)

    expect((await screen.findAllByText('42%')).length).toBeGreaterThan(0)
    expect(await screen.findByText(/3(\.0)? GB \/ 4(\.0)? GB \(75%\)/)).toBeInTheDocument()
  })

  it('logs degraded platform status sources when one section fails', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/monitor/overview') {
        return Promise.resolve({
          counts: { healthy: 1 },
          unhealthyItems: [],
          platformItems: [],
        })
      }

      if (path === '/api/software/local/services') {
        return Promise.reject(new Error('services unavailable'))
      }

      if (path.startsWith('/api/monitor/targets/platform/appos-core/series?')) {
        return Promise.resolve({
          targetType: 'platform',
          targetId: 'appos-core',
          window: '1h',
          series: [],
        })
      }

      return Promise.resolve([])
    })

    render(<PlatformStatusPage />)

    expect(
      await screen.findByText('Some status sections are temporarily unavailable.')
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        'Platform status degraded data sources',
        expect.arrayContaining([
          expect.objectContaining({ section: 'services', message: 'services unavailable' }),
        ])
      )
    })
  })

  it('pauses platform latest polling while the document is hidden and refreshes on visibility restore', async () => {
    visibilityStateValue = 'hidden'
    mockPlatformStatusResponses()

    render(<PlatformStatusPage />)

    expect(await screen.findByText('Platform Availability')).toBeInTheDocument()
    vi.useFakeTimers()
    const latestCallsBefore = sendMock.mock.calls.filter(call =>
      String(call[0]).includes('/platform/appos-core/latest?')
    ).length

    await vi.advanceTimersByTimeAsync(11000)

    expect(
      sendMock.mock.calls.filter(call => String(call[0]).includes('/platform/appos-core/latest?'))
        .length
    ).toBe(latestCallsBefore)

    visibilityStateValue = 'visible'
    fireEvent(document, new Event('visibilitychange'))

    await Promise.resolve()
    await Promise.resolve()

    expect(
      sendMock.mock.calls.filter(call => String(call[0]).includes('/platform/appos-core/latest?'))
        .length
    ).toBe(latestCallsBefore + 1)
  })
})
