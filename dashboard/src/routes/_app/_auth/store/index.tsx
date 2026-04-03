import { useState, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { getLocale } from '@/lib/i18n'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  toLegacyPrimaryCategories,
  useCatalogAppDetail,
  useCatalogApps,
  useCatalogCategories,
  useCatalogDeploySource,
} from '@/lib/catalog-api'
import {
  useProducts,
} from '@/lib/store-api'
import { useUserApps, useToggleFavorite, useSaveNote } from '@/lib/store-user-api'
import {
  useCustomApps,
  useCreateCustomApp,
  useUpdateCustomApp,
  useDeleteCustomApp,
  customAppToProduct,
} from '@/lib/store-custom-api'
import type { CustomApp, CustomAppFormData } from '@/lib/store-custom-api'
import type { ProductWithCategories, PageSize, Screenshot } from '@/lib/store-types'
import { PAGE_SIZES } from '@/lib/store-types'
import { CategoryFilter } from '@/components/store/CategoryFilter'
import { SearchAutocomplete } from '@/components/store/SearchAutocomplete'
import { AppCard } from '@/components/store/AppCard'
import { CustomAppCard } from '@/components/store/CustomAppCard'
import { CustomAppDialog } from '@/components/store/CustomAppDialog'
import { StorePagination } from '@/components/store/StorePagination'
import { AppDetailModal } from '@/components/store/AppDetailModal'
import { Loader2, RefreshCw, PlusCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── Route definition ──────────────────────────────────────────────────────────

export const Route = createFileRoute('/_app/_auth/store/')({
  component: StorePage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function StorePage() {
  const navigate = useNavigate()
  const { t } = useTranslation('store')
  const queryClient = useQueryClient()
  const locale = getLocale()

  // ─── Filters & pagination state ──────────────────────────────────────────────
  const [primaryCategory, setPrimaryCategory] = useState<string | null>(null)
  const [secondaryCategory, setSecondaryCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
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
  const [enScreenshots, setEnScreenshots] = useState<Screenshot[]>([])

  // ─── Custom app dialog state ──────────────────────────────────────────────────
  const [customAppDialogOpen, setCustomAppDialogOpen] = useState(false)
  const [editingCustomApp, setEditingCustomApp] = useState<CustomApp | null>(null)

  // ─── Favorites filter ─────────────────────────────────────────────────────────
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)

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
    data: productsData,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useProducts(locale, queryClient)

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
      q: search,
      favorite: showFavoritesOnly ? true : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [locale, primaryCategory, secondaryCategory, search, showFavoritesOnly, pageSize, page]
  )

  const {
    data: officialAppsPage,
    isLoading: officialAppsLoading,
    isError: officialAppsError,
    refetch: refetchOfficialApps,
  } = useCatalogApps(catalogAppsQuery)

  // Always fetch en products for screenshot URL fallback (cached, no extra network if locale === 'en')
  const { data: enProductsData } = useProducts('en', queryClient)

  const isLoading = catalogLoading || productsLoading || officialAppsLoading
  const isError = catalogError || productsError || officialAppsError

  const selectedAppKey = selectedApp?.key ?? null
  const {
    data: selectedAppDetail,
    isLoading: selectedAppDetailLoading,
    error: selectedAppDetailError,
  } = useCatalogAppDetail(locale, selectedAppKey, modalOpen)
  const { data: selectedDeploySource, error: selectedDeploySourceError } = useCatalogDeploySource(
    locale,
    selectedAppKey,
    modalOpen
  )
  const modalCatalogError = selectedAppDetailError || selectedDeploySourceError

  // Sort catalog by position
  const primaryCategories = useMemo(() => {
    if (!categoryTree) return []
    return toLegacyPrimaryCategories(categoryTree).sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
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

  const paginatedProducts = useMemo(
    () => (officialAppsPage?.items ?? []).map(item => ({
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

  const officialTotal = officialAppsPage?.page.total ?? 0
  const totalCount = useMemo(
    () => categoryTree?.items.reduce((sum, item) => sum + item.appCount, 0) ?? officialTotal,
    [categoryTree, officialTotal]
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

  const openDetail = (product: ProductWithCategories) => {
    setSelectedApp(product)
    setSelectedAppIsCustom(false)
    setSelectedCustomAppRaw(null)
    // Set en screenshots for fallback when locale URLs fail
    const enProduct = enProductsData?.find(p => p.key === product.key)
    setEnScreenshots(enProduct?.screenshots ?? [])
    setModalOpen(true)
  }

  const openCustomDetail = (app: CustomApp) => {
    setSelectedApp(customAppToProduct(app))
    setSelectedAppIsCustom(true)
    setSelectedCustomAppRaw(app)
    setEnScreenshots([])
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
      await Promise.all([refetchCatalog(), refetchOfficialApps(), refetchProducts()])
      setSyncResult('success')
    } catch {
      setSyncResult('error')
    }
    setSyncing(false)
    setTimeout(() => setSyncResult(null), 3000)
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4" role="status">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground">{t('loading')}</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-destructive font-medium">{t('error.title')}</p>
        <Button
          variant="outline"
          onClick={() => {
            refetchCatalog()
            refetchOfficialApps()
            refetchProducts()
          }}
        >
          {t('error.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingCustomApp(null)
              setCustomAppDialogOpen(true)
            }}
            className="flex items-center gap-1.5"
          >
            <PlusCircle className="w-4 h-4" />
            {t('customApp.add')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing
              ? t('sync.syncing')
              : syncResult === 'success'
                ? t('sync.success')
                : syncResult === 'error'
                  ? t('sync.error')
                  : t('sync.button')}
          </Button>
          <SearchAutocomplete
            value={search}
            products={productsData ?? []}
            primaryCategories={primaryCategories}
            onChange={handleSearch}
            onCommit={handleSearch}
          />
        </div>
      </div>

      {/* Category filter */}
      <CategoryFilter
        primaryCategories={primaryCategories}
        primaryCounts={primaryCounts}
        secondaryCounts={secondaryCounts}
        selectedPrimary={primaryCategory}
        selectedSecondary={secondaryCategory}
        totalCount={totalCount}
        onSelectPrimary={handleSetPrimary}
        onSelectSecondary={handleSetSecondary}
      />

      {/* Favorites filter */}
      <div className="flex items-center gap-2">
        <input
          id="show-favorites"
          type="checkbox"
          checked={showFavoritesOnly}
          onChange={e => {
            setShowFavoritesOnly(e.target.checked)
            setPage(1)
          }}
          className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
        />
        <label htmlFor="show-favorites" className="text-sm cursor-pointer select-none">
          {t('favorites.showOnly')}
        </label>
      </div>

      {/* App grid: custom apps group + official apps group */}
      {visibleCustomApps.length === 0 && paginatedProducts.length === 0 ? (
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
          {/* Custom Apps group */}
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

          {/* Official Apps group */}
          {paginatedProducts.length > 0 && (
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
                  {paginatedProducts.map(product => (
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

      {/* Pagination — hidden when official apps are collapsed */}
      {!officialCollapsed && (
        <StorePagination
          page={page}
          pageSize={pageSize}
          total={officialTotal}
          onPageChange={setPage}
          onPageSizeChange={size => {
            setPageSize(size)
            setPage(1)
          }}
        />
      )}

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
                  to: '/deploy',
                  search: {
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
        fallbackScreenshots={enScreenshots}
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
        allProducts={productsData ?? []}
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
