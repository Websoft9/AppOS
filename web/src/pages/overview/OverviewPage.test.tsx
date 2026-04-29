import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewPage } from './OverviewPage'

const sendMock = vi.fn()
const getFullListMock = vi.fn()
let currentUserCollectionName = '_superusers'

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      getFullList: (...args: unknown[]) => getFullListMock(...args),
    }),
  },
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: currentUserCollectionName ? { collectionName: currentUserCollectionName } : null,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    className?: string
  }) => {
    const resolvedTo = params?.appId ? to.replace('$appId', params.appId) : to
    return (
      <a href={resolvedTo} className={className}>
        {children}
      </a>
    )
  },
}))

vi.mock('@/components/monitor/TimeSeriesChart', () => ({
  TimeSeriesChart: ({ name }: { name: string }) => <div aria-label={`${name} time series chart`} />,
}))

describe('OverviewPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getFullListMock.mockReset()
    currentUserCollectionName = '_superusers'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders overview summaries, issues, and quick links from live data sources', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/apps') {
        return Promise.resolve([
          {
            id: 'app-1',
            server_id: 'srv-1',
            name: 'WordPress',
            project_dir: '/srv/wp',
            source: 'store',
            status: 'ready',
            runtime_status: 'running',
            health_summary: 'Healthy',
            created: '2026-04-15T10:00:00Z',
            updated: '2026-04-17T10:30:00Z',
          },
          {
            id: 'app-2',
            server_id: 'srv-1',
            name: 'Ghost',
            project_dir: '/srv/ghost',
            source: 'store',
            status: 'ready',
            runtime_status: 'error',
            runtime_reason: 'container restart loop',
            created: '2026-04-14T10:00:00Z',
            updated: '2026-04-16T08:00:00Z',
          },
        ])
      }
      if (path === '/api/monitor/overview') {
        return Promise.resolve({
          counts: { healthy: 2, degraded: 1, offline: 1 },
          unhealthyItems: [
            {
              targetType: 'platform',
              targetId: 'appos-core',
              displayName: 'AppOS Core',
              status: 'degraded',
              reason: 'disk pressure rising',
              lastTransitionAt: '2026-04-17T10:00:00Z',
              detailHref: '/status',
              summary: {
                memory_bytes: 2147483648,
                uptime_seconds: 7200,
              },
            },
          ],
          platformItems: [
            {
              targetType: 'platform',
              targetId: 'worker',
              displayName: 'Worker',
              status: 'healthy',
              reason: null,
              lastTransitionAt: '2026-04-17T10:05:00Z',
              summary: { uptime_seconds: 3600 },
            },
            {
              targetType: 'platform',
              targetId: 'appos-core',
              displayName: 'AppOS Core',
              status: 'degraded',
              reason: 'disk pressure rising',
              lastTransitionAt: '2026-04-17T10:00:00Z',
              summary: { memory_bytes: 2147483648, uptime_seconds: 7200 },
            },
          ],
        })
      }
      if (path === '/api/tunnel/overview') {
        return Promise.resolve({
          summary: { total: 2, online: 1, offline: 1, waiting_for_first_connect: 0 },
          items: [
            {
              id: 'tun-1',
              name: 'edge-node',
              status: 'offline',
              services: [],
              group_names: [],
            },
          ],
        })
      }
      if (
        path ===
        '/api/monitor/targets/platform/appos-core/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cnetwork'
      ) {
        return Promise.resolve({
          targetType: 'platform',
          targetId: 'appos-core',
          window: '1h',
          series: [
            {
              name: 'cpu',
              unit: 'percent',
              points: [
                [1713096000, 18.4],
                [1713096060, 21.1],
              ],
            },
            {
              name: 'memory',
              unit: 'bytes',
              segments: [
                {
                  name: 'used',
                  points: [
                    [1713096000, 2147483648],
                    [1713096060, 2362232012],
                  ],
                },
                {
                  name: 'available',
                  points: [
                    [1713096000, 1073741824],
                    [1713096060, 858993459],
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
                    [1713096000, 75161927680],
                    [1713096060, 76235669504],
                  ],
                },
                {
                  name: 'free',
                  points: [
                    [1713096000, 32212254720],
                    [1713096060, 31138512896],
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
                    [1713096000, 2048],
                    [1713096060, 4096],
                  ],
                },
                {
                  name: 'out',
                  points: [
                    [1713096000, 1024],
                    [1713096060, 2048],
                  ],
                },
              ],
            },
          ],
        })
      }
      return Promise.reject(new Error(`Unexpected path ${path}`))
    })

    getFullListMock
      .mockResolvedValueOnce([
        { id: 'srv-1', name: 'server-a', connect_type: 'tunnel', tunnel_status: 'online' },
        { id: 'srv-2', name: 'server-b', connect_type: 'tunnel', tunnel_status: 'offline' },
        { id: 'srv-3', name: 'server-c', connect_type: 'direct' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sec-1',
          name: 'prod-db-password',
          expires_at: '2099-01-01T00:00:00Z',
          status: 'active',
        },
        { id: 'sec-2', name: 'legacy-token', expires_at: '2026-04-20T00:00:00Z', status: 'active' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'cert-1',
          name: 'portal-cert',
          domain: 'portal.example.com',
          expires_at: '2026-04-18T00:00:00Z',
          status: 'active',
        },
      ])

    render(<OverviewPage />)

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Operational cockpit for AppOS health, current risks, and recent change across your single-server workspace.'
      )
    ).not.toBeInTheDocument()
    expect(screen.getByText('Applications')).toBeInTheDocument()
    expect(screen.getByText('Attention Needed')).toBeInTheDocument()
    expect(await screen.findByText('Needs Attention')).toBeInTheDocument()
    expect(screen.getAllByText('AppOS Core').length).toBeGreaterThan(0)
    expect(await screen.findByText('AppOS Core Trends')).toBeInTheDocument()
    expect(screen.getByLabelText('cpu time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('memory time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('disk_usage time series chart')).toBeInTheDocument()
    expect(screen.getByLabelText('network time series chart')).toBeInTheDocument()
    expect(screen.getByText('Recent App Changes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /System Monitor/i })).toHaveAttribute('href', '/status')
    expect(screen.getByRole('link', { name: /Manage Servers/i })).toHaveAttribute(
      'href',
      '/resources/servers'
    )
    expect(screen.getByRole('link', { name: /WordPress/i })).toHaveAttribute('href', '/apps/app-1')
    expect(screen.getAllByRole('link', { name: /Deploy App/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /Review Credentials/i }).length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/monitor/overview', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/tunnel/overview', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/platform/appos-core/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cnetwork',
        { method: 'GET' }
      )
    })
  })

  it('skips admin-only collection requests for non-superusers and still renders overview content', async () => {
    currentUserCollectionName = 'users'

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/apps') {
        return Promise.resolve([])
      }
      if (path === '/api/monitor/overview') {
        return Promise.resolve({
          counts: { healthy: 1 },
          unhealthyItems: [],
          platformItems: [],
        })
      }
      if (path === '/api/tunnel/overview') {
        return Promise.resolve({
          summary: { total: 0, online: 0, offline: 0, waiting_for_first_connect: 0 },
          items: [],
        })
      }
      return Promise.reject(new Error(`Unexpected path ${path}`))
    })

    render(<OverviewPage />)

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(await screen.findByText('No applications deployed yet.')).toBeInTheDocument()
    await waitFor(() => {
      expect(getFullListMock).not.toHaveBeenCalled()
    })
  })
})
