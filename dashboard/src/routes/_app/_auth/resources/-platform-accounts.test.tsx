import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformAccountsPage } from './platform-accounts'

const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: unknown }) =>
      component,
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
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

describe('PlatformAccountsPage', () => {
  beforeEach(() => {
    sendMock.mockReset()

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/provider-accounts/templates') {
        return Promise.resolve([
          {
            id: 'generic-aws-account',
            category: 'cloud',
            kind: 'aws',
            title: 'AWS Account',
            fields: [
              { id: 'identifier', label: 'Account ID', type: 'text', required: true },
              { id: 'region', label: 'Default Region', type: 'text' },
            ],
          },
          {
            id: 'github-app-installation',
            category: 'developer-platform',
            kind: 'github',
            title: 'GitHub App Installation',
            fields: [
              { id: 'identifier', label: 'Installation ID', type: 'text', required: true },
              { id: 'organization', label: 'Organization', type: 'text', required: true },
            ],
          },
        ])
      }
      if (path === '/api/provider-accounts') {
        return Promise.resolve([])
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/secrets/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve([])
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('opens a product picker before showing the selected platform account form', async () => {
    render(<PlatformAccountsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/provider-accounts/templates', { method: 'GET' })
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByRole('dialog')

    expect(screen.getByText('Choose a Product')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Search products like AWS, GitHub, Azure, Cloudflare...')
    ).toBeInTheDocument()
    expect(screen.getByText('AWS')).toBeInTheDocument()
    expect(screen.getByText('GitHub App Installation')).toBeInTheDocument()

    fireEvent.change(
      screen.getByPlaceholderText('Search products like AWS, GitHub, Azure, Cloudflare...'),
      {
        target: { value: 'github' },
      }
    )

    expect(screen.getByText('GitHub App Installation')).toBeInTheDocument()
    expect(screen.queryByText('AWS')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /GitHub App Installation/i }))

    await waitFor(() => {
      expect(screen.getByText('Installation ID')).toBeInTheDocument()
      expect(screen.getByText('Organization')).toBeInTheDocument()
    })

    expect(screen.getByText('Selected Product')).toBeInTheDocument()
    expect(screen.getByText('GitHub App Installation')).toBeInTheDocument()
    expect(screen.getByText('Developer Platforms')).toBeInTheDocument()

    const formDialog = await screen.findByRole('dialog')
    expect(formDialog.className).toContain('sm:max-w-4xl')
  })
})
