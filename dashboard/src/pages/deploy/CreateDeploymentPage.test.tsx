import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CreateDeploymentPage } from './CreateDeploymentPage'

const sendMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/i18n', () => ({
  getLocale: () => 'en',
}))

vi.mock('@/lib/store-api', () => ({
  fetchStoreJson: vi.fn().mockResolvedValue([]),
  getIconUrl: (key: string) => `/${key}.png`,
}))

vi.mock('@/lib/store-user-api', () => ({
  useUserApps: () => ({ data: [] }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    authStore: { token: '' },
  },
}))

vi.mock('@/lib/iac-api', () => ({
  iacLoadLibraryAppFiles: vi.fn(),
  iacRead: vi.fn(),
  iacUploadFile: vi.fn().mockResolvedValue(undefined),
  iacMkdir: vi.fn().mockResolvedValue(undefined),
}))

describe('CreateDeploymentPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    sendMock.mockReset()
    navigateMock.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/ext/docker/servers') {
        return Promise.resolve([{ id: 'local', label: 'local', host: '127.0.0.1', status: 'online' }])
      }
      if (path === '/api/actions') {
        return Promise.resolve([])
      }
      if (path === '/api/actions/install/manual-compose' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'act_manual_1',
          compose_project_name: options.body?.project_name || 'demo-nginx',
        })
      }
      if (path === '/api/actions/install/manual-compose/check' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          message: 'Preflight passed',
          compose_project_name: options.body?.project_name || 'demo-nginx',
          checks: {
            app_name: { ok: true, message: 'application name is available' },
            ports: { ok: true, status: 'not_applicable', message: 'compose does not declare fixed published host ports', items: [] },
          },
          warnings: [],
        })
      }
      if (path === '/api/actions/install/name-availability' && options?.method === 'POST') {
        const rawName = String(options.body?.project_name || '')
        const normalized = rawName.trim().toLowerCase().replace(/\s+/g, '-')
        return Promise.resolve({
          ok: true,
          project_name: normalized,
          normalized_name: normalized,
          message: 'application name is available',
        })
      }
      if (path === '/api/actions/install/git-compose/check' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          message: 'Preflight passed',
          compose_project_name: options.body?.project_name || 'repo-app',
          checks: {
            app_name: { ok: true, message: 'application name is available' },
            ports: { ok: true, status: 'not_applicable', message: 'compose does not declare fixed published host ports', items: [] },
          },
          warnings: [],
        })
      }
      if (path === '/api/actions/install/git-compose' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'act_git_1',
          compose_project_name: options.body?.project_name || 'repo-app',
        })
      }
      return Promise.resolve({})
    })
  })

  it('renders the full create page and submits a manual compose action', async () => {
    render(
      <TooltipProvider>
        <CreateDeploymentPage entryMode="compose" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Deployment' })).toBeInTheDocument()
      expect(screen.getByLabelText('App Name')).toBeInTheDocument()
    })

    expect(screen.queryByText('Leave blank to auto-generate the normalized app name.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cancel' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'wordpress-prod' } })
    fireEvent.change(screen.getByLabelText('Target Location'), { target: { value: 'local' } })

    const composeTextarea = screen.getByPlaceholderText(/services:/i)
    fireEvent.change(composeTextarea, { target: { value: 'services:\n  web:\n    image: nginx:alpine\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          app_required_disk_gib: '',
        },
      })
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          app_required_disk_gib: '',
        },
      })
    })

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/actions/$actionId',
      params: { actionId: 'act_manual_1' },
      search: { returnTo: 'list' },
    })
  })

  it('blocks create when auto preflight check fails', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/ext/docker/servers') {
        return Promise.resolve([{ id: 'local', label: 'local', host: '127.0.0.1', status: 'online' }])
      }
      if (path === '/api/actions') {
        return Promise.resolve([])
      }
      if (path === '/api/actions/install/manual-compose/check' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          message: 'Preflight found blocking issues',
          compose_project_name: options.body?.project_name || 'demo-nginx',
          checks: {
            app_name: { ok: false, message: 'application name "wordpress-prod" already exists' },
          },
          warnings: [],
        })
      }
      if (path === '/api/actions/install/name-availability' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          project_name: 'wordpress-prod',
          normalized_name: 'wordpress-prod',
          message: 'application name "wordpress-prod" already exists',
        })
      }
      if (path === '/api/actions/install/manual-compose' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'act_manual_1',
          compose_project_name: options.body?.project_name || 'demo-nginx',
        })
      }
      return Promise.resolve({})
    })

    render(
      <TooltipProvider>
        <CreateDeploymentPage entryMode="compose" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('App Name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'wordpress-prod' } })
    fireEvent.change(screen.getByLabelText('Target Location'), { target: { value: 'local' } })
    fireEvent.change(screen.getByPlaceholderText(/services:/i), { target: { value: 'services:\n  web:\n    image: nginx:alpine\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          app_required_disk_gib: '',
        },
      })
    })

    expect(sendMock).not.toHaveBeenCalledWith('/api/actions/install/manual-compose', expect.anything())
  })

  it('runs a manual compose preflight check without creating an action', async () => {
    render(
      <TooltipProvider>
        <CreateDeploymentPage entryMode="compose" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('App Name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'wordpress-prod' } })
    fireEvent.change(screen.getByLabelText('Target Location'), { target: { value: 'local' } })
    fireEvent.change(screen.getByPlaceholderText(/services:/i), { target: { value: 'services:\n  web:\n    image: nginx:alpine\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          app_required_disk_gib: '',
        },
      })
    })

    expect(screen.getAllByText('Preflight passed').length).toBeGreaterThan(0)
    expect(screen.queryByText('application name is available')).not.toBeInTheDocument()
    expect(sendMock).not.toHaveBeenCalledWith('/api/actions/install/manual-compose', expect.anything())
  })

  it('allows create when auto preflight returns warnings only', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/ext/docker/servers') {
        return Promise.resolve([{ id: 'local', label: 'local', host: '127.0.0.1', status: 'online' }])
      }
      if (path === '/api/actions') {
        return Promise.resolve([])
      }
      if (path === '/api/actions/install/manual-compose/check' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          message: 'Preflight completed with warnings',
          compose_project_name: options.body?.project_name || 'demo-nginx',
          checks: {
            app_name: { ok: true, message: 'application name is available' },
            ports: { ok: true, status: 'unavailable', message: 'Port occupancy checks are unavailable for the current target.', items: [] },
          },
          warnings: ['Port occupancy checks are unavailable for the current target.'],
        })
      }
      if (path === '/api/actions/install/name-availability' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          project_name: 'wordpress-prod',
          normalized_name: 'wordpress-prod',
          message: 'application name is available',
        })
      }
      if (path === '/api/actions/install/manual-compose' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'act_manual_1',
          compose_project_name: options.body?.project_name || 'demo-nginx',
        })
      }
      return Promise.resolve({})
    })

    render(
      <TooltipProvider>
        <CreateDeploymentPage entryMode="compose" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('App Name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'wordpress-prod' } })
    fireEvent.change(screen.getByLabelText('Target Location'), { target: { value: 'local' } })
    fireEvent.change(screen.getByPlaceholderText(/services:/i), { target: { value: 'services:\n  web:\n    image: nginx:alpine\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          app_required_disk_gib: '',
        },
      })
    })

    expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
      method: 'POST',
      body: {
        server_id: 'local',
        project_name: 'wordpress-prod',
        compose: 'services:\n  web:\n    image: nginx:alpine\n',
        env: {},
        app_required_disk_gib: '',
      },
    })
    expect(screen.queryByText('Create blocked by preflight: Preflight completed with warnings')).not.toBeInTheDocument()
  })

  it('blocks create when estimated app disk exceeds available disk', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/ext/docker/servers') {
        return Promise.resolve([{ id: 'local', label: 'local', host: '127.0.0.1', status: 'online' }])
      }
      if (path === '/api/actions') {
        return Promise.resolve([])
      }
      if (path === '/api/actions/install/manual-compose/check' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          message: 'Preflight found blocking issues',
          compose_project_name: options.body?.project_name || 'demo-nginx',
          checks: {
            app_name: { ok: true, message: 'application name is available' },
            disk_space: {
              ok: false,
              conflict: true,
              status: 'conflict',
              message: 'Application estimated disk requirement (2147483648 bytes) exceeds available disk space (1073741824 bytes)',
            },
          },
          warnings: [],
        })
      }
      if (path === '/api/actions/install/name-availability' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          project_name: 'wordpress-prod',
          normalized_name: 'wordpress-prod',
          message: 'application name is available',
        })
      }
      if (path === '/api/actions/install/manual-compose' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'act_manual_1',
          compose_project_name: options.body?.project_name || 'demo-nginx',
        })
      }
      return Promise.resolve({})
    })

    render(
      <TooltipProvider>
        <CreateDeploymentPage entryMode="compose" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('App Name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'wordpress-prod' } })
    fireEvent.change(screen.getByLabelText('Target Location'), { target: { value: 'local' } })
    fireEvent.change(screen.getByLabelText('Estimated App Disk (GiB)'), { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText(/services:/i), { target: { value: 'services:\n  web:\n    image: nginx:alpine\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          app_required_disk_gib: '2',
        },
      })
    })

    expect(sendMock).not.toHaveBeenCalledWith('/api/actions/install/manual-compose', expect.anything())
    expect(screen.getByText('Create blocked by preflight: Preflight found blocking issues')).toBeInTheDocument()
    expect(screen.getByText('Application estimated disk requirement (2147483648 bytes) exceeds available disk space (1073741824 bytes)')).toBeInTheDocument()
  })

  it('runs realtime name availability check when app name changes', async () => {
    render(
      <TooltipProvider>
        <CreateDeploymentPage entryMode="compose" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('App Name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'wordpress-prod' } })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/name-availability', {
        method: 'POST',
        body: { project_name: 'wordpress-prod' },
      })
    })

    expect(screen.queryByText('application name is available')).not.toBeInTheDocument()
  })

  it('supports the git repository create flow on the full page', async () => {
    render(
      <TooltipProvider>
        <CreateDeploymentPage entryMode="git-compose" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Repository')).toBeInTheDocument()
      expect(screen.getByLabelText('Repository URL')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'git-wordpress' } })
    fireEvent.change(screen.getByLabelText('Target Location'), { target: { value: 'local' } })
    fireEvent.change(screen.getByLabelText('Repository URL'), { target: { value: 'https://github.com/org/repo' } })
    fireEvent.change(screen.getByLabelText('Compose Path'), { target: { value: 'docker-compose.yml' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/git-compose', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'git-wordpress',
          repository_url: 'https://github.com/org/repo',
          ref: 'main',
          compose_path: 'docker-compose.yml',
          auth_header_name: '',
          auth_header_value: '',
          app_required_disk_gib: '',
        },
      })
    })

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/actions/$actionId',
      params: { actionId: 'act_git_1' },
      search: { returnTo: 'list' },
    })
  })
})