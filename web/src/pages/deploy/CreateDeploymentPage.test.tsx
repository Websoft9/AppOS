import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { settingsEntryPath } from '@/lib/settings-api'
import { buildExposurePortCandidates, recommendExposurePort } from './createDeploymentPage.helpers'
import { CreateDeploymentPage } from './CreateDeploymentPage'

const sendMock = vi.fn()
const collectionCreateMock = vi.fn()
const navigateMock = vi.fn()
const iacUploadFileMock = vi.fn()
const iacMkdirMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/lib/i18n', () => ({
  getLocale: () => 'en',
}))

vi.mock('@/lib/store-user-api', () => ({
  useUserApps: () => ({ data: [] }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: (name: string) => ({
      create: (...args: unknown[]) => {
        if (name !== 'secrets') {
          throw new Error(`Unexpected collection create for ${name}`)
        }
        return collectionCreateMock(...args)
      },
    }),
    authStore: { token: '' },
  },
}))

vi.mock('@/lib/iac-api', () => ({
  iacLoadLibraryAppFiles: vi.fn(),
  iacRead: vi.fn(),
  iacUploadFile: (...args: unknown[]) => iacUploadFileMock(...args),
  iacMkdir: (...args: unknown[]) => iacMkdirMock(...args),
}))

vi.mock('@/pages/deploy/OrchestrationSection', () => ({
  OrchestrationSection: ({
    compose,
    setCompose,
    envVars,
    setEnvVars,
    setSrcFiles,
    onYamlError,
    onRuntimeEnvInputsChange,
  }: {
    compose: string
    setCompose: (value: string) => void
    envVars: Array<{ key: string; value: string }>
    setEnvVars: React.Dispatch<React.SetStateAction<Array<{ key: string; value: string }>>>
    setSrcFiles: React.Dispatch<React.SetStateAction<File[]>>
    onYamlError?: (error: string | null) => void
    onRuntimeEnvInputsChange?: (
      inputs: Array<{ name: string; kind: 'sensitive'; generator_method?: string }>
    ) => void
  }) => {
    useEffect(() => {
      onYamlError?.(null)
    }, [compose, onYamlError])

    useEffect(() => {
      const inputs = envVars
        .filter(item => item.key.trim())
        .map(item => ({
          name: item.key.trim(),
          kind: 'sensitive' as const,
          generator_method: 'password_16',
        }))
      onRuntimeEnvInputsChange?.(inputs)
    }, [envVars, onRuntimeEnvInputsChange])

    const primaryEnv = envVars[0] ?? { key: '', value: '' }

    return (
      <section aria-label="Orchestration Section Mock">
        <label htmlFor="compose-content">Compose Content</label>
        <textarea
          id="compose-content"
          placeholder="services:"
          value={compose}
          onChange={event => setCompose(event.target.value)}
        />

        <button type="button">Environment Variables & Secret-backed</button>

        <input
          placeholder="KEY"
          value={primaryEnv.key}
          onChange={event =>
            setEnvVars([{ key: event.target.value, value: primaryEnv.value || '' }])
          }
        />
        <button
          type="button"
          title="Auto-generate sensitive value"
          onClick={() =>
            setEnvVars([
              { key: primaryEnv.key, value: primaryEnv.value || 'generated-secret-value' },
            ])
          }
        >
          Generate Sensitive
        </button>

        <select aria-label="Sensitive Method" value="password_16" onChange={() => undefined}>
          <option value="password_16">Password (16)</option>
        </select>

        <input
          type="file"
          multiple
          onChange={event => {
            const files = Array.from(event.target.files || [])
            setSrcFiles(files)
          }}
        />
      </section>
    )
  },
}))

function renderCreateDeploymentPage(
  props: Partial<React.ComponentProps<typeof CreateDeploymentPage>> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CreateDeploymentPage entryMode="compose" {...props} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function getAppNameField() {
  return screen.getByLabelText(/^App Name/)
}

function getTargetLocationField() {
  return screen.getByLabelText(/^Target Location/)
}

async function selectTargetLocation(value: string) {
  await waitFor(() => {
    const field = getTargetLocationField() as HTMLSelectElement
    expect(Array.from(field.options).some(option => option.value === value)).toBe(true)
  })
  fireEvent.change(getTargetLocationField(), { target: { value } })
  await waitFor(() => {
    expect((getTargetLocationField() as HTMLSelectElement).value).toBe(value)
  })
}

async function clickEnabledButton(name: string) {
  await waitFor(() => {
    expect(screen.getByRole('button', { name })).toBeEnabled()
  })
  fireEvent.click(screen.getByRole('button', { name }))
}

async function enablePortAccess() {
  fireEvent.click(screen.getByRole('button', { name: /Port Access/i }))
  await waitFor(() => {
    expect(screen.getByText('Service Name')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/Server Port /i).length).toBeGreaterThan(0)
  })
}

function openAdvancedOptions() {
  const summary = screen.getByText('Toggle advanced settings').closest('summary')
  expect(summary).not.toBeNull()
  const details = summary?.closest('details') as HTMLDetailsElement | null
  expect(details).not.toBeNull()
  if (details && !details.open) {
    details.open = true
  }
}

function expectPortExposure() {
  return expect.objectContaining({
    exposure_type: 'port',
    is_primary: true,
    target_port: expect.any(Number),
  })
}

describe('CreateDeploymentPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    sendMock.mockReset()
    collectionCreateMock.mockReset()
    navigateMock.mockReset()
    iacUploadFileMock.mockReset()
    iacMkdirMock.mockReset()
    iacUploadFileMock.mockResolvedValue(undefined)
    iacMkdirMock.mockResolvedValue(undefined)
    collectionCreateMock.mockResolvedValue({ id: 'secret-1' })
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/servers/docker-targets') {
          return Promise.resolve([
            { id: 'local', label: 'local', host: '127.0.0.1', status: 'online' },
          ])
        }
        if (path === '/api/software/local/docker') {
          return Promise.resolve({
            component_key: 'docker',
            label: 'Docker',
            target_type: 'local',
            template_kind: 'docker',
            installed_state: 'installed',
            detected_version: '27.0.1',
            verification_state: 'healthy',
            available_actions: ['verify'],
            preflight: {
              ok: true,
              os_supported: true,
              privilege_ok: true,
              network_ok: true,
              dependency_ready: true,
            },
            verification: {
              state: 'healthy',
              checked_at: '2026-01-01T00:00:00Z',
              details: {
                engine_version: '27.0.1',
                compose_available: true,
                compose_version: 'v2.29.1',
              },
            },
          })
        }
        if (path === '/api/actions') {
          return Promise.resolve([])
        }
        if (path === settingsEntryPath('deploy-git-defaults') && options?.method === 'GET') {
          return Promise.resolve({
            id: 'deploy-git-defaults',
            value: { defaultRef: 'main', defaultComposePath: 'docker-compose.yml' },
          })
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
              ports: {
                ok: true,
                status: 'not_applicable',
                message: 'compose does not declare fixed published host ports',
                items: [],
              },
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
              ports: {
                ok: true,
                status: 'not_applicable',
                message: 'compose does not declare fixed published host ports',
                items: [],
              },
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
        if (path.startsWith('/api/catalog/categories?')) {
          return Promise.resolve({
            items: [],
            meta: {
              locale: 'en',
              sourceVersion: 'test',
            },
          })
        }
        if (path.startsWith('/api/catalog/apps?')) {
          return Promise.resolve({
            items: [
              {
                key: 'wordpress',
                title: 'WordPress',
                overview: '',
                source: 'official',
                visibility: 'public',
                secondaryCategories: [],
                badges: [],
                template: { key: 'wordpress', source: 'official', available: true },
                personalization: { isFavorite: false, hasNote: false },
              },
              {
                key: 'odoo',
                title: 'Odoo',
                overview: '',
                source: 'official',
                visibility: 'public',
                secondaryCategories: [],
                badges: [],
                template: { key: 'odoo', source: 'official', available: true },
                personalization: { isFavorite: false, hasNote: false },
              },
            ],
            page: {
              limit: 200,
              offset: 0,
              total: 2,
              hasMore: false,
            },
            meta: {
              locale: 'en',
              sourceVersion: 'test',
            },
          })
        }
        if (path === '/api/catalog/apps/odoo/template') {
          return Promise.resolve({
            templateKey: 'odoo',
            manifest: {
              trademark: 'Odoo',
              category: 'Business',
              requirements: { diskGb: 1 },
              serviceRoles: { odoo: 'primary', postgresql: 'database' },
            },
            inputs: [
              {
                key: 'admin_email',
                label: 'Admin Email',
                type: 'string',
                required: true,
                visibility: 'basic',
                storage_mode: 'plain',
                default: '',
              },
            ],
            exposure: { kind: 'http', service: 'odoo', targetPort: 8069 },
            composeValues: { primaryService: 'odoo', databaseService: 'postgresql' },
          })
        }
        if (path === '/api/catalog/apps/odoo?locale=en') {
          return Promise.resolve({
            key: 'odoo',
            title: 'Odoo',
            overview: '',
            iconUrl: 'https://example.com/odoo.png',
            screenshots: [],
            source: { kind: 'official', visibility: 'public' },
            categories: { primary: { key: 'business', title: 'Business' }, secondary: [] },
            links: {},
            requirements: { storageGb: 1 },
            template: { key: 'odoo', source: 'official', available: true },
            deploy: {
              supported: true,
              mode: 'template',
              sourceKind: 'official',
              defaultAppName: 'odoo',
            },
            personalization: { isFavorite: false },
            audit: {},
          })
        }
        if (path === '/api/catalog/apps/wordpress/template') {
          return Promise.resolve({
            templateKey: 'wordpress',
            manifest: {
              trademark: 'WordPress',
              category: 'CMS',
              requirements: { diskGb: 1 },
              serviceRoles: { wordpress: 'primary', mysql: 'database' },
            },
            inputs: [
              {
                key: 'admin_email',
                label: 'Admin Email',
                type: 'string',
                required: true,
                visibility: 'basic',
                storage_mode: 'plain',
                default: '',
              },
              {
                key: 'db_password',
                label: 'Database Password',
                type: 'string',
                required: true,
                visibility: 'basic',
                storage_mode: 'secret_backed',
                default: '',
              },
            ],
            exposure: { kind: 'http', service: 'wordpress', targetPort: 80 },
            composeValues: { primaryService: 'wordpress', databaseService: 'mysql' },
          })
        }
        if (path === '/api/catalog/apps/wordpress?locale=en') {
          return Promise.resolve({
            key: 'wordpress',
            title: 'WordPress',
            overview: '',
            iconUrl: 'https://example.com/wordpress.png',
            screenshots: [],
            source: { kind: 'official', visibility: 'public' },
            categories: { primary: { key: 'cms', title: 'CMS' }, secondary: [] },
            links: {},
            requirements: { storageGb: 1 },
            template: { key: 'wordpress', source: 'official', available: true },
            deploy: {
              supported: true,
              mode: 'template',
              sourceKind: 'official',
              defaultAppName: 'wordpress',
            },
            personalization: { isFavorite: false },
            audit: {},
          })
        }
        if (path === '/api/actions/install/template/check' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            message: 'Preflight passed',
            compose_project_name: options.body?.project_name || 'wordpress',
            checks: {
              app_name: { ok: true, message: 'application name is available' },
            },
            warnings: [],
          })
        }
        if (path === '/api/actions/install/template' && options?.method === 'POST') {
          return Promise.resolve({
            id: 'act_template_1',
            compose_project_name: options.body?.project_name || 'wordpress',
          })
        }
        if (path === '/api/secrets/secret-1/payload' && options?.method === 'PUT') {
          return Promise.resolve({ ok: true })
        }
        return Promise.resolve({})
      }
    )
  })

  it('does not inject a local target when no docker-capable servers exist', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/docker-targets') {
        return Promise.resolve([])
      }
      if (path === settingsEntryPath('deploy_checklist')) {
        return Promise.resolve({
          key: 'deploy_checklist',
          value: { compose_acknowledged: true },
        })
      }
      if (path === '/api/catalog/apps?locale=en&source=official&limit=1000&offset=0') {
        return Promise.resolve({ items: [], total: 0 })
      }
      if (path === '/api/catalog/categories?locale=en') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/deploy/intents') {
        return Promise.resolve({ items: [], total: 0 })
      }
      return Promise.resolve([])
    })

    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/servers/docker-targets', { method: 'GET' })
    })

    const targetField = getTargetLocationField() as HTMLSelectElement
    expect(Array.from(targetField.options).some(option => option.value === 'local')).toBe(false)
    expect(targetField.value).toBe('')
  })

  it('renders the full create page and submits a manual compose action', async () => {
    renderCreateDeploymentPage({ entryMode: 'compose' })

    await screen.findByRole('heading', { name: 'Create Deployment' })
    await screen.findByLabelText('App Name *')

    await enablePortAccess()

    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle deployment help' })).toBeInTheDocument()
    expect(screen.queryByText('Help')).toBeNull()
    expect(screen.queryByText('FAQ')).toBeNull()
    expect(getAppNameField()).toBeRequired()
    expect(getTargetLocationField()).toBeRequired()

    expect(screen.getByRole('link', { name: /Deploy/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Back$/i })).not.toBeInTheDocument()

    expect(
      screen.queryByText('Leave blank to auto-generate the normalized app name.')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cancel' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle deployment help' }))

    expect(screen.getByText('Help')).toBeInTheDocument()
    expect(screen.getByText('FAQ')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle deployment help' }))

    expect(screen.queryByText('Help')).toBeNull()
    expect(screen.queryByText('FAQ')).toBeNull()

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')

    const composeTextarea = screen.getByPlaceholderText(/services:/i)
    fireEvent.change(composeTextarea, {
      target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'manual-compose' },
          runtime_inputs: undefined,
          app_required_disk_gib: '',
        }),
      })
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'manual-compose' },
          runtime_inputs: undefined,
          app_required_disk_gib: '',
        }),
      })
    })

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/activity/$actionId',
      params: { actionId: 'act_manual_1' },
      search: { returnTo: 'list' },
    })
  }, 30000)

  it('blocks create when auto preflight check fails', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/servers/docker-targets') {
          return Promise.resolve([
            { id: 'local', label: 'local', host: '127.0.0.1', status: 'online' },
          ])
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
      }
    )

    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(getAppNameField()).toBeInTheDocument()
    })

    await enablePortAccess()

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByPlaceholderText(/services:/i), {
      target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'manual-compose' },
          runtime_inputs: undefined,
          app_required_disk_gib: '',
        }),
      })
    })

    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/actions/install/manual-compose',
      expect.anything()
    )
  })

  it('runs a manual compose preflight check without creating an action', async () => {
    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(getAppNameField()).toBeInTheDocument()
    })
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByPlaceholderText(/services:/i), {
      target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
    })
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled()
    await clickEnabledButton('Check')

    await waitFor(() => {
      expect(screen.getByText('Ready to deploy')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          metadata: { candidate_kind: 'manual-compose' },
          runtime_inputs: undefined,
          app_required_disk_gib: '',
        }),
      })
    })

    expect(screen.getAllByText('Ready to deploy').length).toBeGreaterThan(0)
    expect(screen.queryByText('application name is available')).not.toBeInTheDocument()
    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/actions/install/manual-compose',
      expect.anything()
    )
  })

  it('allows create when auto preflight returns warnings only', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/servers/docker-targets') {
          return Promise.resolve([
            { id: 'local', label: 'local', host: '127.0.0.1', status: 'online' },
          ])
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
              ports: {
                ok: true,
                status: 'unavailable',
                message: 'Port occupancy checks are unavailable for the current target.',
                items: [],
              },
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
      }
    )

    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(getAppNameField()).toBeInTheDocument()
    })

    await enablePortAccess()

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByPlaceholderText(/services:/i), {
      target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'manual-compose' },
          app_required_disk_gib: '',
        }),
      })
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'manual-compose' },
          app_required_disk_gib: '',
        }),
      })
      expect(
        screen.queryByText('Create blocked by preflight: Preflight completed with warnings')
      ).toBeNull()
    })
  })

  it('blocks create when estimated app disk exceeds available disk', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/servers/docker-targets') {
          return Promise.resolve([
            { id: 'local', label: 'local', host: '127.0.0.1', status: 'online' },
          ])
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
                message:
                  'Application estimated disk requirement (2147483648 bytes) exceeds available disk space (1073741824 bytes)',
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
      }
    )

    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(getAppNameField()).toBeInTheDocument()
    })

    await enablePortAccess()
    openAdvancedOptions()

    await waitFor(() => {
      expect(screen.getByLabelText('Estimated App Disk')).toBeInTheDocument()
    })

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByLabelText('Estimated App Disk'), { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText(/services:/i), {
      target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: {},
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'manual-compose' },
          runtime_inputs: undefined,
          app_required_disk_gib: '2',
        }),
      })
    })

    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/actions/install/manual-compose',
      expect.anything()
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Create blocked by preflight: Preflight found blocking issues'
    )
    expect(
      screen.getByText(
        'Application estimated disk requirement (2147483648 bytes) exceeds available disk space (1073741824 bytes)'
      )
    ).toBeInTheDocument()
  })

  it('checks name availability after the app name field blurs', async () => {
    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(getAppNameField()).toBeInTheDocument()
    })

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/actions/install/name-availability',
      expect.anything()
    )

    fireEvent.blur(getAppNameField())

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/name-availability', {
        method: 'POST',
        body: { project_name: 'wordpress-prod' },
      })
    })

    expect(screen.queryByText('application name is available')).not.toBeInTheDocument()
  })

  it.each([
    ['docker-command', 'docker-command'],
    ['install-script', 'install-script'],
  ] as const)(
    'submits manual deployment with %s candidate metadata',
    async (entryMode, candidateKind) => {
      renderCreateDeploymentPage({ entryMode })

      await waitFor(() => {
        expect(getAppNameField()).toBeInTheDocument()
      })

      await enablePortAccess()

      fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
      await selectTargetLocation('local')
      fireEvent.change(screen.getByPlaceholderText(/services:/i), {
        target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

      await waitFor(() => {
        expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
          method: 'POST',
          body: expect.objectContaining({
            server_id: 'local',
            project_name: 'wordpress-prod',
            compose: 'services:\n  web:\n    image: nginx:alpine\n',
            env: {},
            exposure: expectPortExposure(),
            metadata: { candidate_kind: candidateKind },
            runtime_inputs: undefined,
            source_build:
              entryMode === 'install-script'
                ? {
                    source_kind: 'uploaded-package',
                    source_ref: 'apps/wordpress-prod/src',
                    workspace_ref: 'apps/wordpress-prod/src',
                    builder_strategy: 'buildpacks',
                    deploy_inputs: {
                      service_name: 'web',
                    },
                    artifact_publication: {
                      mode: 'local',
                      image_name: 'apps/wordpress-prod',
                    },
                  }
                : undefined,
            app_required_disk_gib: '',
          }),
        })
      })
    }
  )

  it('submits non-empty runtime inputs for install-script create after source upload', async () => {
    renderCreateDeploymentPage({ entryMode: 'install-script' })

    await waitFor(() => {
      expect(getAppNameField()).toBeInTheDocument()
    })

    await enablePortAccess()

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByPlaceholderText(/services:/i), {
      target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
    })

    fireEvent.click(screen.getByText('Environment Variables & Secret-backed'))
    fireEvent.change(screen.getByPlaceholderText('KEY'), { target: { value: 'APP_SECRET' } })
    fireEvent.click(screen.getByTitle('Auto-generate sensitive value'))

    await waitFor(() => {
      expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1)
    })
    const sensitiveMethodSelect = screen
      .getAllByRole('combobox')
      .find(element => element.querySelector('option[value="password_16"]'))
    expect(sensitiveMethodSelect).toBeTruthy()
    fireEvent.change(sensitiveMethodSelect as Element, { target: { value: 'password_16' } })

    await waitFor(() => {
      expect(screen.getByLabelText('Target Service')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Target Service'), { target: { value: 'web' } })

    const sourceFileInput = document.querySelector(
      'input[type="file"][multiple]'
    ) as HTMLInputElement | null
    expect(sourceFileInput).not.toBeNull()
    fireEvent.change(sourceFileInput as HTMLInputElement, {
      target: {
        files: [new File(['archive-bytes'], 'app.tar.gz', { type: 'application/gzip' })],
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: { APP_SECRET: expect.any(String) },
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'install-script' },
          runtime_inputs: {
            env: [{ name: 'APP_SECRET', kind: 'sensitive', generator_method: 'password_16' }],
            files: [
              {
                name: 'app.tar.gz',
                kind: 'source-package',
                source_path: './src/app.tar.gz',
                uploaded: false,
              },
            ],
          },
          source_build: {
            source_kind: 'uploaded-package',
            source_ref: 'apps/wordpress-prod/src',
            workspace_ref: 'apps/wordpress-prod/src',
            builder_strategy: 'buildpacks',
            deploy_inputs: {
              service_name: 'web',
            },
            artifact_publication: {
              mode: 'local',
              image_name: 'apps/wordpress-prod',
            },
          },
          app_required_disk_gib: '',
        }),
      })
    })

    expect(iacMkdirMock).toHaveBeenCalledWith('apps/wordpress-prod/src')
    expect(iacUploadFileMock).toHaveBeenCalledWith(
      'apps/wordpress-prod/src',
      expect.objectContaining({ name: 'app.tar.gz' })
    )

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n',
          env: { APP_SECRET: expect.any(String) },
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'install-script' },
          runtime_inputs: {
            env: [{ name: 'APP_SECRET', kind: 'sensitive', generator_method: 'password_16' }],
            files: [
              {
                name: 'app.tar.gz',
                kind: 'source-package',
                source_path: './src/app.tar.gz',
                uploaded: true,
              },
            ],
          },
          source_build: {
            source_kind: 'uploaded-package',
            source_ref: 'apps/wordpress-prod/src',
            workspace_ref: 'apps/wordpress-prod/src',
            builder_strategy: 'buildpacks',
            deploy_inputs: {
              service_name: 'web',
            },
            artifact_publication: {
              mode: 'local',
              image_name: 'apps/wordpress-prod',
            },
          },
          app_required_disk_gib: '',
        }),
      })
    })
  })

  it('requires a target service selection for multi-service install-script deployments', async () => {
    renderCreateDeploymentPage({ entryMode: 'install-script' })

    await waitFor(() => {
      expect(getAppNameField()).toBeInTheDocument()
    })

    await enablePortAccess()

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByPlaceholderText(/services:/i), {
      target: {
        value: 'services:\n  web:\n    image: nginx:alpine\n  worker:\n    image: busybox\n',
      },
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Target Service')).toBeInTheDocument()
      expect(
        screen.getByText('Select which service should use the locally built application image.')
      ).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Create Deployment' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Target Service'), { target: { value: 'worker' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          compose: 'services:\n  web:\n    image: nginx:alpine\n  worker:\n    image: busybox\n',
          env: {},
          exposure: expectPortExposure(),
          metadata: { candidate_kind: 'install-script' },
          runtime_inputs: undefined,
          source_build: {
            source_kind: 'uploaded-package',
            source_ref: 'apps/wordpress-prod/src',
            workspace_ref: 'apps/wordpress-prod/src',
            builder_strategy: 'buildpacks',
            deploy_inputs: {
              service_name: 'worker',
            },
            artifact_publication: {
              mode: 'local',
              image_name: 'apps/wordpress-prod',
            },
          },
          app_required_disk_gib: '',
        }),
      })
    })
  })

  it('supports the git repository create flow on the full page', async () => {
    renderCreateDeploymentPage({ entryMode: 'git-compose' })

    await waitFor(() => {
      expect(screen.getByText('Repository')).toBeInTheDocument()
      expect(screen.getByLabelText('Repository URL')).toBeInTheDocument()
    })

    await enablePortAccess()

    fireEvent.change(getAppNameField(), { target: { value: 'git-wordpress' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/org/repo' },
    })
    fireEvent.change(screen.getByLabelText('Compose Path'), {
      target: { value: 'docker-compose.yml' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/git-compose', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'git-wordpress',
          repository_url: 'https://github.com/org/repo',
          ref: 'main',
          compose_path: 'docker-compose.yml',
          auth_header_name: '',
          auth_header_value: '',
          exposure: expectPortExposure(),
          app_required_disk_gib: '',
        }),
      })
    })

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/activity/$actionId',
      params: { actionId: 'act_git_1' },
      search: { returnTo: 'list' },
    })
  })

  it('uses deploy settings defaults in the git compose create request', async () => {
    const fallback = sendMock.getMockImplementation()
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === settingsEntryPath('deploy-git-defaults') && options?.method === 'GET') {
          return Promise.resolve({
            id: 'deploy-git-defaults',
            value: { defaultRef: 'release', defaultComposePath: 'deploy/custom-compose.yml' },
          })
        }
        return fallback?.(path, options)
      }
    )

    renderCreateDeploymentPage({ entryMode: 'git-compose' })

    await waitFor(() => {
      expect(screen.getByLabelText('Ref')).toHaveValue('release')
      expect(screen.getByLabelText('Compose Path')).toHaveValue('deploy/custom-compose.yml')
    })

    await enablePortAccess()

    fireEvent.change(getAppNameField(), { target: { value: 'git-wordpress' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/org/repo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/git-compose', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'git-wordpress',
          repository_url: 'https://github.com/org/repo',
          ref: 'release',
          compose_path: 'deploy/custom-compose.yml',
          auth_header_name: '',
          auth_header_value: '',
          exposure: expectPortExposure(),
          app_required_disk_gib: '',
        }),
      })
    })
  })

  it('pins template mode to the selected store app', async () => {
    renderCreateDeploymentPage({
      entryMode: 'template',
      prefillMode: 'target',
      prefillSource: 'library',
      prefillAppKey: 'wordpress',
      prefillAppName: 'WordPress',
    })

    await waitFor(() => {
      expect(screen.getByText('App Settings')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText('Search Template')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('App Template')).not.toBeInTheDocument()
    expect(screen.getByText('App Settings')).toBeInTheDocument()
    expect(screen.queryByText('Template key: wordpress · CMS')).toBeNull()
    expect(screen.getByAltText('WordPress logo')).toBeInTheDocument()
    expect(screen.getByLabelText('Database Source')).toHaveValue('companion')
    expect(screen.getByText('Template DB (mysql)')).toBeInTheDocument()
    expect((getAppNameField() as HTMLInputElement).value).toMatch(/^wordpress-\d{4}$/)
    openAdvancedOptions()
    expect(screen.getByLabelText('Estimated App Disk')).toHaveValue(1)
    expect(screen.queryByLabelText('HTTP Port *')).not.toBeInTheDocument()
  })

  it('stores secret-backed template values in secrets before check and create', async () => {
    renderCreateDeploymentPage({
      entryMode: 'template',
      prefillAppKey: 'wordpress',
      prefillAppName: 'WordPress',
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Database Source')).toBeInTheDocument()
      expect(getTargetLocationField()).toBeInTheDocument()
    })

    await enablePortAccess()

    openAdvancedOptions()

    await waitFor(() => {
      expect(screen.getByLabelText('Database Password *')).toBeInTheDocument()
    })

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByLabelText('Admin Email *'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Database Password *'), {
      target: { value: 'sup3r-secret' },
    })

    await clickEnabledButton('Check')

    await waitFor(() => {
      expect(collectionCreateMock).toHaveBeenCalledWith({
        name: 'app-wordpress-prod-db-password',
        description: 'Generated for wordpress-prod deployment field Database Password',
        template_id: 'single_value',
        scope: 'global',
        visible_to: ['application'],
        payload: { value: 'sup3r-secret' },
      })
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/template/check', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          template_key: 'wordpress',
          input_values: {
            admin_email: 'admin@example.com',
            db_password: 'secretRef:secret-1',
          },
          exposure: expectPortExposure(),
          app_required_disk_gib: '1',
        }),
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/template', {
        method: 'POST',
        body: expect.objectContaining({
          server_id: 'local',
          project_name: 'wordpress-prod',
          template_key: 'wordpress',
          input_values: {
            admin_email: 'admin@example.com',
            db_password: 'secretRef:secret-1',
          },
          exposure: expectPortExposure(),
          app_required_disk_gib: '1',
        }),
      })
    })

    expect(collectionCreateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/activity/$actionId',
      params: { actionId: 'act_template_1' },
      search: { returnTo: 'list' },
    })
  })

  it('submits internal-only exposure when public access is disabled for template installs', async () => {
    renderCreateDeploymentPage({
      entryMode: 'template',
      prefillAppKey: 'wordpress',
      prefillAppName: 'WordPress',
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Database Source')).toBeInTheDocument()
      expect(getTargetLocationField()).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('Disabled'))

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-private' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByLabelText('Admin Email *'), {
      target: { value: 'admin@example.com' },
    })

    await clickEnabledButton('Check')

    await waitFor(() => {
      expect(
        sendMock.mock.calls.some(
          ([path, options]) =>
            path === '/api/actions/install/template/check' &&
            options?.method === 'POST' &&
            options?.body?.server_id === 'local' &&
            options?.body?.project_name === 'wordpress-private' &&
            options?.body?.template_key === 'wordpress' &&
            options?.body?.input_values?.admin_email === 'admin@example.com' &&
            options?.body?.app_required_disk_gib === '1' &&
            options?.body?.exposure?.exposure_type === 'internal_only' &&
            options?.body?.exposure?.is_primary === true
        )
      ).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(
        sendMock.mock.calls.some(
          ([path, options]) =>
            path === '/api/actions/install/template' &&
            options?.method === 'POST' &&
            options?.body?.server_id === 'local' &&
            options?.body?.project_name === 'wordpress-private' &&
            options?.body?.template_key === 'wordpress' &&
            options?.body?.input_values?.admin_email === 'admin@example.com' &&
            options?.body?.app_required_disk_gib === '1' &&
            options?.body?.exposure?.exposure_type === 'internal_only' &&
            options?.body?.exposure?.is_primary === true
        )
      ).toBe(true)
    })
  })

  it('suggests the next available primary server port when the recommended one is occupied', async () => {
    const occupiedPort = recommendExposurePort('local:wordpress-prod')
    const suggestedPort = String(buildExposurePortCandidates(occupiedPort, 2)[1])
    const fallback = sendMock.getMockImplementation()

    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === `/api/servers/local/ops/ports/${occupiedPort}?view=all&protocol=tcp`) {
          return Promise.resolve({
            server_id: 'local',
            port: Number(occupiedPort),
            protocol: 'tcp',
            view: 'all',
            detected_at: '2026-01-01T00:00:00Z',
            occupancy: { occupied: true, listeners: [] },
            reservation: { reserved: false, sources: [] },
          })
        }
        if (path === `/api/servers/local/ops/ports/${suggestedPort}?view=all&protocol=tcp`) {
          return Promise.resolve({
            server_id: 'local',
            port: Number(suggestedPort),
            protocol: 'tcp',
            view: 'all',
            detected_at: '2026-01-01T00:00:00Z',
            occupancy: { occupied: false, listeners: [] },
            reservation: { reserved: false, sources: [] },
          })
        }
        return fallback ? fallback(path, options) : Promise.resolve({})
      }
    )

    renderCreateDeploymentPage({
      entryMode: 'template',
      prefillAppKey: 'wordpress',
      prefillAppName: 'WordPress',
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Database Source')).toBeInTheDocument()
      expect(getTargetLocationField()).toBeInTheDocument()
    })

    await enablePortAccess()

    fireEvent.change(getAppNameField(), { target: { value: 'wordpress-prod' } })
    await selectTargetLocation('local')

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        `/api/servers/local/ops/ports/${occupiedPort}?view=all&protocol=tcp`,
        expect.anything()
      )
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Server Port wordpress')).toHaveValue(Number(suggestedPort))
    })

    expect(
      screen.getByText(
        `Primary recommended port ${occupiedPort} is already in use or reserved on this server. Suggested ${suggestedPort} instead.`
      )
    ).toBeInTheDocument()
  })

  it('starts with exposure cards unselected and lets operators enable port access independently', async () => {
    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Port Access/i })).toBeInTheDocument()
    })

    expect(screen.queryByText('Service Name')).toBeNull()
    expect(screen.queryByLabelText('Server Port primary')).toBeNull()
    expect(screen.queryByRole('button', { name: /No access/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Deployment' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Domain Access/i }))

    expect(
      screen.getAllByText(/Domain access currently applies only to the primary service/i).length
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Create Deployment' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Port Access/i }))

    expect(screen.getByText('Service Name')).toBeInTheDocument()
    expect(screen.getByText('Container Port')).toBeInTheDocument()
    expect(screen.getByText('Open Port')).toBeInTheDocument()
    expect(screen.getByLabelText('Open Port primary')).toBeInTheDocument()
    expect(screen.getByLabelText('Server Port primary')).toBeInTheDocument()

    fireEvent.change(getAppNameField(), { target: { value: 'internal-demo' } })
    await selectTargetLocation('local')
    fireEvent.change(screen.getByPlaceholderText(/services:/i), {
      target: { value: 'services:\n  web:\n    image: nginx:alpine\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Deployment' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/actions/install/manual-compose/check', {
        method: 'POST',
        body: expect.objectContaining({
          project_name: 'internal-demo',
          exposure: expectPortExposure(),
        }),
      })
    })
  })

  it('checks docker readiness after choosing a target and links to prerequisites when Docker is not ready', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/servers/docker-targets') {
          return Promise.resolve([
            { id: 'srv-1', label: 'edge-1', host: '10.0.0.8', status: 'online' },
          ])
        }
        if (path === '/api/servers/srv-1/software/docker') {
          return Promise.resolve({
            component_key: 'docker',
            label: 'Docker',
            target_type: 'server',
            template_kind: 'docker',
            installed_state: 'installed',
            detected_version: '27.0.1',
            verification_state: 'degraded',
            available_actions: ['upgrade'],
            preflight: {
              ok: true,
              os_supported: true,
              privilege_ok: true,
              network_ok: true,
              dependency_ready: true,
            },
            verification: {
              state: 'degraded',
              checked_at: '2026-01-01T00:00:00Z',
              reason: 'docker compose: command not found',
              details: {
                engine_version: '27.0.1',
                compose_available: false,
                compose_version: '',
              },
            },
          })
        }
        if (path === '/api/actions') {
          return Promise.resolve([])
        }
        if (path === settingsEntryPath('deploy-git-defaults') && options?.method === 'GET') {
          return Promise.resolve({
            id: 'deploy-git-defaults',
            value: { defaultRef: 'main', defaultComposePath: 'docker-compose.yml' },
          })
        }
        return Promise.resolve({})
      }
    )

    renderCreateDeploymentPage({ entryMode: 'compose' })

    await waitFor(() => {
      expect(getTargetLocationField()).toBeInTheDocument()
    })

    fireEvent.change(getTargetLocationField(), { target: { value: 'srv-1' } })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Need Fix' })).toBeInTheDocument()
    })

    const fixLink = screen.getByRole('link', { name: 'Need Fix' })
    expect(fixLink).toHaveAttribute(
      'href',
      '/resources/servers?server=srv-1&tab=components&focusComponent=docker&focusPanel=checklist&focusSource=compose&focusIssue=compose_missing'
    )
  })
})
