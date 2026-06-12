import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConnectorCreateHref } from '@/components/connectors/shared'
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
        'connectors.page.title': 'External Services',
        'connectors.page.description':
          'Reusable API, webhook, MCP, proxy, SMTP, registry, and DNS services backed by grouped profiles',
        'connectors.page.addConnector': 'Add External Service',
        'connectors.page.searchPlaceholder': 'Search external services',
        'connectors.selection.title': 'Choose an External Service Type',
        'connectors.selection.description':
          'Start with the service type, then choose a vendor profile to prefill the shared schema.',
        'connectors.selection.searchPlaceholder':
          'Search service types like SMTP, DNS, proxy, or registry...',
        'connectors.selection.emptyMessage': 'No matching external service types found.',
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
        'connectors.secret.newDescription':
          'Create a reusable secret and attach it to this external service.',
        'connectors.secret.generatedDescription': `${String(options?.field ?? 'Secret')} for ${String(options?.name ?? '')}`,
        'connectors.secret.directPlaceholder': 'Enter a secret value',
        'connectors.secret.show': 'Show secret',
        'connectors.secret.hide': 'Hide secret',
        'connectors.dialog.externalServiceTitle': 'External service title',
        'connectors.dialog.applyTitle': 'Apply title',
        'connectors.dialog.newExternalService': 'New External Service',
        'connectors.dialog.editTitle': 'Edit title',
        'connectors.dialog.createDescription': `Add a ${String(options?.kind ?? '')} service${String(options?.profile ?? '') ? ` using ${String(options?.profile ?? '')}` : ''}`,
        'connectors.secretTemplates.single_value': 'Token / Single Value',
        'connectors.errors.profileRequired': 'Connector profile is required',
        'connectors.errors.fieldRequired': `${String(options?.field ?? 'Field')} is required`,
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
  function clickChooserOption(dialog: HTMLElement, title: string) {
    const label = within(dialog).getByText(title)
    const button = label.closest('button')
    if (!button) {
      throw new Error(`expected chooser button for ${title}`)
    }
    fireEvent.click(button)
  }

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
        "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value')%26%26(visible_to:length=0||visible_to:each%3F='connector')&sort=name"
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

  it('starts create flow from connector type and then narrows profiles to that kind schema', async () => {
    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/connectors/templates', { method: 'GET' })
      expect(screen.getByRole('button', { name: 'Add External Service' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add External Service' }))

    const chooser = await screen.findByRole('dialog')
    expect(within(chooser).getByRole('heading', { name: 'Choose an External Service Type' })).toBeInTheDocument()
    expect(within(chooser).getByText('REST API')).toBeInTheDocument()
    expect(within(chooser).getByText('SMTP')).toBeInTheDocument()

    clickChooserOption(chooser, 'SMTP')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/^connector-\d{6}$/)).toBeInTheDocument()
    const select = dialog.querySelector('select') as HTMLSelectElement | null
    if (!select) {
      throw new Error('expected profile select to be rendered')
    }

    const options = Array.from(select.querySelectorAll('option'))
      .map(option => option.textContent?.trim())
      .filter(option => option && option !== 'Select…')
    expect(options).toEqual(['Generic SMTP', 'Amazon SES SMTP'])
    expect(select.value).toBe('generic-smtp')

    fireEvent.change(select, { target: { value: 'ses-smtp' } })

    expect(select.value).toBe('ses-smtp')
    expect(within(dialog).getByText(/Add a SMTP service using Amazon SES SMTP/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Advanced' }))
    expect(within(dialog).getByText('AWS Region')).toBeInTheDocument()
  })

  it('loads relation options once when opening the create dialog', async () => {
    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add External Service' })).toBeInTheDocument()
    })

    const initialGroupRequests = sendMock.mock.calls.filter(
      ([path]) => path === '/api/collections/groups/records?perPage=500&sort=name'
    )
    expect(initialGroupRequests).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Add External Service' }))

    const chooser = await screen.findByRole('dialog')
    clickChooserOption(chooser, 'SMTP')

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
      expect(screen.getByRole('button', { name: 'Add External Service' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add External Service' }))

    const chooser = await screen.findByRole('dialog')
    clickChooserOption(chooser, 'Proxy')

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
    expect(within(dialog).queryByPlaceholderText('Enter a secret value')).not.toBeInTheDocument()

    fireEvent.change(authSelect, { target: { value: 'username_password' } })

    expect(within(dialog).getByLabelText(/^Username/)).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('Enter a secret value')).toBeInTheDocument()
  })

  it('supports direct password entry by creating a managed secret before save', async () => {
    createMock.mockResolvedValue({ id: 'created-secret', template_id: 'single_value' })

    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add External Service' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add External Service' }))

    const chooser = await screen.findByRole('dialog')
    clickChooserOption(chooser, 'Proxy')

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Authentication/), {
      target: { value: 'username_password' },
    })
    fireEvent.change(within(dialog).getByLabelText(/^Username/), {
      target: { value: 'proxy-user' },
    })
    fireEvent.change(within(dialog).getByPlaceholderText('Enter a secret value'), {
      target: { value: 'top-secret' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          template_id: 'single_value',
          visible_to: ['connector'],
          payload: { value: 'top-secret' },
        })
      )
      expect(sendMock).toHaveBeenCalledWith('/api/connectors', {
        method: 'POST',
        body: expect.objectContaining({
          kind: 'proxy',
          credential: 'created-secret',
          auth_scheme: 'basic',
        }),
      })
    })
  })

  it('keeps password secret inline for edit until the operator explicitly unlocks it', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/secrets/templates') {
        return Promise.resolve([{ id: 'single_value', label: 'Single Value' }])
      }
      if (path === '/api/connectors/templates') {
        return Promise.resolve([
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
            ],
          },
        ])
      }
      if (path === '/api/connectors?kind=rest_api,webhook,mcp,proxy,smtp,registry,dns') {
        return Promise.resolve([
          {
            id: 'connector-1',
            name: 'ses-main',
            kind: 'smtp',
            template_id: 'ses-smtp',
            endpoint: 'smtp://email-smtp.us-east-1.amazonaws.com:587',
            auth_scheme: 'basic',
            credential: 'secret-1',
            config: { username: 'mailer' },
          },
        ])
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value')%26%26(visible_to:length=0||visible_to:each%3F='connector')&sort=name"
      ) {
        return Promise.resolve({
          items: [{ id: 'secret-1', name: 'smtp-password', template_id: 'single_value' }],
        })
      }
      return Promise.resolve({ items: [] })
    })

    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ses-main' })).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByTitle('More actions'))
    fireEvent.click(await screen.findByText('Edit'))

    await screen.findByRole('dialog')
    expect(screen.queryByPlaceholderText('Enter a secret value')).not.toBeInTheDocument()
    expect(screen.getByText('smtp-password')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Secret' }))

    expect(await screen.findByPlaceholderText('Enter a secret value')).toBeInTheDocument()
    expect(screen.getByTitle('Use direct API key input')).toBeInTheDocument()
  })

  it('opens the settings-generated proxy deep link directly in the External Services form', async () => {
    window.history.pushState({}, '', buildConnectorCreateHref('proxy', 'http-proxy'))

    render(<ConnectorsPage />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('heading', { name: 'Choose an External Service Type' })).not.toBeInTheDocument()
    const select = dialog.querySelector('select') as HTMLSelectElement | null
    if (!select) {
      throw new Error('expected profile select to be rendered')
    }
    expect(select.value).toBe('http-proxy')
    expect((within(dialog).getByLabelText(/^Proxy Endpoint/) as HTMLInputElement).value).toBe(
      'http://proxy.example.com:8080'
    )

    window.history.pushState({}, '', '/resources/connectors')
  })
})
