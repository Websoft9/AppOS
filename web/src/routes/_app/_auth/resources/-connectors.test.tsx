import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsPage } from './connectors'

const sendMock = vi.fn()
const getOneMock = vi.fn()
const createMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: unknown }) =>
      component,
  useNavigate: () => navigateMock,
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'hub.title': 'Resources',
        'connectors.page.title': 'Connectors',
        'connectors.page.description': 'Reusable API, webhook, MCP, proxy, SMTP, registry, and DNS connectors backed by grouped connector profiles',
        'connectors.page.addConnector': 'Add Connector',
        'connectors.page.searchPlaceholder': 'Search connectors',
        'connectors.fields.name': 'Name',
        'connectors.fields.profile': 'Profile',
        'connectors.fields.description': 'Description',
        'connectors.fields.advancedConfig': 'Advanced Config (JSON)',
        'connectors.fields.groups': 'Groups',
        'connectors.placeholders.name': 'my-connector',
        'connectors.placeholders.advancedConfig': '{"headers": {"X-Custom": "value"}}',
        'connectors.columns.name': 'Name',
        'connectors.columns.default': 'Default',
        'connectors.columns.kind': 'Kind',
        'connectors.columns.profile': 'Profile',
        'connectors.columns.url': 'URL',
        'connectors.columns.auth': 'Auth',
        'connectors.badges.default': 'Default',
        'connectors.kinds.rest_api': 'REST API',
        'connectors.kinds.webhook': 'Webhook',
        'connectors.kinds.mcp': 'MCP',
        'connectors.kinds.proxy': 'Proxy',
        'connectors.kinds.smtp': 'SMTP',
        'connectors.kinds.registry': 'Registry',
        'connectors.kinds.dns': 'DNS',
        'connectors.auth.none': 'No authentication',
        'connectors.auth.usernamePassword': 'Username + Password',
        'connectors.auth.noneValue': 'none',
        'connectors.authValues.none': 'none',
        'connectors.authValues.basic': 'basic',
        'connectors.authValues.bearer': 'bearer',
        'connectors.secret.new': 'New Secret',
        'connectors.secret.edit': 'Edit Secret',
        'connectors.secret.newTitle': 'New Secret',
        'connectors.secret.newDescription': 'Create a reusable secret and attach it to this connector.',
        'connectors.secretTemplates.single_value': 'Token / Single Value',
        'connectors.errors.profileRequired': 'Connector profile is required'
      }
      if (key === 'connectors.page.totalItems') {
        return `Total ${String(options?.count ?? '')} items`
      }
      return labels[key] ?? key
    },
  }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      getOne: (...args: unknown[]) => getOneMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    }),
  },
}))

describe('ConnectorsPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getOneMock.mockReset()
    createMock.mockReset()
    navigateMock.mockReset()

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/secrets/templates') {
        return Promise.resolve([{ id: 'single_value', label: 'Single Value' }])
      }
      if (path === '/api/connectors/templates') {
        return Promise.resolve([
          {
            id: 'generic-rest',
            kind: 'rest_api',
            title: 'Generic REST API',
            fields: [{ id: 'endpoint', label: 'Base URL', type: 'url', required: true }],
          },
          {
            id: 'generic-webhook',
            kind: 'webhook',
            title: 'Generic Webhook',
            fields: [{ id: 'endpoint', label: 'Webhook URL', type: 'url', required: true }],
          },
          {
            id: 'generic-mcp',
            kind: 'mcp',
            title: 'Generic MCP',
            fields: [{ id: 'endpoint', label: 'Server URL', type: 'url', required: true }],
          },
          {
            id: 'http-proxy',
            kind: 'proxy',
            title: 'HTTP Proxy',
            defaultEndpoint: 'http://proxy.example.com:8080',
            fields: [
              { id: 'endpoint', label: 'Proxy Endpoint', type: 'url', required: true },
              {
                id: 'auth_mode',
                label: 'Authentication',
                type: 'string',
                required: true,
                default: 'none',
              },
              { id: 'username', label: 'Username', type: 'string' },
              {
                id: 'credential',
                label: 'Password Secret',
                type: 'secret_ref',
                secretTemplate: 'single_value',
              },
              { id: 'no_proxy', label: 'Bypass Hosts', type: 'string' },
            ],
          },
          {
            id: 'socks5-proxy',
            kind: 'proxy',
            title: 'SOCKS5 Proxy',
            defaultEndpoint: 'socks5://proxy.example.com:1080',
            fields: [
              { id: 'endpoint', label: 'Proxy Endpoint', type: 'url', required: true },
              {
                id: 'auth_mode',
                label: 'Authentication',
                type: 'string',
                required: true,
                default: 'none',
              },
              { id: 'username', label: 'Username', type: 'string' },
              {
                id: 'credential',
                label: 'Password Secret',
                type: 'secret_ref',
                secretTemplate: 'single_value',
              },
              { id: 'no_proxy', label: 'Bypass Hosts', type: 'string' },
            ],
          },
          {
            id: 'generic-smtp',
            kind: 'smtp',
            title: 'Generic SMTP',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'SMTP Endpoint', type: 'string', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              {
                id: 'credential',
                label: 'Password Secret',
                type: 'secret_ref',
                required: true,
                secretTemplate: 'single_value',
              },
            ],
          },
          {
            id: 'ses-smtp',
            kind: 'smtp',
            title: 'Amazon SES SMTP',
            defaultEndpoint: 'smtp://email-smtp.us-east-1.amazonaws.com:587',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'SMTP Endpoint', type: 'string', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              {
                id: 'credential',
                label: 'Password Secret',
                type: 'secret_ref',
                required: true,
                secretTemplate: 'single_value',
              },
              { id: 'region', label: 'AWS Region', type: 'string', placeholder: 'us-east-1' },
            ],
          },
          {
            id: 'generic-registry',
            kind: 'registry',
            title: 'Generic OCI Registry',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'Registry URL', type: 'url', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              {
                id: 'credential',
                label: 'Password Secret',
                type: 'secret_ref',
                required: true,
                secretTemplate: 'single_value',
              },
            ],
          },
          {
            id: 'ghcr',
            kind: 'registry',
            title: 'GitHub Container Registry',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'Registry URL', type: 'url', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              {
                id: 'credential',
                label: 'Password Secret',
                type: 'secret_ref',
                required: true,
                secretTemplate: 'single_value',
              },
            ],
          },
          {
            id: 'generic-dns',
            kind: 'dns',
            title: 'Generic DNS Provider',
            fields: [{ id: 'endpoint', label: 'API Endpoint', type: 'url', required: true }],
          },
          {
            id: 'cloudflare-dns',
            kind: 'dns',
            title: 'Cloudflare DNS',
            fields: [{ id: 'endpoint', label: 'API Endpoint', type: 'url', required: true }],
          },
        ])
      }
      if (path === '/api/connectors?kind=rest_api,webhook,mcp,proxy,smtp,registry,dns') {
        return Promise.resolve([])
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value')%26%26(visible_to:length=0||visible_to%3F='connector')&sort=name"
      ) {
        return Promise.resolve({
          items: [{ id: 'secret-1', name: 'smtp-password', template_id: 'single_value' }],
        })
      }
      return Promise.resolve({ items: [] })
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders connector profile options grouped by kind in the create dialog', async () => {
    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/connectors/templates', { method: 'GET' })
      expect(screen.getByRole('button', { name: 'Add Connector' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Connector' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Runtime Default')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Add Connector' })).toBeInTheDocument()
    const nameInput = within(dialog).getByLabelText(/^Name/) as HTMLInputElement
    expect(nameInput.value).toMatch(/^connector-\d{6}$/)
    const select = dialog.querySelector('select') as HTMLSelectElement | null
    if (!select) {
      throw new Error('expected profile select to be rendered')
    }

    const groups = Array.from(select.querySelectorAll('optgroup')).map(group => ({
      label: group.label,
      options: Array.from(group.querySelectorAll('option')).map(option =>
        option.textContent?.trim()
      ),
    }))

    expect(groups).toEqual([
      { label: 'REST API', options: ['Generic REST API'] },
      { label: 'Webhook', options: ['Generic Webhook'] },
      { label: 'MCP', options: ['Generic MCP'] },
      { label: 'Proxy', options: ['HTTP Proxy', 'SOCKS5 Proxy'] },
      { label: 'SMTP', options: ['Generic SMTP', 'Amazon SES SMTP'] },
      { label: 'Registry', options: ['Generic OCI Registry', 'GitHub Container Registry'] },
      { label: 'DNS', options: ['Generic DNS Provider', 'Cloudflare DNS'] },
    ])

    fireEvent.change(select, { target: { value: 'ses-smtp' } })

    expect(select.value).toBe('ses-smtp')
    expect(within(dialog).getByText('AWS Region')).toBeInTheDocument()
  })

  it('loads relation options once when opening the create dialog', async () => {
    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Connector' })).toBeInTheDocument()
    })

    const initialGroupRequests = sendMock.mock.calls.filter(
      ([path]) => path === '/api/collections/groups/records?perPage=500&sort=name'
    )
    expect(initialGroupRequests).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Add Connector' }))

    await screen.findByRole('dialog')

    await waitFor(() => {
      const groupRequests = sendMock.mock.calls.filter(
        ([path]) => path === '/api/collections/groups/records?perPage=500&sort=name'
      )
      expect(groupRequests).toHaveLength(1)
    })
  })

  it('uses separate proxy profiles and only shows username/password when auth is enabled', async () => {
    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Connector' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Connector' }))

    const dialog = await screen.findByRole('dialog')
    const profileSelect = dialog.querySelector('select') as HTMLSelectElement | null
    if (!profileSelect) {
      throw new Error('expected profile select to be rendered')
    }

    fireEvent.change(profileSelect, { target: { value: 'socks5-proxy' } })

    expect(within(dialog).queryByLabelText(/^Protocol/)).not.toBeInTheDocument()
    expect((within(dialog).getByLabelText(/^Proxy Endpoint/) as HTMLInputElement).value).toBe(
      'socks5://proxy.example.com:1080'
    )

    const authSelect = within(dialog).getByLabelText(/^Authentication/) as HTMLSelectElement
    expect(authSelect.value).toBe('none')
    expect(within(dialog).queryByLabelText(/^Username/)).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'Password Secret' })
    ).not.toBeInTheDocument()

    fireEvent.change(authSelect, { target: { value: 'username_password' } })

    expect(within(dialog).getByLabelText(/^Username/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Password Secret' })).toBeInTheDocument()
  })

  it('lets the user jump to edit the selected secret from connector credentials', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Connector' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Connector' }))

    const dialog = await screen.findByRole('dialog')
    const select = dialog.querySelector('select') as HTMLSelectElement | null
    if (!select) {
      throw new Error('expected profile select to be rendered')
    }

    fireEvent.change(select, { target: { value: 'ses-smtp' } })

    fireEvent.click(screen.getByRole('button', { name: 'Password Secret*' }))
    fireEvent.click(await screen.findByRole('button', { name: /smtp-password/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Secret' }))

    expect(openSpy).toHaveBeenCalledWith(
      'http://localhost:3000/secrets?id=secret-1&edit=secret-1',
      '_blank',
      'noopener,noreferrer'
    )

    openSpy.mockRestore()
  })
})
