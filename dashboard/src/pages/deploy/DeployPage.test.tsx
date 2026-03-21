import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DeployPage } from './DeployPage'

const sendMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
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
    data: [{ id: 'fav1', user: 'u1', app_key: 'wordpress', is_favorite: true, note: null, created: '2026-03-21T08:00:00Z', updated: '2026-03-21T08:00:00Z' }],
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
  beforeEach(() => {
    sendMock.mockReset()
    navigateMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ext/docker/servers') {
        return Promise.resolve([{ id: 'local', label: 'local', host: '127.0.0.1', status: 'online' }])
      }
      if (path === '/api/deployments') {
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
            user_email: 'admin@example.com',
          },
        ])
      }
      return Promise.resolve({})
    })
  })

  it('renders the new deployment homepage and opens the repository dialog', async () => {
    render(
      <TooltipProvider>
        <DeployPage />
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Deploy Application')).toBeInTheDocument()
      expect(screen.getByText('Install from Store')).toBeInTheDocument()
      expect(screen.getByText('Custom Deployment')).toBeInTheDocument()
      expect(screen.getByText('Latest Deployments')).toBeInTheDocument()
      expect(screen.getByText('Need more templates?')).toBeInTheDocument()
    })

    expect(screen.getByText('Compose File')).toBeInTheDocument()
    expect(screen.getByText('Git Repository')).toBeInTheDocument()
    expect(screen.getByText('Docker Command')).toBeInTheDocument()
    expect(screen.getByText('Source Packages')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText('Local Server')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Git Repository').closest('button') as HTMLButtonElement)

    expect(screen.getByText('Create Deployment from Git Repository')).toBeInTheDocument()
  })
})
