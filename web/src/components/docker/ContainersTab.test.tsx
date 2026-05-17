import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContainersTab } from './ContainersTab'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/monitor/TimeSeriesChart', () => ({
  TimeSeriesChart: ({ name }: { name: string }) => <div>{name} chart</div>,
}))

function renderTab(overrides?: {
  visibleColumns?: {
    ports: boolean
    volumes: boolean
    status: boolean
    cpu: boolean
    mem: boolean
    network: boolean
    compose: boolean
  }
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ContainersTab
        serverId="srv-1"
        stateFilter="all"
        page={1}
        pageSize={50}
        visibleColumns={
          overrides?.visibleColumns ?? {
            ports: true,
            volumes: true,
            status: true,
            cpu: true,
            mem: true,
            network: true,
            compose: false,
          }
        }
      />
    </QueryClientProvider>
  )
}

describe('ContainersTab', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/srv-1/docker/containers') {
        return Promise.resolve({
          output: [
            JSON.stringify({
              ID: 'ctr-1',
              Names: 'demo-web',
              Image: 'nginx:alpine',
              State: 'running',
              Status: 'Up 2 hours',
              Ports: '0.0.0.0:8080->80/tcp',
            }),
            JSON.stringify({
              ID: 'ctr-2',
              Names: 'demo-worker',
              Image: 'busybox:latest',
              State: 'running',
              Status: 'Up 30 minutes',
              Ports: '',
            }),
          ].join('\n'),
        })
      }
      if (
        path ===
        '/api/monitor/servers/srv-1/container-telemetry?window=15m&containerId=ctr-1&containerId=ctr-2'
      ) {
        return Promise.resolve({
          serverId: 'srv-1',
          window: '15m',
          rangeStartAt: '2026-04-29T00:00:00Z',
          rangeEndAt: '2026-04-29T00:15:00Z',
          stepSeconds: 30,
          items: [
            {
              containerId: 'ctr-1',
              latest: {
                cpuPercent: 17.2,
                memoryBytes: 134217728,
                networkRxBytesPerSecond: 2048,
                networkTxBytesPerSecond: 1024,
              },
              freshness: {
                state: 'fresh',
                observedAt: '2026-04-29T00:15:00Z',
              },
              series: [
                {
                  name: 'cpu',
                  unit: 'percent',
                  points: [
                    [1, 10],
                    [2, 17.2],
                  ],
                },
                {
                  name: 'memory',
                  unit: 'bytes',
                  points: [
                    [1, 104857600],
                    [2, 134217728],
                  ],
                },
                {
                  name: 'network',
                  unit: 'bytes/s',
                  segments: [
                    {
                      name: 'in',
                      points: [
                        [1, 1024],
                        [2, 2048],
                      ],
                    },
                    {
                      name: 'out',
                      points: [
                        [1, 512],
                        [2, 1024],
                      ],
                    },
                  ],
                },
              ],
            },
            {
              containerId: 'ctr-2',
              latest: {
                cpuPercent: 4.4,
                memoryBytes: 33554432,
              },
              freshness: {
                state: 'stale',
                observedAt: '2026-04-28T23:55:00Z',
              },
              series: [
                {
                  name: 'cpu',
                  unit: 'percent',
                  points: [
                    [1, 2],
                    [2, 4.4],
                  ],
                },
              ],
            },
          ],
        })
      }
      if (path === '/api/servers/srv-1/docker/containers/metadata') {
        return Promise.resolve({
          items: {
            'ctr-1': {
              created: '2026-04-29T00:00:00Z',
              compose_project: 'demo',
              volume_names: ['data'],
            },
            'ctr-2': {
              created: '2026-04-29T00:05:00Z',
              volume_names: [],
            },
          },
        })
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders monitor-backed telemetry without calling docker stats', async () => {
    renderTab()

    expect(await screen.findByText('demo-web')).toBeInTheDocument()
    expect(await screen.findByText('17%')).toBeInTheDocument()
    expect(screen.getByText('128 MiB')).toBeInTheDocument()
    expect(screen.getByText('2.0 KiB/s in / 1.0 KiB/s out')).toBeInTheDocument()
    expect(screen.getByText('Stale telemetry')).toBeInTheDocument()
    expect(screen.getByText('1 volume')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/docker/containers/metadata', {
        method: 'POST',
        body: { ids: ['ctr-1', 'ctr-2'] },
      })
      expect(sendMock).not.toHaveBeenCalledWith(
        '/api/servers/srv-1/docker/containers/stats',
        {
          method: 'GET',
        }
      )
      expect(sendMock).not.toHaveBeenCalledWith(
        '/api/servers/srv-1/docker/containers/ctr-1',
        {
          method: 'GET',
        }
      )
      expect(sendMock).not.toHaveBeenCalledWith(
        '/api/servers/srv-1/docker/containers/ctr-2',
        {
          method: 'GET',
        }
      )
    })
  })

  it('renders compose and created columns from bulk metadata and sorts by compose', async () => {
    const dateSpy = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('formatted created')

    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/srv-1/docker/containers') {
        return Promise.resolve({
          output: [
            JSON.stringify({
              ID: 'ctr-1',
              Names: 'zulu-web',
              Image: 'nginx:alpine',
              State: 'running',
              Status: 'Up 2 hours',
              Ports: '',
            }),
            JSON.stringify({
              ID: 'ctr-2',
              Names: 'alpha-worker',
              Image: 'busybox:latest',
              State: 'running',
              Status: 'Up 30 minutes',
              Ports: '',
            }),
          ].join('\n'),
        })
      }
      if (
        path ===
        '/api/monitor/servers/srv-1/container-telemetry?window=15m&containerId=ctr-1&containerId=ctr-2'
      ) {
        return Promise.resolve({
          serverId: 'srv-1',
          window: '15m',
          rangeStartAt: '2026-04-29T00:00:00Z',
          rangeEndAt: '2026-04-29T00:15:00Z',
          stepSeconds: 30,
          items: [],
        })
      }
      if (path === '/api/servers/srv-1/docker/containers/metadata') {
        return Promise.resolve({
          items: {
            'ctr-1': {
              created: '2026-04-29T00:00:00Z',
              compose_project: 'alpha-project',
              volume_names: [],
            },
            'ctr-2': {
              created: '2026-04-29T00:05:00Z',
              compose_project: 'zulu-project',
              volume_names: [],
            },
          },
        })
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    renderTab({
      visibleColumns: {
        ports: false,
        volumes: false,
        status: true,
        cpu: false,
        mem: false,
        network: false,
        compose: true,
      },
    })

    expect(await screen.findByText('alpha-project')).toBeInTheDocument()
    expect(screen.getAllByText('formatted created')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Compose' }))

    await waitFor(() => {
      const table = screen.getByRole('table')
      const rows = within(table)
        .getAllByRole('row')
        .filter(row => within(row).queryByText('zulu-web') || within(row).queryByText('alpha-worker'))

      expect(within(rows[0]).getByText('zulu-web')).toBeInTheDocument()
      expect(within(rows[0]).getByText('alpha-project')).toBeInTheDocument()
      expect(within(rows[1]).getByText('alpha-worker')).toBeInTheDocument()
      expect(within(rows[1]).getByText('zulu-project')).toBeInTheDocument()
    })

    dateSpy.mockRestore()
  })
})
