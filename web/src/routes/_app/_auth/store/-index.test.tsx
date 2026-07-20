import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorePage } from './index'

type MockCategory = { key: string; title: string }

const navigateMock = vi.fn()
const useCatalogAppsMock = vi.fn()
const useCatalogAllAppsMock = vi.fn()
const refetchCatalogMock = vi.fn()
const refetchOfficialAppsMock = vi.fn()
const refetchOfficialSeedMock = vi.fn()
let catalogAppsError = false
let catalogAllAppsError = false

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  createFileRoute: () => (config: unknown) => ({
    ...((config as Record<string, unknown>) ?? {}),
    useSearch: () => ({}),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/lib/i18n', () => ({
  getLocale: () => 'en',
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    authStore: {
      record: { id: 'user-1' },
    },
    send: vi.fn(),
  },
}))

const wordpressSummary = {
  key: 'wordpress',
  title: 'WordPress',
  overview: 'WordPress overview',
  iconUrl: undefined,
  source: 'official' as const,
  visibility: 'public',
  primaryCategory: { key: 'cms', title: 'CMS' },
  secondaryCategories: [] as MockCategory[],
  badges: [],
  template: { key: 'wordpress', source: 'official', available: true },
  personalization: { isFavorite: false, hasNote: false },
}

const nocodbSummary = {
  key: 'nocodb',
  title: 'NocoDB',
  overview: 'Spreadsheet-first database platform',
  iconUrl: undefined,
  source: 'official' as const,
  visibility: 'public',
  primaryCategory: { key: 'low-code', title: 'Low Code' },
  secondaryCategories: [] as MockCategory[],
  badges: [],
  template: { key: 'nocodb', source: 'official', available: true },
  personalization: { isFavorite: false, hasNote: false },
}

const odooSummary = {
  key: 'odoo',
  title: 'Odoo',
  overview: 'Business app suite',
  iconUrl: undefined,
  source: 'official' as const,
  visibility: 'public',
  primaryCategory: { key: 'business', title: 'Business' },
  secondaryCategories: [] as MockCategory[],
  badges: [],
  template: { key: 'odoo', source: 'official', available: true },
  personalization: { isFavorite: false, hasNote: false },
}

const erpnextSummary = {
  key: 'erpnext',
  title: 'ERPNext',
  overview: 'Open source ERP platform',
  iconUrl: undefined,
  source: 'official' as const,
  visibility: 'public',
  primaryCategory: { key: 'business', title: 'Business' },
  secondaryCategories: [] as MockCategory[],
  badges: [],
  template: { key: 'erpnext', source: 'official', available: true },
  personalization: { isFavorite: false, hasNote: false },
}

vi.mock('@/lib/catalog-api', () => ({
  useCatalogCategories: () => ({
    data: {
      items: [
        { key: 'cms', title: 'CMS', position: 1, appCount: 1, children: [] },
        { key: 'low-code', title: 'Low Code', position: 2, appCount: 1, children: [] },
        { key: 'business', title: 'Business', position: 3, appCount: 2, children: [] },
      ],
      meta: { locale: 'en', sourceVersion: 'test' },
    },
    isLoading: false,
    isError: false,
    refetch: refetchCatalogMock,
  }),
  useCatalogApps: (...args: unknown[]) => useCatalogAppsMock(...args),
  useCatalogAllApps: (...args: unknown[]) => useCatalogAllAppsMock(...args),
  useCatalogAppDetail: (_locale: string, key: string | null) => ({
    data: key
      ? {
          key: 'wordpress',
          title: 'WordPress',
          overview: 'WordPress overview',
          description: 'WordPress description',
          screenshots: [],
          source: { kind: 'official', visibility: 'public', author: null, recordId: null },
          categories: { primary: { key: 'cms', title: 'CMS' }, secondary: [] },
          links: {},
          requirements: {},
          template: { key: 'wordpress', source: 'official', available: true },
          deploy: {
            supported: true,
            mode: 'template',
            sourceKind: 'library',
            defaultAppName: 'WordPress',
          },
          personalization: { isFavorite: false, note: null },
          installed: null,
          audit: {},
        }
      : null,
    isLoading: false,
    error: null,
  }),
  useCatalogDeploySource: (_locale: string, key: string | null) => ({
    data: key
      ? {
          app: { key: 'wordpress', title: 'WordPress', source: 'official' },
          template: { key: 'wordpress', source: 'official', available: true },
          install: {
            prefillMode: 'target',
            prefillSource: 'library',
            prefillAppKey: 'wordpress',
            prefillAppName: 'WordPress',
          },
          capabilities: {
            hasComposeTemplate: true,
            hasEnvTemplate: false,
            supportsDirectDeploy: true,
          },
        }
      : null,
    error: null,
  }),
  toLegacyProduct: (
    item:
      | typeof wordpressSummary
      | typeof nocodbSummary
      | typeof odooSummary
      | typeof erpnextSummary
  ) => ({
    sys: { id: item.key },
    key: item.key,
    trademark: item.title,
    summary: item.overview,
    overview: item.overview,
    logo: undefined,
    catalogCollection: {
      items: item.secondaryCategories.map(category => ({
        key: category.key,
        title: category.title,
        catalogCollection: item.primaryCategory
          ? { items: [{ key: item.primaryCategory.key }] }
          : undefined,
      })),
    },
    primaryCategoryKey: item.primaryCategory?.key ?? null,
    secondaryCategoryKeys: item.secondaryCategories.map(category => category.key),
  }),
  toLegacyProducts: (response: {
    items: Array<
      typeof wordpressSummary | typeof nocodbSummary | typeof odooSummary | typeof erpnextSummary
    >
  }) =>
    response.items.map(item => ({
      sys: { id: item.key },
      key: item.key,
      trademark: item.title,
      summary: item.overview,
      overview: item.overview,
      logo: undefined,
      catalogCollection: { items: [] },
      primaryCategoryKey: item.primaryCategory?.key ?? null,
      secondaryCategoryKeys: [],
    })),
  toLegacyPrimaryCategories: (response: {
    items: Array<{ key: string; title: string; position?: number | null }>
  }) =>
    response.items.map(item => ({
      key: item.key,
      title: item.title,
      position: item.position ?? null,
      linkedFrom: { catalogCollection: { items: [] } },
    })),
}))

vi.mock('@/lib/store-user-api', () => ({
  useUserApps: () => ({ data: [] }),
  useToggleFavorite: () => ({ mutate: vi.fn() }),
  useSaveNote: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/store-custom-api', () => ({
  useCustomApps: () => ({ data: [] }),
  useCreateCustomApp: () => ({ mutate: vi.fn() }),
  useUpdateCustomApp: () => ({ mutate: vi.fn() }),
  useDeleteCustomApp: () => ({ mutate: vi.fn() }),
  customAppToProduct: vi.fn(),
}))

vi.mock('@/components/store/SearchAutocomplete', () => ({
  SearchAutocomplete: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <input aria-label="search" value={value} onChange={event => onChange(event.target.value)} />
  ),
}))

vi.mock('@/components/store/AppCard', () => ({
  AppCard: ({
    product,
    onSelectApp,
  }: {
    product: { trademark: string }
    onSelectApp: (product: { trademark: string }) => void
  }) => (
    <button type="button" onClick={() => onSelectApp(product)}>
      Open {product.trademark}
    </button>
  ),
}))

vi.mock('@/components/store/CustomAppCard', () => ({
  CustomAppCard: () => null,
}))

vi.mock('@/components/store/CustomAppDialog', () => ({
  CustomAppDialog: () => null,
}))

vi.mock('@/components/store/AppDetailModal', () => ({
  AppDetailModal: ({
    product,
    open,
    onDeploy,
  }: {
    product: { trademark: string } | null
    open: boolean
    onDeploy?: () => void
  }) =>
    open && product ? (
      <div>
        <div>{product.trademark}</div>
        <button type="button" onClick={onDeploy}>
          Deploy {product.trademark}
        </button>
      </div>
    ) : null,
}))

describe('StorePage deploy handoff', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    useCatalogAppsMock.mockReset()
    useCatalogAllAppsMock.mockReset()
    refetchCatalogMock.mockReset()
    refetchOfficialAppsMock.mockReset()
    refetchOfficialSeedMock.mockReset()
    catalogAppsError = false
    catalogAllAppsError = false

    refetchCatalogMock.mockResolvedValue(undefined)
    refetchOfficialAppsMock.mockResolvedValue(undefined)
    refetchOfficialSeedMock.mockResolvedValue(undefined)

    useCatalogAppsMock.mockImplementation((_query: unknown, enabled = true) => ({
      data: {
        items: [wordpressSummary, nocodbSummary, odooSummary, erpnextSummary],
        page: { limit: 24, offset: 0, total: 4, hasMore: false },
        meta: { locale: 'en', sourceVersion: 'test' },
      },
      isLoading: false,
      isError: enabled ? catalogAppsError : false,
      refetch: refetchOfficialAppsMock,
    }))

    useCatalogAllAppsMock.mockImplementation((_query: unknown, enabled = true) => ({
      data: enabled
        ? {
            items: [wordpressSummary, nocodbSummary, odooSummary, erpnextSummary],
            page: { limit: 1000, offset: 0, total: 4, hasMore: false },
            meta: { locale: 'en', sourceVersion: 'test' },
          }
        : undefined,
      isLoading: false,
      isError: enabled ? catalogAllAppsError : false,
      refetch: refetchOfficialSeedMock,
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it('opens template deployment pinned to the selected store app', async () => {
    render(<StorePage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open WordPress' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open WordPress' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deploy WordPress' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Deploy WordPress' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/deploy/create',
      search: {
        entry: 'template',
        prefillMode: 'target',
        prefillSource: 'library',
        prefillAppId: undefined,
        prefillAppKey: 'wordpress',
        prefillAppName: 'WordPress',
        prefillServerId: undefined,
      },
    })
  })

  it('matches apps when searching by category title', async () => {
    render(<StorePage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open WordPress' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open NocoDB' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'Low Code' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open NocoDB' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open WordPress' })).not.toBeInTheDocument()
    })
  })

  it('matches apps when searching by exact app key', async () => {
    render(<StorePage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open WordPress' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open Odoo' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open ERPNext' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'wordpress' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open WordPress' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open Odoo' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open ERPNext' })).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'odoo' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Odoo' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open WordPress' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open ERPNext' })).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'erpnext' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open ERPNext' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open WordPress' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open Odoo' })).not.toBeInTheDocument()
    })
  })

  it('search remains global even when a category filter is selected', async () => {
    render(<StorePage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open WordPress' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'filters.primaryCategory' }), {
      target: { value: 'low-code' },
    })

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'wordpress' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open WordPress' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open NocoDB' })).not.toBeInTheDocument()
    })
  })

  it('uses only the full-seed query while search is active', async () => {
    render(<StorePage />)

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'wordpress' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open WordPress' })).toBeInTheDocument()
    })

    expect(useCatalogAppsMock).toHaveBeenLastCalledWith(expect.any(Object), false)
    expect(useCatalogAllAppsMock).toHaveBeenLastCalledWith(expect.any(Object), true)
  })

  it('keeps the page shell mounted while search results are loading', async () => {
    useCatalogAllAppsMock.mockImplementation((_query: unknown, enabled = true) => ({
      data: enabled
        ? undefined
        : {
            items: [wordpressSummary, nocodbSummary, odooSummary, erpnextSummary],
            page: { limit: 1000, offset: 0, total: 4, hasMore: false },
            meta: { locale: 'en', sourceVersion: 'test' },
          },
      isLoading: enabled,
      isError: false,
      refetch: refetchOfficialSeedMock,
    }))

    render(<StorePage />)

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'wordpress' } })

    await waitFor(() => {
      expect(screen.getByText('title')).toBeInTheDocument()
      expect(screen.getByLabelText('search')).toHaveValue('wordpress')
      expect(screen.getByText('loading')).toBeInTheDocument()
    })
  })

  it('shows the error state when the full-seed query fails during search', async () => {
    catalogAllAppsError = true

    render(<StorePage />)

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'wordpress' } })

    await waitFor(() => {
      expect(screen.getByText('error.title')).toBeInTheDocument()
    })

    expect(screen.queryByText('No apps found')).not.toBeInTheDocument()
  })
})
