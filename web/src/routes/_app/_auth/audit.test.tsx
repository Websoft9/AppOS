import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditPage } from './audit'

const collectionGetListMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: ({ children, to, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} className={className} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    authStore: {
      record: { collectionName: '_superusers' },
    },
    collection: () => ({
      getList: (...args: unknown[]) => collectionGetListMock(...args),
    }),
  },
}))

describe('AuditPage', () => {
  beforeEach(() => {
    collectionGetListMock.mockReset()
    collectionGetListMock.mockImplementation((_page: number, _perPage: number, options?: { filter?: string }) => {
      if (options?.filter === 'status = "success"') return Promise.resolve({ totalItems: 1 })
      if (options?.filter === 'status = "failed"') return Promise.resolve({ totalItems: 1 })
      if (options?.filter === 'status = "pending"') return Promise.resolve({ totalItems: 0 })

      return Promise.resolve({
        items: [
          {
            id: 'audit-1',
            user_id: 'user-1',
            user_email: 'owner@example.com',
            action: 'app.deploy',
            resource_type: 'app',
            resource_id: 'app-1',
            resource_name: 'My App',
            ip: '10.0.0.1',
            status: 'success',
            detail: null,
            created: '2026-04-21T12:00:00Z',
          },
        ],
        totalPages: 3,
        totalItems: 2,
      })
    })
  })

  it('uses icon-only header actions and keeps the page-size selector in the bottom pagination group', async () => {
    render(<AuditPage />)

    expect(await screen.findByText('Audit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open logs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh audit' })).toBeInTheDocument()
    expect(screen.queryByText('Refresh')).not.toBeInTheDocument()
    expect(screen.queryByText('Logs')).not.toBeInTheDocument()

    const pagination = screen.getByText('Page 1 of 3').closest('div')
    if (!pagination) throw new Error('Expected pagination container')

    const paginationControls = within(pagination).getAllByRole('combobox')
    expect(paginationControls).toHaveLength(1)
    expect(within(pagination).getByRole('button', { name: 'Previous' })).toBeInTheDocument()
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeInTheDocument()

    await waitFor(() => {
      expect(collectionGetListMock).toHaveBeenCalled()
    })
  })
})