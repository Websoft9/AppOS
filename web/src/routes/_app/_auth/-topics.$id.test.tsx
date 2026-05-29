import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './topics.$id'

const navigateMock = vi.fn()
const sendMock = vi.fn()
const originalFileReader = globalThis.FileReader

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'topic-1' }),
    useNavigate: () => navigateMock,
  }),
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
  },
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'owner@example.com' },
  }),
}))

vi.mock('@/components/ui/markdown', () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label={placeholder ?? 'Markdown editor'}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  ),
  MarkdownView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

describe('TopicDetailPage', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    sendMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    globalThis.FileReader = originalFileReader
  })

  function mockTopicPage(importPolicy?: { maxDescriptionImportBytes?: number; textOnly?: boolean }) {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/collections/topics/records/topic-1') {
        return Promise.resolve({
          id: 'topic-1',
          title: 'Alpha Topic',
          description: 'desc',
          created_by: 'user-1',
          closed: false,
          share_token: '',
          share_expires_at: '',
          created: '2026-04-10T08:00:00Z',
          updated: '2026-04-11T08:00:00Z',
        })
      }

      if (path.startsWith('/api/collections/topic_comments/records?')) {
        return Promise.resolve({ items: [] })
      }

      if (path === '/api/topics/policy/import') {
        return Promise.resolve({
          maxDescriptionImportBytes: importPolicy?.maxDescriptionImportBytes ?? 2048,
          textOnly: importPolicy?.textOnly ?? true,
        })
      }

      if (path === '/api/topics/policy/share') {
        return Promise.resolve({
          shareMaxMinutes: 60,
          shareDefaultMinutes: 30,
        })
      }

      return Promise.resolve({})
    })
  }

  it('uses import policy to change the upload label when text-only is disabled', async () => {
    mockTopicPage({ maxDescriptionImportBytes: 2097152, textOnly: false })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alpha Topic' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await waitFor(() => {
      expect(screen.getByText('Edit Topic')).toBeInTheDocument()
      expect(screen.getByText('Upload file')).toBeInTheDocument()
    })

    expect(screen.queryByText('Upload text file')).not.toBeInTheDocument()
  })

  it('uses import policy max bytes when validating uploaded description files', async () => {
    mockTopicPage({ maxDescriptionImportBytes: 4096, textOnly: true })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    const { container } = render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alpha Topic' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await waitFor(() => {
      expect(screen.getByText('Upload text file')).toBeInTheDocument()
    })

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!fileInput) {
      throw new Error('expected topic description file input to be rendered')
    }

    const oversizedFile = new File(['x'.repeat(5000)], 'topic.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } })

    await waitFor(() => {
      expect(screen.getByText('File too large (max 4 KB)')).toBeInTheDocument()
    })
  })

  it('rejects binary-looking uploads when text-only imports are enabled', async () => {
    mockTopicPage({ maxDescriptionImportBytes: 2048, textOnly: true })

    class MockFileReader {
      result: string | ArrayBuffer | null = 'hello\0world'
      onload: null | (() => void) = null
      onerror: null | (() => void) = null

      readAsText() {
        this.onload?.()
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader

    const Component = (Route as unknown as { component: React.ComponentType }).component
    const { container } = render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alpha Topic' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await waitFor(() => {
      expect(screen.getByText('Upload text file')).toBeInTheDocument()
    })

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!fileInput) {
      throw new Error('expected topic description file input to be rendered')
    }

    const file = new File(['hello'], 'topic.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Binary file detected, please upload a text file')).toBeInTheDocument()
    })
  })

  it('uses share policy defaults and limits in the share dialog', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/collections/topics/records/topic-1') {
        return Promise.resolve({
          id: 'topic-1',
          title: 'Alpha Topic',
          description: 'desc',
          created_by: 'user-1',
          closed: false,
          share_token: '',
          share_expires_at: '',
          created: '2026-04-10T08:00:00Z',
          updated: '2026-04-11T08:00:00Z',
        })
      }
      if (path.startsWith('/api/collections/topic_comments/records?')) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/topics/policy/import') {
        return Promise.resolve({
          maxDescriptionImportBytes: 2048,
          textOnly: true,
        })
      }
      if (path === '/api/topics/policy/share') {
        return Promise.resolve({
          shareMaxMinutes: 90,
          shareDefaultMinutes: 45,
        })
      }
      return Promise.resolve({})
    })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alpha Topic' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    const shareMinutesInput = await screen.findByLabelText('Validity (minutes)')
    expect(shareMinutesInput).toHaveValue(45)
    expect(shareMinutesInput).toHaveAttribute('max', '90')

    fireEvent.change(shareMinutesInput, { target: { value: '91' } })
    expect(screen.getByRole('button', { name: 'Generate Link' })).toBeDisabled()
  })
})
