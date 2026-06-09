import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DeployPage } from './DeployPage'

const sendMock = vi.fn()
const navigateMock = vi.fn()

function paginatedActionsResponse(items: Array<Record<string, unknown>>) {
  return {
    items,
    page: 1,
    perPage: 15,
    totalItems: items.length,
    totalPages: 1,
  }
}

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

    const storeAppItems = Array.from({ length: 17 }, (_, index) => ({
      key: index === 0 ? 'wordpress' : `app-${index + 1}`,
      title: index === 0 ? 'WordPress' : `App ${String(index + 1).padStart(2, '0')}`,
      overview: `Overview ${index + 1}`,
      iconUrl: `https://example.com/app-${index + 1}.png`,
      source: 'official',
      visibility: 'public',
      primaryCategory: { key: 'cms', title: 'CMS' },
      secondaryCategories: [{ key: 'featured', title: 'Featured' }],
      badges: [],
      template: {
        key: index === 0 ? 'wordpress' : `app-${index + 1}`,
        source: 'official',
        available: true,
      },
      personalization: { isFavorite: index === 0, hasNote: false },
      updatedAt: `2026-03-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
    }))

    const actionItems = [
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
        status: 'running',
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
      {
        id: 'dep_3',
        server_id: 'local',
        server_label: 'Local Server',
        server_host: '127.0.0.1',
        source: 'manualops',
        status: 'failed',
        adapter: 'manual',
        compose_project_name: 'redis-prod',
        project_dir: '/srv/redis',
        rendered_compose: '',
        error_summary: '',
        created: '2026-03-21T06:00:00Z',
        updated: '2026-03-21T06:12:00Z',
        started_at: '2026-03-21T06:03:00Z',
        finished_at: '2026-03-21T06:12:00Z',
        user_email: 'ops@example.com',
        pipeline: {
          started_at: '2026-03-21T06:03:00Z',
          finished_at: '2026-03-21T06:12:00Z',
        },
      },
      {
        id: 'dep_4',
        server_id: 'local',
        server_label: 'Local Server',
        server_host: '127.0.0.1',
        source: 'manualops',
        status: 'queued',
        adapter: 'manual',
        compose_project_name: 'ghost-prod',
        project_dir: '/srv/ghost',
        rendered_compose: '',
        error_summary: '',
        created: '2026-03-21T05:00:00Z',
        updated: '2026-03-21T05:00:00Z',
        user_email: 'ops@example.com',
        pipeline: {
          started_at: '2026-03-21T05:00:00Z',
          finished_at: '',
        },
      },
    ]

    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/servers/docker-targets') {
        return Promise.resolve([
          { id: 'local', label: 'local', host: '127.0.0.1', status: 'online' },
        ])
      }
      if (path.startsWith('/api/catalog/apps?')) {
        return Promise.resolve({
          items: storeAppItems,
          page: {
            limit: 1000,
            offset: 0,
            total: storeAppItems.length,
            hasMore: false,
          },
          meta: {
            locale: 'en',
            sourceVersion: 'test',
          },
        })
      }
      if (path.startsWith('/api/catalog/categories?')) {
        return Promise.resolve({
          items: [
            {
              key: 'cms',
              title: 'CMS',
              appCount: storeAppItems.length,
              children: [
                {
                  key: 'featured',
                  title: 'Featured',
                  appCount: storeAppItems.length,
                  parentKey: 'cms',
                },
              ],
            },
          ],
          meta: {
            locale: 'en',
            sourceVersion: 'test',
          },
        })
      }
      if (path.startsWith('/api/actions?')) {
        return Promise.resolve(paginatedActionsResponse(actionItems))
      }
      if (path === '/api/actions') {
        return Promise.resolve(actionItems)
      }
      if (
        (path === '/api/actions/dep_1' ||
          path === '/api/actions/dep_2' ||
          path === '/api/actions/dep_3' ||
          path === '/api/actions/dep_4') &&
        options?.method === 'DELETE'
      ) {
        return Promise.resolve({})
      }
      if (path === '/api/actions/dep_4/cancel' && options?.method === 'POST') {
        return Promise.resolve({})
      }
      if (path === '/api/actions/dep_2/force-fail' && options?.method === 'POST') {
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
      expect(screen.getByText('Latest Activity Summary')).toBeInTheDocument()
      expect(screen.getByText('Need more templates?')).toBeInTheDocument()
    })

    expect(screen.getByText('Compose File')).toBeInTheDocument()
    expect(screen.getByText('Git Repository')).toBeInTheDocument()
    expect(screen.getByText('Docker Command')).toBeInTheDocument()
    expect(screen.getByText('Source Packages')).toBeInTheDocument()
    expect(screen.queryByText('App Template')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show another set' })).toBeInTheDocument()
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
      to: '/activity/$actionId',
      params: { actionId: 'dep_1' },
      search: { returnTo: 'list' },
    })
  })

  it('cycles through another batch of store shortcuts from the install card', async () => {
    render(
      <TooltipProvider>
        <DeployPage />
      </TooltipProvider>
    )

    const storeCard = screen
      .getByText('Install from Store')
      .closest('[data-slot="card"]') as HTMLElement

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show another set' })).toBeInTheDocument()
      expect(within(storeCard).getByTitle('WordPress')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show another set' }))

    await waitFor(() => {
      expect(within(storeCard).queryByTitle('WordPress')).not.toBeInTheDocument()
      expect(within(storeCard).getAllByTitle(/^(WordPress|App \d{2})$/)).toHaveLength(2)
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
      to: '/activity/$actionId',
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
      to: '/activity/$actionId',
      params: { actionId: 'dep_1' },
      search: { returnTo: 'list' },
    })
  })

  it('offers cancel for queued actions and posts the cancel endpoint', async () => {
    render(
      <TooltipProvider>
        <DeployPage view="list" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('More actions for ghost-prod')).toBeInTheDocument()
    })

    const actionTrigger = screen.getByLabelText('More actions for ghost-prod')
    fireEvent.pointerDown(actionTrigger)
    fireEvent.mouseDown(actionTrigger)

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.getByText('Cancel Action')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/dep_4/cancel', { method: 'POST' })
    })
  })

  it('offers force fail for running actions and posts the force-fail endpoint', async () => {
    render(
      <TooltipProvider>
        <DeployPage view="list" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('More actions for mysql-prod')).toBeInTheDocument()
    })

    const actionTrigger = screen.getByLabelText('More actions for mysql-prod')
    fireEvent.pointerDown(actionTrigger)
    fireEvent.mouseDown(actionTrigger)

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Force Fail' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Force Fail' }))

    await waitFor(() => {
      expect(screen.getByText('Force Fail Action')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Force Fail' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/dep_2/force-fail', { method: 'POST' })
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
      expect(screen.getByLabelText('Select redis-prod')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('Select wordpress-prod'))
    fireEvent.click(screen.getByLabelText('Select redis-prod'))

    expect(screen.getByText('Delete Selected (2)')).toBeInTheDocument()
    expect(screen.getByText('App Name')).toBeInTheDocument()
    expect(screen.getByText('Total duration')).toBeInTheDocument()
    expect(screen.getAllByText('9m 0s').length).toBeGreaterThan(0)
    expect(screen.getByText('13m 0s')).toBeInTheDocument()
    expect(screen.getByText('Started')).toBeInTheDocument()
    expect(screen.getByText('Finished')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Delete Selected (2)'))

    await waitFor(() => {
      expect(screen.getByText('Delete Activity Records')).toBeInTheDocument()
      expect(screen.getByText('Delete 2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Delete 2'))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/dep_1', { method: 'DELETE' })
      expect(sendMock).toHaveBeenCalledWith('/api/actions/dep_3', { method: 'DELETE' })
    })
  })

  it('keeps summary, compact pagination, and page-size settings in the list header', async () => {
    render(
      <TooltipProvider>
        <DeployPage view="list" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByText(/Total:/)).toBeInTheDocument()
    })

    expect(screen.getByText(/Active \(/)).toBeInTheDocument()
    expect(screen.getByText(/Completed \(/)).toBeInTheDocument()
    expect(screen.getByText(/Failed \(/)).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('defaults the list to created-desc sorting, keeps Created hidden, and shows Executing for running actions', async () => {
    render(
      <TooltipProvider>
        <DeployPage view="list" />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/actions?'),
        expect.objectContaining({ method: 'GET' })
      )
    })

    const actionQuery = sendMock.mock.calls.find(
      ([path]) => typeof path === 'string' && path.startsWith('/api/actions?')
    )?.[0]

    expect(String(actionQuery)).toContain('sortField=created')
    expect(String(actionQuery)).toContain('sortDir=desc')
    expect(screen.queryByRole('columnheader', { name: 'Created' })).not.toBeInTheDocument()
    expect(screen.getByText('Executing')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select mysql-prod'))
    expect(screen.getByText('Executing actions cannot be deleted.')).toBeInTheDocument()

    const settingsTrigger = screen.getByRole('button', { name: 'List settings' })
    fireEvent.pointerDown(settingsTrigger)
    fireEvent.mouseDown(settingsTrigger)

    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: 'Created' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Created' }))

    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeInTheDocument()
  })
})
