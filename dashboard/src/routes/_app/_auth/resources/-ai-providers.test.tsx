import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIProvidersPage } from './ai-providers'

const sendMock = vi.fn()

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
      getOne: vi.fn(),
      create: vi.fn(),
    }),
  },
}))

describe('AIProvidersPage', () => {
  beforeEach(() => {
    sendMock.mockReset()

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/ai-providers/templates') {
        return Promise.resolve([
          {
            id: 'openai',
            kind: 'llm',
            title: 'OpenAI',
            capabilities: ['hosted'],
            fields: [{ id: 'endpoint', label: 'Base URL', type: 'url', required: true }],
          },
          {
            id: 'ollama',
            kind: 'llm',
            title: 'Ollama',
            capabilities: ['local', 'openai-compatible'],
            defaultEndpoint: 'http://localhost:11434/v1',
            fields: [{ id: 'endpoint', label: 'Base URL', type: 'url', required: true }],
          },
        ])
      }
      if (path === '/api/ai-providers') {
        return Promise.resolve([])
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='single_value'||template_id='api_key'||template_id='basic_auth'))&sort=name"
      ) {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })
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

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.queryByText('Favorites only')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search any AI providers')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }))

    await screen.findByRole('dialog')

    expect(screen.getByText('Choose a Product')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Search products like OpenAI, Ollama, Anthropic, OpenRouter...')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /OpenAI/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ollama/i })).toBeInTheDocument()
    expect(document.querySelector('optgroup')).toBeNull()

    fireEvent.change(
      screen.getByPlaceholderText('Search products like OpenAI, Ollama, Anthropic, OpenRouter...'),
      { target: { value: 'ollama' } }
    )

    expect(screen.getByRole('button', { name: /Ollama/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^OpenAI$/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Ollama/i }))

    await waitFor(() => {
      expect(screen.getByText('Base URL')).toBeInTheDocument()
    })

    expect(screen.getByText('Add Ollama AI Provider')).toBeInTheDocument()
    expect(screen.queryByLabelText('Profile')).not.toBeInTheDocument()
  })
})