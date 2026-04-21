import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TunnelsPage } from './TunnelsPage'

const sendMock = vi.fn()
const subscribeMock = vi.fn()
const unsubscribeMock = vi.fn()

vi.mock('@/components/servers/TunnelSetupWizard', () => ({
  TunnelSetupWizard: () => <div data-testid="tunnel-setup-wizard" />,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      subscribe: (...args: unknown[]) => subscribeMock(...args),
      unsubscribe: (...args: unknown[]) => unsubscribeMock(...args),
    }),
  },
}))

describe('TunnelsPage', () => {
  beforeEach(() => {
    vi.useRealTimers()
    sendMock.mockReset()
    subscribeMock.mockReset()
    unsubscribeMock.mockReset()
    subscribeMock.mockResolvedValue(() => {})
    unsubscribeMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders incomplete tunnel servers without null-length crashes', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/tunnel/overview') {
        return Promise.resolve({
          summary: { total: 1, online: 0, offline: 1, waiting_for_first_connect: 1 },
          items: [
            {
              id: 'srv-1',
              name: 'Pending setup tunnel',
              status: 'offline',
              services: null,
              group_names: null,
              waiting_for_first_connect: true,
            },
          ],
        })
      }
      return Promise.resolve({})
    })

    render(<TunnelsPage />)

    expect(await screen.findByText('Pending setup tunnel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh tunnels' })).toBeInTheDocument()
    expect(screen.queryByText('Refresh')).not.toBeInTheDocument()
    expect(screen.getAllByText('Waiting').length).toBeGreaterThan(0)
    expect(screen.getByText('All status')).toBeInTheDocument()
  })

  it('shows compact inline details and opens connection logs from the action menu', async () => {
    let subscriptionHandler: ((event: { record: Record<string, unknown> }) => void) | null = null
    const openServerDetail = vi.fn()

    subscribeMock.mockImplementation(
      (_topic: string, handler: (event: { record: Record<string, unknown> }) => void) => {
        subscriptionHandler = handler
        return Promise.resolve(() => {})
      }
    )

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/tunnel/overview') {
        return Promise.resolve({
          summary: { total: 1, online: 1, offline: 0, waiting_for_first_connect: 0 },
          items: [
            {
              id: 'srv-2',
              name: 'Connected tunnel',
              description: 'Edge ingress node',
              status: 'online',
              connected_at: '2026-03-19T08:00:00Z',
              created: '2026-03-19T08:00:00Z',
              session_duration_label: '2.5h',
              remote_addr: '10.0.0.2:2200',
              services: [{ service_name: 'ssh', local_port: 22, tunnel_port: 40222 }],
              group_names: ['ops'],
              recent_reconnect_count_24h: 2,
            },
          ],
        })
      }
      if (path === '/api/tunnel/servers/srv-2/logs') {
        return Promise.resolve({
          items: [
            {
              id: 'log-1',
              label: 'Reconnect',
              at: '2026-03-19T09:10:00Z',
              reason_label: 'Pause window elapsed',
              remote_addr: '10.0.0.2:2200',
            },
            {
              id: 'log-2',
              label: 'Rejected while paused',
              at: '2026-03-19T09:00:00Z',
              pause_until: '2026-03-19T09:05:00Z',
            },
          ],
        })
      }
      return Promise.resolve({})
    })

    render(<TunnelsPage onOpenServerDetail={openServerDetail} />)

    const nameButton = await screen.findByRole('button', { name: /Connected tunnel/ })
    expect(nameButton.querySelector('svg')).not.toBeNull()
    fireEvent.click(nameButton)

    expect(await screen.findAllByText('Effective Mappings')).not.toHaveLength(0)
    expect(screen.getByText('Server Name')).toBeInTheDocument()
    expect(screen.getByText(/ssh localhost:22 → 40222/)).toBeInTheDocument()
    const serverButtons = screen.getAllByRole('button', { name: 'Connected tunnel' })
    expect(serverButtons.length).toBeGreaterThan(1)

    fireEvent.click(serverButtons[1])
    expect(openServerDetail).toHaveBeenCalledWith('srv-2')

    const row = screen.getAllByText('Connected tunnel')[0].closest('tr')
    if (!row) {
      throw new Error('Expected tunnel row for Connected tunnel')
    }
    fireEvent.click(within(row).getByRole('menuitem', { name: /connection logs/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/tunnel/servers/srv-2/logs', { method: 'GET' })
    })

    expect(await screen.findByText('Reconnect')).toBeInTheDocument()
    expect(screen.getByText('Rejected while paused')).toBeInTheDocument()
    expect(screen.getByText('Pause until')).toBeInTheDocument()
    expect(screen.getAllByText('Reason').length).toBe(1)
    expect(screen.getAllByText('Remote').length).toBeGreaterThan(0)
    expect(screen.queryByText('Reason: —')).not.toBeInTheDocument()
    expect(screen.queryByText('Remote: —')).not.toBeInTheDocument()

    await act(async () => {
      subscriptionHandler?.({ record: { id: 'srv-2', connect_type: 'tunnel' } })
      await new Promise(resolve => setTimeout(resolve, 350))
    })

    await waitFor(() => {
      const overviewCalls = sendMock.mock.calls.filter(call => call[0] === '/api/tunnel/overview')
      expect(overviewCalls.length).toBeGreaterThan(1)
    })
  })

  it('opens standalone port forward action and saves desired forwards', async () => {
    let savedForwardsBody: unknown = null

    sendMock.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/api/tunnel/overview') {
        return Promise.resolve({
          summary: { total: 1, online: 0, offline: 1, waiting_for_first_connect: 0 },
          items: [
            {
              id: 'srv-3',
              name: 'Paused tunnel',
              status: 'paused',
              is_paused: true,
              pause_until: '2026-03-19T10:40:00Z',
              services: [{ service_name: 'ssh', local_port: 22, tunnel_port: 40222 }],
              group_names: [],
            },
          ],
        })
      }
      if (path === '/api/tunnel/servers/srv-3/forwards' && options?.method === 'GET') {
        return Promise.resolve({
          forwards: [
            { service_name: 'ssh', local_port: 22 },
            { service_name: 'app', local_port: 3000 },
          ],
        })
      }
      if (path === '/api/tunnel/servers/srv-3/forwards' && options?.method === 'PUT') {
        savedForwardsBody = options.body
        return Promise.resolve({
          forwards: [
            { service_name: 'ssh', local_port: 22 },
            { service_name: 'app', local_port: 4000 },
          ],
        })
      }
      return Promise.resolve({})
    })

    render(<TunnelsPage />)

    expect(await screen.findByText('Paused tunnel')).toBeInTheDocument()
    expect(screen.getByText('Resume Connect')).toBeInTheDocument()

    const row = screen.getByText('Paused tunnel').closest('tr')
    if (!row) {
      throw new Error('Expected tunnel row for Paused tunnel')
    }

    fireEvent.click(within(row).getByRole('menuitem', { name: /port forward/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/tunnel/servers/srv-3/forwards', { method: 'GET' })
    })

    expect(await screen.findByText('Desired Forwards')).toBeInTheDocument()
    expect(screen.getByText('Effective Mappings')).toBeInTheDocument()

    const localPortInputs = screen.getAllByPlaceholderText('local port')
    fireEvent.change(localPortInputs[1], { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: /save desired forwards/i }))

    await waitFor(() => {
      expect(savedForwardsBody).toEqual({
        forwards: [
          { service_name: 'ssh', local_port: 22 },
          { service_name: 'app', local_port: 4000 },
        ],
      })
    })
    expect(
      screen.getByText('Saved. Applies on next reconnect or regenerated setup.')
    ).toBeInTheDocument()
  })

  it('renames disconnect to restart connection and allows dismissing notices', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/tunnel/overview') {
        return Promise.resolve({
          summary: { total: 1, online: 1, offline: 0, waiting_for_first_connect: 0 },
          items: [
            {
              id: 'srv-4',
              name: 'Restartable tunnel',
              status: 'online',
              services: [],
              group_names: [],
            },
          ],
        })
      }
      if (path === '/api/tunnel/servers/srv-4/disconnect' && options?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 'disconnecting' })
      }
      return Promise.resolve({})
    })

    render(<TunnelsPage />)

    expect(await screen.findByText('Restartable tunnel')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /restart connection/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /restart connection/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Restarting')).toBeInTheDocument()
    expect(await screen.findByText('Tunnel connection restart requested.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }))
    expect(screen.queryByText('Tunnel connection restart requested.')).not.toBeInTheDocument()
  })

  it('shows reconnecting status after resume until the tunnel comes back online', async () => {
    let overviewCalls = 0

    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/tunnel/overview') {
        overviewCalls += 1
        return Promise.resolve({
          summary: { total: 1, online: 0, offline: 1, waiting_for_first_connect: 0 },
          items: [
            {
              id: 'srv-5',
              name: 'Recovering tunnel',
              status: overviewCalls === 1 ? 'paused' : 'offline',
              is_paused: overviewCalls === 1,
              pause_until: overviewCalls === 1 ? '2026-03-20T16:35:18Z' : '',
              services: [],
              group_names: [],
            },
          ],
        })
      }
      if (path === '/api/tunnel/servers/srv-5/resume' && options?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 'offline', pause_until: '' })
      }
      return Promise.resolve({})
    })

    render(<TunnelsPage />)

    expect(await screen.findByText('Recovering tunnel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /resume connect/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Reconnecting')).toBeInTheDocument()
    expect(screen.getByText('Resume sent. Waiting for reconnect.')).toBeInTheDocument()
  })
})
