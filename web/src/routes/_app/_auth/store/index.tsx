import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getLocale } from '@/lib/i18n'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  toLegacyProduct,
  toLegacyPrimaryCategories,
  useCatalogAllApps,
  useCatalogAppDetail,
  useCatalogApps,
  useCatalogCategories,
  useCatalogDeploySource,
} from '@/lib/catalog-api'
import { useUserApps, useToggleFavorite, useSaveNote } from '@/lib/store-user-api'
import {
  useCustomApps,
  useCreateCustomApp,
  useUpdateCustomApp,
  useDeleteCustomApp,
  customAppToProduct,
} from '@/lib/store-custom-api'
import type { CustomApp, CustomAppFormData } from '@/lib/store-custom-api'
import type { ProductWithCategories, PageSize } from '@/lib/store-types'
import { PAGE_SIZES } from '@/lib/store-types'
import { SearchAutocomplete } from '@/components/store/SearchAutocomplete'
import { AppCard } from '@/components/store/AppCard'
import { CustomAppCard } from '@/components/store/CustomAppCard'
import { CustomAppDialog } from '@/components/store/CustomAppDialog'
import { AppDetailModal } from '@/components/store/AppDetailModal'
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PlusCircle,
  RefreshCw,
  Settings2,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function matchesStoreSearch(
  product: ProductWithCategories,
  query: string,
  primaryCategories: Array<{ key: string; title: string }>
): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const primaryTitle = primaryCategories.find(
    category => category.key === product.primaryCategoryKey
  )?.title
  const secondaryTitles = product.catalogCollection.items.map(item => item.title)
  const haystacks = [
    product.key,
    product.trademark,
    product.summary,
    product.overview,
    primaryTitle,
    ...secondaryTitles,
  ]

  return haystacks
    .filter((value): value is string => Boolean(value))
    .some(value => value.toLowerCase().includes(normalizedQuery))
}

// ─── Route definition ──────────────────────────────────────────────────────────

export const Route = createFileRoute('/_app/_auth/store/')({
  component: StorePage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    app: typeof search.app === 'string' ? search.app : undefined,
  }),
})

// ─── Component ────────────────────────────────────────────────────────────────

export function StorePage() {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { t } = useTranslation('store')
  const locale = getLocale()

  // ─── Filters & pagination state ──────────────────────────────────────────────
  const [primaryCategory, setPrimaryCategory] = useState<string | null>(null)
  const [secondaryCategory, setSecondaryCategory] = useState<string | null>(null)
  const [search, setSearch] = useState(searchParams.q ?? '')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZES[0])

  // ─── Sync state ───────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null)

  // ─── Detail modal state ───────────────────────────────────────────────────────
  const [selectedApp, setSelectedApp] = useState<ProductWithCategories | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedAppIsCustom, setSelectedAppIsCustom] = useState(false)
  const [selectedCustomAppRaw, setSelectedCustomAppRaw] = useState<CustomApp | null>(null)

  // ─── Custom app dialog state ──────────────────────────────────────────────────
  const [customAppDialogOpen, setCustomAppDialogOpen] = useState(false)
  const [editingCustomApp, setEditingCustomApp] = useState<CustomApp | null>(null)

  // ─── Favorites filter ─────────────────────────────────────────────────────────
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const deferredSearch = useDeferredValue(search)
  const searchActive = deferredSearch.trim().length > 0

  // ─── Official apps collapse ───────────────────────────────────────────────────
  const [officialCollapsed, setOfficialCollapsed] = useState(false)

  // ─── Error toast ──────────────────────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const showError = (msg: string) => {
    setErrorMsg(msg)
    setTimeout(() => setErrorMsg(null), 4000)
  }

  // ─── User apps (favorites + notes) ───────────────────────────────────────────
  const { data: userApps = [] } = useUserApps()
  const toggleFavorite = useToggleFavorite(showError)
  const saveNote = useSaveNote(showError)

  // ─── Custom apps ──────────────────────────────────────────────────────────────
  const { data: customApps = [] } = useCustomApps()
  const createCustomApp = useCreateCustomApp(showError, showError)
  const updateCustomApp = useUpdateCustomApp(showError, showError)
  const deleteCustomApp = useDeleteCustomApp(showError)
  const currentUserId = pb.authStore.record?.id ?? ''

  const handleToggleFavorite = (appKey: string) => {
    toggleFavorite.mutate({ appKey, userApps })
  }

  const handleSaveNote = (appKey: string, note: string | null) => {
    saveNote.mutate({ appKey, note, userApps })
  }

  // ─── Data fetching ────────────────────────────────────────────────────────────
  const {
    data: categoryTree,
    isLoading: catalogLoading,
    isError: catalogError,
    refetch: refetchCatalog,
  } = useCatalogCategories(locale)

  const catalogAppsQuery = useMemo(
    () => ({
      locale,
      source: 'official' as const,
      primaryCategory,
      secondaryCategory,
      q: deferredSearch,
      favorite: showFavoritesOnly ? true : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [deferredSearch, locale, primaryCategory, secondaryCategory, showFavoritesOnly, pageSize, page]
  )

  const {
    data: officialAppsPage,
    isLoading: officialAppsLoading,
    isError: officialAppsError,
    refetch: refetchOfficialApps,
  } = useCatalogApps(catalogAppsQuery, !searchActive)

  const officialCatalogSeedQuery = useMemo(
    () => ({
      locale,
      source: 'official' as const,
      limit: 1000,
      offset: 0,
    }),
    [locale]
  )

  const {
    data: officialCatalogSeed,
    isLoading: officialCatalogSeedLoading,
    isError: officialCatalogSeedError,
    refetch: refetchOfficialCatalogSeed,
  } = useCatalogAllApps(officialCatalogSeedQuery, searchActive)

  const selectedAppKey = selectedApp?.key ?? null
  const {
    data: selectedAppDetail,
    isLoading: selectedAppDetailLoading,
    error: selectedAppDetailError,
  } = useCatalogAppDetail(locale, selectedAppKey, modalOpen)
  const { data: selectedAppDetailEn } = useCatalogAppDetail(
    'en',
    selectedAppKey,
    modalOpen && locale !== 'en'
  )
  const { data: selectedDeploySource, error: selectedDeploySourceError } = useCatalogDeploySource(
    locale,
    selectedAppKey,
    modalOpen
  )
  const modalCatalogError = selectedAppDetailError || selectedDeploySourceError

  // Sort catalog by position
  const primaryCategories = useMemo(() => {
    if (!categoryTree) return []
    return toLegacyPrimaryCategories(categoryTree).sort(
      (a, b) => (a.position ?? 999) - (b.position ?? 999)
    )
  }, [categoryTree])

  const primaryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of categoryTree?.items ?? []) {
      counts[item.key] = item.appCount
    }
    return counts
  }, [categoryTree])

  const secondaryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of categoryTree?.items ?? []) {
      for (const child of item.children) {
        counts[child.key] = child.appCount
      }
    }
    return counts
  }, [categoryTree])

  const officialCatalogSeedProducts = useMemo<ProductWithCategories[]>(
    () => (officialCatalogSeed?.items ?? []).map(item => toLegacyProduct(item)),
    [officialCatalogSeed]
  )

  const fallbackScreenshots = useMemo(
    () =>
      (selectedAppDetailEn?.screenshots ?? []).map(shot => ({
        id: shot.key,
        key: shot.key,
        value: shot.url,
      })),
    [selectedAppDetailEn]
  )

  const paginatedProducts = useMemo(
    () =>
      (officialAppsPage?.items ?? []).map(item => ({
        sys: { id: item.key },
        key: item.key,
        trademark: item.title,
        summary: item.overview,
        overview: item.overview,
        logo: item.iconUrl ? { imageurl: item.iconUrl } : undefined,
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
      })),
    [officialAppsPage]
  )

  const favoriteKeys = useMemo(
    () => new Set(userApps.filter(item => item.is_favorite).map(item => item.app_key)),
    [userApps]
  )

  const searchedOfficialProducts = useMemo<ProductWithCategories[]>(() => {
    if (!searchActive) return paginatedProducts

    return officialCatalogSeedProducts.filter(product => {
      if (showFavoritesOnly && !favoriteKeys.has(product.key)) return false
      return matchesStoreSearch(product, deferredSearch, primaryCategories)
    })
  }, [
    deferredSearch,
    favoriteKeys,
    officialCatalogSeedProducts,
    paginatedProducts,
    primaryCategories,
    searchActive,
    showFavoritesOnly,
  ])

  const visibleOfficialProducts = useMemo<ProductWithCategories[]>(() => {
    if (!searchActive) return paginatedProducts
    const start = (page - 1) * pageSize
    return searchedOfficialProducts.slice(start, start + pageSize)
  }, [page, pageSize, paginatedProducts, searchActive, searchedOfficialProducts])

  const officialTotal = searchActive
    ? searchedOfficialProducts.length
    : (officialAppsPage?.page.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(officialTotal / pageSize))
  const favoriteCount = useMemo(() => userApps.filter(item => item.is_favorite).length, [userApps])
  const selectedPrimaryNode = useMemo(
    () => categoryTree?.items.find(item => item.key === primaryCategory) ?? null,
    [categoryTree, primaryCategory]
  )
  const secondaryOptions = useMemo(
    () =>
      [...(selectedPrimaryNode?.children ?? [])].sort(
        (a, b) => (a.position ?? 999) - (b.position ?? 999)
      ),
    [selectedPrimaryNode]
  )

  // Filtered custom apps
  const visibleCustomApps = useMemo(() => {
    let apps = customApps.filter(a => a.created_by === currentUserId || a.visibility === 'shared')
    if (search) {
      const q = search.toLowerCase()
      apps = apps.filter(
        a => a.trademark.toLowerCase().includes(q) || a.key.toLowerCase().includes(q)
      )
    }
    if (showFavoritesOnly) {
      const favKeys = new Set(userApps.filter(a => a.is_favorite).map(a => a.app_key))
      apps = apps.filter(a => favKeys.has(a.key))
    }
    return apps
  }, [customApps, currentUserId, search, showFavoritesOnly, userApps])

  const totalCount = useMemo(
    () => officialTotal + visibleCustomApps.length,
    [officialTotal, visibleCustomApps.length]
  )
  const deepLinkedAppKey = searchParams.app?.trim() || null
  const deepLinkedProduct = useMemo(() => {
    if (!deepLinkedAppKey) return null

    const customApp = customApps.find(
      item =>
        item.key === deepLinkedAppKey &&
        (item.created_by === currentUserId || item.visibility === 'shared')
    )
    if (customApp) return { product: customAppToProduct(customApp), isCustom: true, customApp }

    const product =
      searchedOfficialProducts.find(item => item.key === deepLinkedAppKey) ||
      paginatedProducts.find(item => item.key === deepLinkedAppKey) ||
      officialCatalogSeedProducts.find(item => item.key === deepLinkedAppKey)
    if (!product) return null

    return { product, isCustom: false, customApp: null }
  }, [
    currentUserId,
    customApps,
    deepLinkedAppKey,
    officialCatalogSeedProducts,
    paginatedProducts,
    searchedOfficialProducts,
  ])
  const pageLoading = catalogLoading && !categoryTree
  const pageError = catalogError && !categoryTree
  const listLoading =
    (!searchActive && officialAppsLoading) || (searchActive && officialCatalogSeedLoading)
  const listError =
    (!searchActive && officialAppsError) || (searchActive && officialCatalogSeedError)
  const showListSkeleton =
    (!searchActive && officialAppsLoading && !officialAppsPage) ||
    (searchActive && officialCatalogSeedLoading && !officialCatalogSeed)

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  useEffect(() => {
    setSearch(searchParams.q ?? '')
  }, [searchParams.q])

  useEffect(() => {
    if (!deepLinkedAppKey || !deepLinkedProduct || modalOpen) return
    if (selectedApp?.key === deepLinkedAppKey) return
    setSelectedApp(deepLinkedProduct.product)
    setSelectedAppIsCustom(deepLinkedProduct.isCustom)
    setSelectedCustomAppRaw(deepLinkedProduct.customApp)
    setModalOpen(true)
  }, [deepLinkedAppKey, deepLinkedProduct, modalOpen, selectedApp?.key])

  // Reset to page 1 when filters change
  const handleSetPrimary = (key: string | null) => {
    setPrimaryCategory(key)
    setSecondaryCategory(null)
    setPage(1)
  }

  const handleSetSecondary = (key: string | null) => {
    setSecondaryCategory(key)
    setPage(1)
  }

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const handleRefresh = async () => {
    await Promise.all([
      refetchCatalog(),
      !searchActive ? refetchOfficialApps() : Promise.resolve(),
      searchActive ? refetchOfficialCatalogSeed() : Promise.resolve(),
    ])
  }

  const openDetail = (product: ProductWithCategories) => {
    setSelectedApp(product)
    setSelectedAppIsCustom(false)
    setSelectedCustomAppRaw(null)
    setModalOpen(true)
  }

  const openCustomDetail = (app: CustomApp) => {
    setSelectedApp(customAppToProduct(app))
    setSelectedAppIsCustom(true)
    setSelectedCustomAppRaw(app)
    setModalOpen(true)
  }

  const handleSaveCustomApp = (data: CustomAppFormData) => {
    if (editingCustomApp) {
      updateCustomApp.mutate(
        { id: editingCustomApp.id, data },
        {
          onSuccess: () => {
            setCustomAppDialogOpen(false)
            setEditingCustomApp(null)
          },
        }
      )
    } else {
      createCustomApp.mutate(data, {
        onSuccess: () => {
          setCustomAppDialogOpen(false)
        },
      })
    }
  }

  const handleCategoryFromModal = (primary: string | null, secondary?: string | null) => {
    setPrimaryCategory(primary)
    setSecondaryCategory(secondary ?? null)
    setPage(1)
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      await pb.send('/api/ext/catalog/sources/sync', {
        method: 'POST',
      })
      await handleRefresh()
      setSyncResult('success')
    } catch (error) {
      setSyncResult('error')
      showError(getApiErrorMessage(error, t('sync.unavailable')))
    }
    setSyncing(false)
    setTimeout(() => setSyncResult(null), 3000)
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4" role="status">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground">{t('loading')}</p>
      </div>
    )
  }

  if (pageError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-destructive font-medium">{t('error.title')}</p>
        <Button
          variant="outline"
          onClick={() => {
            refetchCatalog()
            if (!searchActive) {
              refetchOfficialApps()
            }
            if (searchActive) {
              refetchOfficialCatalogSeed()
            }
          }}
        >
          {t('error.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleRefresh()
            }}
            aria-label={t('refresh.button')}
            title={t('refresh.button')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            aria-label={
              syncing
                ? t('sync.syncing')
                : syncResult === 'success'
                  ? t('sync.success')
                  : syncResult === 'error'
                    ? t('sync.error')
                    : t('sync.button')
            }
            title={
              syncing
                ? t('sync.syncing')
                : syncResult === 'success'
                  ? t('sync.success')
                  : syncResult === 'error'
                    ? t('sync.error')
                    : t('sync.button')
            }
          >
            <ArrowDownToLine className={`h-4 w-4 ${syncing ? 'animate-bounce' : ''}`} />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setEditingCustomApp(null)
              setCustomAppDialogOpen(true)
            }}
            className="bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            <PlusCircle className="w-4 h-4" />
            {t('customApp.add')}
          </Button>
        </div>
      </div>

      <div className="border-b pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="min-w-[170px] flex-1 sm:max-w-[220px]">
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={primaryCategory ?? ''}
                onChange={e => handleSetPrimary(e.target.value || null)}
                aria-label={t('filters.primaryCategory')}
              >
                <option value="">
                  {t('categories.allApps')} ({totalCount})
                </option>
                {primaryCategories.map(cat => (
                  <option key={cat.key} value={cat.key}>
                    {cat.title} ({primaryCounts[cat.key] ?? 0})
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-[170px] flex-1 sm:max-w-[220px]">
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                value={secondaryCategory ?? ''}
                onChange={e => handleSetSecondary(e.target.value || null)}
                disabled={!selectedPrimaryNode || secondaryOptions.length === 0}
                aria-label={t('filters.secondaryCategory')}
              >
                <option value="">{t('categories.all')}</option>
                {secondaryOptions.map(category => (
                  <option key={category.key} value={category.key}>
                    {category.title} ({secondaryCounts[category.key] ?? 0})
                  </option>
                ))}
              </select>
            </label>

            <div className="w-full sm:w-[180px] md:w-[200px] lg:w-[220px] shrink-0">
              <SearchAutocomplete
                value={search}
                products={officialCatalogSeedProducts}
                primaryCategories={primaryCategories}
                onChange={handleSearch}
                onCommit={handleSearch}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-1 sm:gap-2 xl:justify-end">
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-7 px-2 text-sm ${showFavoritesOnly ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
                onClick={() => {
                  setShowFavoritesOnly(value => !value)
                  setPage(1)
                }}
                aria-pressed={showFavoritesOnly}
                aria-label={`${t('favorites.showOnly')} (${favoriteCount})`}
                title={`${t('favorites.showOnly')} (${favoriteCount})`}
              >
                <Star
                  className={`h-4 w-4 ${showFavoritesOnly ? 'fill-current text-amber-500' : ''}`}
                />
                <span className="tabular-nums">{favoriteCount}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={() => setPage(current => Math.max(1, current - 1))}
                disabled={page <= 1 || officialTotal === 0}
                aria-label={t('pagination.previous')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[36px] text-center text-sm font-medium tracking-tight">
                {page}/{totalPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages || officialTotal === 0}
                aria-label={t('pagination.next')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7"
                  aria-label={t('filters.pageSize')}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel>{t('filters.pageSize')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={String(pageSize)}
                  onValueChange={value => {
                    setPageSize(Number(value) as PageSize)
                    setPage(1)
                  }}
                >
                  {PAGE_SIZES.map(size => (
                    <DropdownMenuRadioItem key={size} value={String(size)}>
                      {size} / page
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* App grid: custom apps group + official apps group */}
      <section className="space-y-4" aria-busy={listLoading} aria-live="polite">
        {listLoading && !showListSkeleton ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('loading')}</span>
          </div>
        ) : null}

        {listError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-destructive font-medium">{t('error.title')}</p>
            <Button
              variant="outline"
              onClick={() => {
                if (!searchActive) {
                  refetchOfficialApps()
                }
                if (searchActive) {
                  refetchOfficialCatalogSeed()
                }
              }}
            >
              {t('error.retry')}
            </Button>
          </div>
        ) : showListSkeleton ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4" role="status">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-muted-foreground">{t('loading')}</p>
          </div>
        ) : visibleCustomApps.length === 0 && visibleOfficialProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <p>{showFavoritesOnly ? t('favorites.noFavorites') : t('search.noResults')}</p>
            {showFavoritesOnly && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowFavoritesOnly(false)
                  setPage(1)
                }}
              >
                {t('favorites.clearFilter')}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {visibleCustomApps.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('customApp.groupLabel')}
                </h3>
                <div
                  className="grid gap-x-4 gap-y-6 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
                  role="list"
                >
                  {visibleCustomApps.map(app => (
                    <div key={app.id} role="listitem">
                      <CustomAppCard
                        app={app}
                        currentUserId={currentUserId}
                        onOpenDetail={openCustomDetail}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {visibleOfficialProducts.length > 0 && (
              <div className="space-y-3">
                {visibleCustomApps.length > 0 && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 group"
                    onClick={() => setOfficialCollapsed(c => !c)}
                  >
                    {officialCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                      {t('customApp.officialGroupLabel')}
                    </h3>
                  </button>
                )}
                {!officialCollapsed && (
                  <div
                    className="grid gap-x-4 gap-y-6 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
                    role="list"
                    aria-label={t('title')}
                  >
                    {visibleOfficialProducts.map(product => (
                      <div key={product.key} role="listitem">
                        <AppCard
                          product={product}
                          primaryCategories={primaryCategories}
                          onSelectApp={openDetail}
                          userApps={userApps}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* App Detail Modal */}
      <AppDetailModal
        product={selectedApp}
        primaryCategories={primaryCategories}
        locale={locale}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelectCategory={selectedAppIsCustom ? undefined : handleCategoryFromModal}
        userApps={selectedAppIsCustom ? undefined : userApps}
        onToggleFavorite={selectedAppIsCustom ? undefined : handleToggleFavorite}
        onSaveNote={selectedAppIsCustom ? undefined : handleSaveNote}
        isSavingNote={selectedAppIsCustom ? undefined : saveNote.isPending}
        showDeploy
        detail={selectedAppDetail ?? null}
        detailLoading={selectedAppDetailLoading}
        onDeploy={
          selectedApp
            ? () => {
                setModalOpen(false)

                const install = selectedDeploySource?.install
                void navigate({
                  to: '/deploy/create',
                  search: {
                    entry: 'template',
                    prefillMode: install?.prefillMode ?? 'target',
                    prefillSource:
                      install?.prefillSource ?? (selectedAppIsCustom ? 'template' : 'library'),
                    prefillAppId: undefined,
                    prefillAppKey: install?.prefillAppKey ?? selectedApp.key,
                    prefillAppName:
                      install?.prefillAppName ??
                      selectedAppDetail?.deploy.defaultAppName ??
                      selectedApp.trademark,
                    prefillServerId: undefined,
                  },
                })
              }
            : undefined
        }
        fallbackScreenshots={fallbackScreenshots}
        onEdit={
          selectedAppIsCustom &&
          selectedCustomAppRaw &&
          selectedCustomAppRaw.created_by === currentUserId
            ? () => {
                setModalOpen(false)
                setEditingCustomApp(selectedCustomAppRaw)
                setCustomAppDialogOpen(true)
              }
            : undefined
        }
        onDelete={
          selectedAppIsCustom &&
          selectedCustomAppRaw &&
          selectedCustomAppRaw.created_by === currentUserId
            ? () => {
                deleteCustomApp.mutate(selectedCustomAppRaw.id)
                setModalOpen(false)
              }
            : undefined
        }
        iacEditPath={
          selectedAppIsCustom && selectedCustomAppRaw
            ? `templates/apps/${selectedCustomAppRaw.key}`
            : undefined
        }
      />

      {/* Custom App Dialog — key forces remount so edit state resets */}
      <CustomAppDialog
        key={editingCustomApp?.id ?? 'new'}
        open={customAppDialogOpen}
        onClose={() => {
          setCustomAppDialogOpen(false)
          setEditingCustomApp(null)
        }}
        onSave={handleSaveCustomApp}
        isSaving={createCustomApp.isPending || updateCustomApp.isPending}
        editApp={editingCustomApp ?? undefined}
        allProducts={officialCatalogSeedProducts}
        existingCustomKeys={customApps.map(a => a.key)}
      />

      {/* Error toast */}
      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-destructive text-destructive-foreground text-sm px-4 py-2 rounded-md shadow-lg">
          {errorMsg}
        </div>
      )}

      {modalOpen && selectedAppKey && !selectedAppDetailLoading && modalCatalogError && (
        <div className="fixed bottom-16 right-4 z-50 bg-destructive text-destructive-foreground text-sm px-4 py-2 rounded-md shadow-lg">
          {getApiErrorMessage(modalCatalogError, t('error.title'))}
        </div>
      )}
    </div>
  )
}
