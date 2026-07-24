import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewPage } from './OverviewPage'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        yes: 'Yes',
        no: 'No',
        'overview.title': 'Overview',
        'overview.actions.refreshAriaLabel': 'Refresh overview',
        'overview.errors.degraded': 'Some overview sections are temporarily unavailable.',
        'overview.errors.loadFailed': 'Failed to load overview',
        'overview.kpis.applications.title': 'Applications',
        'overview.kpis.applications.description':
          '{{running}} running · {{error}} error · {{stopped}} stopped',
        'overview.kpis.servers.title': 'Servers',
        'overview.kpis.servers.description':
          '{{tunnelOnline}} tunnel online · {{tunnelOffline}} tunnel offline · {{direct}} direct',
        'overview.kpis.attentionNeeded.title': 'Attention Needed',
        'overview.kpis.attentionNeeded.description':
          '{{monitorIssues}} monitor issues · {{offlineTunnels}} offline tunnels',
        'overview.kpis.credentialsRisk.title': 'Credentials Risk',
        'overview.kpis.credentialsRisk.description':
          '{{certificates}} certificate risks · {{secrets}} secret risks',
        'overview.sections.needsAttention.title': 'Needs Attention',
        'overview.sections.needsAttention.description':
          'Prioritized operational items collected from monitor, tunnel, and credential state.',
        'overview.sections.needsAttention.loading': 'Loading current issues...',
        'overview.sections.needsAttention.empty': 'No urgent issues right now.',
        'overview.sections.trends.title': '1H Trends',
        'overview.sections.trends.description':
          'AppOS control-plane CPU, memory usage versus limit, disk, and network over the last hour.',
        'overview.sections.trends.linkAriaLabel': 'View system status',
        'overview.sections.trends.loading': 'Loading AppOS self metrics...',
        'overview.sections.trends.empty': 'AppOS self metrics have not reported yet.',
        'overview.sections.recentApps.title': 'Recent App Changes',
        'overview.sections.recentApps.description':
          'Most recently updated application instances across the workspace.',
        'overview.sections.recentApps.loading': 'Loading applications...',
        'overview.sections.recentApps.empty': 'No applications deployed yet.',
        'overview.sections.recentApps.updated': 'Updated',
        'overview.sections.quickActions.title': 'Quick Actions',
        'overview.sections.quickActions.description':
          'Jump directly into the most common operational workflows.',
        'overview.quickLinks.deployApp.title': 'Deploy App',
        'overview.quickLinks.deployApp.description': 'Start a new deployment workflow.',
        'overview.quickLinks.openMonitor.title': 'Open Monitor',
        'overview.quickLinks.openMonitor.description': 'Inspect platform and unhealthy targets.',
        'overview.quickLinks.manageServers.title': 'Manage Servers',
        'overview.quickLinks.manageServers.description':
          'Review connected hosts and monitor agent rollout.',
        'overview.quickLinks.reviewCredentials.title': 'Review Credentials',
        'overview.quickLinks.reviewCredentials.description':
          'Check secrets and certificates that may need action.',
        'overview.issues.monitorFallback': '{{status}} requires attention.',
        'overview.issues.tunnelWaiting': 'Waiting for first tunnel connection.',
        'overview.issues.tunnelOffline': 'Tunnel is offline.',
        'overview.issues.certificateExpired': 'Certificate is expired or revoked.',
        'overview.issues.certificateExpiring': 'Certificate is expiring within 30 days.',
        'overview.issues.secretExpired': 'Secret is expired or revoked.',
        'overview.issues.secretExpiring': 'Secret is expiring within 30 days.',
        'overview.issueKinds.monitor': 'Monitor',
        'overview.issueKinds.tunnel': 'Tunnel',
        'overview.issueKinds.certificate': 'Certificate',
        'overview.issueKinds.secret': 'Secret',
        'overview.seriesLabels.cpu': 'CPU',
        'overview.seriesLabels.memory': 'Memory',
        'overview.seriesLabels.disk_usage': 'Disk Usage',
        'overview.seriesLabels.disk': 'Disk IO',
        'overview.seriesLabels.network': 'Network Speed',
        'overview.seriesLabels.network_traffic': 'Network Traffic',
        'overview.statusLabels.running': 'Running',
        'overview.statusLabels.error': 'Error',
        'overview.statusLabels.stopped': 'Stopped',
        'overview.statusLabels.unknown': 'Unknown',
        'overview.statusLabels.healthy': 'Healthy',
        'overview.statusLabels.degraded': 'Degraded',
        'overview.statusLabels.offline': 'Offline',
        'overview.statusLabels.unreachable': 'Unreachable',
        'overview.statusLabels.credential_invalid': 'Credential Invalid',
        'overview.trendSummary.memoryUsageWithLimit': '{{used}} used / {{limit}} limit',
        'overview.trendSummary.memoryUsage': '{{used}} used',
        'overview.trendSummary.diskUsage': '{{used}} used{{free}}',
        'overview.trendSummary.networkSpeed': '{{inbound}} in{{outbound}}',
        'overview.trendSummary.networkTraffic': '{{inbound}} in{{outbound}}',
        'overview.trendSummary.diskIo': '{{read}} read{{write}}',
        'overview.trendSummary.free': 'free',
        'overview.trendSummary.out': 'out',
        'overview.trendSummary.write': 'write',
      }

      const template = translations[key]
      if (!template) {
        return values?.defaultValue && typeof values.defaultValue === 'string'
          ? values.defaultValue
          : key
      }

      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(values?.[token] ?? ''))
    },
  }),
}))

const sendMock = vi.fn()
const getFullListMock = vi.fn()
let currentUserCollectionName = '_superusers'
let warnSpy: ReturnType<typeof vi.spyOn>

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
    ...props
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    className?: string
    [key: string]: unknown
  }) => {
    const resolvedTo = params?.appId ? to.replace('$appId', params.appId) : to
    return (
      <a href={resolvedTo} className={className} {...props}>
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
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
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
        '/api/monitor/targets/platform/appos-core/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic'
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
            {
              name: 'network_traffic',
              unit: 'bytes',
              segments: [
                {
                  name: 'in',
                  points: [
                    [1713096000, 8192],
                    [1713096060, 9728],
                  ],
                },
                {
                  name: 'out',
                  points: [
                    [1713096000, 6144],
                    [1713096060, 7424],
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
        { id: 'srv-3', name: 'local', connect_type: 'direct' },
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
    expect(await screen.findByText('Applications')).toBeInTheDocument()
    expect(await screen.findByText('Attention Needed')).toBeInTheDocument()
    expect(await screen.findByText('Needs Attention')).toBeInTheDocument()
    expect(await screen.findByText('1H Trends')).toBeInTheDocument()
    expect(
      await screen.findByText(
        'AppOS control-plane CPU, memory usage versus limit, disk, and network over the last hour.'
      )
    ).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'View system status' })).toHaveAttribute(
      'href',
      '/status'
    )
    expect(await screen.findByLabelText('cpu time series chart')).toBeInTheDocument()
    expect(await screen.findByLabelText('memory time series chart')).toBeInTheDocument()
    expect(await screen.findByLabelText('disk_usage time series chart')).toBeInTheDocument()
    expect(await screen.findByLabelText('disk time series chart')).toBeInTheDocument()
    expect(await screen.findByLabelText('network time series chart')).toBeInTheDocument()
    expect(await screen.findByLabelText('network_traffic time series chart')).toBeInTheDocument()
    expect(await screen.findByText('Recent App Changes')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Manage Servers/i })).toHaveAttribute(
      'href',
      '/resources/servers'
    )
    expect(await screen.findByRole('link', { name: /WordPress/i })).toHaveAttribute(
      'href',
      '/apps/app-1'
    )
    expect((await screen.findAllByRole('link', { name: /Deploy App/i })).length).toBeGreaterThan(0)
    expect(
      (await screen.findAllByRole('link', { name: /Review Credentials/i })).length
    ).toBeGreaterThan(0)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps', { method: 'GET', requestKey: null })
      expect(sendMock).toHaveBeenCalledWith('/api/monitor/overview', {
        method: 'GET',
        requestKey: null,
      })
      expect(sendMock).toHaveBeenCalledWith('/api/tunnel/overview', {
        method: 'GET',
        requestKey: null,
      })
      expect(sendMock).toHaveBeenCalledWith(
        '/api/monitor/targets/platform/appos-core/series?window=1h&series=cpu%2Cmemory%2Cdisk_usage%2Cdisk%2Cnetwork%2Cnetwork_traffic',
        { method: 'GET', requestKey: null }
      )
    })
    expectAppOSCorePlatformSeriesRequests()
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

  it('logs degraded overview sources when optional requests fail', async () => {
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

    getFullListMock
      .mockRejectedValueOnce(new Error('servers unavailable'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    render(<OverviewPage />)

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        'Overview degraded data sources',
        expect.arrayContaining([
          expect.objectContaining({ section: 'servers', message: 'servers unavailable' }),
        ])
      )
    })
  })
})
