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

    fireEvent.change(screen.getByLabelText('App Name'), { target: { value: 'wordpress-prod' } })
    fireEvent.change(screen.getByLabelText('Target Location'), { target: { value: 'local' } })

    const composeTextarea = screen.getByPlaceholderText(/services:/i)
    fireEvent.change(composeTextarea, { target: { value: 'services:\n  web:\n    image: nginx:alpine\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
        method: 'POST',
        body: {
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
        },
      })
    })

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/actions/$actionId',
      params: { actionId: 'act_manual_1' },
      search: { returnTo: 'list' },
    })
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