import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIProvidersPage, buildAIProviderPayload } from './ai-providers'
import { shouldAutoListModels } from '@/components/ai/AIProviderCreateFlowDialog'

const AI_PROVIDER_SECRET_PATH =
  "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value')%26%26(visible_to:length=0||visible_to:each%3F='ai_provider')&sort=name"

const sendMock = vi.fn()
const getOneMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const navigateMock = vi.fn()

function getProductButton(title: string) {
  const titleNode = screen.getByText(title)
  const button = titleNode.closest('button')
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`expected ${title} product button`)
  }
  return button
}

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
        'aiProviders.page.title': 'AI Providers',
        'aiProviders.page.description':
          'Hosted and local AI provider definitions such as OpenAI, Anthropic, OpenRouter, and Ollama endpoints.',
        'aiProviders.page.emptyState': 'No AI Providers found',
        'aiProviders.page.searchPlaceholder': 'Search any AI providers',
        'aiProviders.page.addProvider': 'Add AI Provider',
        'aiProviders.page.refresh': 'Refresh',
        'aiProviders.page.totalItems': `Total ${String(options?.count ?? '')} items`,
        'aiProviders.selection.title': 'Choose a Product',
        'aiProviders.selection.description':
          'Choose a provider product, then enter connection details.',
        'aiProviders.selection.searchPlaceholder':
          'Search products like OpenAI, Ollama, Anthropic, OpenRouter...',
        'aiProviders.selection.emptyMessage': 'No matching products found.',
        'aiProviders.selection.loading': 'Loading products...',
        'aiProviders.selection.help': 'Help',
        'aiProviders.selection.groups.singleProvider': 'Single Provider',
        'aiProviders.selection.groups.cloudGateway': 'LLM Gateway',
        'aiProviders.selection.groups.selfHosted': 'Self-Hosted LLM Gateway',
        'aiProviders.columns.name': 'Name',
        'aiProviders.columns.provider': 'Provider',
        'aiProviders.columns.enabledModels': 'Enabled Model(s)',
        'aiProviders.columns.profile': 'Profile',
        'aiProviders.columns.availability': 'Availability',
        'aiProviders.columns.reachability': 'Reachability',
        'aiProviders.columns.endpoint': 'Endpoint',
        'aiProviders.columns.lastChecked': 'Last Checked',
        'aiProviders.columns.created': 'Created',
        'aiProviders.columns.updated': 'Updated',
        'servers.listSettings.title': 'List settings',
        'servers.listSettings.rowsPerPage': 'Rows per page',
        'servers.listSettings.columns': 'Columns',
        'aiProviders.actions.testConnection': 'Test it',
        'aiProviders.actions.editEndpoint': 'Edit endpoint',
        'aiProviders.actions.finishEditingEndpoint': 'Finish editing endpoint',
        'aiProviders.status.available': 'Available',
        'aiProviders.status.reachable': 'Reachable',
        'aiProviders.status.unavailable': 'Unavailable',
        'aiProviders.status.unreachable': 'Unreachable',
        'aiProviders.status.unknown': 'Unknown',
        'aiProviders.fields.name': 'Name',
        'aiProviders.fields.provider': 'Provider',
        'aiProviders.fields.profile': 'Profile',
        'aiProviders.fields.description': 'Description',
        'aiProviders.fields.enableIt': 'Enable it',
        'aiProviders.fields.authScheme': 'Auth Scheme',
        'aiProviders.fields.enabledModels': 'Enabled Models',
        'aiProviders.fields.apiEndpoint': 'API Endpoint',
        'aiProviders.fields.openaiCompatibleUrl': 'OpenAI Compatible URL',
        'aiProviders.fields.selectedProduct': 'Selected Product',
        'aiProviders.fields.selectedProductMeta': 'Selected Product Meta',
        'aiProviders.fields.selectedProductDescription': 'Selected Product Description',
        'aiProviders.fields.titleNameEditing': 'Title Name Editing',
        'aiProviders.fields.credentialUseSecret': 'Credential Use Secret',
        'aiProviders.fields.apiKeyValue': 'API Key Value',
        'aiProviders.fields.advancedConfig': 'Advanced Config (JSON)',
        'aiProviders.fields.groups': 'Groups',
        'aiProviders.fields.apiKey': 'API Key',
        'aiProviders.authSchemes.bearer': 'Bearer token',
        'aiProviders.authSchemes.api_key': 'API key header',
        'aiProviders.authSchemes.none': 'No auth',
        'aiProviders.placeholders.name': 'my-ai-provider',
        'aiProviders.placeholders.advancedConfig': '{"temperature": 0.2}',
        'aiProviders.placeholders.groups': 'Select groups',
        'aiProviders.credential.generateTitle': 'Generate API Key',
        'aiProviders.credential.generateDescription':
          'Choose the API key length before filling the field.',
        'aiProviders.credential.generateLengthLabel': 'API Key Length',
        'aiProviders.credential.generateConfirmLabel': 'Fill API Key',
        'aiProviders.dialog.providerTitle': 'AI provider title',
        'aiProviders.dialog.applyTitle': 'Apply title',
        'aiProviders.dialog.newProvider': 'New AI Provider',
        'aiProviders.dialog.editTitle': 'Edit title',
        'aiProviders.dialog.add': 'Add',
        'aiProviders.dialog.cancel': 'Cancel',
        'aiProviders.dialog.update': 'Update',
        'aiProviders.dialog.suffix': 'AI Provider',
        'aiProviders.secret.new': 'New Secret',
        'aiProviders.secret.edit': 'Edit Secret',
        'aiProviders.secret.newTitle': 'New Secret',
        'aiProviders.secret.newDescription':
          'Create a reusable secret and attach it to this AI Provider.',
        'aiProviders.secret.singleValueTemplate': 'Token / Single Value',
        'aiProviders.errors.profileRequired': 'AI Provider profile is required',
      }
      if (key === 'aiProviders.credential.enterField') {
        return `Enter ${String(options?.field ?? '')}`
      }
      if (key === 'aiProviders.credential.showField') {
        return `Show ${String(options?.field ?? '')}`
      }
      if (key === 'aiProviders.credential.hideField') {
        return `Hide ${String(options?.field ?? '')}`
      }
      if (key === 'aiProviders.secret.generatedDescription') {
        return `API key for ${String(options?.name ?? '')}`
      }
      if (key === 'aiProviders.errors.fieldRequired') {
        return `${String(options?.field ?? '')} is required`
      }
      if (key === 'servers.listSettings.rowsPerPageOption') {
        return `${String(options?.count ?? '')} / page`
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
      update: (...args: unknown[]) => updateMock(...args),
    }),
  },
}))

describe('AIProvidersPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getOneMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    navigateMock.mockReset()

    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'generic-llm',
              kind: 'llm',
              title: 'Custom OpenAI-compatible',
              vendor: 'Custom OpenAI-compatible',
              description: 'Custom OpenAI-compatible endpoint',
              endpointMode: 'user_supplied',
              defaultAuthScheme: 'bearer',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
            {
              id: 'openai',
              kind: 'llm',
              title: 'OpenAI',
              vendor: 'OpenAI',
              description: 'Hosted OpenAI models',
              aliases: ['chatgpt'],
              contextSize: 128000,
              defaultEndpoint: 'https://api.openai.com/v1',
              defaultAuthScheme: 'bearer',
              capabilities: ['hosted'],
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                {
                  id: 'apiVersion',
                  label: 'API Version',
                  type: 'string',
                  advanced: true,
                  placeholder: '2024-10-21',
                },
                {
                  id: 'max_completion_tokens',
                  label: 'Max Completion Tokens',
                  type: 'number',
                  advanced: true,
                  default: 4096,
                },
                {
                  id: 'credential',
                  label: 'API Key',
                  type: 'secret_ref',
                  required: true,
                  secretTemplate: 'single_value',
                },
                {
                  id: 'org_secret',
                  label: 'Organization Secret',
                  type: 'secret_ref',
                  required: false,
                  secretTemplate: 'single_value',
                },
              ],
            },
            {
              id: 'ollama',
              kind: 'llm',
              title: 'Ollama',
              vendor: 'Ollama',
              description: 'Local Ollama runtime',
              capabilities: ['local', 'openai-compatible'],
              endpointMode: 'user_supplied',
              defaultAuthScheme: 'bearer',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
            {
              id: 'xai',
              kind: 'llm',
              title: 'xAI',
              vendor: 'xAI',
              description: 'Hosted Grok models',
              contextSize: 131072,
              defaultEndpoint: 'https://api.x.ai/v1',
              defaultAuthScheme: 'bearer',
              capabilities: ['hosted', 'openai-compatible'],
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers' && options?.method === 'POST') {
          return Promise.resolve({
            id: 'provider-1',
            name: String(options.body?.name ?? 'OpenAI'),
            template_id: String(options.body?.template_id ?? 'openai'),
            endpoint: String(options.body?.endpoint ?? 'https://api.openai.com/v1'),
            auth_scheme: String(options.body?.auth_scheme ?? 'bearer'),
            credential: String(options.body?.credential ?? 'secret-1'),
            config: options.body?.config ?? {},
            description: String(options.body?.description ?? ''),
          })
        }
        if (path === '/api/ai-providers') {
          return Promise.resolve([])
        }
        if (path.startsWith('/api/ai-providers/availability?')) {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({
            items: [{ id: 'secret-1', name: 'shared-secret', template_id: 'single_value' }],
          })
        }
        return Promise.resolve([])
      }
    )

    getOneMock.mockResolvedValue({ template_id: 'single_value' })
    createMock.mockResolvedValue({ id: 'secret-1' })
  })

  afterEach(() => {
    cleanup()
  })

  it('uses an instance-style add flow with product picker, refresh button, and no favorites', async () => {
    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/templates', { method: 'GET' })
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    expect(screen.getByText('No AI Providers found')).toBeInTheDocument()
    expect(screen.getByTitle('Refresh')).toBeInTheDocument()
    expect(screen.queryByText('Refresh')).not.toBeInTheDocument()
    expect(screen.queryByText('Favorites only')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search any AI providers')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))

    await screen.findByRole('dialog')

    expect(screen.getByText('Choose a Product')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Search products like OpenAI, Ollama, Anthropic, OpenRouter...')
    ).toBeInTheDocument()
    expect(getProductButton('OpenAI')).toBeInTheDocument()
    expect(getProductButton('Custom OpenAI-compatible')).toBeInTheDocument()
    expect(getProductButton('Ollama')).toBeInTheDocument()
    expect(getProductButton('xAI')).toBeInTheDocument()
    expect(getProductButton('OpenAI')).toHaveAttribute('title', 'Hosted OpenAI models')
    expect(document.querySelector('optgroup')).toBeNull()

    const productButtons = ['OpenAI', 'Ollama', 'xAI', 'Custom OpenAI-compatible'].filter(title =>
      screen.queryByText(title)
    )
    expect(productButtons).toEqual(['OpenAI', 'Ollama', 'xAI', 'Custom OpenAI-compatible'])

    fireEvent.change(
      screen.getByPlaceholderText('Search products like OpenAI, Ollama, Anthropic, OpenRouter...'),
      { target: { value: 'openai' } }
    )

    expect(getProductButton('OpenAI')).toBeInTheDocument()
    expect(screen.queryByText('Ollama')).not.toBeInTheDocument()

    fireEvent.change(
      screen.getByPlaceholderText('Search products like OpenAI, Ollama, Anthropic, OpenRouter...'),
      { target: { value: 'chatgpt' } }
    )

    expect(getProductButton('OpenAI')).toBeInTheDocument()
    expect(screen.queryByText('Custom OpenAI-compatible')).not.toBeInTheDocument()

    fireEvent.click(getProductButton('OpenAI'))

    await waitFor(() => {
      expect(screen.getByText('Add OpenAI AI Provider')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(AI_PROVIDER_SECRET_PATH, { method: 'GET' })
    })

    expect(screen.getByText('Add OpenAI AI Provider')).toBeInTheDocument()
    expect(screen.queryByLabelText('Profile')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Runtime Default')).not.toBeInTheDocument()
    expect(screen.queryByText('Auth Scheme')).not.toBeInTheDocument()
    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter API Key')).toBeInTheDocument()
    expect(screen.getByTitle('Use a saved secret')).toBeInTheDocument()
    expect(screen.queryByText('Enable Models')).not.toBeInTheDocument()
    expect(screen.queryByText('API Version')).not.toBeInTheDocument()
    expect(screen.queryByText('Max Completion Tokens')).not.toBeInTheDocument()
    expect(screen.queryByText('Advanced Config (JSON)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }))

    expect(screen.getByText('API Version')).toBeInTheDocument()
    expect(screen.getByText('Max Completion Tokens')).toBeInTheDocument()
    expect(screen.getByText('Enable it')).toBeInTheDocument()
    expect(screen.getAllByText('OpenAI Compatible URL').length).toBeGreaterThan(0)
  }, 15000)

  it('keeps endpoint in advanced settings for customizable hosted providers like Kimi and submits an override', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'moonshot',
              kind: 'llm',
              title: 'Moonshot AI (Kimi)',
              vendor: 'Moonshot AI',
              uiGroup: 'single_provider',
              endpointMode: 'customizable',
              defaultEndpoint: 'https://api.moonshot.cn/v1',
              defaultAuthScheme: 'bearer',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          if (options?.method === 'POST') {
            return Promise.resolve({
              id: 'moonshot-main',
              name: 'moonshot-main',
              template_id: 'moonshot',
              endpoint: String(options.body?.endpoint ?? ''),
              credential: String(options.body?.credential ?? ''),
              is_enabled: true,
              config: {},
            })
          }
          return Promise.resolve([])
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))
    await screen.findByRole('dialog')
    fireEvent.click(getProductButton('Moonshot AI (Kimi)'))

    await waitFor(() => {
      expect(screen.getByText('Add Moonshot AI (Kimi) AI Provider')).toBeInTheDocument()
    })

    expect(screen.queryByText('OpenAI Compatible URL')).not.toBeInTheDocument()
    expect(screen.queryByText('Advanced Config (JSON)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }))

    expect(screen.getByText('OpenAI Compatible URL')).toBeInTheDocument()
    const endpointInput = screen.getByDisplayValue('https://api.moonshot.cn/v1')
    fireEvent.change(endpointInput, { target: { value: 'https://kimi-proxy.internal/v1' } })
    fireEvent.change(screen.getByPlaceholderText('Enter API Key'), {
      target: { value: 'moonshot-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers', {
        method: 'POST',
        body: expect.objectContaining({
          template_id: 'moonshot',
          endpoint: 'https://kimi-proxy.internal/v1',
          auth_scheme: 'bearer',
        }),
      })
    })
  })

  it('promotes user-supplied endpoints into the primary form even for single-provider templates', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'writer',
              kind: 'llm',
              title: 'Writer',
              vendor: 'Writer',
              uiGroup: 'single_provider',
              endpointMode: 'user_supplied',
              defaultAuthScheme: 'bearer',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          if (options?.method === 'POST') {
            return Promise.resolve({
              id: 'writer-main',
              name: 'writer-main',
              template_id: 'writer',
              endpoint: String(options.body?.endpoint ?? ''),
              credential: String(options.body?.credential ?? ''),
              is_enabled: true,
              config: {},
            })
          }
          return Promise.resolve([])
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))
    await screen.findByRole('dialog')
    fireEvent.click(getProductButton('Writer'))

    await waitFor(() => {
      expect(screen.getByText('Add Writer AI Provider')).toBeInTheDocument()
    })

    expect(screen.getByText('OpenAI Compatible URL')).toBeInTheDocument()
    expect(screen.queryByText('Advanced Config (JSON)')).not.toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'https://writer.example.com/v1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Enter API Key'), {
      target: { value: 'writer-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers', {
        method: 'POST',
        body: expect.objectContaining({
          template_id: 'writer',
          endpoint: 'https://writer.example.com/v1',
          auth_scheme: 'bearer',
        }),
      })
    })
  })

  it('hides qwen from the chooser and groups NVIDIA NIM Cloud under LLM Gateway', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'openai',
            kind: 'llm',
            title: 'OpenAI',
            vendor: 'OpenAI',
            uiGroup: 'single_provider',
            defaultEndpoint: 'https://api.openai.com/v1',
            defaultAuthScheme: 'api_key',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
          {
            id: 'nvidia-nim-cloud',
            kind: 'llm',
            title: 'NVIDIA NIM Cloud',
            vendor: 'NVIDIA',
            uiGroup: 'cloud_gateway',
            providerMode: 'gateway',
            fields: [{ id: 'endpoint', label: 'Base URL', type: 'url', required: true }],
          },
          {
            id: 'qwen-dashscope',
            kind: 'llm',
            title: 'Qwen (DashScope)',
            vendor: 'Alibaba Cloud',
            uiGroup: 'single_provider',
            hideInChooser: true,
            defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([])
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))

    await screen.findByRole('dialog')

    expect(screen.getByText('Single Provider')).toBeInTheDocument()
    expect(screen.getByText('LLM Gateway')).toBeInTheDocument()
    expect(getProductButton('NVIDIA NIM Cloud')).toBeInTheDocument()
    expect(screen.queryByText('Qwen (DashScope)')).not.toBeInTheDocument()
  })

  it('promotes the self-hosted endpoint into the primary create form while keeping auth template-owned', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'nvidia-nim-local',
            kind: 'llm',
            title: 'NVIDIA NIM Local',
            vendor: 'NVIDIA',
            uiGroup: 'self_hosted',
            endpointMode: 'user_supplied',
            defaultAuthScheme: 'bearer',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([])
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))
    await screen.findByRole('dialog')
    fireEvent.click(getProductButton('NVIDIA NIM Local'))

    await waitFor(() => {
      expect(screen.getByText('Add NVIDIA NIM Local AI Provider')).toBeInTheDocument()
    })

    expect(screen.queryByDisplayValue('http://localhost:8000/v1')).not.toBeInTheDocument()
    expect(screen.queryByText('Auth Scheme')).not.toBeInTheDocument()
    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByText('OpenAI Compatible URL')).toBeInTheDocument()
    const endpointLabel = screen.getByText('OpenAI Compatible URL')
    const apiKeyLabel = screen.getByText('API Key')
    expect(
      endpointLabel.compareDocumentPosition(apiKeyLabel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText('Advanced Config (JSON)')).not.toBeInTheDocument()
  })

  it('keeps hosted gateway endpoints in advanced settings with required API keys and defaults', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'writer',
            kind: 'llm',
            title: 'Writer',
            vendor: 'Writer',
            uiGroup: 'single_provider',
            endpointMode: 'customizable',
            defaultEndpoint: 'https://api.writer.com/v1/chat',
            defaultAuthScheme: 'bearer',
            fields: [
              {
                id: 'endpoint',
                label: 'OpenAI Compatible URL',
                type: 'url',
                required: true,
              },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([])
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))
    await screen.findByRole('dialog')
    fireEvent.click(getProductButton('Writer'))

    await waitFor(() => {
      expect(screen.getByText('Add Writer AI Provider')).toBeInTheDocument()
    })

    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.queryByText('OpenAI Compatible URL')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }))
    const endpointInput = await screen.findByDisplayValue('https://api.writer.com/v1/chat')
    expect(endpointInput).toBeInTheDocument()
  })

  it('sorts Custom OpenAI-compatible to the top of the self-hosted chooser group', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'vllm',
            kind: 'llm',
            title: 'vLLM',
            vendor: 'vLLM',
            uiGroup: 'self_hosted',
            endpointMode: 'user_supplied',
            defaultAuthScheme: 'bearer',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
          {
            id: 'generic-llm',
            kind: 'llm',
            title: 'Custom OpenAI-compatible',
            vendor: 'Custom OpenAI-compatible',
            uiGroup: 'self_hosted',
            endpointMode: 'user_supplied',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
          {
            id: 'sglang',
            kind: 'llm',
            title: 'SGLang',
            vendor: 'SGLang',
            uiGroup: 'self_hosted',
            endpointMode: 'user_supplied',
            defaultAuthScheme: 'bearer',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([])
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))
    await screen.findByRole('dialog')

    const customButton = getProductButton('Custom OpenAI-compatible')
    const vllmButton = getProductButton('vLLM')
    expect(
      customButton.compareDocumentPosition(vllmButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('removes Notes from Custom OpenAI-compatible and keeps Description as the freeform metadata field', async () => {
    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))
    await screen.findByRole('dialog')
    fireEvent.click(getProductButton('Custom OpenAI-compatible'))

    await waitFor(() => {
      expect(screen.getByText('Add Custom OpenAI-compatible AI Provider')).toBeInTheDocument()
    })

    expect(screen.queryByText('Notes')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }))

    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })

  it('stores manual API keys as single-value secrets and keeps template-declared auth', async () => {
    const templatesById = new Map([
      [
        'openai',
        {
          id: 'openai',
          kind: 'llm',
          title: 'OpenAI',
          defaultAuthScheme: 'bearer',
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
      ],
    ])

    const payload = await buildAIProviderPayload(
      {
        name: 'openai-main',
        template_id: 'openai',
        endpoint: 'https://api.openai.com/v1',
        credential_use_secret: false,
        api_key_value: 'sk-test-manual-key',
      },
      templatesById
    )

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        template_id: 'single_value',
        visible_to: ['ai_provider'],
        payload: { value: 'sk-test-manual-key' },
      })
    )
    expect(payload).toEqual(
      expect.objectContaining({
        auth_scheme: 'bearer',
        credential: 'secret-1',
      })
    )
  })

  it('keeps max completion tokens in provider config payload', async () => {
    const templatesById = new Map([
      [
        'openrouter',
        {
          id: 'openrouter',
          kind: 'llm',
          title: 'OpenRouter',
          defaultAuthScheme: 'api_key',
          fields: [
            { id: 'endpoint', label: 'Endpoint', type: 'url', required: true },
            {
              id: 'credential',
              label: 'API Key',
              type: 'secret_ref',
              required: true,
              secretTemplate: 'single_value',
            },
            {
              id: 'max_completion_tokens',
              label: 'Max Completion Tokens',
              type: 'number',
              default: 31100,
            },
          ],
        },
      ],
    ])

    getOneMock.mockResolvedValue({ id: 'secret-1', template_id: 'single_value' })
    const payload = await buildAIProviderPayload(
      {
        name: 'openrouter-main',
        template_id: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1',
        credential: 'secret-1',
        credential_use_secret: true,
        max_completion_tokens: '31100',
      },
      templatesById
    )

    expect(payload).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          max_completion_tokens: 31100,
        }),
      })
    )
  })

  it('renders availability, last checked, paging summary, and hides created/updated by default', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'xai',
              kind: 'llm',
              title: 'xAI',
              vendor: 'xAI',
              description: 'Hosted Grok models',
              contextSize: 131072,
              defaultEndpoint: 'https://api.x.ai/v1',
              defaultAuthScheme: 'api_key',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          return Promise.resolve([
            {
              id: 'provider-xai',
              name: 'xai-main',
              template_id: 'xai',
              endpoint: 'https://api.x.ai/v1',
              auth_scheme: 'api_key',
              credential: 'secret-1',
              config: {
                availability: {
                  status: 'available',
                  checked_at: '2025-01-06T12:00:00Z',
                },
                reachability: {
                  status: 'reachable',
                  checked_at: '2025-01-06T11:55:00Z',
                },
              },
              created: '2025-01-05T10:30:00Z',
              updated: '2025-01-06T11:45:00Z',
            },
          ])
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path.startsWith('/api/ai-providers/reachability?')) {
          return Promise.resolve({
            items: [
              {
                id: 'provider-xai',
                status: 'reachable',
                checked_at: '2025-01-06T12:00:00Z',
              },
            ],
          })
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/ai-providers' && options?.method === 'POST') {
          return Promise.resolve({})
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/templates', { method: 'GET' })
    })

    fireEvent.click(screen.getByTitle('Refresh'))

    expect(await screen.findByText('Available')).toBeInTheDocument()
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/ai-providers/reachability?'),
        { method: 'GET' }
      )
    })
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByText('Last Checked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List settings' })).toBeInTheDocument()
    expect(screen.getByText('Total 1 items')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.queryByText('Type')).not.toBeInTheDocument()
    expect(screen.queryByText('Auth')).not.toBeInTheDocument()
    expect(screen.getByText('2025-01-06 12:00')).toBeInTheDocument()
    expect(screen.queryByText('Created')).not.toBeInTheDocument()
    expect(screen.queryByText('Updated')).not.toBeInTheDocument()
    expect(screen.queryByText('api_key')).not.toBeInTheDocument()
  })

  it('lets the user jump to edit a selected generic secret field', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add AI Provider' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))
    await screen.findByText('Choose a Product')
    fireEvent.click(getProductButton('OpenAI'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Organization Secret' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Organization Secret' }))
    fireEvent.click(await screen.findByRole('button', { name: /shared-secret/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Secret' }))

    expect(openSpy).toHaveBeenCalledWith(
      'http://localhost:3000/secrets?id=secret-1&edit=secret-1',
      '_blank',
      'noopener,noreferrer'
    )

    openSpy.mockRestore()
  })

  it('shows provider and enabled status, loads availability, and opens edit from name', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'xai',
            kind: 'llm',
            title: 'xAI',
            vendor: 'xAI',
            defaultEndpoint: 'https://api.x.ai/v1',
            defaultAuthScheme: 'api_key',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([
          {
            id: 'provider-xai',
            name: 'xai-main',
            template_id: 'xai',
            endpoint: 'https://api.x.ai/v1',
            credential: 'secret-1',
            is_enabled: false,
            config: {
              availability: {
                status: 'unknown',
              },
            },
            created: '2025-01-05T10:30:00Z',
            updated: '2025-01-06T11:45:00Z',
          },
        ])
      }
      if (path.startsWith('/api/ai-providers/reachability?')) {
        return Promise.resolve({ items: [{ id: 'provider-xai', status: 'reachable' }] })
      }
      if (path === '/api/ai-providers/models/provider-xai') {
        return Promise.resolve({ models: [{ id: 'grok-4' }] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/group_items/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'xai-main' })).toBeInTheDocument()
    expect(screen.getByText('Provider')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'xai-main' }))

    // Inline detail expands with List Models feedback
    expect(await screen.findByText(/Loading models/)).toBeInTheDocument()
  })

  it('lets the user click an Unknown availability cell to run the existing test flow', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'openrouter',
            kind: 'llm',
            title: 'OpenRouter',
            vendor: 'OpenRouter',
            providerMode: 'gateway',
            defaultEndpoint: 'https://openrouter.ai/api/v1',
            defaultAuthScheme: 'api_key',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([
          {
            id: 'provider-openrouter',
            name: 'openrouter-main',
            template_id: 'openrouter',
            endpoint: 'https://openrouter.ai/api/v1',
            credential: 'secret-1',
            is_enabled: true,
            enabled_models: ['openai/gpt-4.1-mini'],
            config: {},
          },
        ])
      }
      if (path === '/api/ai-providers/models/provider-openrouter') {
        return Promise.resolve({ models: [{ id: 'openai/gpt-4.1-mini' }] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({
          items: [{ id: 'secret-1', name: 'shared-secret', template_id: 'single_value' }],
        })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'openrouter-main' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Test it openrouter-main' }))

    expect(await screen.findByText('shared-secret')).toBeInTheDocument()
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/models/provider-openrouter', {
        method: 'GET',
      })
    })
  })

  it('shows a visible refresh affordance inside the Availability action', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'openrouter',
            kind: 'llm',
            title: 'OpenRouter',
            vendor: 'OpenRouter',
            defaultEndpoint: 'https://openrouter.ai/api/v1',
            defaultAuthScheme: 'api_key',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([
          {
            id: 'provider-openrouter',
            name: 'openrouter-main',
            template_id: 'openrouter',
            endpoint: 'https://openrouter.ai/api/v1',
            credential: 'secret-1',
            is_enabled: true,
            config: {},
          },
        ])
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'openrouter-main' })).toBeInTheDocument()

    const availabilityButton = screen.getByRole('button', { name: 'Test it openrouter-main' })
    expect(within(availabilityButton).getByTestId('availability-refresh-icon')).toBeInTheDocument()
  })

  it('renders List Models feedback inline under the selected row and lets the name toggle it', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'openrouter',
            kind: 'llm',
            title: 'OpenRouter',
            vendor: 'OpenRouter',
            providerMode: 'gateway',
            defaultEndpoint: 'https://openrouter.ai/api/v1',
            defaultAuthScheme: 'api_key',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
            ],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([
          {
            id: 'provider-openrouter',
            name: 'openrouter-main',
            template_id: 'openrouter',
            endpoint: 'https://openrouter.ai/api/v1',
            credential: 'secret-1',
            is_enabled: true,
            enabled_models: ['openai/gpt-4.1-mini'],
            config: {},
          },
        ])
      }
      if (path.startsWith('/api/ai-providers/availability?')) {
        return Promise.resolve({ items: [{ id: 'provider-openrouter', status: 'available' }] })
      }
      if (path === '/api/ai-providers/models/provider-openrouter') {
        return Promise.resolve({ models: [{ id: 'openai/gpt-4.1-mini' }] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === AI_PROVIDER_SECRET_PATH) {
        return Promise.resolve({
          items: [{ id: 'secret-1', name: 'shared-secret', template_id: 'single_value' }],
        })
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'openrouter-main' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTitle('More actions'))
    fireEvent.click(await screen.findByText('Test it'))

    // Inline detail panel expands below the row
    expect(screen.getByText('Secret')).toBeInTheDocument()
    expect(screen.getByText('shared-secret')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse details' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse details' }))

    await waitFor(() => {
      expect(screen.queryByText('shared-secret')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'openrouter-main' })[0])

    expect(await screen.findByText('shared-secret')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'openrouter-main' })[0])

    // Clicking again collapses the inline detail
    await waitFor(() => {
      expect(screen.queryByText('shared-secret')).not.toBeInTheDocument()
    })
  })

  it('preserves saved enabled models in edit mode and keeps them checked after loading inventory', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'bailian',
              kind: 'llm',
              title: 'Alibaba Cloud Bailian',
              vendor: 'Alibaba Cloud',
              defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              defaultAuthScheme: 'api_key',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          return Promise.resolve([
            {
              id: 'alibaba-cloud-bailian-1494',
              name: 'bailian-main',
              template_id: 'bailian',
              endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              credential: 'secret-1',
              is_enabled: true,
              enabled_models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max'],
              config: {},
            },
          ])
        }
        if (path.startsWith('/api/ai-providers/availability?')) {
          return Promise.resolve({
            items: [{ id: 'alibaba-cloud-bailian-1494', status: 'available' }],
          })
        }
        if (path === '/api/ai-providers/models/alibaba-cloud-bailian-1494') {
          return Promise.resolve({
            models: [
              { id: 'qwen-max' },
              { id: 'qwen-plus' },
              { id: 'qwen-turbo' },
              { id: 'qwen-vl-max' },
              { id: 'qwen-coder-plus' },
            ],
          })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({
            items: [{ id: 'secret-1', name: 'shared-secret', template_id: 'single_value' }],
          })
        }
        if (path === '/api/collections/group_items/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path.startsWith('/api/ai-providers/') && options?.method === 'PUT') {
          return Promise.resolve({})
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'bailian-main' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTitle('More actions'))
    fireEvent.click(await screen.findByText('Edit'))

    expect(await screen.findByText('qwen-max')).toBeInTheDocument()
    expect(screen.getByText('qwen-plus')).toBeInTheDocument()
    expect(screen.getByText('qwen-turbo')).toBeInTheDocument()
    expect(screen.getByText('qwen-vl-max')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Load all available models/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/models/alibaba-cloud-bailian-1494', {
        method: 'GET',
      })
    })

    expect(screen.getByLabelText('qwen-max')).toBeChecked()
    expect(screen.getByLabelText('qwen-plus')).toBeChecked()
    expect(screen.getByLabelText('qwen-turbo')).toBeChecked()
    expect(screen.getByLabelText('qwen-vl-max')).toBeChecked()
    expect(screen.getByLabelText('qwen-coder-plus')).not.toBeChecked()
  })

  it('drops invalid saved models after loading inventory and tolerates group labels missing from the API', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'aws-bedrock',
              kind: 'llm',
              title: 'AWS Bedrock',
              vendor: 'Amazon Web Services',
              defaultEndpoint: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
              defaultAuthScheme: 'api_key',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'region', label: 'Region Code', type: 'string' },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          return Promise.resolve([
            {
              id: 'provider-bedrock',
              name: 'bedrock-main',
              template_id: 'aws-bedrock',
              endpoint: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
              credential: 'secret-1',
              is_enabled: true,
              enabled_models: ['anthropic.claude-3-5-sonnet-20240620-v1:0', 'stale-model-id'],
              config: { region: 'us-east-1' },
            },
          ])
        }
        if (path.startsWith('/api/ai-providers/availability?')) {
          return Promise.resolve({ items: [{ id: 'provider-bedrock', status: 'available' }] })
        }
        if (path === '/api/ai-providers/models/provider-bedrock') {
          return Promise.resolve({
            models: [{ id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' }],
            groups: [
              {
                vendor: 'Anthropic',
                models: [{ id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' }],
              },
            ],
          })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({
            items: [{ id: 'secret-1', name: 'bedrock-secret', template_id: 'single_value' }],
          })
        }
        if (path.startsWith('/api/ai-providers/') && options?.method === 'PUT') {
          return Promise.resolve({ ok: true, body: options.body })
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'bedrock-main' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTitle('More actions'))
    fireEvent.click(await screen.findByText('Edit'))

    expect(screen.getByText('stale-model-id')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Load all available models/i }))

    expect(await screen.findByLabelText('anthropic.claude-3-5-sonnet-20240620-v1:0')).toBeChecked()
    await waitFor(() => {
      expect(screen.queryByText('stale-model-id')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /^Save/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/provider-bedrock', {
        method: 'PUT',
        body: expect.objectContaining({
          enabled_models: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
        }),
      })
    })
  })

  it('updates enabled models and edits the current secret inline without opening a new page', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'google-gemini',
              kind: 'llm',
              title: 'Google Gemini',
              vendor: 'Google',
              defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
              defaultAuthScheme: 'api_key',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          return Promise.resolve([
            {
              id: 'provider-gemini',
              name: 'gemini-main',
              template_id: 'google-gemini',
              endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
              credential: 'secret-1',
              is_enabled: true,
              enabled_models: ['gemini-3.5-flash'],
              config: {},
            },
          ])
        }
        if (path.startsWith('/api/ai-providers/availability?')) {
          return Promise.resolve({ items: [{ id: 'provider-gemini', status: 'available' }] })
        }
        if (path === '/api/ai-providers/models/provider-gemini') {
          return Promise.resolve({
            models: [{ id: 'gemini-3.5-flash' }, { id: 'gemini-3.1-pro-preview' }],
          })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({
            items: [{ id: 'secret-1', name: 'gemini-secret', template_id: 'single_value' }],
          })
        }
        if (path === '/api/secrets/secret-1/payload' && options?.method === 'PUT') {
          return Promise.resolve({ ok: true, version: 2 })
        }
        if (path.startsWith('/api/ai-providers/') && options?.method === 'PUT') {
          return Promise.resolve({ ok: true, body: options.body })
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'gemini-main' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTitle('More actions'))
    fireEvent.click(await screen.findByText('Edit'))

    fireEvent.click(screen.getByRole('button', { name: /Load all available models/i }))

    expect(await screen.findByLabelText('gemini-3.1-pro-preview')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('gemini-3.1-pro-preview'))

    fireEvent.click(screen.getByTitle('Edit secret value'))
    fireEvent.change(
      screen.getByPlaceholderText('Enter a new API key to update the current secret'),
      {
        target: { value: 'replacement-secret-value' },
      }
    )

    fireEvent.click(screen.getByRole('button', { name: /^Save/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/secrets/secret-1/payload', {
        method: 'PUT',
        body: { payload: { value: 'replacement-secret-value' } },
      })
    })
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/provider-gemini', {
        method: 'PUT',
        body: expect.objectContaining({
          enabled_models: ['gemini-3.5-flash', 'gemini-3.1-pro-preview'],
          credential: 'secret-1',
        }),
      })
    })
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('uses the unsaved inline secret value when loading models in edit mode', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'google-gemini',
              kind: 'llm',
              title: 'Google Gemini',
              vendor: 'Google',
              defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
              defaultAuthScheme: 'api_key',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          return Promise.resolve([
            {
              id: 'provider-gemini',
              name: 'gemini-main',
              template_id: 'google-gemini',
              endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
              credential: 'secret-1',
              is_enabled: true,
              enabled_models: ['gemini-3.5-flash'],
              config: {},
            },
          ])
        }
        if (path.startsWith('/api/ai-providers/availability?')) {
          return Promise.resolve({ items: [{ id: 'provider-gemini', status: 'available' }] })
        }
        if (path === '/api/ai-providers/fetch-models' && options?.method === 'POST') {
          return Promise.resolve({
            models: [{ id: 'gemini-3.5-flash' }, { id: 'gemini-3.1-pro-preview' }],
          })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({
            items: [{ id: 'secret-1', name: 'gemini-secret', template_id: 'single_value' }],
          })
        }
        if (path.startsWith('/api/ai-providers/') && options?.method === 'PUT') {
          return Promise.resolve({ ok: true, body: options.body })
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'gemini-main' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTitle('More actions'))
    fireEvent.click(await screen.findByText('Edit'))

    fireEvent.click(screen.getByTitle('Edit secret value'))
    fireEvent.change(
      screen.getByPlaceholderText('Enter a new API key to update the current secret'),
      {
        target: { value: 'replacement-secret-value' },
      }
    )

    fireEvent.click(screen.getByRole('button', { name: /Load all available models/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/fetch-models', {
        method: 'POST',
        body: expect.objectContaining({
          endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
          api_key: 'replacement-secret-value',
          template_id: 'google-gemini',
        }),
      })
    })
    expect(sendMock).not.toHaveBeenCalledWith('/api/ai-providers/models/provider-gemini', {
      method: 'GET',
    })
    expect(await screen.findByLabelText('gemini-3.1-pro-preview')).toBeInTheDocument()
  })

  it('keeps the provider name in edit mode so the title and update payload stay populated', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/ai-providers/templates') {
          return Promise.resolve([
            {
              id: 'google-gemini',
              kind: 'llm',
              title: 'Google Gemini',
              vendor: 'Google',
              defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
              defaultAuthScheme: 'api_key',
              fields: [
                { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
                { id: 'credential', label: 'API Key', type: 'secret_ref', required: true },
              ],
            },
          ])
        }
        if (path === '/api/ai-providers') {
          return Promise.resolve([
            {
              id: 'provider-gemini',
              name: 'gemini-main',
              template_id: 'google-gemini',
              endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
              credential: 'secret-1',
              is_enabled: true,
              enabled_models: ['gemini-3.5-flash'],
              config: {},
            },
          ])
        }
        if (path.startsWith('/api/ai-providers/availability?')) {
          return Promise.resolve({ items: [{ id: 'provider-gemini', status: 'available' }] })
        }
        if (path === '/api/ai-providers/models/provider-gemini') {
          return Promise.resolve({
            models: [{ id: 'gemini-3.5-flash' }, { id: 'gemini-3.1-pro-preview' }],
          })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === AI_PROVIDER_SECRET_PATH) {
          return Promise.resolve({
            items: [{ id: 'secret-1', name: 'gemini-secret', template_id: 'single_value' }],
          })
        }
        if (path.startsWith('/api/ai-providers/') && options?.method === 'PUT') {
          return Promise.resolve({ ok: true, body: options.body })
        }
        return Promise.resolve([])
      }
    )

    render(<AIProvidersPage />)

    expect(await screen.findByRole('button', { name: 'gemini-main' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTitle('More actions'))
    fireEvent.click(await screen.findByText('Edit'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('gemini-main')).toBeInTheDocument()
    expect(within(dialog).queryByText('New AI Provider')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Load all available models/i }))
    expect(await screen.findByLabelText('gemini-3.1-pro-preview')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('gemini-3.1-pro-preview'))

    fireEvent.click(screen.getByRole('button', { name: /^Save/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/provider-gemini', {
        method: 'PUT',
        body: expect.objectContaining({
          name: 'gemini-main',
          enabled_models: ['gemini-3.5-flash', 'gemini-3.1-pro-preview'],
        }),
      })
    })
  })

  it('shouldAutoListModels: skips when already fetched, reports fetch failure, and proceeds with pre-selected models', async () => {
    const setError = vi.fn()
    const setSaving = vi.fn()

    // Already fetched — no need to re-fetch
    await expect(
      shouldAutoListModels({
        lastFetchSucceeded: true,
        runFetchModels: vi.fn(),
        setError,
        setSaving,
      })
    ).resolves.toEqual({ canSave: true, selected: [], failedToLoad: false })

    // Not yet fetched, but fetch fails — caller can show a confirm dialog
    await expect(
      shouldAutoListModels({
        lastFetchSucceeded: false,
        runFetchModels: async () => ({ success: false, selected: [], error: 'Timed out' }),
        setError,
        setSaving,
      })
    ).resolves.toEqual({
      canSave: false,
      selected: [],
      failedToLoad: true,
      error: 'Timed out',
    })
    expect(setSaving).toHaveBeenCalledWith(false)

    // Not yet fetched, fetch succeeds with pre-selected models — proceeds
    setSaving.mockReset()
    await expect(
      shouldAutoListModels({
        lastFetchSucceeded: false,
        runFetchModels: async () => ({ success: true, selected: ['llama3', 'mistral'] }),
        setError,
        setSaving,
      })
    ).resolves.toEqual({
      canSave: true,
      selected: ['llama3', 'mistral'],
      failedToLoad: false,
    })
    expect(setSaving).not.toHaveBeenCalled()

    // Not yet fetched, fetch succeeds with zero models — save can still continue
    setSaving.mockReset()
    await expect(
      shouldAutoListModels({
        lastFetchSucceeded: false,
        runFetchModels: async () => ({ success: true, selected: [] }),
        setError,
        setSaving,
      })
    ).resolves.toEqual({ canSave: true, selected: [], failedToLoad: false })
    expect(setSaving).not.toHaveBeenCalled()
  })
})
