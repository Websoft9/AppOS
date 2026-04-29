import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

function renderTab() {
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
        page={1}
        pageSize={50}
        visibleColumns={{
          ports: true,
          status: true,
          cpu: true,
          mem: true,
          network: true,
          compose: false,
        }}
      />
    </QueryClientProvider>
  )
}

describe('ContainersTab', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ext/docker/containers?server_id=srv-1') {
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
      if (path === '/api/ext/docker/containers/ctr-1?server_id=srv-1') {
        return Promise.resolve({
          output:
            '[{"Created":"2026-04-29T00:00:00Z","Config":{"Labels":{}},"NetworkSettings":{"Networks":{}},"Mounts":[]}]',
        })
      }
      if (path === '/api/ext/docker/containers/ctr-2?server_id=srv-1') {
        return Promise.resolve({
          output:
            '[{"Created":"2026-04-29T00:05:00Z","Config":{"Labels":{}},"NetworkSettings":{"Networks":{}},"Mounts":[]}]',
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

    await waitFor(() => {
      expect(sendMock).not.toHaveBeenCalledWith(
        '/api/ext/docker/containers/stats?server_id=srv-1',
        {
          method: 'GET',
        }
      )
    })
  })
})
