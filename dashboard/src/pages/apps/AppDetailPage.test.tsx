import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDetailPage } from './AppDetailPage'

const sendMock = vi.fn()
const navigateMock = vi.fn()
const iacReadMock = vi.fn()
const iacSaveFileMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/lib/iac-api', () => ({
  iacRead: (...args: unknown[]) => iacReadMock(...args),
  iacSaveFile: (...args: unknown[]) => iacSaveFileMock(...args),
}))

describe('AppDetailPage', () => {
  let windowOpenMock: ReturnType<typeof vi.spyOn>
  let appDetailResponse: Record<string, unknown>
  let clipboardWriteTextMock: ReturnType<typeof vi.fn>

  afterEach(() => {
    cleanup()
    windowOpenMock.mockRestore()
  })

  beforeEach(() => {
    sendMock.mockReset()
    navigateMock.mockReset()
    iacReadMock.mockReset()
    iacSaveFileMock.mockReset()
    appDetailResponse = {
      id: 'app-1',
      name: 'Demo App',
      server_id: 'local',
      iac_path: 'apps/installed/demo-app/docker-compose.yml',
      project_dir: '/tmp/demo-app',
      source: 'manualops',
      status: 'installed',
      runtime_status: 'running',
      lifecycle_state: 'running_healthy',
      publication_summary: 'unpublished',
      access_username: 'admin',
      access_secret_hint: 'initial password from welcome page',
      access_retrieval_method: 'Read the install completion output',
      access_notes: 'Rotate after first login',
      last_operation: 'op-last',
      current_pipeline: null,
      created: '2026-03-30T10:00:00Z',
      updated: '2026-03-30T10:10:00Z',
    }
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteTextMock },
    })
    windowOpenMock = vi.spyOn(window, 'open').mockImplementation(() => ({ closed: false } as Window))
    iacReadMock.mockResolvedValue({ content: 'APP_ENV=demo\n' })
    iacSaveFileMock.mockResolvedValue(undefined)
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
      if (path === '/api/apps/app-1' && options?.method === 'GET') {
        return Promise.resolve(appDetailResponse)
      }
      if (path === '/api/apps/app-1/releases' && options?.method === 'GET') {
        return Promise.resolve([])
      }
      if (path === '/api/apps/app-1/exposures' && options?.method === 'GET') {
        return Promise.resolve([])
      }
      if (path === '/api/apps/app-1/logs' && options?.method === 'GET') {
        return Promise.resolve({
          id: 'app-1',
          name: 'Demo App',
          server_id: 'local',
          project_dir: '/tmp/demo-app',
          runtime_status: 'running',
          output: 'app log line 1\napp log line 2',
        })
      }
      if (path === '/api/actions' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'op-last',
            app_id: 'app-1',
            server_id: 'local',
            source: 'manualops',
            status: 'success',
            adapter: 'docker',
            compose_project_name: 'demo-app',
            project_dir: '/tmp/demo-app',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-30T10:09:00Z',
            updated: '2026-03-30T10:10:00Z',
            started_at: '2026-03-30T10:09:00Z',
            finished_at: '2026-03-30T10:10:00Z',
            pipeline: {
              id: 'pipe-1',
              operation_id: 'op-last',
              app_id: 'app-1',
              server_id: 'local',
              family: 'change',
              status: 'success',
              current_phase: 'completed',
              selector: { operation_type: 'restart', source: 'manualops', adapter: 'docker' },
            },
            pipeline_selector: { operation_type: 'restart', source: 'manualops', adapter: 'docker' },
          },
          {
            id: 'op-other',
            app_id: 'app-2',
            server_id: 'local',
            source: 'manualops',
            status: 'success',
            adapter: 'docker',
            compose_project_name: 'other-app',
            project_dir: '/tmp/other-app',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-30T11:09:00Z',
            updated: '2026-03-30T11:10:00Z',
          },
        ])
      }
      if (path === '/api/ext/resources/databases' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'db-1',
            name: 'demo-app-db',
            type: 'postgres',
            host: 'db.internal',
            port: 5432,
            db_name: 'demo_app',
            user: 'demo_user',
            description: 'Primary database for demo app',
          },
          {
            id: 'db-2',
            name: 'shared-platform-db',
            type: 'mysql',
            host: 'shared.internal',
            port: 3306,
            db_name: 'platform',
            user: 'platform_user',
            description: 'Shared infra database',
          },
        ])
      }
      if (path === '/api/ext/docker/containers' && options?.method === 'GET') {
        return Promise.resolve({
          output: [
            JSON.stringify({
              ID: 'container-1',
              Names: 'demo-app-web-1',
              Image: 'nginx:stable',
              State: 'running',
              Status: 'Up 4 minutes',
              Ports: '0.0.0.0:8080->80/tcp',
            }),
            JSON.stringify({
              ID: 'container-2',
              Names: 'other-app-web-1',
              Image: 'redis:7',
              State: 'running',
              Status: 'Up 10 minutes',
              Ports: '6379/tcp',
            }),
          ].join('\n'),
        })
      }
      if (path === '/api/ext/docker/volumes' && options?.method === 'GET') {
        return Promise.resolve({
          output: [
            JSON.stringify({ Name: 'demo-app-data', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/demo-app-data/_data' }),
            JSON.stringify({ Name: 'shared-cache', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/shared-cache/_data' }),
          ].join('\n'),
        })
      }
      if (path === '/api/ext/docker/containers/stats' && options?.method === 'GET') {
        return Promise.resolve({
          output: [
            JSON.stringify({ ID: 'container-1', Name: 'demo-app-web-1', CPUPerc: '12.5%', MemUsage: '256MiB / 1GiB' }),
            JSON.stringify({ ID: 'container-2', Name: 'other-app-web-1', CPUPerc: '5.0%', MemUsage: '128MiB / 1GiB' }),
          ].join('\n'),
        })
      }
      if (path === '/api/ext/docker/containers/container-1/logs?tail=200' && options?.method === 'GET') {
        return Promise.resolve({
          output: 'demo log line 1\ndemo log line 2',
        })
      }
      if (path === '/api/ext/docker/containers/container-1' && options?.method === 'GET') {
        return Promise.resolve({
          output: JSON.stringify([{
            Mounts: [
              {
                Type: 'bind',
                Source: '/srv/demo-app/storage',
                Destination: '/app/storage',
                RW: true,
              },
            ],
          }]),
        })
      }
      if (path === '/api/ext/backup/list' && options?.method === 'GET') {
        return Promise.resolve({ message: 'not implemented' })
      }
      if (path === '/api/apps/app-1/start' && options?.method === 'POST') {
        return Promise.resolve({ id: 'op-start-1' })
      }
      if (path === '/api/apps/app-1' && options?.method === 'DELETE') {
        return Promise.resolve({ id: 'op-uninstall-1' })
      }
      if (path === '/api/apps/app-1/access' && options?.method === 'PUT') {
        return Promise.resolve({
          access_username: options?.body?.access_username || '',
          access_secret_hint: options?.body?.access_secret_hint || '',
          access_retrieval_method: options?.body?.access_retrieval_method || '',
          access_notes: options?.body?.access_notes || '',
        })
      }
      return Promise.resolve({})
    })
  })

  it('navigates to action detail after start creates an operation', async () => {
    appDetailResponse = {
      ...appDetailResponse,
      runtime_status: 'stopped',
      lifecycle_state: 'stopped',
    }

    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Start' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1/start', { method: 'POST' })
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/actions/$actionId',
        params: { actionId: 'op-start-1' },
        search: { returnTo: 'list' },
      })
    })
  })

  it('shows current source-build release artifact and source details in overview', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
      if (path === '/api/apps/app-1' && options?.method === 'GET') {
        return Promise.resolve(appDetailResponse)
      }
      if (path === '/api/apps/app-1/releases' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'rel-1',
            app_id: 'app-1',
            release_role: 'active',
            version_label: 'source-build-demo-20260401',
            source_type: 'file',
            source_ref: 'apps/source-build-demo/src',
            artifact_digest: 'apps/source-build-demo@sha256:abc123',
            notes: 'uploaded source package | Source build promoted | image=apps/source-build-demo:candidate | service=web',
            is_active: true,
            is_last_known_good: true,
            updated: '2026-04-01T06:00:00Z',
          },
          {
            id: 'rel-2',
            app_id: 'app-1',
            release_role: 'candidate',
            version_label: 'source-build-demo-20260401-candidate',
            source_type: 'file',
            source_ref: 'apps/source-build-demo/src',
            artifact_digest: 'apps/source-build-demo:candidate',
            is_active: false,
            is_last_known_good: false,
            updated: '2026-04-01T05:58:00Z',
          },
        ])
      }
      if (path === '/api/apps/app-1/exposures' && options?.method === 'GET') {
        return Promise.resolve([])
      }
      if (path === '/api/actions' && options?.method === 'GET') {
        return Promise.resolve([])
      }
      if (path === '/api/ext/resources/databases' && options?.method === 'GET') {
        return Promise.resolve([])
      }
      if (path === '/api/ext/docker/containers' && options?.method === 'GET') {
        return Promise.resolve({ output: '' })
      }
      if (path === '/api/ext/docker/volumes' && options?.method === 'GET') {
        return Promise.resolve({ output: '' })
      }
      if (path === '/api/ext/docker/containers/stats' && options?.method === 'GET') {
        return Promise.resolve({ output: '' })
      }
      if (path === '/api/apps/app-1/logs' && options?.method === 'GET') {
        return Promise.resolve({
          id: 'app-1',
          name: 'Demo App',
          server_id: 'local',
          project_dir: '/tmp/demo-app',
          runtime_status: 'running',
          output: '',
        })
      }
      if (path === '/api/ext/backup/list' && options?.method === 'GET') {
        return Promise.resolve({ message: 'not implemented' })
      }
      return Promise.resolve({})
    })

    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    expect(screen.getAllByText('active · source-build-demo-20260401')).toHaveLength(2)
    expect(screen.getAllByText('Artifact: apps/source-build-demo@sha256:abc123')).toHaveLength(2)
    expect(screen.getAllByText('Local image: apps/source-build-demo:candidate')).toHaveLength(2)
    expect(screen.getAllByText('Source: apps/source-build-demo/src')).toHaveLength(3)
    expect(screen.getAllByText('Target service: web')).toHaveLength(2)
    expect(screen.getByText('Release Lineage')).toBeInTheDocument()
    expect(screen.getByText('candidate · source-build-demo-20260401-candidate')).toBeInTheDocument()
    expect(screen.getByText('Artifact: apps/source-build-demo:candidate')).toBeInTheDocument()
  })

  it('opens a release detail dialog from the lineage section', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
      if (path === '/api/apps/app-1' && options?.method === 'GET') {
        return Promise.resolve(appDetailResponse)
      }
      if (path === '/api/apps/app-1/releases' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'rel-1',
            app_id: 'app-1',
            release_role: 'active',
            version_label: 'source-build-demo-20260401',
            source_type: 'file',
            source_ref: 'apps/source-build-demo/src',
            artifact_digest: 'apps/source-build-demo@sha256:abc123',
            notes: 'uploaded source package | Source build promoted | image=apps/source-build-demo:candidate | service=web',
            is_active: true,
            is_last_known_good: true,
            updated: '2026-04-01T06:00:00Z',
          },
        ])
      }
      if (path === '/api/apps/app-1/exposures' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/actions' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/ext/resources/databases' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/ext/docker/containers' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/ext/docker/volumes' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/ext/docker/containers/stats' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/apps/app-1/logs' && options?.method === 'GET') {
        return Promise.resolve({ id: 'app-1', name: 'Demo App', server_id: 'local', project_dir: '/tmp/demo-app', runtime_status: 'running', output: '' })
      }
      if (path === '/api/ext/backup/list' && options?.method === 'GET') return Promise.resolve({ message: 'not implemented' })
      return Promise.resolve({})
    })

    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Open detail' })[0])

    const dialog = await screen.findByRole('dialog', { name: 'Release Detail: source-build-demo-20260401' })
    expect(dialog).toHaveTextContent('apps/source-build-demo@sha256:abc123')
    expect(dialog).toHaveTextContent('apps/source-build-demo:candidate')
    expect(dialog).toHaveTextContent('apps/source-build-demo/src')
    expect(dialog).toHaveTextContent('web')
    expect(dialog).toHaveTextContent('uploaded source package | Source build promoted')
  })

  it('navigates to the related action from the release detail dialog', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
      if (path === '/api/apps/app-1' && options?.method === 'GET') {
        return Promise.resolve(appDetailResponse)
      }
      if (path === '/api/apps/app-1/releases' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'rel-1',
            app_id: 'app-1',
            created_by_operation: 'op-source-build-1',
            release_role: 'active',
            version_label: 'source-build-demo-20260401',
            source_type: 'file',
            source_ref: 'apps/source-build-demo/src',
            artifact_digest: 'apps/source-build-demo@sha256:abc123',
            notes: 'uploaded source package | Source build promoted | image=apps/source-build-demo:candidate | service=web',
            is_active: true,
            is_last_known_good: true,
            updated: '2026-04-01T06:00:00Z',
          },
        ])
      }
      if (path === '/api/apps/app-1/exposures' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/actions' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/ext/resources/databases' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/ext/docker/containers' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/ext/docker/volumes' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/ext/docker/containers/stats' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/apps/app-1/logs' && options?.method === 'GET') {
        return Promise.resolve({ id: 'app-1', name: 'Demo App', server_id: 'local', project_dir: '/tmp/demo-app', runtime_status: 'running', output: '' })
      }
      if (path === '/api/ext/backup/list' && options?.method === 'GET') return Promise.resolve({ message: 'not implemented' })
      return Promise.resolve({})
    })

    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Open detail' })[0])

    const dialog = await screen.findByRole('dialog', { name: 'Release Detail: source-build-demo-20260401' })
    expect(dialog).toHaveTextContent('op-source-build-1')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Related Action' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/actions/$actionId',
        params: { actionId: 'op-source-build-1' },
        search: { returnTo: 'list' },
      })
    })
  })

  it('copies artifact and source values from the release detail dialog', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
      if (path === '/api/apps/app-1' && options?.method === 'GET') {
        return Promise.resolve(appDetailResponse)
      }
      if (path === '/api/apps/app-1/releases' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'rel-1',
            app_id: 'app-1',
            created_by_operation: 'op-source-build-1',
            release_role: 'active',
            version_label: 'source-build-demo-20260401',
            source_type: 'file',
            source_ref: 'apps/source-build-demo/src',
            artifact_digest: 'apps/source-build-demo@sha256:abc123',
            notes: 'uploaded source package | Source build promoted | image=apps/source-build-demo:candidate | service=web',
            is_active: true,
            is_last_known_good: true,
            updated: '2026-04-01T06:00:00Z',
          },
        ])
      }
      if (path === '/api/apps/app-1/exposures' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/actions' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/ext/resources/databases' && options?.method === 'GET') return Promise.resolve([])
      if (path === '/api/ext/docker/containers' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/ext/docker/volumes' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/ext/docker/containers/stats' && options?.method === 'GET') return Promise.resolve({ output: '' })
      if (path === '/api/apps/app-1/logs' && options?.method === 'GET') {
        return Promise.resolve({ id: 'app-1', name: 'Demo App', server_id: 'local', project_dir: '/tmp/demo-app', runtime_status: 'running', output: '' })
      }
      if (path === '/api/ext/backup/list' && options?.method === 'GET') return Promise.resolve({ message: 'not implemented' })
      return Promise.resolve({})
    })

    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Open detail' })[0])

    const dialog = await screen.findByRole('dialog', { name: 'Release Detail: source-build-demo-20260401' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy Artifact' }))

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('apps/source-build-demo@sha256:abc123')
      expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy Source' }))

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('apps/source-build-demo/src')
    })
  })

  it('navigates to action detail after uninstall creates an operation', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Uninstall' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Uninstall' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1', { method: 'DELETE' })
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/actions/$actionId',
        params: { actionId: 'op-uninstall-1' },
        search: { returnTo: 'list' },
      })
    })
  })

  it('shows app-scoped action history in the Actions tab', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const actionsTab = screen.getByRole('tab', { name: 'Actions' })
    fireEvent.mouseDown(actionsTab)
    fireEvent.click(actionsTab)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions', { method: 'GET' })
      expect(screen.getByText('Restart')).toBeInTheDocument()
      expect(screen.queryByText('other-app')).not.toBeInTheDocument()
    })
  })

  it('disables lifecycle actions that conflict with the current runtime state', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }))

    const startWhileRunning = await screen.findByRole('menuitem', { name: 'Start' })
    const stopWhileRunning = await screen.findByRole('menuitem', { name: 'Stop' })
    const restartWhileRunning = await screen.findByRole('menuitem', { name: 'Restart' })
    expect(startWhileRunning).toHaveAttribute('data-disabled')
    expect(stopWhileRunning).not.toHaveAttribute('data-disabled')
    expect(restartWhileRunning).not.toHaveAttribute('data-disabled')

    cleanup()
    appDetailResponse = {
      ...appDetailResponse,
      runtime_status: 'stopped',
      lifecycle_state: 'stopped',
    }

    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }))

    const startWhileStopped = await screen.findByRole('menuitem', { name: 'Start' })
    const stopWhileStopped = await screen.findByRole('menuitem', { name: 'Stop' })
    const restartWhileStopped = await screen.findByRole('menuitem', { name: 'Restart' })
    expect(startWhileStopped).not.toHaveAttribute('data-disabled')
    expect(stopWhileStopped).toHaveAttribute('data-disabled')
    expect(restartWhileStopped).toHaveAttribute('data-disabled')
  })

  it('supports access hints display mode and edit mode', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const accessTab = screen.getByRole('tab', { name: 'Access' })
    fireEvent.mouseDown(accessTab)
    fireEvent.click(accessTab)

    await waitFor(() => {
      expect(screen.getByText('initial password from welcome page')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit Account Hints' }))

    const usernameInput = screen.getByDisplayValue('admin')
    fireEvent.change(usernameInput, { target: { value: 'root' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Account Hints' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1/access', {
        method: 'PUT',
        body: {
          access_username: 'root',
          access_secret_hint: 'initial password from welcome page',
          access_retrieval_method: 'Read the install completion output',
          access_notes: 'Rotate after first login',
        },
      })
      expect(screen.getByText('root')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })
  })

  it('opens the shared actions page with app-scoped deep-link context', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const actionsTab = screen.getByRole('tab', { name: 'Actions' })
    fireEvent.mouseDown(actionsTab)
    fireEvent.click(actionsTab)

    fireEvent.click(await screen.findByRole('button', { name: 'Open in Actions' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/actions',
        search: {
          appId: 'app-1',
          q: 'demo-app',
        },
      })
    })
  })

  it('shows matched runtime containers for the current app', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const runtimeTab = screen.getByRole('tab', { name: 'Runtime' })
    fireEvent.mouseDown(runtimeTab)
    fireEvent.click(runtimeTab)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ext/docker/containers', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/ext/docker/containers/stats', { method: 'GET' })
      expect(screen.getByText('demo-app-web-1')).toBeInTheDocument()
      expect(screen.queryByText('other-app-web-1')).not.toBeInTheDocument()
      expect(screen.getByText('12.5%')).toBeInTheDocument()
    })
  })

  it('opens a runtime container logs quick view', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const runtimeTab = screen.getByRole('tab', { name: 'Runtime' })
    fireEvent.mouseDown(runtimeTab)
    fireEvent.click(runtimeTab)

    const runtimePanel = screen.getByRole('tabpanel', { name: 'Runtime' })
    const logsButton = await within(runtimePanel).findByRole('button', { name: 'Logs' })
    fireEvent.click(logsButton)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ext/docker/containers/container-1/logs?tail=200', { method: 'GET' })
    })

    const logsDialog = await screen.findByRole('dialog', { name: 'Container Logs: demo-app-web-1' })
    expect(logsDialog).toHaveTextContent('demo log line 1')
    expect(logsDialog).toHaveTextContent('demo log line 2')
  })

  it('shows observability projections from logs, runtime, and action history', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const observabilityTab = screen.getByRole('tab', { name: 'Observability' })
    fireEvent.mouseDown(observabilityTab)
    fireEvent.click(observabilityTab)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1/logs', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/actions', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/ext/docker/containers', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/ext/docker/containers/stats', { method: 'GET' })
    })

    const observabilityPanel = screen.getByRole('tabpanel')
    expect(observabilityPanel).toHaveTextContent('app log line 1')
    expect(observabilityPanel).toHaveTextContent('1 / 1')
    expect(observabilityPanel).toHaveTextContent('CPU 12.5%')
    expect(observabilityPanel).toHaveTextContent('Restart')

    const metricsHeading = screen.getByText('Metrics')
    const logsHeading = screen.getByText('Logs')
    expect(metricsHeading.compareDocumentPosition(logsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows app-matched databases and volumes in the Data tab', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const dataTab = screen.getByRole('tab', { name: 'Data' })
    fireEvent.mouseDown(dataTab)
    fireEvent.click(dataTab)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ext/resources/databases', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/ext/docker/volumes', { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith('/api/ext/backup/list', { method: 'GET' })
    })

    expect(screen.getByText('demo-app-db')).toBeInTheDocument()
    expect(screen.queryByText('shared-platform-db')).not.toBeInTheDocument()
    expect(screen.getByText('demo-app-data')).toBeInTheDocument()
    expect(screen.queryByText('shared-cache')).not.toBeInTheDocument()
    expect(screen.getByText('Platform backup inventory is not connected yet.')).toBeInTheDocument()
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ext/docker/containers/container-1', { method: 'GET' })
    })
    expect(await screen.findByText('/srv/demo-app/storage')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Files' }).length).toBeGreaterThan(0)
  })

  it('opens IaC in a new window and loads the adjacent env file in Compose', async () => {
    render(<AppDetailPage appId="app-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo App' })).toBeInTheDocument()
    })

    const composeTab = screen.getByRole('tab', { name: 'Compose' })
    fireEvent.mouseDown(composeTab)
    fireEvent.click(composeTab)

    await waitFor(() => {
      expect(iacReadMock).toHaveBeenCalledWith('apps/installed/demo-app/.env')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open in IaC' }))

    expect(windowOpenMock).toHaveBeenCalledTimes(1)
    expect(windowOpenMock.mock.calls[0]?.[0]).toContain('/iac?path=apps%2Finstalled%2Fdemo-app%2Fdocker-compose.yml')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('KEY=value')).toHaveValue('APP_ENV=demo\n')
    })
  })
})