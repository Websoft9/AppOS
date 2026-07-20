import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContainersTab } from './ContainersTab'

const sendMock = vi.fn()
const getServerContainerTelemetryMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/lib/monitor-api', () => ({
  getServerContainerTelemetry: (...args: unknown[]) => getServerContainerTelemetryMock(...args),
}))

function dockerJsonLines(items: unknown[]) {
  return items.map(item => JSON.stringify(item)).join('\n')
}

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
        stateFilter="all"
        page={1}
        pageSize={25}
        visibleColumns={{
          ports: false,
          volumes: false,
          status: false,
          created: false,
          cpu: true,
          mem: false,
          network: false,
          compose: false,
        }}
        onOpenTerminal={() => {}}
        showPanelChrome={false}
      />
    </QueryClientProvider>
  )
}

describe('ContainersTab labels', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getServerContainerTelemetryMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)

    getServerContainerTelemetryMock.mockResolvedValue({ items: [] })

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
              `data: ${JSON.stringify({ output: '' })}`,
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
          output: dockerJsonLines([
            {
              ID: 'ctr-1',
              Names: 'web',
              Image: 'nginx:alpine',
              State: 'running',
              Status: 'Up 2 hours',
            },
          ]),
        })
      }

      if (path === '/api/servers/srv-1/docker/containers/metadata') {
        return Promise.resolve({ items: [] })
      }

      if (path === '/api/servers/srv-1/docker/containers/stats') {
        return Promise.resolve({ output: '' })
      }

      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows CPU without a duplicated percent sign and renames the terminal action to Exec', async () => {
    const user = userEvent.setup()
    renderTab()

    expect(await screen.findByRole('columnheader', { name: 'CPU' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'CPU%' })).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /more actions for web/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /exec/i })).toBeInTheDocument()
    })

    expect(screen.queryByRole('menuitem', { name: /terminal/i })).not.toBeInTheDocument()
  })
})
