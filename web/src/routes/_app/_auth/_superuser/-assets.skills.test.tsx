import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetsSkillsPage } from './ai-assets.skills'

const sendMock = vi.fn()
const setHeaderRightStartContentMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({ ...config }),
  useNavigate: () => vi.fn(),
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

vi.mock('@/contexts/LayoutContext', () => ({
  useOptionalLayout: () => ({
    setHeaderRightStartContent: setHeaderRightStartContentMock,
  }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  DropdownMenuSeparator: () => <div />,
}))

describe('AssetsSkillsPage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/ai-assets/skills')
    setHeaderRightStartContentMock.mockReset()
    sendMock.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/assets') {
        return Promise.resolve([
          {
            id: 'skill-1',
            name: 'Ops Skill',
            kind: 'skill',
            storage_kind: 'folder',
            source_kind: 'local',
            path: '',
            entrypoint: 'SKILL.md',
            updated: '2026-05-29T13:00:00Z',
          },
        ])
      }
      if (path === '/api/assets/skill-1/content') {
        return Promise.resolve({
          id: 'skill-1',
          storage_kind: 'folder',
          path: '',
          entrypoint: 'SKILL.md',
          files: [{ path: 'SKILL.md', content: '# Skill' }],
        })
      }
      if (path === '/api/assets/skill-1' && options?.method === 'PUT') {
        return Promise.resolve({ id: 'skill-1' })
      }
      if (path === '/api/assets/skill/pull' && options?.method === 'POST') {
        return Promise.resolve({
          entrypoint: 'docs/SKILL.md',
          files: [
            { path: 'docs/SKILL.md', content: '# Pulled Skill' },
            { path: 'docs/guide.md', content: 'guide' },
          ],
        })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the skills list page with dedicated family actions and form fields', async () => {
    render(<AssetsSkillsPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI Skills' })).toBeInTheDocument()
    })

    expect(setHeaderRightStartContentMock).toHaveBeenCalled()
    const breadcrumb = setHeaderRightStartContentMock.mock.calls[0]?.[0] as React.ReactElement
    render(breadcrumb)
    expect(screen.getByRole('link', { name: 'Assets' })).toHaveAttribute('href', '/ai-assets')
    expect(
      screen.getByText(
        'Bundled skill packages with structured files, entrypoints, and reusable guidance content.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Skill' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search skills...')).toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(screen.getByText('Total 1 items')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.getByText('Ops Skill')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add Skill' }))
    const createDialog = screen.getByRole('dialog')
    expect(within(createDialog).getByRole('heading', { name: 'Add Skill' })).toBeInTheDocument()
    expect((within(createDialog).getByLabelText('Name') as HTMLInputElement).value).not.toBe('')
    expect(within(createDialog).getByLabelText('Skill Source')).toBeInTheDocument()
    expect(
      within(createDialog).getByRole('button', { name: 'Skill source help' })
    ).toBeInTheDocument()
    expect(within(createDialog).getByText('Skill Files')).toBeInTheDocument()
  })
})
