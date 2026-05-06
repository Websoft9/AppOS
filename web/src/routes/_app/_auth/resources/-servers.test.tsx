import type { AnchorHTMLAttributes, ReactNode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersPage } from './servers'

const navigateMock = vi.fn()
const getFullListMock = vi.fn()
const sendMock = vi.fn()
const createServerMock = vi.fn()
const getSecretMock = vi.fn()
const updateSecretMock = vi.fn()
const getLocalDockerBridgeAddressMock = vi.fn()
const getSystemdStatusMock = vi.fn()
const installMonitorAgentMock = vi.fn()
const updateMonitorAgentMock = vi.fn()
let searchState: Record<string, unknown> = {}

function isSecretSummaryRequest(path: string) {
  return (
    path.startsWith('/api/collections/secrets/records?') && path.includes('fields=id%2Ctemplate_id')
  )
}

function isMonitorSummaryRequest(path: string) {
  return path.startsWith('/api/collections/monitor_latest_status/records?')
}

function isServerSoftwareRequest(path: string) {
  return path === '/api/servers/server-1/software'
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => searchState,
    useNavigate: () => navigateMock,
  }),
  Link: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => (
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
  getSystemdStatus: (...args: unknown[]) => getSystemdStatusMock(...args),
  installMonitorAgent: (...args: unknown[]) => installMonitorAgentMock(...args),
  serverPower: vi.fn(),
  updateMonitorAgent: (...args: unknown[]) => updateMonitorAgentMock(...args),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'owner@example.com' },
  }),
}))

vi.mock('@/components/connect/DockerPanel', () => ({
  DockerPanel: ({ serverId }: { serverId: string }) => <div>Docker panel for {serverId}</div>,
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
    getSystemdStatusMock.mockReset()
    installMonitorAgentMock.mockReset()
    updateMonitorAgentMock.mockReset()
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
              facts_json: {
                os: { family: 'linux', distribution: 'ubuntu', version: '24.04' },
                kernel: { release: '6.8.0' },
                architecture: 'amd64',
                cpu: { cores: 4 },
                memory: { total_bytes: 8589934592 },
              },
              facts_observed_at: '2026-04-16T01:02:03Z',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
          ],
        })
      }
      if (isSecretSummaryRequest(path)) {
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
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
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
      if (isSecretSummaryRequest(path)) {
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
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
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
    getSystemdStatusMock.mockResolvedValue({
      server_id: 'server-1',
      service: 'netdata',
      status: {},
      status_text: '',
    })
    installMonitorAgentMock.mockResolvedValue({ status: 'installed' })
    updateMonitorAgentMock.mockResolvedValue({ status: 'updated' })
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
    expect(screen.getByRole('button', { name: 'Filter User' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter Secret Type' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filter Credential' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toHaveClass('text-left')
    expect(screen.getAllByRole('button', { name: 'More actions' })[0].closest('td')).toHaveClass(
      'text-left'
    )
    expect(screen.getByText('ubuntu 24.04 · amd64')).toBeInTheDocument()
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
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
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
    expect(screen.getByText('Total 11 items')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List settings' })).toBeInTheDocument()
  })

  it('moves page size and optional column visibility into list settings', async () => {
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
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
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
    expect(screen.getByText('server-10')).toBeInTheDocument()
    expect(screen.queryByText('server-11')).toBeNull()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'List settings' }))

    expect(await screen.findByRole('menuitemradio', { name: '10 / page' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Host' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Monitor' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'User' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Secret Type' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitemradio', { name: '50 / page' }))

    await waitFor(() => {
      expect(screen.getByText('server-11')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'List settings' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Host' }))

    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: 'Host' })).toBeNull()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'List settings' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Monitor' }))

    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: 'Monitor' })).toBeNull()
    })
  }, 25000)

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
              access: {
                status: 'unavailable',
                reason: 'waiting_for_first_connect',
                checked_at: '',
                source: 'tunnel_runtime',
              },
              tunnel: {
                state: 'setup_required',
                status: 'offline',
                waiting_for_first_connect: true,
                services: [],
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

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Awaiting Connection')).toBeInTheDocument()
    expect(screen.getByText('Not Configured')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'User' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Secret Type' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Monitor' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Host' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Setup' })).toBeInTheDocument()
  }, 20000)

  it('filters rows by user', async () => {
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
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
            {
              id: 'server-2',
              name: 'beta',
              connect_type: 'direct',
              host: '10.0.0.2',
              port: 22,
              user: 'ubuntu',
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
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

    expect(await screen.findByText('alpha')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter User' }))
    fireEvent.click((await screen.findAllByText('ubuntu')).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.queryByText('beta')).toBeNull()
    })
  })

  it('filters rows by secret type and shows a monitor shortcut when monitoring exists', async () => {
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
              credential: 'secret-1',
              credential_type: 'Password',
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
            {
              id: 'server-2',
              name: 'beta',
              connect_type: 'direct',
              host: '10.0.0.2',
              port: 22,
              user: 'ubuntu',
              credential: 'secret-2',
              credential_type: 'SSH Key',
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({
          items: [
            {
              target_id: 'server-1',
              status: 'online',
              reason: 'netdata ready',
              last_checked_at: '2026-04-16T01:02:00Z',
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
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open monitor for alpha' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter Secret Type' }))
    fireEvent.click((await screen.findAllByText('SSH Key')).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.queryByText('beta')).toBeNull()
    })
  })

  it('places favorite below shutdown in the actions menu', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'More actions' })[0])

    expect(await screen.findByText('View Details')).toBeInTheDocument()
    expect(screen.getByText('View Connection')).toBeInTheDocument()
    const menuText =
      (await screen.findByText('Restart')).parentElement?.parentElement?.textContent ?? ''
    expect(menuText.indexOf('Restart')).toBeLessThan(menuText.indexOf('Shutdown'))
    expect(menuText.indexOf('Shutdown')).toBeLessThan(menuText.indexOf('Add Favorite'))
  })

  it('folds tunnel details into the Connection tab and removes the tunnel tab', async () => {
    searchState = { server: 'server-1', tab: 'connection' }

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
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'tunnel_runtime',
              },
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
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
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

    expect(await screen.findByRole('tab', { name: 'Connection' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Tunnel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Server actions' })).toBeInTheDocument()
    expect(await screen.findByText('Connection Summary')).toBeInTheDocument()
    expect(screen.getByText('Primary Next Step')).toBeInTheDocument()
    expect(screen.getByText('Mode-Specific Setup or Recovery')).toBeInTheDocument()
    expect(screen.getByText('Tunnel Services')).toBeInTheDocument()
    expect(screen.getByText('Port 2201')).toBeInTheDocument()
    expect(screen.getByText('Diagnostics')).toBeInTheDocument()
    expect(screen.getByText('Activity Timeline')).toBeInTheDocument()
  })

  it('hides the tunnel tab for direct servers', async () => {
    render(<ServersPage />)

    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View Details' }))

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Server actions' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Tunnel' })).toBeNull()
    expect(screen.queryByText('Tunnel Services')).toBeNull()
  })

  it('shows collected host facts in the overview tab', async () => {
    render(<ServersPage />)

    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View Details' }))

    expect(await screen.findByText('Operating System')).toBeInTheDocument()
    expect(screen.getByText('ubuntu 24.04')).toBeInTheDocument()
    expect(screen.getByText('6.8.0')).toBeInTheDocument()
    expect(screen.getByText('amd64')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('8.0 GiB')).toBeInTheDocument()
    expect(screen.getByText(new Date('2026-04-16T01:02:03Z').toLocaleString())).toBeInTheDocument()
  })

  it('splits the overview tab into metadata and system information groups', async () => {
    searchState = { server: 'server-1', tab: 'overview' }

    render(<ServersPage />)

    expect(await screen.findByText('Server Metadata')).toBeInTheDocument()
    expect(screen.getByText('System Information')).toBeInTheDocument()
    expect(screen.getByText('Operating System')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand detail width' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand detail width' }))

    expect(await screen.findByRole('button', { name: 'Restore detail width' })).toBeInTheDocument()
  })

  it('splits the software tab into prerequisites and addons list', async () => {
    searchState = { server: 'server-1', tab: 'software' }

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
              created: '2026-04-16T00:00:00Z',
              updated: '2026-04-16T01:00:00Z',
              facts_json: {
                os: { family: 'linux', distribution: 'ubuntu', version: '24.04' },
                kernel: { release: '6.8.0' },
                architecture: 'amd64',
                cpu: { cores: 4 },
                memory: { total_bytes: 8589934592 },
              },
              facts_observed_at: '2026-04-16T01:02:03Z',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({
          items: [
            {
              component_key: 'docker',
              label: 'Docker Engine',
              target_type: 'server',
              template_kind: 'package',
              installed_state: 'installed',
              detected_version: '27.0.1',
              install_source: 'managed',
              source_evidence: 'apt:docker-ce',
              verification_state: 'healthy',
              preflight: {
                ok: true,
                os_supported: true,
                privilege_ok: true,
                network_ok: true,
                dependency_ready: true,
              },
              available_actions: ['verify', 'upgrade'],
            },
            {
              component_key: 'reverse-proxy',
              label: 'Reverse Proxy',
              target_type: 'server',
              template_kind: 'package',
              installed_state: 'installed',
              detected_version: '1.27.0',
              packaged_version: '1.27.1',
              verification_state: 'degraded',
              preflight: {
                ok: false,
                os_supported: true,
                privilege_ok: true,
                network_ok: true,
                dependency_ready: false,
                issues: ['dependency_not_ready: docker is not ready'],
              },
              last_action: { action: 'verify', result: 'failed', at: '2026-04-16T02:03:04Z' },
              available_actions: ['verify', 'reinstall', 'uninstall'],
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
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Software' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Prerequisites' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Addons list' })).toBeInTheDocument()
    expect(screen.getByText('Docker Engine')).toBeInTheDocument()
    expect(
      screen.getByText('Container runtime required for platform-managed workloads.')
    ).toBeInTheDocument()
    expect(screen.getByText('Install source: Managed (apt:docker-ce)')).toBeInTheDocument()
    expect(screen.getByText('Reverse Proxy')).toBeInTheDocument()
    expect(screen.getByText('reverse-proxy')).toBeInTheDocument()
    expect(screen.getByText('dependency_not_ready: docker is not ready')).toBeInTheDocument()

    const prerequisitesSection = screen.getByRole('region', { name: 'Prerequisites section' })
    expect(
      within(prerequisitesSection).getByText('No corrective action available')
    ).toBeInTheDocument()

    const addonsSection = screen.getByRole('region', { name: 'Addons list section' })
    expect(within(addonsSection).queryByText('Docker Engine')).toBeNull()
    expect(within(addonsSection).getByText('Reverse Proxy')).toBeInTheDocument()
  })

  it('shows the migrated Docker tab in server detail', async () => {
    searchState = { server: 'server-1', tab: 'docker' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Docker' })).toBeInTheDocument()
    expect(screen.getByText('Docker panel for server-1')).toBeInTheDocument()
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
  }, 15000)

  it('renders connection type as cards, pre-fills a generated name, and uses the simplified credential action', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    expect(await screen.findByRole('dialog')).toHaveClass('sm:max-w-4xl')
    expect(screen.getByRole('button', { name: 'Connection type help' })).toBeInTheDocument()
    expect(screen.queryByText('Choose how the managed server connects to AppOS.')).toBeNull()
    expect(screen.getByRole('radio', { name: /Direct SSH/i })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /Reverse Tunnel/i })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByDisplayValue(/^server-\d{6}$/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Credential (Secret)' }))
    expect(await screen.findByRole('button', { name: 'New credential' })).toBeInTheDocument()
  }, 20000)

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

  it('requires host for direct ssh but allows tunnel submission without host or port', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    const createDialog = await screen.findByRole('dialog')
    const nameInput = within(createDialog).getByLabelText(/^Name\*/) as HTMLInputElement
    const hostInput = within(createDialog).getByLabelText(/^Host\*/) as HTMLInputElement
    const portInput = within(createDialog).getByLabelText(/^Port\*/) as HTMLInputElement
    const userInput = within(createDialog).getByLabelText(/^User\*/) as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'edge-node' } })
    fireEvent.change(userInput, { target: { value: 'root' } })
    fireEvent.change(hostInput, { target: { value: '' } })
    fireEvent.change(portInput, { target: { value: '22' } })
    expect(hostInput).toBeRequired()
    expect(portInput).toBeRequired()
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create' }))

    expect(createServerMock).not.toHaveBeenCalled()

    fireEvent.click(within(createDialog).getByRole('radio', { name: /Reverse Tunnel/i }))

    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'edge-node',
          user: 'root',
          connect_type: 'tunnel',
        })
      )
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    createServerMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }))
    const secondCreateDialog = await screen.findByRole('dialog')
    fireEvent.change(within(secondCreateDialog).getByLabelText(/^Name\*/), {
      target: { value: 'edge-node-2' },
    })
    fireEvent.change(within(secondCreateDialog).getByLabelText(/^User\*/), {
      target: { value: 'root' },
    })
    fireEvent.change(within(secondCreateDialog).getByLabelText(/^Port\*/), {
      target: { value: '' },
    })
    fireEvent.click(within(secondCreateDialog).getByRole('radio', { name: /Reverse Tunnel/i }))
    fireEvent.click(within(secondCreateDialog).getByRole('button', { name: 'Create' }))

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
