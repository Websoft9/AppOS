import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DockerPanel } from './DockerPanel'

const sendMock = vi.fn()
let scenario: 'attention' | 'healthy' | 'many' | 'composeMissing' = 'attention'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a href="/deploy/create" className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/docker/ContainersTab', () => ({
  ContainersTab: ({ includeNames }: { includeNames?: string[] }) => (
    <div data-testid="containers-tab">Containers tab {includeNames?.join(',')}</div>
  ),
}))

vi.mock('@/components/docker/ImagesTab', () => ({
  ImagesTab: ({
    onSummaryChange,
  }: {
    onSummaryChange?: (summary: {
      totalItems: number
      totalPages: number
      usedItems: number
      unusedItems: number
    }) => void
  }) => {
    const React = require('react') as typeof import('react')

    React.useEffect(() => {
      onSummaryChange?.({
        totalItems: 3,
        totalPages: 1,
        usedItems: 2,
        unusedItems: 1,
      })
    }, [onSummaryChange])

    return <div data-testid="images-tab">Images tab</div>
  },
}))

vi.mock('@/components/docker/VolumesTab', () => ({
  VolumesTab: () => <div data-testid="volumes-tab">Volumes tab</div>,
}))

vi.mock('@/components/docker/NetworksTab', () => ({
  NetworksTab: () => <div data-testid="networks-tab">Networks tab</div>,
}))

vi.mock('@/components/docker/ComposeTab', () => ({
  ComposeTab: ({
    externalStatusFilter,
    onSummaryChange,
  }: {
    externalStatusFilter?: string
    onSummaryChange?: (summary: {
      totalItems: number
      totalPages: number
      statusCounts: Array<{ status: string; count: number }>
    }) => void
  }) => {
    const React = require('react') as typeof import('react')

    React.useEffect(() => {
      onSummaryChange?.({
        totalItems: 2,
        totalPages: 1,
        statusCounts: [
          { status: 'running(1)', count: 1 },
          { status: 'exited(1)', count: 1 },
        ],
      })
    }, [onSummaryChange])

    return <div data-testid="compose-tab">Compose tab {externalStatusFilter ?? 'all'}</div>
  },
}))

vi.mock('@/components/connect/TerminalPanel', () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}))

function dockerJsonLines(items: unknown[]) {
  return items.map(item => JSON.stringify(item)).join('\n')
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <DockerPanel serverId="srv-1" />
    </QueryClientProvider>
  )
}

function mockDockerEndpoints() {
  sendMock.mockImplementation((path: string) => {
    if (path === '/api/servers/docker-targets') {
      return Promise.resolve([{ id: 'srv-1', label: 'Server 1', status: 'online' }])
    }

    if (scenario === 'healthy') {
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
      if (path === '/api/servers/srv-1/docker/compose/ls') {
        return Promise.resolve({
          output: JSON.stringify([{ Name: 'stack-a', Status: 'running(1)' }]),
        })
      }
    } else if (scenario === 'many') {
      if (path === '/api/servers/srv-1/docker/containers') {
        return Promise.resolve({
          output: dockerJsonLines(
            Array.from({ length: 8 }, (_, index) => ({
              ID: `ctr-${index + 1}`,
              Names: `stopped-${index + 1}`,
              Image: 'busybox:latest',
              State: 'exited',
              Status: 'Exited (0) 10 minutes ago',
            }))
          ),
        })
      }
      if (path === '/api/servers/srv-1/docker/compose/ls') {
        return Promise.resolve({
          output: JSON.stringify([
            { Name: 'stack-a', Status: 'running(1)' },
            { Name: 'broken-stack', Status: 'exited(1)' },
          ]),
        })
      }
    } else if (scenario === 'composeMissing') {
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
      if (path === '/api/servers/srv-1/docker/compose/ls') {
        return Promise.reject(new Error("docker: 'compose' is not a docker command"))
      }
    } else {
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
            {
              ID: 'ctr-2',
              Names: 'worker',
              Image: 'busybox:latest',
              State: 'exited',
              Status: 'Exited (0) 10 minutes ago',
            },
            {
              ID: 'ctr-3',
              Names: 'paused-one',
              Image: 'redis:7',
              State: 'paused',
              Status: 'Up 1 hour (Paused)',
            },
          ]),
        })
      }
      if (path === '/api/servers/srv-1/docker/compose/ls') {
        return Promise.resolve({
          output: JSON.stringify([
            { Name: 'stack-a', Status: 'running(1)' },
            { Name: 'stack-b', Status: 'exited(1)' },
          ]),
        })
      }
    }

    if (path === '/api/servers/srv-1/docker/images') {
      return Promise.resolve({
        output: dockerJsonLines([
          { ID: 'img-1', Repository: 'nginx', Tag: 'alpine' },
          { ID: 'img-2', Repository: 'busybox', Tag: 'latest' },
          { ID: 'img-3', Repository: '<none>', Tag: '<none>' },
        ]),
      })
    }

    if (path === '/api/servers/srv-1/docker/volumes') {
      return Promise.resolve({
        output: dockerJsonLines([{ Name: 'data' }, { Name: 'cache' }]),
      })
    }

    if (path === '/api/servers/srv-1/docker/networks') {
      return Promise.resolve({
        output: dockerJsonLines([{ ID: 'net-1', Name: 'bridge' }]),
      })
    }

    return Promise.reject(new Error(`Unexpected request: ${path}`))
  })
}

describe('DockerPanel overview', () => {
  beforeEach(() => {
    sendMock.mockReset()
    scenario = 'attention'
    mockDockerEndpoints()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders simplified resource cards, attention issues, and quick actions', async () => {
    renderPanel()

    expect(await screen.findByText('Needs Attention')).toBeInTheDocument()
    expect(screen.getByText('2 stopped')).toBeInTheDocument()
    expect(screen.getByText('1 attention')).toBeInTheDocument()
    expect(screen.getByText('2 tagged')).toBeInTheDocument()
    expect(screen.getByText('clean')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()

    expect(screen.getByText('worker')).toBeInTheDocument()
    expect(screen.getByText('exited container')).toBeInTheDocument()
    expect(screen.getByText('paused-one')).toBeInTheDocument()
    expect(screen.getByText('paused container')).toBeInTheDocument()
    expect(screen.getByText('stack-b')).toBeInTheDocument()
    expect(screen.getByText('Compose project needs attention')).toBeInTheDocument()

    const containersOverviewCard = screen.getByRole('button', { name: /containers 3 2 stopped/i })
      .firstElementChild as HTMLElement
    expect(containersOverviewCard).not.toHaveClass('border-amber-300/70', 'bg-amber-50/40')

    const quickActions = screen.getByText('Quick Actions').closest('div')
      ?.parentElement?.parentElement
    expect(quickActions).toBeTruthy()
    expect(within(quickActions as HTMLElement).getByText('Create Compose')).toBeInTheDocument()
    expect(within(quickActions as HTMLElement).getByText('Pull Image')).toBeInTheDocument()
    expect(within(quickActions as HTMLElement).getByText('Prune Resources')).toBeInTheDocument()
    expect(within(quickActions as HTMLElement).queryByText('Refresh')).toBeNull()

    expect(screen.queryByText('Container Health')).not.toBeInTheDocument()
    expect(screen.queryByText('Compose Stacks')).not.toBeInTheDocument()
    expect(screen.queryByText('Inventory Split')).not.toBeInTheDocument()
  })

  it('shows the empty attention state when inventory is operational', async () => {
    scenario = 'healthy'
    mockDockerEndpoints()

    renderPanel()

    expect(await screen.findByText('No issues detected')).toBeInTheDocument()
    expect(
      screen.getByText(
        'All discovered Docker resources look operational from current inventory data.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('0 issues')).toBeInTheDocument()
  })

  it('routes a container issue to the Containers tab with a name filter', async () => {
    renderPanel()

    const issue = await screen.findByRole('button', { name: /worker exited container/i })
    fireEvent.click(issue)

    await waitFor(() => {
      expect(screen.getByTestId('containers-tab')).toHaveTextContent('worker')
    })
  })

  it('caps long attention lists and offers type-specific drilldowns', async () => {
    scenario = 'many'
    mockDockerEndpoints()

    renderPanel()

    expect(await screen.findByText('Showing first 6 of 9 issues.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view containers/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view compose/i })).toBeInTheDocument()
    expect(screen.getByText('stopped-1')).toBeInTheDocument()
    expect(screen.queryByText('stopped-8')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /view compose/i }))

    await waitFor(() => {
      expect(screen.getByTestId('compose-tab')).toBeInTheDocument()
    })
  })

  it('surfaces compose status filtering in the workspace toolbar', async () => {
    renderPanel()

    const composeTab = await screen.findByRole('tab', { name: 'Compose' })
    fireEvent.mouseDown(composeTab)
    fireEvent.click(composeTab)

    const statusFilter = await screen.findByRole('combobox', { name: 'Filter compose status' })
    expect(statusFilter).toHaveValue('all')
    expect(screen.getByRole('option', { name: 'running(1) (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'exited(1) (1)' })).toBeInTheDocument()

    fireEvent.change(statusFilter, { target: { value: 'exited(1)' } })

    await waitFor(() => {
      expect(screen.getByTestId('compose-tab')).toHaveTextContent('Compose tab exited(1)')
    })
  })

  it('shows CPU and Memory once in the container visible columns menu', async () => {
    const user = userEvent.setup()

    renderPanel()

    await screen.findByText('Needs Attention')
    await user.click(screen.getByRole('tab', { name: 'Containers' }))
    await user.click(screen.getByRole('button', { name: 'Container display settings' }))

    expect(screen.getByRole('menuitemcheckbox', { name: 'CPU' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Memory' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'CPU%' })).not.toBeInTheDocument()
  })

  it('turns compose prerequisite failures into a guided alert', async () => {
    scenario = 'composeMissing'
    mockDockerEndpoints()

    renderPanel()

    expect(
      await screen.findByText('Docker Compose is not available on this server')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Compose commands cannot run until the Docker Compose plugin or compatible compose command is installed and working.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Components > Prerequisites' })).toHaveAttribute(
      'href',
      '/resources/servers?server=srv-1&tab=components&focusComponent=docker&focusPanel=checklist&focusSource=compose&focusIssue=compose_missing'
    )
  })
})
