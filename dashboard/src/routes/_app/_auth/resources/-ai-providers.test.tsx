import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIProvidersPage, buildAIProviderPayload } from './ai-providers'

const sendMock = vi.fn()
const getOneMock = vi.fn()
const createMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: unknown }) =>
      component,
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

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      getOne: (...args: unknown[]) => getOneMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    }),
  },
}))

describe('AIProvidersPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getOneMock.mockReset()
    createMock.mockReset()

    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'generic-llm',
            kind: 'llm',
            title: 'OpenAI-Compatible',
            vendor: 'OpenAI-Compatible',
            description: 'Custom OpenAI-compatible endpoint',
            defaultAuthScheme: 'none',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: false },
            ],
          },
          {
            id: 'openai',
            kind: 'llm',
            title: 'OpenAI',
            vendor: 'OpenAI',
            description: 'Hosted OpenAI models',
            contextSize: 128000,
            defaultEndpoint: 'https://api.openai.com/v1',
            defaultAuthScheme: 'api_key',
            capabilities: ['hosted'],
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'apiVersion', label: 'API Version', type: 'string', placeholder: '2024-10-21' },
              {
                id: 'credential',
                label: 'API Key',
                type: 'secret_ref',
                required: true,
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
            defaultEndpoint: 'http://localhost:11434/v1',
            fields: [
              { id: 'endpoint', label: 'Base URL', type: 'url', required: true },
              { id: 'credential', label: 'API Key', type: 'secret_ref', required: false },
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
            defaultAuthScheme: 'api_key',
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
          auth_scheme: String(options.body?.auth_scheme ?? 'api_key'),
          credential: String(options.body?.credential ?? 'secret-1'),
          config: options.body?.config ?? {},
          description: String(options.body?.description ?? ''),
        })
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([])
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='single_value'))&sort=name"
      ) {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })

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
    expect(screen.getByRole('button', { name: /^OpenAI$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^OpenAI-Compatible$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Ollama$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^xAI$/i })).toBeInTheDocument()
    expect(screen.queryByText('Hosted OpenAI models')).not.toBeInTheDocument()
    expect(screen.queryByText('Local Ollama runtime')).not.toBeInTheDocument()
    expect(screen.queryByText('Custom OpenAI-compatible endpoint')).not.toBeInTheDocument()
    expect(document.querySelector('optgroup')).toBeNull()

    const productButtons = screen
      .getAllByRole('button')
      .filter(button => ['OpenAI', 'Ollama', 'xAI', 'OpenAI-Compatible'].includes(button.textContent ?? ''))
      .map(button => button.textContent)
    expect(productButtons).toEqual(['OpenAI', 'Ollama', 'xAI', 'OpenAI-Compatible'])

    fireEvent.change(
      screen.getByPlaceholderText('Search products like OpenAI, Ollama, Anthropic, OpenRouter...'),
      { target: { value: 'openai' } }
    )

    expect(screen.getByRole('button', { name: /^OpenAI$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ollama$/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^OpenAI$/i }))

    await waitFor(() => {
      expect(screen.getByText('Base URL')).toBeInTheDocument()
    })

    expect(screen.getByText('Add OpenAI AI Provider')).toBeInTheDocument()
    expect(screen.queryByLabelText('Profile')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Runtime Default')).not.toBeInTheDocument()
    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter API Key')).toBeInTheDocument()
    expect(screen.queryByText('API Version')).not.toBeInTheDocument()
    expect(screen.queryByText('Advanced Config (JSON)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByText('Generate API Key')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fill API Key' }))
    expect((screen.getByPlaceholderText('Enter API Key') as HTMLInputElement).value).toMatch(/^sk-/)

    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }))

    expect(screen.getByText('API Version')).toBeInTheDocument()
  })

  it('stores manual API keys as single-value secrets and keeps api_key auth', async () => {
    const templatesById = new Map([
      [
        'openai',
        {
          id: 'openai',
          kind: 'llm',
          title: 'OpenAI',
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
        payload: { value: 'sk-test-manual-key' },
      })
    )
    expect(getOneMock).toHaveBeenCalledWith('secret-1')
    expect(payload).toEqual(
      expect.objectContaining({
        auth_scheme: 'api_key',
        credential: 'secret-1',
      })
    )
  })

  it('renders reachability and timestamps in the list', async () => {
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
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
              reachability: {
                status: 'reachable',
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
      if (
        path ===
        "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='single_value'))&sort=name"
      ) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/ai-providers' && options?.method === 'POST') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })

    render(<AIProvidersPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/ai-providers/templates', { method: 'GET' })
    })

    fireEvent.click(screen.getByTitle('Refresh'))

  expect(await screen.findByText('Reachable')).toBeInTheDocument()
  expect(screen.getByText('Reachability')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.queryByText('Type')).not.toBeInTheDocument()
    expect(screen.queryByText('Auth')).not.toBeInTheDocument()
    expect(screen.getByText('Jan 05, 2025, 10:30 AM')).toBeInTheDocument()
    expect(screen.getByText('Jan 06, 2025, 11:45 AM')).toBeInTheDocument()
    expect(screen.queryByText('api_key')).not.toBeInTheDocument()
  })
})