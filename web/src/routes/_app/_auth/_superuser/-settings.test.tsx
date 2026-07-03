import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SETTINGS_ENTRIES_API_PATH,
  SETTINGS_SCHEMA_API_PATH,
  settingsEntryPath,
} from '@/lib/settings-api'
import { SettingsPage } from './settings'

const sendMock = vi.fn()
const listServersMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
  }),
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    to,
    className,
  }: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      create: vi.fn(),
    }),
  },
}))

vi.mock('@/lib/connect-api', () => ({
  listServers: (...args: unknown[]) => listServersMock(...args),
}))

function isSettingsEntriesPath(path: string) {
  return path === SETTINGS_ENTRIES_API_PATH || path.startsWith(`${SETTINGS_ENTRIES_API_PATH}?`)
}

function filterSettingsEntriesForPath<T extends { id: string }>(path: string, items: T[]): T[] {
  if (!isSettingsEntriesPath(path)) {
    return items
  }
  const queryIndex = path.indexOf('?')
  if (queryIndex < 0) {
    return items
  }
  const params = new URLSearchParams(path.slice(queryIndex + 1))
  const idsParam = params.get('ids')
  if (!idsParam) {
    return items
  }
  const allowed = new Set(idsParam.split(',').map(value => value.trim()).filter(Boolean))
  if (allowed.size === 0) {
    return items
  }
  return items.filter(item => allowed.has(item.id))
}

describe('SettingsPage shared settings paths', () => {
  beforeEach(() => {
    sendMock.mockReset()
    listServersMock.mockReset()
    listServersMock.mockResolvedValue([])
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (path === SETTINGS_SCHEMA_API_PATH) {
        return Promise.resolve({
          entries: [
            { id: 'basic', title: 'Basic', section: 'system', source: 'native', fields: [] },
            {
              id: 'smtp',
              title: 'SMTP',
              description:
                'Reference-only entry. Create and manage SMTP services from Resources > External Services.',
              section: 'system',
              source: 'native',
              fields: [],
            },
            { id: 's3', title: 'S3 Storage', section: 'system', source: 'native', fields: [] },
            { id: 'logs', title: 'Logs', section: 'system', source: 'native', fields: [] },
            {
              id: 'monitor-scheduling',
              title: 'Monitor Scheduling',
              section: 'system',
              source: 'custom',
              fields: [
                {
                  id: 'reachabilityIntervalMinutes',
                  label: 'Reachability Interval Minutes',
                  type: 'integer',
                },
              ],
            },
            {
              id: 'monitor-policy',
              title: 'Monitor Policy',
              section: 'system',
              source: 'custom',
              fields: [
                {
                  id: 'metricsFreshnessLookbackSeconds',
                  label: 'Metrics Freshness Lookback Seconds',
                  type: 'integer',
                },
              ],
            },
            {
              id: 'monitor-platform-self-observation',
              title: 'Platform Self-Observation',
              section: 'system',
              source: 'custom',
              fields: [
                {
                  id: 'platformObserverIntervalSeconds',
                  label: 'Platform Observer Interval Seconds',
                  type: 'integer',
                },
                {
                  id: 'platformSchedulerStaleThresholdSeconds',
                  label: 'Platform Scheduler Stale Threshold Seconds',
                  type: 'integer',
                },
                {
                  id: 'enableHostTelemetry',
                  label: 'Enable Host Telemetry',
                  type: 'boolean',
                },
                {
                  id: 'enableContainerTelemetry',
                  label: 'Enable Container Telemetry',
                  type: 'boolean',
                },
              ],
            },
            {
              id: 'monitor-managed-collector-policy',
              title: 'Managed Collector Policy',
              section: 'system',
              source: 'custom',
              fields: [
                {
                  id: 'collectionIntervalSeconds',
                  label: 'Collection Interval Seconds',
                  type: 'integer',
                },
                {
                  id: 'flushIntervalSeconds',
                  label: 'Flush Interval Seconds',
                  type: 'integer',
                },
              ],
            },
            {
              id: 'secrets-policy',
              title: 'Secrets',
              section: 'system',
              source: 'custom',
              fields: [],
            },
            {
              id: 'space-quota',
              title: 'Space Quota',
              section: 'workspace',
              source: 'custom',
              fields: [],
            },
            {
              id: 'connect-terminal',
              title: 'Connect Terminal',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'idleTimeoutSeconds',
                  label: 'Idle Timeout Seconds',
                  type: 'integer',
                  helpText: 'Disconnect idle terminal sessions after this many seconds.',
                },
                {
                  id: 'maxConnections',
                  label: 'Max Connections',
                  type: 'integer',
                  helpText: '0 means unlimited',
                },
              ],
            },
            {
              id: 'connect-sftp',
              title: 'Connect SFTP',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'maxUploadFiles',
                  label: 'Max Upload Files',
                  type: 'integer',
                  helpText: 'Maximum number of files allowed in a single SFTP upload.',
                },
              ],
            },
            {
              id: 'deploy-preflight',
              title: 'Deploy Preflight',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'minFreeDiskGiB',
                  label: 'Minimum Free Disk (GiB)',
                  type: 'number',
                  helpText:
                    'Block deployment when the target keeps less free disk than this buffer.',
                },
              ],
            },
            {
              id: 'deploy-runtime',
              title: 'Deploy Runtime',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'imagePullTimeoutSeconds',
                  label: 'Image Pull Timeout Seconds',
                  type: 'integer',
                },
                {
                  id: 'composeUpTimeoutSeconds',
                  label: 'Compose Up Timeout Seconds',
                  type: 'integer',
                },
                {
                  id: 'healthCheckTimeoutSeconds',
                  label: 'Health Check Timeout Seconds',
                  type: 'integer',
                },
                {
                  id: 'runtimePullIdleHeartbeatSeconds',
                  label: 'Runtime Pull Idle Heartbeat Seconds',
                  type: 'integer',
                },
              ],
            },
            {
              id: 'deploy-git-defaults',
              title: 'Deploy Git Defaults',
              section: 'workspace',
              source: 'custom',
              fields: [
                { id: 'defaultRef', label: 'Default Ref', type: 'string' },
                {
                  id: 'defaultComposePath',
                  label: 'Default Compose Path',
                  type: 'string',
                },
              ],
            },
            {
              id: 'iac-files',
              title: 'IaC Files',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'maxSizeMB',
                  label: 'Max File Size MB',
                  type: 'integer',
                  helpText: 'Maximum size allowed for a single IaC file upload or read.',
                },
                {
                  id: 'maxZipSizeMB',
                  label: 'Max ZIP Size MB',
                  type: 'integer',
                  helpText: 'Maximum size allowed when importing IaC ZIP archives.',
                },
                {
                  id: 'extensionBlacklist',
                  label: 'Extension Blacklist',
                  type: 'string',
                  helpText: 'Comma-separated file extensions blocked in the IaC workspace browser.',
                },
              ],
            },
            {
              id: 'tunnel-port-range',
              title: 'Tunnel',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'start',
                  label: 'Start Port',
                  type: 'integer',
                  helpText: 'Lowest port that can be assigned to a reverse tunnel session.',
                },
                {
                  id: 'end',
                  label: 'End Port',
                  type: 'integer',
                  helpText: 'Highest port that can be assigned to a reverse tunnel session.',
                },
              ],
            },
            {
              id: 'proxy-network',
              title: 'Proxy',
              section: 'workspace',
              source: 'custom',
              fields: [
                { id: 'enabled', label: 'Enable Proxy', type: 'boolean' },
                { id: 'socks5ConnectorId', label: 'SOCKS5 Proxy Service', type: 'relation' },
                { id: 'httpConnectorId', label: 'HTTP Proxy Service', type: 'relation' },
                { id: 'httpsConnectorId', label: 'HTTPS Proxy Service', type: 'relation' },
              ],
            },
            {
              id: 'topic-share',
              title: 'Topic Share',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'shareDefaultMinutes',
                  label: 'Share Default Minutes',
                  type: 'integer',
                },
                {
                  id: 'shareMaxMinutes',
                  label: 'Share Max Minutes',
                  type: 'integer',
                },
              ],
            },
            {
              id: 'topic-comment-policy',
              title: 'Topic Comment Policy',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'allowGuestComments',
                  label: 'Allow Guest Comments',
                  type: 'boolean',
                },
                {
                  id: 'defaultGuestName',
                  label: 'Default Guest Name',
                  type: 'string',
                },
                {
                  id: 'maxGuestNameLength',
                  label: 'Max Guest Name Length',
                  type: 'integer',
                },
                {
                  id: 'maxCommentBodyLength',
                  label: 'Max Comment Body Length',
                  type: 'integer',
                },
              ],
            },
            {
              id: 'topic-import-policy',
              title: 'Topic Description Import',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'maxDescriptionImportKB',
                  label: 'Max Description Import (KB)',
                  type: 'integer',
                },
                {
                  id: 'textOnly',
                  label: 'Text-only Imports',
                  type: 'boolean',
                },
              ],
            },
            {
              id: 'feeds-policy',
              title: 'Feeds',
              section: 'workspace',
              source: 'custom',
              fields: [
                {
                  id: 'pollIntervalHours',
                  label: 'Poll Interval (hours)',
                  type: 'integer',
                },
                {
                  id: 'globalRetentionCap',
                  label: 'Global Retention Cap',
                  type: 'integer',
                },
              ],
            },
            {
              id: 'docker-mirror',
              title: 'Docker Mirrors',
              description: 'Speed up AppOS image pulls. Does not change server Docker settings.',
              section: 'workspace',
              source: 'custom',
              fields: [
                { id: 'mirrors', label: 'Pull Sources', type: 'string-list' },
                {
                  id: 'allowInsecureRegistries',
                  label: 'Allow Insecure Registries',
                  type: 'boolean',
                },
              ],
            },
            {
              id: 'docker-registries',
              title: 'Docker Registries',
              description:
                'Reference-only entry. Create and manage registry services from Resources > External Services.',
              section: 'workspace',
              source: 'custom',
              fields: [],
            },
          ],
          actions: [],
        })
      }
      if (isSettingsEntriesPath(path)) {
        return Promise.resolve({
          items: filterSettingsEntriesForPath(path, [
            { id: 'basic', value: { appName: 'AppOS', appURL: 'https://appos.test' } },
            { id: 'smtp', value: {} },
            {
              id: 's3',
              value: {
                enabled: false,
                bucket: '',
                region: '',
                endpoint: '',
                accessKey: '',
                secret: '',
                forcePathStyle: false,
              },
            },
            { id: 'logs', value: { maxDays: 7, minLevel: 5, logIP: false, logAuthId: false } },
            { id: 'monitor-scheduling', value: { reachabilityIntervalMinutes: 1 } },
            { id: 'monitor-policy', value: { metricsFreshnessLookbackSeconds: 300 } },
            {
              id: 'monitor-platform-self-observation',
              value: {
                platformObserverIntervalSeconds: 30,
                platformSchedulerStaleThresholdSeconds: 10,
                enableHostTelemetry: false,
                enableContainerTelemetry: false,
              },
            },
            {
              id: 'monitor-managed-collector-policy',
              value: {
                collectionIntervalSeconds: 10,
                flushIntervalSeconds: 10,
                metricBatchSize: 1000,
                metricBufferLimit: 5000,
                collectionJitterSeconds: 1,
                flushJitterSeconds: 1,
              },
            },
            {
              id: 'feeds-policy',
              value: {
                pollIntervalHours: 3,
                failureBackoffMaxHours: 24,
                perSourceRetentionCap: 100,
                globalRetentionCap: 10000,
              },
            },
            { id: 'space-quota', value: {} },
            { id: 'topic-share', value: { shareMaxMinutes: 60, shareDefaultMinutes: 30 } },
            {
              id: 'topic-comment-policy',
              value: {
                allowGuestComments: true,
                defaultGuestName: 'Guest',
                maxGuestNameLength: 100,
                maxCommentBodyLength: 10000,
              },
            },
            {
              id: 'topic-import-policy',
              value: {
                maxDescriptionImportKB: 2,
                textOnly: true,
              },
            },
            { id: 'connect-terminal', value: {} },
            { id: 'connect-sftp', value: { maxUploadFiles: 10 } },
            { id: 'deploy-preflight', value: { minFreeDiskGiB: 1 } },
            {
              id: 'deploy-runtime',
              value: {
                imagePullTimeoutSeconds: 180,
                composeUpTimeoutSeconds: 600,
                healthCheckTimeoutSeconds: 120,
                runtimePullIdleHeartbeatSeconds: 20,
              },
            },
            {
              id: 'deploy-git-defaults',
              value: { defaultRef: 'main', defaultComposePath: 'docker-compose.yml' },
            },
            { id: 'iac-files', value: { maxSizeMB: 10, maxZipSizeMB: 50 } },
            { id: 'tunnel-port-range', value: {} },
            { id: 'secrets-policy', value: {} },
            {
              id: 'proxy-network',
              value: {
                enabled: false,
                socks5ConnectorId: '',
                httpConnectorId: '',
                httpsConnectorId: '',
              },
            },
            { id: 'docker-mirror', value: { mirrors: [], allowInsecureRegistries: false } },
            { id: 'docker-registries', value: {} },
          ]),
        })
      }
      if (path === '/api/connectors') {
        return Promise.resolve([])
      }
      if (path === '/api/connectors?kind=proxy') {
        return Promise.resolve([])
      }
      if (path === '/api/connectors/templates') {
        return Promise.resolve([
          {
            id: 'generic-proxy',
            kind: 'proxy',
            title: 'Generic HTTP/HTTPS Proxy',
            description: 'Standard forward proxy with optional basic auth',
            defaultEndpoint: 'http://proxy.example.com:3128',
            fields: [
              { id: 'endpoint', label: 'Endpoint', type: 'url', required: true },
              {
                id: 'protocol',
                label: 'Protocol',
                type: 'select',
                required: true,
                default: 'http',
              },
              {
                id: 'auth_mode',
                label: 'Authentication',
                type: 'select',
                required: true,
                default: 'none',
              },
              {
                id: 'username',
                label: 'Username',
                type: 'text',
                placeholder: 'proxy-user',
              },
              {
                id: 'credential',
                label: 'Credential',
                type: 'secret_ref',
                secretTemplate: 'single_value',
              },
              {
                id: 'no_proxy',
                label: 'No Proxy',
                type: 'text',
                placeholder: 'localhost,127.0.0.1,.svc',
              },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'openai',
            kind: 'llm',
            title: 'OpenAI',
            vendor: 'OpenAI',
            description: 'Hosted OpenAI models',
            defaultEndpoint: 'https://api.openai.com/v1',
            defaultAuthScheme: 'api_key',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              {
                id: 'credential',
                label: 'API Key',
                type: 'secret_ref',
                required: true,
                secretTemplate: 'single_value',
              },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers/defaults' && (!options || options.method === 'GET')) {
        return Promise.resolve({
          items: [
            {
              endpoint: 'https://api.openai.com/v1',
              provider_id: 'provider-1',
            },
          ],
        })
      }
      if (path === '/api/ai-providers/defaults' && options?.method === 'PUT') {
        return Promise.resolve(options.body ?? { items: [] })
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([
          {
            id: 'provider-1',
            created: '2026-06-01T00:00:00Z',
            name: 'Workspace OpenAI',
            kind: 'llm',
            is_default: true,
            template_id: 'openai',
            endpoint: 'https://api.openai.com/v1',
            auth_scheme: 'api_key',
            credential: 'secret-1',
            config: { defaultModel: 'gpt-4.1-mini' },
            description: '',
          },
          {
            id: 'provider-2',
            created: '2026-06-02T00:00:00Z',
            name: 'Backup OpenAI',
            kind: 'llm',
            is_default: false,
            template_id: 'openai',
            endpoint: 'https://api.openai.com/v1',
            auth_scheme: 'api_key',
            credential: 'secret-2',
            config: { defaultModel: 'gpt-4.1-mini' },
            description: '',
          },
        ])
      }
      if (path === '/api/connectors?kind=smtp') {
        return Promise.resolve([
          {
            id: 'smtp-1',
            created: '2026-06-01T00:00:00Z',
            name: 'Primary SMTP',
            kind: 'smtp',
            template_id: 'generic-smtp',
            endpoint: 'smtp://smtp.example.com:587',
            auth_scheme: 'basic',
            credential: 'secret-1',
            config: { username: 'mailer' },
          },
        ])
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value')%26%26(visible_to:length=0||visible_to:each%3F='ai_provider')&sort=name"
      ) {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('loads system and extension settings via shared path helpers', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        SETTINGS_SCHEMA_API_PATH,
        expect.objectContaining({ method: 'GET' })
      )
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/settings\/entries(?:\?|$)/),
        expect.objectContaining({ method: 'GET' })
      )
    })
  })

  it('loads the initial settings section only once without PocketBase auto-cancel', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      const initialSectionCalls = sendMock.mock.calls.filter(
        ([path]) => path === '/api/settings/entries?ids=basic'
      )
      expect(initialSectionCalls).toHaveLength(1)
    })

    expect(sendMock).toHaveBeenCalledWith(SETTINGS_SCHEMA_API_PATH, {
      method: 'GET',
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith('/api/settings/entries?ids=basic', {
      method: 'GET',
      requestKey: null,
    })
  })

  it('shows Tunnel under System below Monitor', async () => {
    const { container } = render(<SettingsPage />)
    let nav: HTMLElement | null = null

    await waitFor(() => {
      nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('Tunnel')).toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/settings\/entries(?:\?|$)/),
        expect.objectContaining({ method: 'GET' })
      )
    })

    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    const navQueries = within(nav)
    const monitorButton = navQueries.getByRole('button', { name: 'Monitor' })
    const tunnelButton = navQueries.getByRole('button', { name: 'Tunnel' })
    expect(
      monitorButton.compareDocumentPosition(tunnelButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText('Help for:')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open Docker Mirrors help' })
    ).not.toBeInTheDocument()
  })

  it('shows one Deploy entry under Workspace and renders all deploy sections', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('Deploy')).toBeInTheDocument()
      expect(navQueries.queryByText('Deploy Preflight')).not.toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/settings\/entries(?:\?|$)/),
        expect.objectContaining({ method: 'GET' })
      )
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }
    within(nav).getByRole('button', { name: 'Deploy' }).click()

    await waitFor(() => {
      expect(screen.getByText('Deploy Preflight')).toBeInTheDocument()
      expect(screen.getByText('Deploy Runtime')).toBeInTheDocument()
      expect(screen.getByText('Deploy Git Defaults')).toBeInTheDocument()
      expect(screen.getByLabelText('Minimum Free Disk (GiB)')).toBeInTheDocument()
      expect(screen.getByLabelText('Image Pull Timeout Seconds')).toBeInTheDocument()
      expect(screen.getByLabelText('Default Ref')).toBeInTheDocument()
    })
  })

  it('saves deploy runtime and git defaults through backend settings entries', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Deploy' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Deploy' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Minimum Free Disk (GiB)')).toBeInTheDocument()
      expect(screen.getByLabelText('Image Pull Timeout Seconds')).toBeInTheDocument()
      expect(screen.getByLabelText('Default Ref')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Minimum Free Disk (GiB)'), {
      target: { value: '1.5' },
    })
    const preflightInput = screen.getByLabelText('Minimum Free Disk (GiB)')
    const preflightCard = preflightInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!preflightCard) {
      throw new Error('expected deploy preflight section box to be rendered')
    }
    fireEvent.click(within(preflightCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('deploy-preflight'), {
        method: 'PATCH',
        body: expect.objectContaining({ minFreeDiskGiB: 1.5 }),
      })
    })

    fireEvent.change(screen.getByLabelText('Image Pull Timeout Seconds'), {
      target: { value: '240' },
    })
    const runtimeInput = screen.getByLabelText('Image Pull Timeout Seconds')
    const runtimeCard = runtimeInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!runtimeCard) {
      throw new Error('expected deploy runtime section box to be rendered')
    }
    fireEvent.click(within(runtimeCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('deploy-runtime'), {
        method: 'PATCH',
        body: expect.objectContaining({ imagePullTimeoutSeconds: 240 }),
      })
    })

    fireEvent.change(screen.getByLabelText('Default Ref'), {
      target: { value: 'release' },
    })
    const gitDefaultsInput = screen.getByLabelText('Default Ref')
    const gitDefaultsCard = gitDefaultsInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!gitDefaultsCard) {
      throw new Error('expected deploy git defaults section box to be rendered')
    }
    fireEvent.click(within(gitDefaultsCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('deploy-git-defaults'), {
        method: 'PATCH',
        body: expect.objectContaining({ defaultRef: 'release' }),
      })
    })
  })

  it('shows IaC Files under Workspace', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('IaC Files')).toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/settings\/entries(?:\?|$)/),
        expect.objectContaining({ method: 'GET' })
      )
    })
  })

  it('shows Secrets under System and renames the app group to Workspace', async () => {
    const { container } = render(<SettingsPage />)
    let nav: HTMLElement | null = null

    await waitFor(() => {
      nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('System')).toBeInTheDocument()
      expect(navQueries.getByText('Workspace')).toBeInTheDocument()
      expect(navQueries.getByText('Monitor')).toBeInTheDocument()
      expect(navQueries.getByText('Secrets')).toBeInTheDocument()
    })

    expect(screen.queryByText('App')).not.toBeInTheDocument()

    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }
    const navQueries = within(nav)
    const secretsButton = navQueries.getByRole('button', { name: 'Secrets' })
    const workspaceHeading = navQueries.getByText('Workspace')
    // DOCUMENT_POSITION_FOLLOWING means workspaceHeading appears *after*
    // secretsButton in DOM order, i.e. Secrets is listed before Workspace.
    expect(
      secretsButton.compareDocumentPosition(workspaceHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders a single monitor page under System with all four editors', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByRole('button', { name: 'Monitor' })).toBeInTheDocument()
      expect(
        navQueries.queryByRole('button', { name: 'Monitor Scheduling' })
      ).not.toBeInTheDocument()
      expect(navQueries.queryByRole('button', { name: 'Monitor Policy' })).not.toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Monitor' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Reachability Interval Minutes')).toBeInTheDocument()
      expect(screen.getByLabelText('Metrics Freshness Lookback Seconds')).toBeInTheDocument()
      expect(screen.getByLabelText('Platform Observer Interval Seconds')).toBeInTheDocument()
      expect(screen.getByLabelText('Collection Interval Seconds')).toBeInTheDocument()
      expect(screen.getByText('Monitor Scheduling')).toBeInTheDocument()
      expect(screen.getByText('Monitor Policy')).toBeInTheDocument()
      expect(screen.getByText('Platform Self-Observation')).toBeInTheDocument()
      expect(screen.getByText('Managed Collector Policy')).toBeInTheDocument()
    })
  })

  it('saves monitor scheduling through the unified settings entry path from the monitor page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Monitor' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Reachability Interval Minutes')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Reachability Interval Minutes'), {
      target: { value: '2' },
    })
    const schedulingInput = screen.getByLabelText('Reachability Interval Minutes')
    const schedulingCard = schedulingInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!schedulingCard) {
      throw new Error('expected monitor scheduling section box to be rendered')
    }
    fireEvent.click(within(schedulingCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('monitor-scheduling'), {
        method: 'PATCH',
        body: expect.objectContaining({
          reachabilityIntervalMinutes: 2,
        }),
      })
    })
  })

  it('saves monitor policy through the unified settings entry path from the monitor page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Monitor' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Metrics Freshness Lookback Seconds')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Metrics Freshness Lookback Seconds'), {
      target: { value: '600' },
    })
    const policyInput = screen.getByLabelText('Metrics Freshness Lookback Seconds')
    const policyCard = policyInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!policyCard) {
      throw new Error('expected monitor policy section box to be rendered')
    }
    fireEvent.click(within(policyCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('monitor-policy'), {
        method: 'PATCH',
        body: expect.objectContaining({
          metricsFreshnessLookbackSeconds: 600,
        }),
      })
    })
  })

  it('saves feeds through the unified settings entry path from the workspace settings page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Feeds' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Feeds' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Poll Interval (hours)')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Poll Interval (hours)'), {
      target: { value: '2' },
    })

    const pollInput = screen.getByLabelText('Poll Interval (hours)')
    const feedsCard = pollInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!feedsCard) {
      throw new Error('expected feeds policy section box to be rendered')
    }
    fireEvent.click(within(feedsCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('feeds-policy'), {
        method: 'PATCH',
        body: expect.objectContaining({
          pollIntervalHours: 2,
        }),
      })
    })
  })

  it('deletes the oldest feed articles from the feeds settings danger zone', async () => {
    const baseImplementation = sendMock.getMockImplementation()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (
        path === SETTINGS_SCHEMA_API_PATH ||
        isSettingsEntriesPath(path) ||
        path === '/api/connectors' ||
        path === '/api/connectors/templates'
      ) {
        if (baseImplementation) {
          return baseImplementation(path, options)
        }
        return Promise.resolve({})
      }
      if (path === '/api/feeds/summary') {
        return Promise.resolve({ totalItems: 12, starredItems: 0, sourceCounts: [] })
      }
      if (path === '/api/feeds/delete') {
        return Promise.resolve({ deleted_count: 3, remaining_count: 9 })
      }
      return Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Feeds' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Feeds' }).click()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete All Articles' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete All Articles' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/summary', { method: 'GET' })
    })

    const countInput = await screen.findByLabelText('Article count')
    fireEvent.change(countInput, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete oldest articles' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/delete', {
        method: 'POST',
        body: { count: 3 },
      })
    })
  })

  it('saves topic comment policy from the aggregated Topics settings page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Topics' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Topics' }).click()

    await waitFor(() => {
      expect(screen.getByText('Topic Share')).toBeInTheDocument()
      expect(screen.getByText('Topic Comment Policy')).toBeInTheDocument()
      expect(screen.getByLabelText('Default Guest Name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Default Guest Name'), {
      target: { value: 'Visitor' },
    })
    fireEvent.click(screen.getByLabelText('Allow Guest Comments'))

    const defaultGuestNameInput = screen.getByLabelText('Default Guest Name')
    const commentPolicyCard = defaultGuestNameInput.closest(
      '.rounded-lg.border'
    ) as HTMLElement | null
    if (!commentPolicyCard) {
      throw new Error('expected topic comment policy section box to be rendered')
    }
    fireEvent.click(within(commentPolicyCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('topic-comment-policy'), {
        method: 'PATCH',
        body: expect.objectContaining({
          allowGuestComments: false,
          defaultGuestName: 'Visitor',
        }),
      })
    })
  })

  it('saves topic share from the aggregated Topics settings page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Topics' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Topics' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Share Default Minutes')).toBeInTheDocument()
      expect(screen.getByLabelText('Share Max Minutes')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Share Default Minutes'), {
      target: { value: '45' },
    })
    fireEvent.change(screen.getByLabelText('Share Max Minutes'), {
      target: { value: '90' },
    })

    const shareInput = screen.getByLabelText('Share Default Minutes')
    const shareCard = shareInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!shareCard) {
      throw new Error('expected topic share section box to be rendered')
    }
    fireEvent.click(within(shareCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('topic-share'), {
        method: 'PATCH',
        body: expect.objectContaining({
          shareDefaultMinutes: 45,
          shareMaxMinutes: 90,
        }),
      })
    })
  })

  it('saves topic import policy from the aggregated Topics settings page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Topics' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Topics' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Max Description Import (KB)')).toBeInTheDocument()
      expect(screen.getByLabelText('Text-only Imports')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Max Description Import (KB)'), {
      target: { value: '2048' },
    })
    fireEvent.click(screen.getByLabelText('Text-only Imports'))

    const importInput = screen.getByLabelText('Max Description Import (KB)')
    const importCard = importInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!importCard) {
      throw new Error('expected topic import policy section box to be rendered')
    }
    fireEvent.click(within(importCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('topic-import-policy'), {
        method: 'PATCH',
        body: expect.objectContaining({
          maxDescriptionImportKB: 2048,
          textOnly: false,
        }),
      })
    })
  })

  it('saves platform self-observation through the unified settings entry path from the monitor page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Monitor' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Platform Observer Interval Seconds')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Platform Observer Interval Seconds'), {
      target: { value: '45' },
    })
    fireEvent.click(screen.getByLabelText('Enable Host Telemetry'))

    const platformInput = screen.getByLabelText('Platform Observer Interval Seconds')
    const platformCard = platformInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!platformCard) {
      throw new Error('expected platform self-observation section box to be rendered')
    }
    fireEvent.click(within(platformCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        settingsEntryPath('monitor-platform-self-observation'),
        {
          method: 'PATCH',
          body: expect.objectContaining({
            platformObserverIntervalSeconds: 45,
            enableHostTelemetry: true,
          }),
        }
      )
    })
  })

  it('saves managed collector policy through the unified settings entry path from the monitor page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Monitor' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Collection Interval Seconds')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Collection Interval Seconds'), {
      target: { value: '15' },
    })

    const collectorInput = screen.getByLabelText('Collection Interval Seconds')
    const collectorCard = collectorInput.closest('.rounded-lg.border') as HTMLElement | null
    if (!collectorCard) {
      throw new Error('expected managed collector policy section box to be rendered')
    }
    fireEvent.click(within(collectorCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('monitor-managed-collector-policy'), {
        method: 'PATCH',
        body: expect.objectContaining({
          collectionIntervalSeconds: 15,
        }),
      })
    })
  })

  it('renders settings navigation in schema order instead of alphabetical title order', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === SETTINGS_SCHEMA_API_PATH) {
        return Promise.resolve({
          entries: [
            { id: 'basic', title: 'Basic', section: 'system', source: 'native', fields: [] },
            {
              id: 'secrets-policy',
              title: 'Secrets',
              section: 'system',
              source: 'custom',
              fields: [],
            },
            { id: 'logs', title: 'Logs', section: 'system', source: 'native', fields: [] },
            {
              id: 'space-quota',
              title: 'Space Quota',
              section: 'workspace',
              source: 'custom',
              fields: [],
            },
          ],
          actions: [],
        })
      }
      if (isSettingsEntriesPath(path)) {
        return Promise.resolve({
          items: filterSettingsEntriesForPath(path, [
            { id: 'basic', value: { appName: 'AppOS', appURL: 'https://appos.test' } },
            { id: 'logs', value: { maxDays: 7, minLevel: 5, logIP: false, logAuthId: false } },
            { id: 'secrets-policy', value: {} },
            { id: 'space-quota', value: {} },
          ]),
        })
      }
      if (path === '/api/connectors') {
        return Promise.resolve([])
      }
      if (path === '/api/connectors/templates') {
        return Promise.resolve([])
      }
      return Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const buttons = within(nav as HTMLElement).getAllByRole('button')
      expect(buttons.map(button => button.textContent)).toEqual([
        'Basic',
        'Secrets',
        'Logs',
        'AI',
        'Space',
      ])
    })
  })

  it('keeps feeds in Workspace after Topics', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const buttons = within(nav as HTMLElement).getAllByRole('button')
      expect(buttons.map(button => button.textContent)).toEqual([
        'Basic',
        'SMTP',
        'S3 Storage',
        'Logs',
        'Monitor',
        'Tunnel',
        'Proxy',
        'Docker',
        'Secrets',
        'AI',
        'Space',
        'Terminal',
        'Deploy',
        'IaC Files',
        'Topics',
        'Feeds',
      ])
    })
  })

  it('renders terminal settings on a single page with terminal and sftp sections', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByRole('button', { name: 'Terminal' })).toBeInTheDocument()
      expect(navQueries.queryByRole('button', { name: 'Connect Terminal' })).not.toBeInTheDocument()
      expect(navQueries.queryByRole('button', { name: 'Connect SFTP' })).not.toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Terminal' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Idle Timeout Seconds')).toBeInTheDocument()
      expect(
        screen.getByText('Disconnect idle terminal sessions after this many seconds.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Max Connections')).toBeInTheDocument()
      expect(screen.getByText('0 means unlimited')).toBeInTheDocument()
      expect(screen.getByLabelText('Max Upload Files')).toBeInTheDocument()
      expect(
        screen.getByText('Maximum number of files allowed in a single SFTP upload.')
      ).toBeInTheDocument()
    })
  })

  it('renders AI settings with provider-grouped account selection', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'AI' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'AI Provider Account' }).click()

    await waitFor(() => {
      expect(screen.getByText('AI Provider Account')).toBeInTheDocument()
      expect(screen.getByText('Provider Name')).toBeInTheDocument()
      expect(screen.getAllByText('Default Account')).toHaveLength(2)
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('https://api.openai.com/v1')).toBeInTheDocument()
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Default Account help' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Open AI Providers' })).toHaveAttribute(
      'href',
      '/resources/ai-providers'
    )
    expect(
      screen.getByRole('option', { name: 'Workspace OpenAI · gpt-4.1-mini' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Backup OpenAI · gpt-4.1-mini' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Save' })[0]).toBeInTheDocument()
    expect(
      screen.queryByText(
        'AppOS uses the earliest created account by default until you choose a different account for this provider.'
      )
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'provider-2' },
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/defaults', {
        method: 'PUT',
        body: {
          items: [
            {
              endpoint: 'https://api.openai.com/v1',
              provider_id: 'provider-2',
            },
          ],
        },
      })
    })
  })

  it('shows AI provider creation guidance when no provider accounts exist', async () => {
    const defaultImpl = sendMock.getMockImplementation()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: any }) => {
      if (path === '/api/ai-providers') {
        return Promise.resolve([])
      }
      return defaultImpl ? defaultImpl(path, options) : Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'AI' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'AI Provider Account' }).click()

    await waitFor(() => {
      expect(screen.getByText('AI Provider Account')).toBeInTheDocument()
      expect(
        screen.getByText(
          'No AI Provider accounts yet. Add one in Resources.'
        )
      ).toBeInTheDocument()
    })

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open AI Providers' })).toHaveAttribute(
      'href',
      '/resources/ai-providers'
    )
  })

  it('shows proxy prerequisites when no external proxy resources exist', async () => {
    const proxyConnectors: Array<{
      id: string
      name: string
      endpoint: string
      config: Record<string, unknown>
    }> = []

    const defaultImpl = sendMock.getMockImplementation()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: any }) => {
      if (path === '/api/connectors?kind=proxy') {
        return Promise.resolve(proxyConnectors)
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=((created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value'))&sort=name"
      ) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/connectors' && options?.method === 'POST') {
        const created = {
          id: 'proxy-1',
          name: String(options.body?.name ?? 'Office Proxy'),
          endpoint: String(options.body?.endpoint ?? 'http://proxy.example.com:3128'),
          config: (options.body?.config as Record<string, unknown>) ?? { protocol: 'http' },
        }
        proxyConnectors.splice(0, proxyConnectors.length, created)
        return Promise.resolve(created)
      }
      if (path === settingsEntryPath('proxy-network') && options?.method === 'PATCH') {
        return Promise.resolve({ value: options.body })
      }
      return defaultImpl ? defaultImpl(path, options) : Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Proxy' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    fireEvent.click(within(nav).getByRole('button', { name: 'Proxy' }))

    await waitFor(() => {
      expect(screen.getByText('Proxy Network')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Open Proxy help' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('External Proxy')).toBeInTheDocument()
      expect(screen.getByText('Built-in Shell Proxy')).toBeInTheDocument()
    })
  })

  it('shows bypass-only remote controls and allows selecting a remote server override', async () => {
    const defaultImpl = sendMock.getMockImplementation()
    sendMock.mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
      if (isSettingsEntriesPath(path)) {
        const response = defaultImpl ? await defaultImpl(path, options) : { items: [] }
        const items = Array.isArray((response as { items?: unknown[] }).items)
          ? [...((response as { items?: unknown[] }).items ?? [])]
          : []
        const upsertEntry = (id: string, value: Record<string, unknown>) => {
          const index = items.findIndex(
            item => typeof item === 'object' && item !== null && (item as { id?: string }).id === id
          )
          const next = { id, value }
          if (index >= 0) {
            items[index] = next
            return
          }
          items.push(next)
        }
        upsertEntry('proxy-network', {
          source: 'self',
          enabled: false,
          socks5ConnectorId: '',
          httpConnectorId: '',
          httpsConnectorId: '',
        })
        upsertEntry('proxy-policies', {
          items: [{ consumerKey: 'remote_shell.global', mode: 'always' }],
          definitions: [
            {
              key: 'remote_shell.global',
              title: 'Remote Shell',
              description: 'Workspace-wide proxy policy for remote server shell and subprocess operations.',
              location: 'remote',
              scope: 'module',
              adapter: 'env',
              trafficClass: 'public_egress',
              support: 'proxy_capable',
              defaultMode: 'always',
              allowedModes: ['disabled', 'always'],
              tags: ['remote', 'servers'],
              enrollable: true,
            },
          ],
        })
        upsertEntry('proxy-remote-shell', { items: [] })
        return { ...(response as Record<string, unknown>), items }
      }
      return defaultImpl ? defaultImpl(path, options) : Promise.resolve({})
    })

    listServersMock.mockResolvedValue([
      { id: 'local', name: 'Local', host: 'local', is_local: true },
      { id: 'srv-1', name: 'Remote One', host: '10.0.0.10' },
      { id: 'srv-2', name: 'Remote Two', host: '10.0.0.11' },
    ])

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    fireEvent.click(within(nav).getByRole('button', { name: 'Proxy' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Manage overrides' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Manage overrides' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Remote Shell overrides' })).toBeInTheDocument()
      expect(screen.getByText('Remote One (10.0.0.10)')).toBeInTheDocument()
      expect(screen.getByText('Remote Two (10.0.0.11)')).toBeInTheDocument()
    })
  })

  it('warns when a saved proxy resource was deleted and blocks save until a valid option is chosen or proxy is disabled', async () => {
    const defaultImpl = sendMock.getMockImplementation()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: any }) => {
      if (isSettingsEntriesPath(path)) {
        return Promise.resolve({
          items: filterSettingsEntriesForPath(path, [
            { id: 'basic', value: { appName: 'AppOS', appURL: 'https://appos.test' } },
            { id: 'smtp', value: {} },
            {
              id: 's3',
              value: {
                enabled: false,
                bucket: '',
                region: '',
                endpoint: '',
                accessKey: '',
                secret: '',
                forcePathStyle: false,
              },
            },
            { id: 'logs', value: { maxDays: 7, minLevel: 5, logIP: false, logAuthId: false } },
            { id: 'monitor-scheduling', value: { reachabilityIntervalMinutes: 1 } },
            { id: 'monitor-policy', value: { metricsFreshnessLookbackSeconds: 300 } },
            {
              id: 'monitor-platform-self-observation',
              value: {
                platformObserverIntervalSeconds: 30,
                platformSchedulerStaleThresholdSeconds: 10,
                enableHostTelemetry: false,
                enableContainerTelemetry: false,
              },
            },
            {
              id: 'monitor-managed-collector-policy',
              value: {
                collectionIntervalSeconds: 10,
                flushIntervalSeconds: 10,
                metricBatchSize: 1000,
                metricBufferLimit: 5000,
                collectionJitterSeconds: 1,
                flushJitterSeconds: 1,
              },
            },
            {
              id: 'feeds-policy',
              value: {
                pollIntervalHours: 3,
                failureBackoffMaxHours: 24,
                perSourceRetentionCap: 100,
                globalRetentionCap: 10000,
              },
            },
            { id: 'space-quota', value: {} },
            { id: 'topic-share', value: { shareMaxMinutes: 60, shareDefaultMinutes: 30 } },
            {
              id: 'topic-comment-policy',
              value: {
                allowGuestComments: true,
                defaultGuestName: 'Guest',
                maxGuestNameLength: 100,
                maxCommentBodyLength: 10000,
              },
            },
            { id: 'topic-import-policy', value: { maxDescriptionImportKB: 2, textOnly: true } },
            { id: 'connect-terminal', value: {} },
            { id: 'connect-sftp', value: { maxUploadFiles: 10 } },
            { id: 'deploy-preflight', value: { minFreeDiskGiB: 1 } },
            {
              id: 'deploy-runtime',
              value: {
                imagePullTimeoutSeconds: 180,
                composeUpTimeoutSeconds: 600,
                healthCheckTimeoutSeconds: 120,
                runtimePullIdleHeartbeatSeconds: 20,
              },
            },
            {
              id: 'deploy-git-defaults',
              value: { defaultRef: 'main', defaultComposePath: 'docker-compose.yml' },
            },
            { id: 'iac-files', value: { maxSizeMB: 10, maxZipSizeMB: 50 } },
            { id: 'tunnel-port-range', value: {} },
            { id: 'secrets-policy', value: {} },
            {
              id: 'proxy-network',
              value: {
                source: 'external',
                enabled: true,
                socks5ConnectorId: 'deleted-proxy',
                httpConnectorId: '',
                httpsConnectorId: '',
              },
            },
            {
              id: 'proxy-policies',
              value: { items: [], definitions: [] },
            },
            {
              id: 'proxy-remote-shell',
              value: { items: [] },
            },
            { id: 'docker-mirror', value: { mirrors: [], allowInsecureRegistries: false } },
            { id: 'docker-registries', value: {} },
          ]),
        })
      }
      if (path === '/api/connectors?kind=proxy') {
        return Promise.resolve([])
      }
      if (path === settingsEntryPath('proxy-network') && options?.method === 'PATCH') {
        return Promise.resolve({ value: options.body })
      }
      return defaultImpl ? defaultImpl(path, options) : Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Proxy' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    fireEvent.click(within(nav).getByRole('button', { name: 'Proxy' }))

    await waitFor(() => {
      expect(screen.getByText('Proxy Network')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(
        screen.getByText(/One or more saved proxy resources were deleted/i)
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => {
      expect(
        screen.getByText(/Select at least one external proxy connector before saving External Proxy/i)
      ).toBeInTheDocument()
    })

    expect(
      sendMock.mock.calls.some(
        ([path, options]) =>
          path === settingsEntryPath('proxy-network') && options?.method === 'PATCH'
      )
    ).toBe(false)
  })

  it('opens proxy help from the registered help aliases', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Proxy' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    fireEvent.click(within(nav).getByRole('button', { name: 'Proxy' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Proxy help' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Proxy help' }))

    await waitFor(() => {
      expect(screen.getByText('Help for:')).toBeInTheDocument()
      expect(
        screen.getByText(
          'SOCKS5 overrides all outbound traffic; otherwise HTTP and HTTPS can be assigned independently.'
        )
      ).toBeInTheDocument()
    })
  })

  it('shows smtp connector details and keeps Docker focused on mirrors only', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'SMTP' })).toBeInTheDocument()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Docker' })).toBeInTheDocument()
      expect(
        within(nav as HTMLElement).queryByRole('button', { name: 'Docker Mirrors' })
      ).not.toBeInTheDocument()
      expect(
        within(nav as HTMLElement).queryByRole('button', { name: 'Docker Registries' })
      ).not.toBeInTheDocument()
    })

    let nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'SMTP' }).click()

    await waitFor(() => {
      expect(screen.getByText('Primary SMTP')).toBeInTheDocument()
      expect(screen.getByText('smtp://smtp.example.com:587')).toBeInTheDocument()
      expect(screen.getByText('mailer')).toBeInTheDocument()
      expect(screen.queryByLabelText('SMTP Service')).not.toBeInTheDocument()
      expect(screen.queryByText(/This section now references external services/i)).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Add SMTP Service' })).toHaveAttribute(
        'href',
        '/resources/connectors'
      )
    })

    nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Docker' }).click()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Docker Mirrors help' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Allow Insecure Registries help' })).toBeInTheDocument()
    })

    expect(
      screen.queryByText(
        'Allow AppOS to pull from insecure registries when a mirror or upstream endpoint requires it.'
      )
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Docker Mirrors help' }))

    await waitFor(() => {
      expect(screen.getByText('Help for:')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Configure AppOS image pull acceleration for deployment and update workflows.'
        )
      ).toBeInTheDocument()
      expect(screen.getByText('Docker Mirrors')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Speeds up AppOS image pulls during deployment and update. Does not change server Docker settings.'
        )
      ).toBeInTheDocument()
      expect(screen.getByText('Pull Sources')).toBeInTheDocument()
      expect(screen.getByLabelText('Allow Insecure Registries')).toBeInTheDocument()
      expect(screen.queryByText('Docker Registries')).not.toBeInTheDocument()
      expect(screen.queryByText(/registry connectors/i)).not.toBeInTheDocument()
    })
  })

  it('shows smtp creation guidance when no smtp services exist', async () => {
    const defaultImpl = sendMock.getMockImplementation()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: any }) => {
      if (path === '/api/connectors?kind=smtp') {
        return Promise.resolve([])
      }
      return defaultImpl ? defaultImpl(path, options) : Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'SMTP' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'SMTP' }).click()

    await waitFor(() => {
      expect(
        screen.getByText(
          'No SMTP services are available yet. Create one in Resources so AppOS can use it for outbound email delivery.'
        )
      ).toBeInTheDocument()
    })

    expect(screen.queryByLabelText('SMTP Service')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add SMTP Service' })).toHaveAttribute(
      'href',
      '/resources/connectors'
    )
  })

  it('shows smtp selector when multiple smtp services exist and defaults to earliest created', async () => {
    const defaultImpl = sendMock.getMockImplementation()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: any }) => {
      if (path === '/api/connectors?kind=smtp') {
        return Promise.resolve([
          {
            id: 'smtp-2',
            created: '2026-06-02T00:00:00Z',
            name: 'Backup SMTP',
            kind: 'smtp',
            template_id: 'generic-smtp',
            endpoint: 'smtp://backup.example.com:587',
            auth_scheme: 'basic',
            config: { username: 'backup-user' },
          },
          {
            id: 'smtp-1',
            created: '2026-06-01T00:00:00Z',
            name: 'Primary SMTP',
            kind: 'smtp',
            template_id: 'generic-smtp',
            endpoint: 'smtp://smtp.example.com:587',
            auth_scheme: 'basic',
            config: { username: 'mailer' },
          },
        ])
      }
      return defaultImpl ? defaultImpl(path, options) : Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'SMTP' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'SMTP' }).click()

    const selector = await screen.findByLabelText('SMTP Service')
    expect(selector).toHaveValue('smtp-1')
    expect(screen.getByText('Primary SMTP')).toBeInTheDocument()
    expect(screen.getByText('smtp://smtp.example.com:587')).toBeInTheDocument()

    fireEvent.change(selector, { target: { value: 'smtp-2' } })

    await waitFor(() => {
      expect(screen.getByText('Backup SMTP')).toBeInTheDocument()
      expect(screen.getByText('smtp://backup.example.com:587')).toBeInTheDocument()
      expect(screen.getByText('backup-user')).toBeInTheDocument()
    })
  })

  it('reorders pull sources in Docker Mirrors by drag and drop', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === SETTINGS_SCHEMA_API_PATH) {
        return Promise.resolve({
          entries: [
            { id: 'basic', title: 'Basic', section: 'system', source: 'native', fields: [] },
            {
              id: 'monitor-scheduling',
              title: 'Monitor Scheduling',
              section: 'system',
              source: 'custom',
              fields: [],
            },
            {
              id: 'docker-mirror',
              title: 'Docker Mirrors',
              description: 'Speed up AppOS image pulls. Does not change server Docker settings.',
              section: 'workspace',
              source: 'custom',
              fields: [
                { id: 'mirrors', label: 'Pull Sources', type: 'string-list' },
                {
                  id: 'allowInsecureRegistries',
                  label: 'Allow Insecure Registries',
                  type: 'boolean',
                },
              ],
            },
            {
              id: 'docker-registries',
              title: 'Docker Registries',
              description:
                'Reference-only entry. Create and manage registry services from Resources > External Services.',
              section: 'workspace',
              source: 'custom',
              fields: [],
            },
          ],
          actions: [],
        })
      }
      if (isSettingsEntriesPath(path)) {
        return Promise.resolve({
          items: filterSettingsEntriesForPath(path, [
            { id: 'basic', value: { appName: 'AppOS', appURL: 'https://appos.test' } },
            {
              id: 'docker-mirror',
              value: {
                mirrors: ['https://mirror-b.example.com', 'https://mirror-a.example.com'],
                allowInsecureRegistries: false,
              },
            },
            { id: 'docker-registries', value: {} },
          ]),
        })
      }
      return Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Docker' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    fireEvent.click(within(nav).getByRole('button', { name: 'Docker' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://mirror-b.example.com')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://mirror-a.example.com')).toBeInTheDocument()
    })

    const dragHandle = screen.getByLabelText('Drag pull source 1')
    const dropRow = screen.getByLabelText('Drag pull source 2').closest('div')
    if (!dropRow) {
      throw new Error('expected draggable row to be rendered')
    }

    fireEvent.dragStart(dragHandle)
    fireEvent.dragOver(dropRow)
    fireEvent.drop(dropRow)

    const inputs = screen.getAllByPlaceholderText(
      'https://mirror.example.com'
    ) as HTMLInputElement[]
    expect(inputs.map(input => input.value)).toEqual([
      'https://mirror-a.example.com',
      'https://mirror-b.example.com',
    ])
  })

  it('renders IaC file fields from schema metadata', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'IaC Files' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'IaC Files' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Max File Size MB')).toBeInTheDocument()
      expect(
        screen.getByText('Maximum size allowed for a single IaC file upload or read.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Extension Blacklist')).toBeInTheDocument()
      expect(
        screen.getByText('Comma-separated file extensions blocked in the IaC workspace browser.')
      ).toBeInTheDocument()
    })
  })

  it('renders tunnel fields from schema metadata', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Tunnel' })).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Tunnel' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Start Port')).toBeInTheDocument()
      expect(
        screen.getByText('Lowest port that can be assigned to a reverse tunnel session.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('End Port')).toBeInTheDocument()
      expect(
        screen.getByText('Highest port that can be assigned to a reverse tunnel session.')
      ).toBeInTheDocument()
    })
  })

  it('falls back to the screen placeholder for unregistered sections', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === SETTINGS_SCHEMA_API_PATH) {
        return Promise.resolve({
          entries: [
            { id: 'basic', title: 'Basic', section: 'system', source: 'native', fields: [] },
            {
              id: 'custom-unmapped',
              title: 'Custom Unmapped',
              description: 'An unregistered settings page used to verify screen fallback behavior.',
              section: 'workspace',
              source: 'custom',
              fields: [],
            },
          ],
          actions: [],
        })
      }
      if (isSettingsEntriesPath(path)) {
        return Promise.resolve({
          items: filterSettingsEntriesForPath(path, [
            { id: 'basic', value: { appName: 'AppOS', appURL: 'https://appos.test' } },
            { id: 'custom-unmapped', value: {} },
          ]),
        })
      }
      return Promise.resolve({})
    })

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Custom Unmapped' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    fireEvent.click(within(nav).getByRole('button', { name: 'Custom Unmapped' }))

    await waitFor(() => {
      expect(screen.getByText('No editor available for this entry.')).toBeInTheDocument()
    })
  })

  it('toggles a proxy consumer off and saves the updated enrollment list', async () => {
    const defaultImpl = sendMock.getMockImplementation()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: any }) => {
      if (isSettingsEntriesPath(path)) {
        return defaultImpl
          ? defaultImpl(path, options).then((res: { items: any[] }) => {
              const items = Array.isArray(res?.items) ? [...res.items] : []
              const upsertEntry = (id: string, value: Record<string, unknown>) => {
                const idx = items.findIndex(
                  i => typeof i === 'object' && i !== null && (i as { id?: string }).id === id
                )
                const next = { id, value }
                if (idx >= 0) { items[idx] = next; return }
                items.push(next)
              }
              upsertEntry('proxy-network', {
                source: 'external',
                enabled: true,
                socks5ConnectorId: 'proxy-1',
                httpConnectorId: '',
                httpsConnectorId: '',
              })
              upsertEntry('proxy-policies', {
                items: [
                  { consumerKey: 'outbound_http.global', mode: 'always' },
                  { consumerKey: 'git.global', mode: 'always' },
                  { consumerKey: 'remote_shell.global', mode: 'always' },
                ],
                definitions: [
                  { key: 'outbound_http.global', title: 'Outbound HTTP', description: 'AppOS web APIs', enrollable: true, allowedModes: ['disabled', 'always'], defaultMode: 'always' },
                  { key: 'git.global', title: 'Git', description: 'Git clone and fetch', enrollable: true, allowedModes: ['disabled', 'always'], defaultMode: 'always' },
                  { key: 'remote_shell.global', title: 'Remote Shell', description: 'Remote shell commands', enrollable: true, allowedModes: ['disabled', 'always'], defaultMode: 'always' },
                ],
              })
              upsertEntry('proxy-remote-shell', { items: [] })
              return { ...(res as Record<string, unknown>), items }
            })
          : Promise.resolve({ items: [] })
      }
      if (path === '/api/connectors?kind=proxy') {
        return Promise.resolve([{ id: 'proxy-1', name: 'Office Proxy' }])
      }
      if (path === settingsEntryPath('proxy-policies') && options?.method === 'PATCH') {
        return Promise.resolve({ items: options.body?.items ?? [] })
      }
      return defaultImpl ? defaultImpl(path, options) : Promise.resolve({})
    })

    listServersMock.mockResolvedValue([])

    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Proxy' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    fireEvent.click(within(nav).getByRole('button', { name: 'Proxy' }))

    // Find the "Outbound HTTP" consumer toggle
    await waitFor(() => {
      expect(screen.getByText('Outbound HTTP')).toBeInTheDocument()
    })

    const outboundToggle = screen.getByRole('switch', { name: 'Toggle Outbound HTTP proxy usage' })
    expect(outboundToggle).toBeInTheDocument()

    // Disable the consumer
    fireEvent.click(outboundToggle)

    // Click the Save button in the consumers section
    const saveButtons = screen.getAllByRole('button', { name: 'Save' })
    fireEvent.click(saveButtons[saveButtons.length - 1])

    await waitFor(() => {
      const patchCall = sendMock.mock.calls.find(
        (callArgs: unknown[]) => {
          const callPath = (callArgs as [string, { method?: string | undefined; body?: Record<string, unknown> | undefined }])[0]
          const callOpts = (callArgs as [string, { method?: string | undefined; body?: Record<string, unknown> | undefined }])[1]
          return callPath === settingsEntryPath('proxy-policies') && callOpts?.method === 'PATCH'
        }
      )
      expect(patchCall).toBeTruthy()
      const callOpts = (patchCall as unknown as [string, { body: Record<string, unknown> }])[1]
      const items = (callOpts.body.items ?? []) as Array<{ consumerKey: string; mode: string }>
      const outboundItem = items.find(item => item.consumerKey === 'outbound_http.global')
      expect(outboundItem).toBeTruthy()
      expect(outboundItem!.mode).toBe('disabled')
    })
  })
})
