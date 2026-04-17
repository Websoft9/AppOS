import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersPage } from './servers'

const navigateMock = vi.fn()
const getFullListMock = vi.fn()
const sendMock = vi.fn()
let searchState: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => searchState,
    useNavigate: () => navigateMock,
  }),
  Link: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: (name: string) => {
      if (name === 'servers') {
        return {
          getFullList: (...args: unknown[]) => getFullListMock(...args),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        }
      }

      return {
        getFullList: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }
    },
  },
}))

vi.mock('@/lib/connect-api', () => ({
  checkServerStatus: vi.fn(),
  serverPower: vi.fn(),
}))

describe('ServersPage layout', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    getFullListMock.mockReset()
    sendMock.mockReset()
    searchState = {}
    getFullListMock.mockResolvedValue([
      {
        id: 'server-1',
        name: 'alpha',
        connect_type: 'direct',
        host: '10.0.0.1',
        port: 22,
        user: 'root',
      },
    ])
    sendMock.mockImplementation((path: string) => {
      if (
        path ===
        "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='single_value'||template_id='ssh_key'))&sort=name"
      ) {
        return Promise.resolve({
          items: [
            {
              id: 'secret-1',
              name: 'ops-password',
              template_id: 'single_value',
            },
          ],
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('uses the updated page header controls', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Servers' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('link', { name: 'Resources' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add Server' })).toBeInTheDocument()
  })

  it('places favorite below shutdown in the actions menu', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'More actions' })[0])

    const menuText = (await screen.findByText('Restart')).parentElement?.parentElement?.textContent ?? ''
    expect(menuText.indexOf('Restart')).toBeLessThan(menuText.indexOf('Shutdown'))
    expect(menuText.indexOf('Shutdown')).toBeLessThan(menuText.indexOf('Add Favorite'))
  })

  it('shows the tunnel tab only for tunnel-connected servers', async () => {
    searchState = { server: 'server-1', tab: 'detail' }
    getFullListMock.mockResolvedValue([
      {
        id: 'server-1',
        name: 'alpha',
        connect_type: 'tunnel',
        host: '10.0.0.1',
        port: 22,
        user: 'root',
        created: '2026-04-16 00:00:00.000Z',
        updated: '2026-04-16 01:00:00.000Z',
        tunnel_services: [{ service_name: 'ssh', tunnel_port: 2201 }],
      },
    ])

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Tunnel' })).toBeInTheDocument()
    expect(screen.getByText('Record Fields')).toBeInTheDocument()
    expect(screen.queryByText('Connection')).not.toBeInTheDocument()
  })

  it('hides the tunnel tab for direct servers', async () => {
    searchState = { server: 'server-1', tab: 'detail' }

    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })
    expect(screen.queryByRole('tab', { name: 'Tunnel' })).toBeNull()
    expect(screen.queryByText('Tunnel Services')).toBeNull()
  })

  it('lets the user jump to edit the selected credential secret', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Server' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }))

    await waitFor(() => {
      expect(screen.getByText('Create Server')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Credential (Secret)' }))
    fireEvent.click(await screen.findByRole('button', { name: /ops-password/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Secret' }))

    expect(openSpy).toHaveBeenCalledWith(
      'http://localhost:3000/secrets?id=secret-1&edit=secret-1',
      '_blank',
      'noopener,noreferrer'
    )

    openSpy.mockRestore()
  })
})