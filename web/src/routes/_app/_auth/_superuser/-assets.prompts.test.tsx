import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetsPromptsPage } from './ai-assets.prompts'

const sendMock = vi.fn()
const openMock = vi.fn()
const setHeaderRightStartContentMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({ ...config }),
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
  useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/contexts/LayoutContext', () => ({
  useOptionalLayout: () => ({
    setHeaderRightStartContent: setHeaderRightStartContentMock,
  }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div />,
}))

describe('AssetsPromptsPage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/ai-assets/prompts')
    window.localStorage.clear()
    openMock.mockReset()
    openMock.mockReturnValue({} as Window)
    setHeaderRightStartContentMock.mockReset()
    vi.stubGlobal('open', openMock)
    sendMock.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/assets') {
        return Promise.resolve([
          {
            id: 'prompt-system',
            name: 'Prompt Optimizer',
            description: 'System-managed meta prompt.',
            kind: 'prompt',
            storage_kind: 'file',
            source_kind: 'local',
            path: 'prompt-optimizer.md',
            entrypoint: '',
            template_key: 'prompt-meta-optimizer',
            is_system: true,
            is_template: false,
            updated: '2026-05-29T12:00:00Z',
          },
          {
            id: 'prompt-template',
            name: 'Code Review Assistant',
            description: 'Prompt template for structured code review.',
            kind: 'prompt',
            storage_kind: 'file',
            source_kind: 'local',
            path: 'code-review-assistant.md',
            entrypoint: '',
            template_key: 'prompt-template-code-review',
            is_system: false,
            is_template: true,
            updated: '2026-05-29T13:00:00Z',
          },
          {
            id: 'prompt-custom',
            name: 'Support Prompt',
            description: 'Custom prompt.',
            kind: 'prompt',
            storage_kind: 'file',
            source_kind: 'local',
            path: 'support-prompt.md',
            entrypoint: '',
            updated: '2026-05-29T14:00:00Z',
          },
        ])
      }
      if (path === '/api/assets/prompt-template/content') {
        return Promise.resolve({
          id: 'prompt-template',
          storage_kind: 'file',
          path: 'code-review-assistant.md',
          entrypoint: '',
          content: 'Review code carefully.',
        })
      }
      if (path === '/api/assets' && options?.method === 'POST') {
        return Promise.resolve({ id: 'new-prompt' })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders prompt assets, starter templates, and copilot handoff actions', async () => {
    render(<AssetsPromptsPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI Prompts' })).toBeInTheDocument()
    })

    expect(setHeaderRightStartContentMock).toHaveBeenCalled()
    const breadcrumb = setHeaderRightStartContentMock.mock.calls[0]?.[0] as React.ReactElement
    render(breadcrumb)
    expect(screen.getByRole('link', { name: 'Assets' })).toHaveAttribute('href', '/ai-assets')
    expect(screen.getAllByText('AI Prompts').length).toBeGreaterThan(0)

    expect(screen.getByPlaceholderText('Search prompts...')).toBeInTheDocument()
    expect(screen.getByText('Prompt Optimizer')).toBeInTheDocument()
    expect(screen.getByText('Support Prompt')).toBeInTheDocument()
    expect(screen.getAllByText('System').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Template').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Add Prompt' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /Add Prompt/ })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Name/)).toBeInTheDocument()
    expect(within(dialog).getByText('Starter Tempate')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue(/## Role/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Code Review Assistant' }))

    await waitFor(() => {
      expect(within(dialog).getByDisplayValue('Review code carefully.')).toBeInTheDocument()
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to AI Copilot' }))
    expect(window.localStorage.getItem('ai-copilot.draft-handoff.v1')).toBe('Review code carefully.')
    expect(openMock).toHaveBeenCalledWith('/ai-copilot', '_blank', 'noopener,noreferrer')
  })
})