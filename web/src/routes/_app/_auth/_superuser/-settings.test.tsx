import { render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_ENTRIES_API_PATH, SETTINGS_SCHEMA_API_PATH } from '@/lib/settings-api'
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
              fields: [],
            },
            {
              id: 'docker-mirror',
              title: 'Docker Mirrors',
              section: 'workspace',
              source: 'custom',
              fields: [],
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
            { id: 'space-quota', value: {} },
            { id: 'connect-terminal', value: {} },
            { id: 'connect-sftp', value: { maxUploadFiles: 10 } },
            { id: 'deploy-preflight', value: { minFreeDiskBytes: 536870912 } },
            { id: 'iac-files', value: { maxSizeMB: 10, maxZipSizeMB: 50 } },
            { id: 'tunnel-port-range', value: {} },
            { id: 'secrets-policy', value: {} },
            { id: 'proxy-network', value: {} },
            { id: 'docker-mirror', value: {} },
            { id: 'docker-registries', value: {} },
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
        'Space Quota',
        'LLM Providers',
      ])
    })
  })

  it('renders simple connect terminal fields from schema metadata', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Connect Terminal' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'Connect Terminal' }).click()

    await waitFor(() => {
      expect(screen.getByLabelText('Idle Timeout Seconds')).toBeInTheDocument()
      expect(
        screen.getByText('Disconnect idle terminal sessions after this many seconds.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Max Connections')).toBeInTheDocument()
      expect(screen.getByText('0 means unlimited')).toBeInTheDocument()
    })
  })

  it('shows connector reference card for llm providers', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'LLM Providers' })
      ).toBeInTheDocument()
    })

    const nav = container.querySelector('nav') as HTMLElement | null
    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }

    within(nav).getByRole('button', { name: 'LLM Providers' }).click()

    await waitFor(() => {
      expect(
        screen.getByText(/This section now references AI provider records\. Create and edit AI Providers/i)
      ).toBeInTheDocument()
    })

    expect(screen.getByRole('link', { name: 'Open AI Providers' })).toHaveAttribute(
      'href',
      '/resources/ai-providers'
    )
  })

  it('shows connector reference cards for smtp and docker registries', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      expect(within(nav as HTMLElement).getByRole('button', { name: 'SMTP' })).toBeInTheDocument()
      expect(
        within(nav as HTMLElement).getByRole('button', { name: 'Docker Registries' })
      ).toBeInTheDocument()
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

    within(nav).getByRole('button', { name: 'Docker Registries' }).click()

    await waitFor(() => {
      expect(
        screen.getByText(
          /This section now references connectors\. Create and edit registry connectors/i
        )
      ).toBeInTheDocument()
    })
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
