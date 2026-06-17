import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SCRIPT_LANGUAGE_OPTIONS,
  formatScriptLanguageOptionLabel,
} from '@/lib/assets-script-languages'
import { AssetsScriptsPage } from './ai-assets.scripts'

const sendMock = vi.fn()
const originalFileReader = globalThis.FileReader
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

describe('AssetsScriptsPage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/ai-assets/scripts')
    setHeaderRightStartContentMock.mockReset()
    sendMock.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/assets') {
        return Promise.resolve([
          {
            id: 'script-1',
            name: 'Backup Script',
            description: 'Script for backups',
            kind: 'script',
            storage_kind: 'file',
            source_kind: 'local',
            language: 'shell',
            reference: 'https://example.com/backup.sh',
            path: 'main.sh',
            entrypoint: 'main.sh',
            updated: '2026-05-29T12:00:00Z',
          },
        ])
      }
      if (path === '/api/assets/script-1/content') {
        return Promise.resolve({
          id: 'script-1',
          storage_kind: 'file',
          path: 'main.sh',
          entrypoint: 'main.sh',
          content: 'echo hello',
        })
      }
      if (path === '/api/assets/script-1' && options?.method === 'PUT') {
        return Promise.resolve({ id: 'script-1' })
      }
      if (path === '/api/assets/script/pull' && options?.method === 'POST') {
        return Promise.resolve({ content: 'echo pulled' })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    globalThis.FileReader = originalFileReader
    cleanup()
  })

  it('renders the scripts list page with secrets-style actions and family-specific forms', async () => {
    render(<AssetsScriptsPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Scripts' })).toBeInTheDocument()
    })

    expect(setHeaderRightStartContentMock).toHaveBeenCalled()
    const breadcrumb = setHeaderRightStartContentMock.mock.calls[0]?.[0] as React.ReactElement
    render(breadcrumb)
    expect(screen.getByRole('link', { name: 'Assets' })).toHaveAttribute('href', '/ai-assets')
    expect(screen.getAllByText('Scripts').length).toBeGreaterThan(0)

    expect(
      screen.getByText(
        'Reusable single-file assets for terminal snippets, operator workflows, and recovery actions.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Script' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search scripts...')).toBeInTheDocument()
    expect(screen.getByText('Total 1 items')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.getByText('Backup Script')).toBeInTheDocument()
    expect(screen.getByText('shell')).toBeInTheDocument()
    expect(screen.getByText('Configured')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Edit'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /Edit Script/ })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Name/)).toBeInTheDocument()
    expect(within(dialog).queryByText('Metadata')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Content')).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Show advanced settings' })
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/Language/)).toBeInTheDocument()
    expect(within(dialog).getByText(formatScriptLanguageOptionLabel('shell'))).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Script Source')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Script Content/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show advanced settings' }))
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Script for backups')
    expect(within(dialog).queryByLabelText('File Path')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Entrypoint')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Generated File')).not.toBeInTheDocument()
  })

  it('keeps search local without adding query params to the route', async () => {
    render(<AssetsScriptsPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Scripts' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Search scripts...'), {
      target: { value: 'backup' },
    })

    expect(window.location.pathname).toBe('/ai-assets/scripts')
    expect(window.location.search).toBe('')
  })

  it('pulls and uploads script content inside the simplified form', async () => {
    class MockFileReader {
      result = 'echo uploaded'
      onload: null | (() => void) = null
      onerror: null | (() => void) = null

      readAsText() {
        this.onload?.()
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader

    render(<AssetsScriptsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Script' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Script' }))
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit asset name' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Script Source'), {
      target: { value: 'https://example.com/backup.sh' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('echo pulled')).toBeInTheDocument()
    })

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(['echo uploaded'], 'backup.sh', { type: 'text/plain' })] },
    })

    await waitFor(() => {
      expect(screen.getByDisplayValue('echo uploaded')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Upload script content' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Script content help' })).toBeInTheDocument()
  })

  it('defines a richer script language catalog with explicit suffix labels', () => {
    expect(SCRIPT_LANGUAGE_OPTIONS.map(option => option.value)).toEqual(
      expect.arrayContaining([
        'shell',
        'bash',
        'zsh',
        'python',
        'javascript',
        'typescript',
        'powershell',
        'ruby',
        'perl',
        'php',
        'lua',
        'groovy',
        'r',
        'other',
      ])
    )
    expect(formatScriptLanguageOptionLabel('bash')).toBe('Bash (.bash, .sh)')
    expect(formatScriptLanguageOptionLabel('other')).toBe('Other (custom suffix)')
  })
})
