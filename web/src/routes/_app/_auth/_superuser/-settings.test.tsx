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

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
  }),
  Link: ({
    to,
    children,
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

describe('SettingsPage shared settings paths', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === SETTINGS_SCHEMA_API_PATH) {
        return Promise.resolve({
          entries: [
            { id: 'basic', title: 'Basic', section: 'system', source: 'native', fields: [] },
            {
              id: 'smtp',
              title: 'SMTP',
              description:
                'Reference-only entry. Create and manage SMTP connectors from Resources > Connectors.',
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
                  id: 'minFreeDiskBytes',
                  label: 'Min Free Disk Bytes',
                  type: 'integer',
                  helpText: 'Block installation when available disk falls below this threshold.',
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
                { id: 'httpConnectorId', label: 'HTTP Proxy Connector', type: 'relation' },
                { id: 'httpsConnectorId', label: 'HTTPS Proxy Connector', type: 'relation' },
              ],
            },
            {
              id: 'docker-mirror',
              title: 'Docker Mirrors',
              description:
                'Speed up AppOS image pulls. Does not change server Docker settings.',
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
                'Reference-only entry. Create and manage registry connectors from Resources > Connectors.',
              section: 'workspace',
              source: 'custom',
              fields: [],
            },
          ],
          actions: [],
        })
      }
      if (path === SETTINGS_ENTRIES_API_PATH) {
        return Promise.resolve({
          items: [
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
            { id: 'space-quota', value: {} },
            { id: 'connect-terminal', value: {} },
            { id: 'connect-sftp', value: { maxUploadFiles: 10 } },
            { id: 'deploy-preflight', value: { minFreeDiskBytes: 536870912 } },
            { id: 'iac-files', value: { maxSizeMB: 10, maxZipSizeMB: 50 } },
            { id: 'tunnel-port-range', value: {} },
            { id: 'secrets-policy', value: {} },
            {
              id: 'proxy-network',
              value: { enabled: false, httpConnectorId: '', httpsConnectorId: '' },
            },
            { id: 'docker-mirror', value: { mirrors: [], allowInsecureRegistries: false } },
            { id: 'docker-registries', value: {} },
          ],
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
      if (path === '/api/ai-providers') {
        return Promise.resolve([
          {
            id: 'provider-1',
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
        ])
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=((created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value'))&sort=name"
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
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_SCHEMA_API_PATH, { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_ENTRIES_API_PATH, { method: 'GET' })
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
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_ENTRIES_API_PATH, { method: 'GET' })
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
    expect(screen.queryByRole('button', { name: 'Open Docker Mirrors help' })).not.toBeInTheDocument()
  })

  it('shows Deploy Preflight under Workspace', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('Deploy Preflight')).toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_ENTRIES_API_PATH, { method: 'GET' })
    })
  })

  it('shows IaC Files under Workspace', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('IaC Files')).toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_ENTRIES_API_PATH, { method: 'GET' })
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
      expect(navQueries.queryByRole('button', { name: 'Monitor Scheduling' })).not.toBeInTheDocument()
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
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })).toBeInTheDocument()
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
    const schedulingCard = schedulingInput.closest('[data-slot="card"]') as HTMLElement | null
    if (!schedulingCard) {
      throw new Error('expected monitor scheduling card to be rendered')
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
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })).toBeInTheDocument()
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
    const policyCard = policyInput.closest('[data-slot="card"]') as HTMLElement | null
    if (!policyCard) {
      throw new Error('expected monitor policy card to be rendered')
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

  it('saves platform self-observation through the unified settings entry path from the monitor page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })).toBeInTheDocument()
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
    const platformCard = platformInput.closest('[data-slot="card"]') as HTMLElement | null
    if (!platformCard) {
      throw new Error('expected platform self-observation card to be rendered')
    }
    fireEvent.click(within(platformCard).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('monitor-platform-self-observation'), {
        method: 'PATCH',
        body: expect.objectContaining({
          platformObserverIntervalSeconds: 45,
          enableHostTelemetry: true,
        }),
      })
    })
  })

  it('saves managed collector policy through the unified settings entry path from the monitor page', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'Monitor' })).toBeInTheDocument()
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
    const collectorCard = collectorInput.closest('[data-slot="card"]') as HTMLElement | null
    if (!collectorCard) {
      throw new Error('expected managed collector policy card to be rendered')
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
      if (path === SETTINGS_ENTRIES_API_PATH) {
        return Promise.resolve({
          items: [
            { id: 'basic', value: { appName: 'AppOS', appURL: 'https://appos.test' } },
            { id: 'logs', value: { maxDays: 7, minLevel: 5, logIP: false, logAuthId: false } },
            { id: 'secrets-policy', value: {} },
            { id: 'space-quota', value: {} },
          ],
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

  it('moves tunnel, proxy, and docker into System below Monitor', async () => {
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
        'Deploy Preflight',
        'IaC Files',
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

  it('renders AI settings with default model selection and in-page create action', async () => {
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

    within(nav).getByRole('button', { name: 'AI' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Default Model')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Default Model' })).toBeInTheDocument()
    })

    expect(screen.getByRole('option', { name: 'Workspace OpenAI / OpenAI / gpt-4.1-mini' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '+ Add a new model...' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open AI Providers' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Default Model' }), {
      target: { value: '__add_model__' },
    })

    await waitFor(() => {
      expect(screen.getByText('Choose a Product')).toBeInTheDocument()
    })
  })

  it('creates and saves a proxy connector from the Proxy settings page', async () => {
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
      expect(screen.getByLabelText('Enable Proxy')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Open Proxy help' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(screen.getByText(/Use the Add option in either selector/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add HTTP Proxy' })).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('HTTP Proxy'), {
      target: { value: '__add_http_proxy__' },
    })

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      const profile = within(dialog).getByLabelText(/^Profile/) as HTMLSelectElement
      expect(profile.options.length).toBeGreaterThan(1)
    })

    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Office Proxy' },
    })
    fireEvent.change(await within(dialog).findByLabelText(/Endpoint/i), {
      target: { value: 'proxy.example.com:3128' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Proxy Connector' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/connectors', {
        method: 'POST',
        body: expect.objectContaining({
          name: 'Office Proxy',
          kind: 'proxy',
          endpoint: 'http://proxy.example.com:3128',
        }),
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('proxy-network'), {
        method: 'PATCH',
        body: {
          enabled: true,
          httpConnectorId: 'proxy-1',
          httpsConnectorId: '',
        },
      })
    })
  })

  it('shows smtp connector reference and keeps Docker focused on mirrors only', async () => {
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
      expect(
        screen.getByText(
          /This section now references connectors\. Create and edit SMTP connectors/i
        )
      ).toBeInTheDocument()
      const links = screen.getAllByRole('link', { name: 'Open Connectors' })
      expect(links[0]).toHaveAttribute('href', '/resources/connectors')
    })

    nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Docker' }).click()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Docker Mirrors help' })).toBeInTheDocument()
    })

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
              description:
                'Speed up AppOS image pulls. Does not change server Docker settings.',
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
                'Reference-only entry. Create and manage registry connectors from Resources > Connectors.',
              section: 'workspace',
              source: 'custom',
              fields: [],
            },
          ],
          actions: [],
        })
      }
      if (path === SETTINGS_ENTRIES_API_PATH) {
        return Promise.resolve({
          items: [
            { id: 'basic', value: { appName: 'AppOS', appURL: 'https://appos.test' } },
            {
              id: 'docker-mirror',
              value: {
                mirrors: ['https://mirror-b.example.com', 'https://mirror-a.example.com'],
                allowInsecureRegistries: false,
              },
            },
            { id: 'docker-registries', value: {} },
          ],
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

    const inputs = screen.getAllByPlaceholderText('https://mirror.example.com') as HTMLInputElement[]
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
})
