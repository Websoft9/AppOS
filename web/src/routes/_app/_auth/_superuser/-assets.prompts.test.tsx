import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetsPromptsPage } from './ai-assets.prompts'

const sendMock = vi.fn()
const openMock = vi.fn()
const setHeaderRightStartContentMock = vi.fn()
let apiImplementation: (path: string, options?: { method?: string; body?: string }) => Promise<unknown>

type PromptAsset = {
  id: string
  name: string
  description?: string
  kind: 'prompt'
  storage_kind: 'file'
  source_kind: 'local'
  path: string
  entrypoint: string
  prompt_scope: 'system' | 'task'
  template_key?: string
  is_system?: boolean
  is_template?: boolean
  created?: string
  updated?: string
  content: string
}

function clonePromptAsset(asset: PromptAsset) {
  return { ...asset }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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
    const promptAssets: PromptAsset[] = [
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
        prompt_scope: 'system',
        is_system: true,
        is_template: false,
        created: '2026-05-29T12:00:00Z',
        updated: '2026-05-29T12:00:00Z',
        content: 'Optimize prompts.',
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
        prompt_scope: 'task',
        is_system: false,
        is_template: true,
        created: '2026-05-29T13:00:00Z',
        updated: '2026-05-29T13:00:00Z',
        content: 'Review code carefully.',
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
        prompt_scope: 'task',
        created: '2026-05-29T14:00:00Z',
        updated: '2026-05-29T14:00:00Z',
        content: 'Support users with concise steps.',
      },
      {
        id: 'prompt-system-custom',
        name: 'Ops Guard Prompt',
        description: 'Editable system prompt.',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'ops-guard-prompt.md',
        entrypoint: '',
        prompt_scope: 'system',
        created: '2026-05-29T15:00:00Z',
        updated: '2026-05-29T15:00:00Z',
        content: 'Guard operational chat behavior.',
      },
    ]

    window.history.pushState({}, '', '/ai-assets/prompts')
    window.localStorage.clear()
    openMock.mockReset()
    openMock.mockReturnValue({} as Window)
    setHeaderRightStartContentMock.mockReset()
    vi.stubGlobal('open', openMock)
    sendMock.mockReset()
    apiImplementation = (path: string, options?: { method?: string; body?: string }) => {
      if (path === '/api/assets') {
        if (options?.method === 'POST') {
          const payload = JSON.parse(String(options.body ?? '{}')) as {
            name: string
            description?: string
            kind: 'prompt'
            storage_kind: 'file'
            prompt_scope: 'system' | 'task'
            is_template?: boolean
            content: string
          }
          const next: PromptAsset = {
            id: `prompt-${promptAssets.length + 1}`,
            name: payload.name,
            description: payload.description,
            kind: 'prompt',
            storage_kind: 'file',
            source_kind: 'local',
            path: `${payload.name.toLowerCase().replace(/\s+/g, '-')}.md`,
            entrypoint: '',
            prompt_scope: payload.prompt_scope,
            is_system: false,
            is_template: payload.is_template === true,
            created: '2026-06-18T07:00:00Z',
            updated: '2026-06-18T07:00:00Z',
            content: payload.content,
          }
          promptAssets.push(next)
          return Promise.resolve(clonePromptAsset(next))
        }
        return Promise.resolve(promptAssets.map(clonePromptAsset))
      }
      if (path === '/api/assets/prompt-template/content') {
        const asset = promptAssets.find(item => item.id === 'prompt-template')
        return Promise.resolve({
          id: asset?.id,
          storage_kind: 'file',
          path: asset?.path,
          entrypoint: '',
          content: asset?.content,
        })
      }
      if (path.startsWith('/api/assets/') && path.endsWith('/content')) {
        const assetId = path.replace('/api/assets/', '').replace('/content', '')
        const asset = promptAssets.find(item => item.id === assetId)
        return Promise.resolve({
          id: asset?.id,
          storage_kind: 'file',
          path: asset?.path,
          entrypoint: asset?.entrypoint ?? '',
          content: asset?.content ?? '',
        })
      }
      if (path.startsWith('/api/assets/') && options?.method === 'PUT') {
        const assetId = path.replace('/api/assets/', '')
        const payload = JSON.parse(String(options.body ?? '{}')) as {
          name: string
          description?: string
          prompt_scope: 'system' | 'task'
          is_template?: boolean
          content: string
        }
        const asset = promptAssets.find(item => item.id === assetId)
        if (!asset) return Promise.resolve({})
        asset.name = payload.name
        asset.description = payload.description
        asset.prompt_scope = payload.prompt_scope
        asset.is_template = payload.is_template === true
        asset.content = payload.content
        asset.updated = '2026-06-18T07:05:00Z'
        return Promise.resolve(clonePromptAsset(asset))
      }
      return Promise.resolve({})
    }
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: string }) =>
      apiImplementation(path, options)
    )
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
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getAllByText('System Prompt').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Task Instruction').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Template').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Add Prompt' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /Add Prompt/ })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Name/)).toBeInTheDocument()
    expect(within(dialog).getByRole('radiogroup', { name: 'Prompt Type' })).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /System Prompt/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(within(dialog).getByRole('radio', { name: /Task Instruction/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(within(dialog).getByText('Starter Tempate')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Prompt content help')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Prompt Content/)).toHaveValue('')
    expect(within(dialog).queryByLabelText('Description')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Show advanced settings' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText('Starter Tempate'))
    expect(screen.getByRole('option', { name: 'Blank' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Code Review Assistant · Task Instruction' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Code Review Assistant · Task Instruction' }))

    await waitFor(() => {
      expect(within(dialog).getByDisplayValue('Review code carefully.')).toBeInTheDocument()
    })

    fireEvent.click(within(dialog).getByRole('radio', { name: /System Prompt/ }))
    expect(within(dialog).getByRole('button', { name: 'Send to AI Copilot' })).toBeDisabled()
    fireEvent.click(within(dialog).getByLabelText('Prompt content help'))
    expect(
      screen.getByText(
        'Use system prompts for stable AI Copilot behavior that should persist across a conversation. Use {{var}} placeholders in plain text when needed. Variable resolution is handled by consumers later.'
      )
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('radio', { name: /Task Instruction/ }))
    expect(within(dialog).getByRole('button', { name: 'Send to AI Copilot' })).toBeEnabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to AI Copilot' }))
    expect(window.localStorage.getItem('ai-copilot.draft-handoff.v1')).toBe('Review code carefully.')
    expect(openMock).toHaveBeenCalledWith('/ai-copilot', '_blank', 'noopener,noreferrer')

    fireEvent.click(within(dialog).getByLabelText('Starter Tempate'))
    fireEvent.click(screen.getByRole('option', { name: 'Blank' }))
    expect(within(dialog).getByLabelText(/Prompt Content/)).toHaveValue('')

    fireEvent.change(within(dialog).getByLabelText(/Name/), {
      target: { value: 'Task Prompt' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Prompt Content/), {
      target: { value: 'Handle this task carefully.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Task Prompt')).toBeInTheDocument()
      const taskPromptRow = screen.getByText('Task Prompt').closest('tr')
      expect(taskPromptRow).not.toBeNull()
      expect(within(taskPromptRow as HTMLElement).getByText('Task Instruction')).toBeInTheDocument()
    })
  })

  it('lets custom prompts opt into templates and keeps system prompts locked', async () => {
    render(<AssetsPromptsPage />)

    await screen.findByText('Support Prompt')

    const supportRow = screen.getByText('Support Prompt').closest('tr')
    expect(supportRow).not.toBeNull()
    fireEvent.click(within(supportRow as HTMLElement).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText('Set as template')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show advanced settings' }))
    const toggle = within(dialog).getByLabelText('Set as template') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(within(dialog).getByRole('radio', { name: /System Prompt/ }))
    fireEvent.click(toggle)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const supportPromptRow = screen.getByText('Support Prompt').closest('tr')
      expect(supportPromptRow).not.toBeNull()
      expect(within(supportPromptRow as HTMLElement).getByText('System Prompt')).toBeInTheDocument()
    })

    const systemRow = screen.getByText('Prompt Optimizer').closest('tr')
    expect(systemRow).not.toBeNull()
    expect(within(systemRow as HTMLElement).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(
      within(systemRow as HTMLElement).getByRole('button', { name: 'Restore default' })
    ).toBeInTheDocument()
    expect(within(systemRow as HTMLElement).getByText('New AI Copilot')).toBeInTheDocument()
    fireEvent.click(within(systemRow as HTMLElement).getByText('New AI Copilot'))
    expect(window.localStorage.getItem('ai-copilot.session-handoff.v1')).toContain('prompt-system')
    expect(openMock).toHaveBeenCalledWith('/ai-copilot', '_blank', 'noopener,noreferrer')
  })

  it('saves both prompt scopes on create, refreshes the list, and preserves scope switches during edit hydration', async () => {
    const promptCustomContent = deferred<{
      id: string
      storage_kind: 'file'
      path: string
      entrypoint: string
      content: string
    }>()
    const promptSystemCustomContent = deferred<{
      id: string
      storage_kind: 'file'
      path: string
      entrypoint: string
      content: string
    }>()

    const previousApiImplementation = apiImplementation
    apiImplementation = (path: string, options?: { method?: string; body?: string }) => {
      if (path === '/api/assets/prompt-custom/content') {
        return promptCustomContent.promise
      }
      if (path === '/api/assets/prompt-system-custom/content') {
        return promptSystemCustomContent.promise
      }
      return previousApiImplementation(path, options)
    }

    render(<AssetsPromptsPage />)

    await screen.findByText('Support Prompt')

    fireEvent.click(screen.getByRole('button', { name: 'Add Prompt' }))
    let dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /System Prompt/ }))
    fireEvent.change(within(dialog).getByLabelText(/Name/), {
      target: { value: 'System Draft' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Prompt Content/), {
      target: { value: 'Keep the assistant strict.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const systemDraftRow = screen.getByText('System Draft').closest('tr')
      expect(systemDraftRow).not.toBeNull()
      expect(within(systemDraftRow as HTMLElement).getByText('System Prompt')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Prompt' }))
    dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Name/), {
      target: { value: 'Task Draft' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Prompt Content/), {
      target: { value: 'Handle the task.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const taskDraftRow = screen.getByText('Task Draft').closest('tr')
      expect(taskDraftRow).not.toBeNull()
      expect(within(taskDraftRow as HTMLElement).getByText('Task Instruction')).toBeInTheDocument()
    })

    const taskRow = screen.getByText('Support Prompt').closest('tr')
    expect(taskRow).not.toBeNull()
    fireEvent.click(within(taskRow as HTMLElement).getByRole('button', { name: 'Edit' }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /System Prompt/ }))
    promptCustomContent.resolve({
      id: 'prompt-custom',
      storage_kind: 'file',
      path: 'support-prompt.md',
      entrypoint: '',
      content: 'Support users with concise steps.',
    })

    await waitFor(() => {
      expect(within(dialog).getByDisplayValue('Support users with concise steps.')).toBeInTheDocument()
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const updatedTaskRow = screen.getByText('Support Prompt').closest('tr')
      expect(updatedTaskRow).not.toBeNull()
      expect(within(updatedTaskRow as HTMLElement).getByText('System Prompt')).toBeInTheDocument()
    })

    fireEvent.click(within(screen.getByText('Support Prompt').closest('tr') as HTMLElement).getByRole('button', { name: 'Edit' }))
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /System Prompt/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    const systemCustomRow = screen.getByText('Ops Guard Prompt').closest('tr')
    expect(systemCustomRow).not.toBeNull()
    fireEvent.click(within(systemCustomRow as HTMLElement).getByRole('button', { name: 'Edit' }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Task Instruction/ }))
    promptSystemCustomContent.resolve({
      id: 'prompt-system-custom',
      storage_kind: 'file',
      path: 'ops-guard-prompt.md',
      entrypoint: '',
      content: 'Guard operational chat behavior.',
    })

    await waitFor(() => {
      expect(within(dialog).getByDisplayValue('Guard operational chat behavior.')).toBeInTheDocument()
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const updatedSystemRow = screen.getByText('Ops Guard Prompt').closest('tr')
      expect(updatedSystemRow).not.toBeNull()
      expect(within(updatedSystemRow as HTMLElement).getByText('Task Instruction')).toBeInTheDocument()
    })

    fireEvent.click(within(screen.getByText('Ops Guard Prompt').closest('tr') as HTMLElement).getByRole('button', { name: 'Edit' }))
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Task Instruction/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
})