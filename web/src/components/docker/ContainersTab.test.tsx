import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContainersTab } from './ContainersTab'

const sendMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/monitor/TimeSeriesChart', () => ({
  TimeSeriesChart: ({
    name,
    points,
    segments,
  }: {
    name: string
    points?: number[][]
    segments?: Array<{ name: string; points: number[][] }>
  }) => {
    const hasData =
      (points?.length || 0) > 0 || (segments || []).some(segment => segment.points.length > 0)
    return (
      <div data-testid={`chart-${name}`} data-has-data={hasData ? 'true' : 'false'}>
        {name} chart
      </div>
    )
  },
}))

function renderTab(overrides?: {
  includeNames?: string[]
  onClearIncludeNames?: () => void
  onClearFilterPreset?: () => void
  visibleColumns?: {
    ports: boolean
    volumes: boolean
    status: boolean
    created: boolean
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
        visibleColumns={overrides?.visibleColumns ?? {
          ports: true,
          volumes: true,
          status: true,
          created: false,
          cpu: true,
          mem: true,
          network: true,
          compose: true,
        }}
        includeNames={overrides?.includeNames}
        onClearIncludeNames={overrides?.onClearIncludeNames}
        onClearFilterPreset={overrides?.onClearFilterPreset}
      />
    </QueryClientProvider>
  )
}

describe('ContainersTab', () => {
  beforeEach(() => {
    sendMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)

    const streamedStatsOutput = [
      JSON.stringify({
        Container: 'ctr-1',
        Name: 'demo-web',
        CPUPerc: '11.2%',
        MemUsage: '128MiB / 256MiB',
        NetIO: '2.0KiB / 1.0KiB',
        BlockIO: '4.0KiB / 2.0KiB',
      }),
      JSON.stringify({
        Container: 'ctr-2',
        Name: 'demo-worker',
        CPUPerc: '0.0%',
        MemUsage: '32MiB / 256MiB',
        NetIO: '0B / 0B',
        BlockIO: '0B / 0B',
      }),
    ].join('\n')

    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url === '/api/servers/srv-1/docker/containers/stats?stream=true') {
        return Promise.resolve(
          new Response(
            [
              'event: ready',
              `data: ${JSON.stringify({ host: 'stub-local', intervalMs: 2000 })}`,
              '',
              'event: stats',
              `data: ${JSON.stringify({ output: streamedStatsOutput })}`,
              '',
            ].join('\n'),
            {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }
          )
        )
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

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
          '/api/monitor/servers/srv-1/container-telemetry?window=5m&containerId=ctr-1&containerName=demo-web&containerId=ctr-2&containerName=demo-worker' ||
        path ===
          '/api/monitor/servers/srv-1/container-telemetry?window=15m&containerId=ctr-1&containerName=demo-web&containerId=ctr-2&containerName=demo-worker'
      ) {
        return Promise.resolve({
          serverId: 'srv-1',
          window: path.includes('window=5m') ? '5m' : '15m',
          rangeStartAt: '2026-04-29T00:00:00Z',
          rangeEndAt: '2026-04-29T00:15:00Z',
          stepSeconds: 30,
          items: [
            {
              containerId: 'ctr-1',
              latest: {
                cpuPercent: 17.2,
                memoryUsageBytes: 134217728,
                memoryLimitBytes: 268435456,
                networkRxBytesPerSecond: 2048,
                networkTxBytesPerSecond: 1024,
                blockReadBytesPerSecond: 4096,
                blockWriteBytesPerSecond: 2048,
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
                  segments: [
                    {
                      name: 'usage',
                      points: [
                        [1, 104857600],
                        [2, 134217728],
                      ],
                    },
                    {
                      name: 'limit',
                      points: [
                        [1, 268435456],
                        [2, 268435456],
                      ],
                    },
                  ],
                },
                {
                  name: 'block',
                  unit: 'bytes/s',
                  segments: [
                    {
                      name: 'read',
                      points: [
                        [1, 2048],
                        [2, 4096],
                      ],
                    },
                    {
                      name: 'write',
                      points: [
                        [1, 1024],
                        [2, 2048],
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
                memoryUsageBytes: 33554432,
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
      if (path === '/api/servers/srv-1/docker/containers/stats') {
        return Promise.resolve({
          output: [
            JSON.stringify({
              ID: 'ctr-1',
              Container: 'ctr-1',
              Name: 'demo-web',
              CPUPerc: '11.2%',
              MemUsage: '128MiB / 256MiB',
              NetIO: '2.0KiB / 1.0KiB',
              BlockIO: '4.0KiB / 2.0KiB',
            }),
            JSON.stringify({
              ID: 'ctr-2',
              Container: 'ctr-2',
              Name: 'demo-worker',
              CPUPerc: '0.0%',
              MemUsage: '32MiB / 256MiB',
              NetIO: '0B / 0B',
              BlockIO: '0B / 0B',
            }),
          ].join('\n'),
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
      if (path === '/api/servers/srv-1/docker/containers/ctr-1') {
        return Promise.resolve({
          output: JSON.stringify([
            {
              Id: 'ctr-1',
              Name: '/demo-web',
              Config: {
                Image: 'nginx:alpine',
              },
              State: {
                Status: 'running',
              },
            },
          ]),
        })
      }
      if (path === '/api/servers/srv-1/docker/containers/ctr-2') {
        return Promise.resolve({
          output: JSON.stringify([
            {
              Id: 'ctr-2',
              Name: '/demo-worker',
              Config: {
                Image: 'busybox:latest',
              },
              State: {
                Status: 'running',
              },
            },
          ]),
        })
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('renders docker stats backed CPU and memory in the containers table', async () => {
    renderTab()

    expect(await screen.findByText('demo-web')).toBeInTheDocument()
    expect(await screen.findByText('11%')).toBeInTheDocument()
    expect(screen.getByText('128 MiB')).toBeInTheDocument()
    expect(screen.getByText('Stale telemetry')).toBeInTheDocument()
    expect(screen.getByText('1 volume')).toBeInTheDocument()
    expect(screen.queryByText('No telemetry')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/docker/containers/metadata', {
        method: 'POST',
        body: { ids: ['ctr-1', 'ctr-2'] },
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/servers/srv-1/docker/containers/stats?stream=true',
        expect.objectContaining({ method: 'GET' })
      )
    })
  })

  it('renders all four telemetry groups in the Container Stats dialog', async () => {
    const user = userEvent.setup()

    renderTab()

    await screen.findByText('demo-web')
    await user.click(screen.getByRole('button', { name: 'Open monitor for demo-web' }))

    expect(await screen.findByText('Container Stats: demo-web')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('50%')).toBeInTheDocument()
    expect(within(dialog).getByText('128 MiB / 256 MiB')).toBeInTheDocument()
    expect(screen.getByText('CPU Trend')).toBeInTheDocument()
    expect(screen.getByText('Memory Trend')).toBeInTheDocument()
    expect(screen.getByText('Network Trend')).toBeInTheDocument()
    expect(screen.getByText('Block I/O Trend')).toBeInTheDocument()
    expect(screen.getByText('cpu chart')).toBeInTheDocument()
    expect(screen.getByText('memory chart')).toBeInTheDocument()
    expect(screen.getByText('network chart')).toBeInTheDocument()
    expect(screen.getByText('block chart')).toBeInTheDocument()
    expect(screen.getByTestId('chart-cpu')).toHaveAttribute('data-has-data', 'true')
    expect(screen.getByTestId('chart-memory')).toHaveAttribute('data-has-data', 'true')
    expect(screen.getByTestId('chart-network')).toHaveAttribute('data-has-data', 'true')
    expect(screen.getByTestId('chart-block')).toHaveAttribute('data-has-data', 'true')
  })

  it('resolves trend telemetry by container name when the response is name-keyed', async () => {
    const user = userEvent.setup()

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
          ].join('\n'),
        })
      }
      if (
        path ===
          '/api/monitor/servers/srv-1/container-telemetry?window=5m&containerId=ctr-1&containerName=demo-web' ||
        path ===
          '/api/monitor/servers/srv-1/container-telemetry?window=15m&containerId=ctr-1&containerName=demo-web'
      ) {
        return Promise.resolve({
          serverId: 'srv-1',
          window: path.includes('window=5m') ? '5m' : '15m',
          rangeStartAt: '2026-04-29T00:00:00Z',
          rangeEndAt: '2026-04-29T00:15:00Z',
          stepSeconds: 30,
          items: [
            {
              containerId: 'demo-web',
              containerName: 'demo-web',
              latest: {
                cpuPercent: 17.2,
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
              ],
            },
          ],
        })
      }
      if (path === '/api/servers/srv-1/docker/containers/stats') {
        return Promise.resolve({
          output: [
            JSON.stringify({
              ID: 'ctr-1',
              Container: 'ctr-1',
              Name: 'demo-web',
              CPUPerc: '11.2%',
              MemUsage: '128MiB / 256MiB',
              NetIO: '2.0KiB / 1.0KiB',
              BlockIO: '4.0KiB / 2.0KiB',
            }),
          ].join('\n'),
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
          },
        })
      }
      if (path === '/api/servers/srv-1/docker/containers/ctr-1') {
        return Promise.resolve({
          output: JSON.stringify([
            {
              Id: 'ctr-1',
              Name: '/demo-web',
              Config: {
                Image: 'nginx:alpine',
              },
              State: {
                Status: 'running',
              },
            },
          ]),
        })
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    renderTab()

    await screen.findByText('demo-web')
    await user.click(screen.getByRole('button', { name: 'Open monitor for demo-web' }))

    expect(await screen.findByText('Container Stats: demo-web')).toBeInTheDocument()
    expect(screen.getByTestId('chart-cpu')).toHaveAttribute('data-has-data', 'true')
  })

  it('renders compose and created columns from bulk metadata', async () => {
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
          '/api/monitor/servers/srv-1/container-telemetry?window=5m&containerId=ctr-1&containerName=zulu-web&containerId=ctr-2&containerName=alpha-worker' ||
        path ===
          '/api/monitor/servers/srv-1/container-telemetry?window=15m&containerId=ctr-1&containerName=zulu-web&containerId=ctr-2&containerName=alpha-worker'
      ) {
        return Promise.resolve({
          serverId: 'srv-1',
          window: path.includes('window=5m') ? '5m' : '15m',
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
        created: true,
        cpu: false,
        mem: false,
        network: false,
        compose: true,
      },
    })

    expect(await screen.findByText('alpha-project')).toBeInTheDocument()
    expect(screen.getAllByText('formatted created')).toHaveLength(2)

    await waitFor(() => {
      const table = screen.getByRole('table')
      const rows = within(table)
        .getAllByRole('row')
        .filter(row => within(row).queryByText('zulu-web') || within(row).queryByText('alpha-worker'))

      expect(rows).toHaveLength(2)
      expect(within(rows[0]).getByText(/alpha-worker|zulu-web/)).toBeInTheDocument()
      expect(within(rows[1]).getByText(/alpha-worker|zulu-web/)).toBeInTheDocument()
    })

    expect(screen.getByText('alpha-project')).toBeInTheDocument()
    expect(screen.getByText('zulu-project')).toBeInTheDocument()

    dateSpy.mockRestore()
  })

  it('keeps the linked container badge and clear action in the same toolbar group', async () => {
    const clearIncludeNames = vi.fn()
    const clearFilterPreset = vi.fn()

    renderTab({
      includeNames: ['demo-web', 'demo-worker', 'demo-api'],
      onClearIncludeNames: clearIncludeNames,
      onClearFilterPreset: clearFilterPreset,
    })

    const badge = await screen.findByText('Linked containers: 3')
    const clearButton = screen.getByRole('button', { name: 'Clear filters' })
    const toolbarGroup = badge.parentElement

    expect(toolbarGroup).toBe(clearButton.parentElement)
    expect(toolbarGroup).toHaveClass('ml-auto', 'justify-end')
    expect(toolbarGroup?.textContent?.indexOf('Linked containers: 3')).toBeLessThan(
      toolbarGroup?.textContent?.indexOf('Clear filters') ?? -1
    )

    fireEvent.click(clearButton)

    expect(clearFilterPreset).toHaveBeenCalledTimes(1)
    expect(clearIncludeNames).toHaveBeenCalledTimes(1)
  })

  it('opens inspect output from the actions menu in the shared viewer dialog', async () => {
    const user = userEvent.setup()
    renderTab()

    await screen.findByText('demo-web')
    const actionButton = screen.getByRole('button', { name: 'More actions for demo-web' })

    await user.click(actionButton)

    await user.click(await screen.findByRole('menuitem', { name: 'Inspect' }))

    expect(await screen.findByText('Container Inspect: demo-web')).toBeInTheDocument()
    expect(await screen.findByText(/"Image":\s*"nginx:alpine"/)).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/docker/containers/ctr-1', {
        method: 'GET',
      })
    })
  })
})
