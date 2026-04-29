import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { useEffect, useState } from 'react'
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
    primaryAction: item => <button type="button">Open {String(item.name)}</button>,
    selectedItemId: selectedId,
    onSelectItem: item => setSelectedId(item ? String(item.id) : undefined),
    renderDetailPanel: item => <div>Detail for {String(item.name)}</div>,
  }

  return <ResourcePage config={config} />
}

function DrawerHarness() {
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const config: ResourcePageConfig = {
    title: 'Servers',
    apiPath: '/api/collections/servers/records',
    listItems: async () => items,
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    columns: [{ key: 'name', label: 'Name' }],
    wrapTableInCard: false,
    selectedItemId: selectedId,
    onSelectItem: item => setSelectedId(item ? String(item.id) : undefined),
    renderDetailPanel: item => <div>Drawer detail for {String(item.name)}</div>,
    detailPresentation: 'drawer',
    detailDrawerTier: 'lg',
    detailDrawerTitle: 'Server Detail',
  }

  return <ResourcePage config={config} />
}

describe('ResourcePage list controls', () => {
  it('supports search, filters, pagination, and bottom detail panels', async () => {
    window.localStorage.clear()
    render(<TestHarness />)

    await screen.findByText('alpha')
    expect(screen.getByRole('button', { name: 'Open alpha' })).toBeInTheDocument()
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

  it('supports drawer-based detail presentation with shared tier styling', async () => {
    render(<DrawerHarness />)

    await screen.findByText('alpha')

    fireEvent.click(screen.getByText('alpha'))

    expect(await screen.findByText('Drawer detail for alpha')).toBeInTheDocument()

    const drawer = document.querySelector('[data-slot="sheet-content"]')
    expect(drawer).not.toBeNull()
    expect(drawer).toHaveStyle({
      width: 'min(896px, calc(100vw - 2rem))',
      maxWidth: 'min(896px, calc(100vw - 2rem))',
    })
  })

  it('waits for create-selection options before auto-opening the create flow', async () => {
    function AutoCreateHarness() {
      const [options, setOptions] = useState<Array<{ id: string; title: string }>>([])

      useEffect(() => {
        Promise.resolve().then(() => {
          setOptions([{ id: 'mysql', title: 'MySQL' }])
        })
      }, [])

      const config: ResourcePageConfig = {
        title: 'Service Instances',
        apiPath: '/api/instances',
        listItems: async () => [],
        fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
        columns: [{ key: 'name', label: 'Name' }],
        autoCreate: true,
        createSelection: {
          title: 'Choose a Product',
          options,
          onSelect: () => ({ template_id: 'mysql' }),
        },
      }

      return <ResourcePage config={config} />
    }

    render(<AutoCreateHarness />)

    expect(await screen.findByText('Choose a Product')).toBeInTheDocument()
    expect(screen.getByText('MySQL')).toBeInTheDocument()
  })

  it('re-fetches items when refreshKey changes', async () => {
    function RefreshHarness() {
      const [refreshKey, setRefreshKey] = useState(0)
      const listItems = vi.fn(async () =>
        refreshKey === 0
          ? [{ id: 'server-1', name: 'alpha' }]
          : [{ id: 'server-1', name: 'alpha-online' }]
      )

      const config: ResourcePageConfig = {
        title: 'Servers',
        apiPath: '/api/collections/servers/records',
        listItems,
        refreshKey,
        fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
        columns: [{ key: 'name', label: 'Name' }],
        wrapTableInCard: false,
      }

      return (
        <>
          <button type="button" onClick={() => setRefreshKey(1)}>
            Trigger refresh
          </button>
          <ResourcePage config={config} />
        </>
      )
    }

    render(<RefreshHarness />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Trigger refresh' }))

    expect(await screen.findByText('alpha-online')).toBeInTheDocument()
  })
})
