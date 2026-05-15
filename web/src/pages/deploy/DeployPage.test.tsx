import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DeployPage } from './DeployPage'

const sendMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/lib/i18n', () => ({
  getLocale: () => 'en',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/lib/store-api', () => ({
  fetchStoreJson: vi.fn().mockResolvedValue([
    { key: 'wordpress', trademark: 'WordPress', logo: { imageurl: '/wordpress.png' } },
    { key: 'mysql', trademark: 'MySQL', logo: { imageurl: '/mysql.png' } },
  ]),
  getIconUrl: (key: string) => `/${key}.png`,
}))

vi.mock('@/lib/store-user-api', () => ({
  useUserApps: () => ({
    data: [
      {
        id: 'fav1',
        user: 'u1',
        app_key: 'wordpress',
        is_favorite: true,
        note: null,
        created: '2026-03-21T08:00:00Z',
        updated: '2026-03-21T08:00:00Z',
      },
    ],
  }),
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
}))

describe('DeployPage homepage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    sendMock.mockReset()
    navigateMock.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/servers/docker-targets') {
        return Promise.resolve([
          { id: 'local', label: 'local', host: '127.0.0.1', status: 'online' },
        ])
      }
      if (path === '/api/actions') {
        return Promise.resolve([
          {
            id: 'dep_1',
            server_id: 'local',
            server_label: 'Local Server',
            server_host: '127.0.0.1',
            source: 'manualops',
            status: 'success',
            adapter: 'manual',
            compose_project_name: 'wordpress-prod',
            project_dir: '/srv/wordpress',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-21T08:00:00Z',
            updated: '2026-03-21T08:10:00Z',
            started_at: '2026-03-21T08:01:00Z',
            finished_at: '2026-03-21T08:10:00Z',
            user_email: 'admin@example.com',
            pipeline: {
              started_at: '2026-03-21T08:01:00Z',
              finished_at: '2026-03-21T08:10:00Z',
            },
          },
          {
            id: 'dep_2',
            server_id: 'local',
            server_label: 'Local Server',
            server_host: '127.0.0.1',
            source: 'gitops',
            status: 'failed',
            adapter: 'git',
            compose_project_name: 'mysql-prod',
            project_dir: '/srv/mysql',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-21T07:00:00Z',
            updated: '2026-03-21T07:15:00Z',
            started_at: '2026-03-21T07:02:00Z',
            finished_at: '2026-03-21T07:15:00Z',
            user_email: 'ops@example.com',
            pipeline: {
              started_at: '2026-03-21T07:02:00Z',
              finished_at: '2026-03-21T07:15:00Z',
            },
          },
        ])
      }
      if (
        (path === '/api/actions/dep_1' || path === '/api/actions/dep_2') &&
        options?.method === 'DELETE'
      ) {
        return Promise.resolve({})
      }
      return Promise.resolve({})
    })
  })

  it('renders the deploy homepage and routes custom deployment entries to the create page', async () => {
    render(
      <TooltipProvider>
        <DeployPage />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Deploy Application')).toBeInTheDocument()
      expect(screen.getByText('Install from Store')).toBeInTheDocument()
      expect(screen.getByText('Custom Deployment')).toBeInTheDocument()
      expect(screen.getByText('Latest Actions')).toBeInTheDocument()
      expect(screen.getByText('Need more templates?')).toBeInTheDocument()
    })

    expect(screen.getByText('Compose File')).toBeInTheDocument()
    expect(screen.getByText('Git Repository')).toBeInTheDocument()
    expect(screen.getByText('Docker Command')).toBeInTheDocument()
    expect(screen.getByText('Source Packages')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('Local Server').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('Git Repository').closest('button') as HTMLButtonElement)

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/deploy/create',
      search: {
        entry: 'git-compose',
      },
    })
  })

  it('opens operation detail when clicking the latest operation name', async () => {
    render(
      <TooltipProvider>
        <DeployPage />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'wordpress-prod' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'wordpress-prod' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/actions/$actionId',
      params: { actionId: 'dep_1' },
      search: { returnTo: 'list' },
    })
  })

  it('opens operation detail when clicking the operation name in list view', async () => {
    render(
      <TooltipProvider>
        <DeployPage view="list" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'wordpress-prod' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'wordpress-prod' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/actions/$actionId',
      params: { actionId: 'dep_1' },
      search: { returnTo: 'list' },
    })
  })

  it('opens operation detail from the action menu view entry', async () => {
    render(
      <TooltipProvider>
        <DeployPage view="list" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('More actions for wordpress-prod')).toBeInTheDocument()
    })

    const actionTrigger = screen.getByLabelText('More actions for wordpress-prod')

    fireEvent.pointerDown(actionTrigger)
    fireEvent.mouseDown(actionTrigger)

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/actions/$actionId',
      params: { actionId: 'dep_1' },
      search: { returnTo: 'list' },
    })
  })

  it('supports bulk delete from the operations list', async () => {
    render(
      <TooltipProvider>
        <DeployPage view="list" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Select wordpress-prod')).toBeInTheDocument()
      expect(screen.getByLabelText('Select mysql-prod')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('Select wordpress-prod'))
    fireEvent.click(screen.getByLabelText('Select mysql-prod'))

    expect(screen.getByText('Delete Selected (2)')).toBeInTheDocument()
    expect(screen.getByText('App Name')).toBeInTheDocument()
    expect(screen.getByText('Total duration')).toBeInTheDocument()
    expect(screen.getByText('9m 0s')).toBeInTheDocument()
    expect(screen.getByText('13m 0s')).toBeInTheDocument()
    expect(screen.getByText('Started')).toBeInTheDocument()
    expect(screen.getByText('Finished')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Delete Selected (2)'))

    await waitFor(() => {
      expect(screen.getByText('Delete Actions')).toBeInTheDocument()
      expect(screen.getByText('Delete 2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Delete 2'))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/dep_1', { method: 'DELETE' })
      expect(sendMock).toHaveBeenCalledWith('/api/actions/dep_2', { method: 'DELETE' })
    })
  })
})
