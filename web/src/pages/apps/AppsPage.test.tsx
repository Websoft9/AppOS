import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientResponseError } from 'pocketbase'
import {
  installAuthRuntimeGuards,
  resetRuntimeSessionExpiryState,
  resetSessionExpiryNavigationAdapterForTests,
  setSessionExpiryNavigationAdapterForTests,
} from '@/lib/auth-session'
import { pb } from '@/lib/pb'
import { AppsPage } from './AppsPage'

const sendMock = vi.fn()
const navigateMock = vi.fn()
const authStoreClearMock = vi.fn()
const sessionExpiryNavigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    authStore: {
      token: 'token',
      clear: (...args: unknown[]) => authStoreClearMock(...args),
    },
  },
}))

describe('AppsPage', () => {
  afterEach(() => {
    resetRuntimeSessionExpiryState()
    resetSessionExpiryNavigationAdapterForTests()
    cleanup()
  })

  beforeEach(() => {
    sendMock.mockReset()
    navigateMock.mockReset()
    authStoreClearMock.mockReset()
    sessionExpiryNavigateMock.mockReset()
    setSessionExpiryNavigationAdapterForTests(sessionExpiryNavigateMock)
    pb.send = (...args: Parameters<typeof pb.send>) => sendMock(...args)
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            template_icon_url: 'https://example.com/wordpress.png',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
            last_operation: 'op-last',
          },
        ])
      }
      if (path === '/api/apps/app-1/start' && options?.method === 'POST') {
        return Promise.resolve({ id: 'op-start-1' })
      }
      if (path === '/api/apps/app-1' && options?.method === 'DELETE') {
        return Promise.resolve({ id: 'op-uninstall-1' })
      }
      return Promise.resolve({})
    })
  })

  it('redirects to login when app polling hits expired auth at runtime', async () => {
    installAuthRuntimeGuards()
    sendMock.mockRejectedValueOnce(
      new ClientResponseError({
        status: 401,
        response: { message: 'The request requires valid record authorization token.' },
      })
    )

    render(<AppsPage />)

    await waitFor(() => {
      expect(sessionExpiryNavigateMock).toHaveBeenCalledWith(
        '/login?reason=session-expired&redirect=%2F'
      )
      expect(authStoreClearMock).toHaveBeenCalledTimes(1)
    })
  })

  it('navigates to action detail after start is requested from the action menu', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            template_icon_url: 'https://example.com/wordpress.png',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'stopped',
            runtime_status: 'stopped',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
            last_operation: 'op-last',
          },
        ])
      }
      if (path === '/api/apps/app-1/start' && options?.method === 'POST') {
        return Promise.resolve({ id: 'op-start-1' })
      }
      return Promise.resolve({})
    })

    render(<AppsPage />)

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open activity for Demo App' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Start' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1/start', { method: 'POST' })
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/activity/$actionId',
        params: { actionId: 'op-start-1' },
        search: { returnTo: 'list' },
      })
    })
  })

  it('navigates to action detail after uninstall is confirmed from the action menu', async () => {
    render(<AppsPage />)

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open activity for Demo App' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Uninstall' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Uninstall' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1', { method: 'DELETE' })
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/activity/$actionId',
        params: { actionId: 'op-uninstall-1' },
        search: { returnTo: 'list' },
      })
    })
  })

  it('shows managed server connectivity reasons and disables live actions for unreachable servers', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            server_id: 'srv-1',
            server_name: 'Remote Alpha',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            server_connection_status: 'unreachable',
            server_connection_reason: 'Server is unreachable from the control plane.',
            runtime_reason: 'Server is unreachable from the control plane.',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
          },
        ])
      }
      return Promise.resolve({})
    })

    render(<AppsPage />)

    await waitFor(() => {
      expect(screen.getByText('Server is unreachable from the control plane.')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /Unavailable/i })).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open activity for Demo App' }))

    expect(await screen.findByRole('menuitem', { name: 'Redeploy' })).toHaveAttribute(
      'data-disabled'
    )
    expect(screen.getByRole('menuitem', { name: 'Upgrade' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Start' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Stop' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Restart' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Uninstall' })).toHaveAttribute('data-disabled')
  })

  it('disables PocketBase auto-cancellation for app list polling', async () => {
    render(<AppsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps', {
        method: 'GET',
        requestKey: null,
      })
    })
  })

  it('renders the updated header controls and enforces the search length limit', async () => {
    render(<AppsPage />)

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument()
    })

    expect(
      screen.getByText('Unified entry to manage your installed & shared apps.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Execution Handoff')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh apps' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to list view' })).toBeInTheDocument()

    const searchInput = screen.getByRole('textbox', { name: 'Search apps' })
    fireEvent.change(searchInput, { target: { value: 'abcdefghijklmnop' } })

    expect(searchInput).toHaveValue('abcdefghijklmno')
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('Degraded')).toBeInTheDocument()
    expect(screen.getByText('Attention Required')).toBeInTheDocument()
    expect(screen.getByText('Updating')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('opens app detail when a grid card is clicked and keeps the visible card content compact', async () => {
    render(<AppsPage />)

    const appName = await screen.findByText('Demo App')
    const cardLink = appName.closest('[role="link"]')

    expect(screen.queryByText('Open Detail')).not.toBeInTheDocument()
    expect(screen.queryByText('installed')).not.toBeInTheDocument()
    expect(screen.queryByText('/tmp/demo-app')).not.toBeInTheDocument()
    expect(screen.queryByText('Last Operation: op-last')).not.toBeInTheDocument()
    expect(screen.queryByText('app-1')).not.toBeInTheDocument()
    expect(screen.getByText('Manual deployment')).toBeInTheDocument()
    expect(screen.getByText('op-last')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Demo App template icon' })).toHaveAttribute(
      'referrerpolicy',
      'no-referrer'
    )

    fireEvent.click(cardLink as HTMLElement)

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/apps/$appId',
      params: { appId: 'app-1' },
      search: { catalogAppKey: undefined },
    })
  })

  it('shows the simplified list view columns', async () => {
    render(<AppsPage />)

    await screen.findByText('Demo App')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to list view' }))

    const headerRow = screen.getAllByRole('row')[0]
    expect(within(headerRow).getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(within(headerRow).queryByRole('button', { name: 'Created' })).not.toBeInTheDocument()
    expect(screen.queryByText('installed')).not.toBeInTheDocument()
  })

  it('filters apps by template and server from the summary controls', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            server_id: 'local',
            server_name: 'Local',
            catalog_app_key: 'wordpress',
            template_icon_url: 'https://example.com/wordpress.png',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
            last_operation: 'op-last',
          },
          {
            id: 'app-2',
            name: 'Ghost App',
            server_id: 'server-2',
            server_name: 'Production Alpha',
            catalog_app_key: 'ghost',
            template_icon_url: 'https://example.com/ghost.png',
            project_dir: '/tmp/ghost-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'stopped',
            runtime_status: 'stopped',
            created: '2026-03-31T10:00:00Z',
            updated: '2026-03-31T10:10:00Z',
            last_operation: 'op-ghost',
          },
          {
            id: 'app-3',
            name: 'Local Compose App',
            server_id: 'local',
            server_name: 'Local',
            catalog_app_key: 'nil',
            project_dir: '/tmp/local-compose-app',
            source: 'docker',
            status: 'installed',
            instance_state: 'updating',
            runtime_status: 'running',
            created: '2026-03-29T10:00:00Z',
            updated: '2026-03-29T10:10:00Z',
            last_operation: 'op-local',
          },
        ])
      }
      return Promise.resolve({})
    })

    render(<AppsPage />)

    await screen.findByText('Demo App')
    await screen.findByText('Ghost App')
    await screen.findByText('Local Compose App')
    expect(screen.getAllByText('Production Alpha').length).toBeGreaterThan(0)

    const templateFilter = screen.getByRole('combobox', { name: 'Filter by app template' })
    expect(templateFilter).toHaveDisplayValue('By template')
    expect(screen.queryByRole('option', { name: '<nil>' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'No-template (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Template-based (2)' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ghost (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'wordpress (1)' })).toBeInTheDocument()

    fireEvent.change(templateFilter, {
      target: { value: '__untemplated__' },
    })

    expect(screen.queryByText('Demo App')).not.toBeInTheDocument()
    expect(screen.queryByText('Ghost App')).not.toBeInTheDocument()
    expect(screen.getByText('Local Compose App')).toBeInTheDocument()

    fireEvent.change(templateFilter, {
      target: { value: 'ghost' },
    })

    expect(screen.queryByText('Demo App')).not.toBeInTheDocument()
    expect(screen.getByText('Ghost App')).toBeInTheDocument()

    fireEvent.change(templateFilter, {
      target: { value: '__all__' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by server' }), {
      target: { value: 'local' },
    })

    expect(screen.getByText('Demo App')).toBeInTheDocument()
    expect(screen.queryByText('Ghost App')).not.toBeInTheDocument()
  })

  it('filters the summary cards by canonical instance_state', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
          },
          {
            id: 'app-2',
            name: 'Ghost App',
            server_id: 'server-2',
            server_name: 'Production Alpha',
            project_dir: '/tmp/ghost-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'stopped',
            runtime_status: 'stopped',
            created: '2026-03-31T10:00:00Z',
            updated: '2026-03-31T10:10:00Z',
          },
          {
            id: 'app-3',
            name: 'Local Compose App',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/local-compose-app',
            source: 'docker',
            status: 'installed',
            instance_state: 'updating',
            runtime_status: 'running',
            created: '2026-03-29T10:00:00Z',
            updated: '2026-03-29T10:10:00Z',
          },
        ])
      }
      return Promise.resolve({})
    })

    render(<AppsPage />)

    await screen.findByText('Demo App')
    await screen.findByText('Ghost App')
    await screen.findByText('Local Compose App')

    fireEvent.click(screen.getByRole('button', { name: /Updating/i }))

    expect(screen.queryByText('Demo App')).not.toBeInTheDocument()
    expect(screen.queryByText('Ghost App')).not.toBeInTheDocument()
    expect(screen.getByText('Local Compose App')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Updating/i }))

    expect(screen.getByText('Demo App')).toBeInTheDocument()
    expect(screen.getByText('Ghost App')).toBeInTheDocument()
    expect(screen.getByText('Local Compose App')).toBeInTheDocument()
  })

  it('filters attention-required apps via the dedicated summary state', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
          },
          {
            id: 'app-2',
            name: 'Needs Manual Fix',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/manual-fix-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'attention_required',
            runtime_status: 'running',
            created: '2026-03-31T10:00:00Z',
            updated: '2026-03-31T10:10:00Z',
          },
        ])
      }
      return Promise.resolve({})
    })

    render(<AppsPage />)

    await screen.findByText('Demo App')
    await screen.findByText('Needs Manual Fix')

    fireEvent.click(screen.getByRole('button', { name: /Attention Required/i }))

    expect(screen.queryByText('Demo App')).not.toBeInTheDocument()
    expect(screen.getByText('Needs Manual Fix')).toBeInTheDocument()
  })

  it('filters unknown apps via the dedicated summary state', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
          },
          {
            id: 'app-2',
            name: 'Unknown App',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/unknown-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'unknown',
            runtime_status: 'unknown',
            created: '2026-03-31T10:00:00Z',
            updated: '2026-03-31T10:10:00Z',
          },
        ])
      }
      return Promise.resolve({})
    })

    render(<AppsPage />)

    await screen.findByText('Demo App')
    await screen.findByText('Unknown App')

    fireEvent.click(screen.getAllByRole('button', { name: /Unknown/i })[0])

    expect(screen.queryByText('Demo App')).not.toBeInTheDocument()
    expect(screen.getByText('Unknown App')).toBeInTheDocument()
  })

  it('filters unreachable managed apps via the Unavailable summary state', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            server_id: 'local',
            server_name: 'Local',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
          },
          {
            id: 'app-2',
            name: 'Ghost App',
            server_id: 'server-2',
            server_name: 'Production Alpha',
            project_dir: '/tmp/ghost-app',
            source: 'manualops',
            status: 'installed',
            instance_state: 'running',
            runtime_status: 'running',
            server_connection_status: 'unreachable',
            server_connection_reason: 'Server is unreachable from the control plane.',
            runtime_reason: 'Server is unreachable from the control plane.',
            created: '2026-03-31T10:00:00Z',
            updated: '2026-03-31T10:10:00Z',
          },
        ])
      }
      return Promise.resolve({})
    })

    render(<AppsPage />)

    await screen.findByText('Demo App')
    await screen.findByText('Ghost App')

    fireEvent.click(screen.getByRole('button', { name: /Unavailable/i }))

    expect(screen.queryByText('Demo App')).not.toBeInTheDocument()
    expect(screen.getByText('Ghost App')).toBeInTheDocument()
  })
})
