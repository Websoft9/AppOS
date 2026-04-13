import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourcePage } from './ResourcePage'
import type { ResourcePageConfig } from './resource-page-types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: ComponentProps<'a'> & { children?: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}))

afterEach(() => {
  cleanup()
})

const items = [
  {
    id: 'server-1',
    name: 'alpha',
    connect_type: 'direct',
    host: '10.0.0.1',
    port: 22,
    user: 'root',
    tunnel_status: 'online',
  },
  {
    id: 'server-2',
    name: 'beta',
    connect_type: 'tunnel',
    host: '10.0.0.2',
    port: 2222,
    user: 'ubuntu',
    tunnel_status: 'offline',
  },
  {
    id: 'server-3',
    name: 'gamma',
    connect_type: 'direct',
    host: '10.0.0.3',
    port: 2200,
    user: 'admin',
    tunnel_status: 'offline',
  },
]

function TestHarness() {
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const config: ResourcePageConfig = {
    title: 'Servers',
    apiPath: '/api/collections/servers/records',
    favoriteStorageKey: 'resource-page:test-favorites',
    createButtonLabel: 'Create Server',
    searchPlaceholder: 'Search servers...',
    pageSize: 2,
    pageSizeOptions: [2, 10],
    defaultSort: { key: 'name', dir: 'asc' },
    wrapTableInCard: false,
    listItems: async () => items,
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    columns: [
      { key: 'name', label: 'Name', searchable: true, sortable: true },
      {
        key: 'connect_type',
        label: 'Type',
        sortable: true,
        filterOptions: [
          { label: 'Direct SSH', value: 'direct' },
          { label: 'Reverse Tunnel', value: 'tunnel' },
        ],
      },
      {
        key: 'tunnel_status',
        label: 'Status',
        sortable: true,
        filterOptions: [
          { label: 'Online', value: 'online' },
          { label: 'Offline', value: 'offline' },
        ],
      },
    ],
    selectedItemId: selectedId,
    onSelectItem: item => setSelectedId(item ? String(item.id) : undefined),
    renderDetailPanel: item => <div>Detail for {String(item.name)}</div>,
  }

  return <ResourcePage config={config} />
}

describe('ResourcePage list controls', () => {
  it('supports search, filters, pagination, and bottom detail panels', async () => {
    window.localStorage.clear()
    render(<TestHarness />)

    await screen.findByText('alpha')
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.queryByText('gamma')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('gamma')

    fireEvent.change(screen.getByPlaceholderText('Search servers...'), {
      target: { value: 'beta' },
    })
    await screen.findByText('beta')
    expect(screen.queryByText('alpha')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search servers...'), {
      target: { value: '' },
    })

    const filterTriggers = document.querySelectorAll('[data-slot="dropdown-menu-trigger"]')
    fireEvent.pointerDown(filterTriggers[0] as HTMLElement)
    fireEvent.click(await screen.findByText('Direct SSH'))

    await waitFor(() => {
      expect(screen.getByText('beta')).toBeInTheDocument()
      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('beta'))
    await screen.findByText('Detail for beta')
  })

  it('promotes favorites and supports favorites-only filtering', async () => {
    window.localStorage.clear()
    render(<TestHarness />)

    await screen.findByText('alpha')

    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'More actions' })[1])
    fireEvent.click(await screen.findByText('Add Favorite'))

    await waitFor(() => {
      const rows = screen.getAllByRole('row')
      expect(rows[1]).toHaveTextContent('beta')
    })

    const favoritesFilter = screen
      .getAllByRole('checkbox')
      .find(element => element.closest('label')?.textContent?.includes('Favorites only'))

    expect(favoritesFilter).toBeDefined()
    fireEvent.click(favoritesFilter as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('beta')).toBeInTheDocument()
      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    })
  })
})