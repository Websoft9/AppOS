import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './groups.index'

const navigateMock = vi.fn()
const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
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

describe('GroupsListPage', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/collections/groups/records?perPage=500') {
        return Promise.resolve({
          items: [
            {
              id: 'group-1',
              name: 'Alpha Group',
              description: 'Primary group',
              created_by: 'user-1',
              created: '2026-04-10T08:00:00Z',
              updated: '2026-04-11T08:00:00Z',
            },
          ],
        })
      }

      if (path === '/api/collections/group_items/records?perPage=500') {
        return Promise.resolve({
          items: [{ id: 'item-1', group_id: 'group-1', object_type: 'server', object_id: 'server-1' }],
        })
      }

      return Promise.resolve({})
    })
  })

  it('adds refresh, sortable descriptive columns, and overflow actions menu', async () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Group' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Description$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Breakdown$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Creator$/i })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    expect(await screen.findByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})