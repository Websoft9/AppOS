import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersPage } from './servers'

const navigateMock = vi.fn()
const getFullListMock = vi.fn()
const sendMock = vi.fn()
const createServerMock = vi.fn()
const getSecretMock = vi.fn()
const updateSecretMock = vi.fn()
const getLocalDockerBridgeAddressMock = vi.fn()
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
          create: (...args: unknown[]) => createServerMock(...args),
          update: vi.fn(),
          delete: vi.fn(),
        }
      }

      if (name === 'secrets') {
        return {
          getFullList: vi.fn(),
          create: vi.fn(),
          getOne: (...args: unknown[]) => getSecretMock(...args),
          update: (...args: unknown[]) => updateSecretMock(...args),
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
  getLocalDockerBridgeAddress: (...args: unknown[]) => getLocalDockerBridgeAddressMock(...args),
  serverPower: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'owner@example.com' },
  }),
}))

describe('ServersPage layout', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    getFullListMock.mockReset()
    sendMock.mockReset()
    createServerMock.mockReset()
    getSecretMock.mockReset()
    updateSecretMock.mockReset()
    getLocalDockerBridgeAddressMock.mockReset()
    searchState = {}
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              credential: 'secret-1',
              credential_type: 'Password',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
          ],
        })
      }
      if (
        path === '/api/collections/secrets/records?perPage=500&fields=id,name,template_id&filter=(id=\'secret-1\')'
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
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === '/api/secrets/secret-1/payload') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })
    createServerMock.mockResolvedValue({ id: 'server-new', connect_type: 'direct' })
    getSecretMock.mockResolvedValue({
      id: 'secret-1',
      name: 'ops-password',
      description: 'Original secret',
      template_id: 'single_value',
    })
    updateSecretMock.mockResolvedValue({})
    getLocalDockerBridgeAddressMock.mockResolvedValue('172.17.0.1')
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
    expect(screen.getByRole('button', { name: 'Filter Mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter Connection' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filter Credential' })).toBeNull()
  })

  it('shows the minimal pager beside search when multiple pages exist', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: Array.from({ length: 11 }, (_, index) => ({
            id: `server-${index + 1}`,
            name: `server-${index + 1}`,
            connect_type: 'direct',
            host: `10.0.0.${index + 1}`,
            port: 22,
            user: 'root',
            created_by: 'user-1',
            created_by_name: 'owner@example.com',
            credential_type: 'Password',
            access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
          })),
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('server-1')).toBeInTheDocument()
    expect(screen.getByText('Total 11 servers')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('10')
    expect(screen.getByRole('option', { name: '10 / page' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '50 / page' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '100 / page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
  })

  it('renders the unified Connection column and lifecycle primary actions', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              credential: 'secret-1',
              credential_type: 'Password',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
            {
              id: 'server-2',
              name: 'beta',
              connect_type: 'tunnel',
              host: '10.0.0.2',
              port: 22,
              user: 'root',
              created_by: 'user-2',
              created_by_name: 'alice',
              credential: 'secret-1',
              credential_type: 'Password',
              access: { status: 'unavailable', reason: 'waiting_for_first_connect', checked_at: '', source: 'tunnel_runtime' },
              tunnel: { state: 'setup_required', status: 'offline', waiting_for_first_connect: true, services: [] },
            },
          ],
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === '/api/secrets/secret-1/payload') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Awaiting Connection')).toBeInTheDocument()
    expect(screen.getByText('Not Configured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Setup' })).toBeInTheDocument()
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
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'tunnel',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              created: '2026-04-16T00:00:00Z',
              updated: '2026-04-16T01:00:00Z',
              credential_type: 'Password',
              access: { status: 'available', reason: '', checked_at: '2026-04-16T01:00:00Z', source: 'tunnel_runtime' },
              tunnel: {
                state: 'ready',
                status: 'online',
                waiting_for_first_connect: false,
                services: [{ service_name: 'ssh', tunnel_port: 2201 }],
              },
            },
          ],
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === '/api/secrets/secret-1/payload') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Detail' }))

    expect(await screen.findByRole('tab', { name: 'Tunnel' })).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toHaveClass('border-b')
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Connection' })).toBeInTheDocument()
  })

  it('hides the tunnel tab for direct servers', async () => {
    render(<ServersPage />)

    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Detail' }))

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })
    expect(screen.queryByRole('tab', { name: 'Tunnel' })).toBeNull()
    expect(screen.queryByText('Tunnel Services')).toBeNull()
  })

  it('edits the selected credential secret without leaving the server dialog', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Server' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Add Server' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Credential (Secret)' }))
    fireEvent.click(await screen.findByRole('button', { name: /ops-password/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Secret' }))

    expect(await screen.findByRole('heading', { name: 'Edit Credential' })).toBeInTheDocument()
    expect(getSecretMock).toHaveBeenCalledWith('secret-1')

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'ops-password-v2' } })
    fireEvent.change(screen.getByLabelText('Secret Value *'), { target: { value: 'new-pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Credential' }))

    await waitFor(() => {
      expect(updateSecretMock).toHaveBeenCalledWith('secret-1', {
        name: 'ops-password-v2',
        description: 'Original secret',
      })
    })

    expect(sendMock).toHaveBeenCalledWith('/api/secrets/secret-1/payload', {
      method: 'PUT',
      body: { payload: { value: 'new-pass' } },
    })
  })

  it('renders connection type as cards, pre-fills a generated name, and uses the simplified credential action', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    expect(await screen.findByRole('dialog')).toHaveClass('sm:max-w-4xl')
    expect(screen.getByRole('button', { name: 'Connection type help' })).toBeInTheDocument()
    expect(screen.queryByText('Choose how the managed server connects to AppOS.')).toBeNull()
    expect(screen.getByRole('radio', { name: /Direct SSH/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Reverse Tunnel/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByDisplayValue(/^server-\d{6}$/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Credential (Secret)' }))
    expect(await screen.findByRole('button', { name: 'New credential' })).toBeInTheDocument()
  })

  it('shows help text only after clicking the question buttons and toggles it closed on second click', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    const connectionHelpButton = screen.getByRole('button', { name: 'Connection type help' })
    const hostHelpButton = screen.getByRole('button', { name: 'Host help' })

    expect(screen.queryByText('Choose how the managed server connects to AppOS.')).toBeNull()
    expect(
      screen.queryByText('Enter the IP address or domain name of the server managed by AppOS.')
    ).toBeNull()

    fireEvent.click(connectionHelpButton)
    expect(
      await screen.findByText('Choose how the managed server connects to AppOS.')
    ).toBeInTheDocument()

    fireEvent.click(connectionHelpButton)
    await waitFor(() => {
      expect(screen.queryByText('Choose how the managed server connects to AppOS.')).toBeNull()
    })

    fireEvent.click(hostHelpButton)
    expect(
      await screen.findByText('Enter the IP address or domain name of the server managed by AppOS.')
    ).toBeInTheDocument()

    fireEvent.click(hostHelpButton)
    await waitFor(() => {
      expect(
        screen.queryByText('Enter the IP address or domain name of the server managed by AppOS.')
      ).toBeNull()
    })
  })

  it('requires host for direct ssh but not for tunnel while port stays required', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    const nameInput = screen.getByLabelText(/^Name\*/) as HTMLInputElement
    const hostInput = screen.getByLabelText(/^Host\*/) as HTMLInputElement
    const portInput = screen.getByLabelText(/^Port\*/) as HTMLInputElement
    const userInput = screen.getByLabelText(/^User\*/) as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'edge-node' } })
    fireEvent.change(userInput, { target: { value: 'root' } })
    fireEvent.change(hostInput, { target: { value: '' } })
    fireEvent.change(portInput, { target: { value: '22' } })
    expect(hostInput).toBeRequired()
    expect(portInput).toBeRequired()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(createServerMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: /Reverse Tunnel/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'edge-node',
          user: 'root',
          connect_type: 'tunnel',
        })
      )
    })

    createServerMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }))
    await screen.findByRole('heading', { name: 'Add Server' })
    fireEvent.change(screen.getByLabelText(/^Name\*/), { target: { value: 'edge-node-2' } })
    fireEvent.change(screen.getByLabelText(/^User\*/), { target: { value: 'root' } })
    fireEvent.change(screen.getByLabelText(/^Port\*/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('radio', { name: /Reverse Tunnel/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createServerMock).toHaveBeenCalledTimes(1)
    })
  })

  it('fills the host with the current docker0 address when Local host is checked', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Local host' }))

    await waitFor(() => {
      expect((screen.getByLabelText(/^Host\*/) as HTMLInputElement).value).toBe('172.17.0.1')
    })
  })
})