import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_ENTRIES_API_PATH, SETTINGS_SCHEMA_API_PATH } from '@/lib/settings-api'
import { SettingsPage } from './settings'

const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
  }),
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
            { id: 'basic', title: 'Basic', section: 'system', source: 'pocketbase', fields: [] },
            { id: 'smtp', title: 'SMTP', section: 'system', source: 'pocketbase', fields: [] },
            { id: 's3', title: 'S3 Storage', section: 'system', source: 'pocketbase', fields: [] },
            { id: 'logs', title: 'Logs', section: 'system', source: 'pocketbase', fields: [] },
            {
              id: 'secrets-policy',
              title: 'Secrets',
              section: 'system',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'space-quota',
              title: 'Space Quota',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'connect-terminal',
              title: 'Connect Terminal',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'deploy-preflight',
              title: 'Deploy Preflight',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'iac-files',
              title: 'IaC Files',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'tunnel-port-range',
              title: 'Tunnel',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'proxy-network',
              title: 'Proxy',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'docker-mirror',
              title: 'Docker Mirrors',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'docker-registries',
              title: 'Docker Registries',
              section: 'workspace',
              source: 'app_settings',
              fields: [],
            },
            {
              id: 'llm-providers',
              title: 'LLM Providers',
              section: 'workspace',
              source: 'app_settings',
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
              id: 'smtp',
              value: {
                enabled: false,
                host: '',
                port: 25,
                username: '',
                password: '',
                authMethod: '',
                tls: false,
                localName: '',
              },
            },
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
            { id: 'space-quota', value: {} },
            { id: 'connect-terminal', value: {} },
            { id: 'deploy-preflight', value: { minFreeDiskBytes: 536870912 } },
            { id: 'iac-files', value: { maxSizeMB: 10, maxZipSizeMB: 50 } },
            { id: 'tunnel-port-range', value: {} },
            { id: 'secrets-policy', value: {} },
            { id: 'proxy-network', value: {} },
            { id: 'docker-mirror', value: {} },
            { id: 'docker-registries', value: { items: [] } },
            { id: 'llm-providers', value: { items: [] } },
          ],
        })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads system and extension settings via shared path helpers', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_SCHEMA_API_PATH, { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_ENTRIES_API_PATH, { method: 'GET' })
    })
  })

  it('shows Tunnel under Workspace', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('Tunnel')).toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_ENTRIES_API_PATH, { method: 'GET' })
    })
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
})
