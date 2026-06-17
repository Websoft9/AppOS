import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetsPage } from './ai-assets'

const sendMock = vi.fn()
const navigateMock = vi.fn()
const outletMock = vi.fn(() => <div>Nested assets route</div>)

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
  }),
  useLocation: () => ({ pathname: window.location.pathname }),
  useNavigate: () => navigateMock,
  Outlet: () => outletMock(),
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
  },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

describe('AssetsPage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/ai-assets')
    navigateMock.mockReset()
    outletMock.mockClear()
    sendMock.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string; body?: string }) => {
      if (path === '/api/assets') {
        return Promise.resolve([
          {
            id: 'asset-1',
            name: 'Backup Script',
            kind: 'script',
            storage_kind: 'file',
            source_kind: 'local',
            path: 'main.sh',
            entrypoint: 'main.sh',
            updated: '2026-05-29T12:00:00Z',
          },
          {
            id: 'asset-3',
            name: 'Ops Skill',
            kind: 'skill',
            storage_kind: 'folder',
            source_kind: 'local',
            path: '',
            entrypoint: 'SKILL.md',
            updated: '2026-05-29T13:00:00Z',
          },
          {
            id: 'asset-4',
            name: 'Prompt Optimizer',
            kind: 'prompt',
            storage_kind: 'file',
            source_kind: 'local',
            path: 'prompt-optimizer.md',
            entrypoint: '',
            updated: '2026-05-29T14:00:00Z',
          },
        ])
      }
      if (path === '/api/assets/asset-1/content') {
        return Promise.resolve({
          id: 'asset-1',
          storage_kind: 'file',
          path: 'main.sh',
          entrypoint: 'main.sh',
          content: 'echo hello',
        })
      }
      if (path === '/api/assets/asset-2/content') {
        return Promise.resolve({
          id: 'asset-2',
          storage_kind: 'folder',
          path: '',
          entrypoint: 'SKILL.md',
          files: [{ path: 'SKILL.md', content: '# Skill' }],
        })
      }
      if (path === '/api/assets/asset-1' && options?.method === 'PUT') {
        return Promise.resolve({
          id: 'asset-1',
          name: 'Backup Script',
          kind: 'script',
          storage_kind: 'file',
          source_kind: 'local',
          path: 'main.sh',
          entrypoint: 'main.sh',
        })
      }
      if (path === '/api/assets/asset-1' && options?.method === 'DELETE') {
        return Promise.resolve({})
      }
      throw new Error(`Unhandled path: ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders resource-style family cards only and routes add actions to dedicated family pages', async () => {
    render(<AssetsPage />)

    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('3 canonical families')).toBeInTheDocument()
    })

    expect(screen.getByText('3 canonical families')).toBeInTheDocument()
    expect(screen.getAllByText('Open family').length).toBeGreaterThan(0)
    expect(
      screen.getByText(
        'Reusable single-file assets for terminal snippets, operator workflows, and recovery actions.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Bundled skill packages with structured files, entrypoints, and reusable guidance content.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Reusable system prompts for AI Copilot and operators.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search assets')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Prompts/i })).toHaveAttribute(
      'href',
      '/ai-assets/prompts'
    )
    expect(screen.getByRole('link', { name: /AI Skills/i })).toHaveAttribute(
      'href',
      '/ai-assets/skills'
    )
    expect(screen.getByRole('link', { name: /Scripts/i })).toHaveAttribute(
      'href',
      '/ai-assets/scripts'
    )

    fireEvent.click(screen.getByRole('button', { name: /Add AI Skill/i }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/ai-assets/skills', search: { create: '1' } })

    fireEvent.click(screen.getByRole('button', { name: /Add AI Prompt/i }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/ai-assets/prompts', search: { create: '1' } })
  })

  it('renders nested family routes instead of the hub on child asset paths', () => {
    window.history.pushState({}, '', '/ai-assets/scripts')

    render(<AssetsPage />)

    expect(screen.getByText('Nested assets route')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Assets' })).not.toBeInTheDocument()
  })
})
