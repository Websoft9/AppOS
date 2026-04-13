import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './topics.index'

const navigateMock = vi.fn()
const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => ({}),
  }),
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
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

describe('TopicsListPage', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/collections/topics/records?perPage=500&sort=-updated') {
        return Promise.resolve({
          items: [
            {
              id: 'topic-1',
              title: 'Alpha Topic',
              description: 'desc',
              created_by: 'user-1',
              closed: false,
              share_token: '',
              share_expires_at: '',
              created: '2026-04-10T08:00:00Z',
              updated: '2026-04-11T08:00:00Z',
            },
          ],
        })
      }

      if (path.startsWith('/api/collections/topic_comments/records?')) {
        return Promise.resolve({ items: [] })
      }

      return Promise.resolve({})
    })
  })

  it('shows a dedicated status column, refresh action, and overflow actions menu', async () => {
    const Component = (Route as unknown as { component: () => unknown }).component
    render(Component() as React.ReactNode)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Topics' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Topic' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Status/i })).toBeInTheDocument()
    expect(screen.queryByTitle('Share')).not.toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    expect(await screen.findByText('Share')).toBeInTheDocument()
    expect(screen.getByText('Close')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})