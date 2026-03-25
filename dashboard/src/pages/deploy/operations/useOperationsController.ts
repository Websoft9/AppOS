import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getLocale } from '@/lib/i18n'
import { iacLoadLibraryAppFiles, iacRead } from '@/lib/iac-api'
import { pb } from '@/lib/pb'
import { fetchStoreJson } from '@/lib/store-api'
import { type PrimaryCategory, type Product, type ProductWithCategories } from '@/lib/store-types'
import { useUserApps } from '@/lib/store-user-api'
import { type AppConfigResponse } from '@/pages/apps/types'
import { buildOperationDetailSearch, isActiveStatus } from '@/pages/deploy/operations/operation-utils'
import type {
  ActiveFilterChip,
  OperationRecord,
  OperationListSearch,
  ManualEntryMode,
  Notice,
  ServerEntry,
  SortDir,
  SortField,
  StoreShortcut,
} from '@/pages/deploy/operations/operation-types'

const STORE_SHORTCUT_COUNT = 15
const SAMPLE_COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
`

type UseOperationsControllerArgs = {
  prefillMode?: string
  prefillSource?: string
  prefillAppId?: string
  prefillAppKey?: string
  prefillAppName?: string
  prefillServerId?: string
  listSearch?: OperationListSearch
  view?: 'home' | 'list'
}

const DEFAULT_SORT_FIELD: SortField = 'started_at'
const DEFAULT_SORT_DIR: SortDir = 'desc'
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE: 15 | 30 | 60 | 90 = 15

function parseExcludedSet(value?: string): Set<string> {
  if (!value) return new Set()
  return new Set(value.split(',').map(item => item.trim()).filter(Boolean))
}

function serializeExcludedSet(values: Set<string>): string | undefined {
  const normalized = Array.from(values).map(item => item.trim()).filter(Boolean).sort().join(',')
  return normalized || undefined
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  return Array.from(left).every(item => right.has(item))
}

function buildListSearchState({
  search,
  sortField,
  sortDir,
  page,
  pageSize,
  excludeStatus,
  excludeSource,
  excludeServer,
}: {
  search: string
  sortField: SortField | null
  sortDir: SortDir
  page: number
  pageSize: 15 | 30 | 60 | 90
  excludeStatus: Set<string>
  excludeSource: Set<string>
  excludeServer: Set<string>
}): OperationListSearch {
  const normalizedSearch = search.trim() || undefined
  const normalizedSortField = sortField && sortField !== DEFAULT_SORT_FIELD ? sortField : undefined
  const normalizedSortDir = sortDir !== DEFAULT_SORT_DIR ? sortDir : undefined
  const normalizedPage = page > DEFAULT_PAGE ? page : undefined
  const normalizedPageSize = pageSize !== DEFAULT_PAGE_SIZE ? pageSize : undefined
  const normalizedExcludeStatus = serializeExcludedSet(excludeStatus)
  const normalizedExcludeSource = serializeExcludedSet(excludeSource)
  const normalizedExcludeServer = serializeExcludedSet(excludeServer)

  return {
    ...(normalizedSearch ? { q: normalizedSearch } : {}),
    ...(normalizedSortField ? { sortField: normalizedSortField } : {}),
    ...(normalizedSortDir ? { sortDir: normalizedSortDir } : {}),
    ...(normalizedPage ? { page: normalizedPage } : {}),
    ...(normalizedPageSize ? { pageSize: normalizedPageSize } : {}),
    ...(normalizedExcludeStatus ? { excludeStatus: normalizedExcludeStatus } : {}),
    ...(normalizedExcludeSource ? { excludeSource: normalizedExcludeSource } : {}),
    ...(normalizedExcludeServer ? { excludeServer: normalizedExcludeServer } : {}),
  }
}

function areListSearchEqual(left: OperationListSearch, right: OperationListSearch): boolean {
  return left.q === right.q
    && left.sortField === right.sortField
    && left.sortDir === right.sortDir
    && left.page === right.page
    && left.pageSize === right.pageSize
    && left.excludeStatus === right.excludeStatus
    && left.excludeSource === right.excludeSource
    && left.excludeServer === right.excludeServer
}

export function useOperationsController({
  prefillMode,
  prefillSource,
  prefillAppId,
  prefillAppKey,
  prefillAppName,
  prefillServerId,
  listSearch,
  view = 'home',
}: UseOperationsControllerArgs) {
  const navigate = useNavigate()
  const locale = getLocale()
  const { data: userApps = [] } = useUserApps()
  const [servers, setServers] = useState<ServerEntry[]>([{ id: 'local', label: 'local', host: 'local', status: 'online' }])
  const [storeShortcuts, setStoreShortcuts] = useState<StoreShortcut[]>([])
  const [storeProducts, setStoreProducts] = useState<ProductWithCategories[]>([])
  const [storePrimaryCategories, setStorePrimaryCategories] = useState<PrimaryCategory[]>([])
  const [selectedStoreProduct, setSelectedStoreProduct] = useState<ProductWithCategories | null>(null)
  const [storeDetailOpen, setStoreDetailOpen] = useState(false)
  const [operations, setOperations] = useState<OperationRecord[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [gitCreateOpen, setGitCreateOpen] = useState(false)
  const [manualEntryMode, setManualEntryMode] = useState<ManualEntryMode>('compose')
  const [serverId, setServerId] = useState('local')
  const [projectName, setProjectName] = useState('demo-nginx')
  const [compose, setCompose] = useState(SAMPLE_COMPOSE)
  const [gitProjectName, setGitProjectName] = useState('')
  const [gitRepositoryUrl, setGitRepositoryUrl] = useState('')
  const [gitRef, setGitRef] = useState('main')
  const [gitComposePath, setGitComposePath] = useState('docker-compose.yml')
  const [gitAuthHeaderName, setGitAuthHeaderName] = useState('Authorization')
  const [gitAuthHeaderValue, setGitAuthHeaderValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [gitSubmitting, setGitSubmitting] = useState(false)
  const [search, setSearch] = useState(() => listSearch?.q || '')
  const [sortField, setSortField] = useState<SortField | null>(() => listSearch?.sortField || DEFAULT_SORT_FIELD)
  const [sortDir, setSortDir] = useState<SortDir>(() => listSearch?.sortDir || DEFAULT_SORT_DIR)
  const [excludeStatus, setExcludeStatus] = useState<Set<string>>(() => parseExcludedSet(listSearch?.excludeStatus))
  const [excludeSource, setExcludeSource] = useState<Set<string>>(() => parseExcludedSet(listSearch?.excludeSource))
  const [excludeServer, setExcludeServer] = useState<Set<string>>(() => parseExcludedSet(listSearch?.excludeServer))
  const [page, setPage] = useState(() => listSearch?.page || DEFAULT_PAGE)
  const [pageSize, setPageSize] = useState<15 | 30 | 60 | 90>(() => listSearch?.pageSize || DEFAULT_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [prefillLoading, setPrefillLoading] = useState(false)
  const [prefillReady, setPrefillReady] = useState('')
  const [pendingDelete, setPendingDelete] = useState<OperationRecord[]>([])

  const serverMap = useMemo(() => new Map(servers.map(item => [item.id, item])), [servers])

  function showNotice(variant: Notice['variant'], message: string) {
    setNotice({ variant, message })
  }

  useEffect(() => {
    void fetchServers()
    void fetchOperations()
  }, [])

  useEffect(() => {
    void fetchStoreShortcuts()
  }, [locale, userApps])

  useEffect(() => {
    let cancelled = false
    async function loadPrefill() {
      if (prefillMode !== 'target' && prefillMode !== 'installed') return
      setPrefillLoading(true)
      try {
        let loadedCompose: string | null = null
        let resolvedServerId = prefillServerId || 'local'

        if (prefillMode === 'target') {
          if (!prefillAppKey) return
          if (prefillSource === 'template') {
            const response = await iacRead(`templates/apps/${prefillAppKey}/docker-compose.yml`)
            loadedCompose = response.content
          } else {
            const { compose: responseCompose } = await iacLoadLibraryAppFiles(prefillAppKey)
            loadedCompose = responseCompose
          }
        }

        if (prefillMode === 'installed') {
          if (!prefillAppId) return
          const response = await pb.send<AppConfigResponse>(`/api/apps/${prefillAppId}/config`, { method: 'GET' })
          loadedCompose = response.content
          resolvedServerId = response.server_id || resolvedServerId
        }

        if (cancelled) return
        if (!loadedCompose || !loadedCompose.trim()) {
          showNotice('destructive', prefillMode === 'installed'
            ? 'No docker-compose config was found for the selected installed application'
            : 'No docker-compose template was found for the selected application')
          return
        }

        setServerId(resolvedServerId)
        setProjectName(prefillAppName || prefillAppKey || '')
        setCompose(loadedCompose)
        setPrefillReady(prefillAppName || prefillAppKey || '')
        setManualEntryMode(prefillMode === 'installed' ? 'installed-prefill' : 'store-prefill')
        setCreateOpen(true)
      } catch {
        if (!cancelled) {
          showNotice('destructive', prefillMode === 'installed'
            ? 'Failed to load deployment config for the selected installed application'
            : 'Failed to load deployment template for the selected application')
        }
      } finally {
        if (!cancelled) setPrefillLoading(false)
      }
    }

    void loadPrefill()
    return () => {
      cancelled = true
    }
  }, [prefillAppId, prefillAppKey, prefillAppName, prefillMode, prefillServerId, prefillSource])

  useEffect(() => {
    if (view !== 'list') return

    const nextSearch = listSearch?.q || ''
    const nextSortField = listSearch?.sortField || DEFAULT_SORT_FIELD
    const nextSortDir = listSearch?.sortDir || DEFAULT_SORT_DIR
    const nextPage = listSearch?.page || DEFAULT_PAGE
    const nextPageSize = listSearch?.pageSize || DEFAULT_PAGE_SIZE
    const nextExcludeStatus = parseExcludedSet(listSearch?.excludeStatus)
    const nextExcludeSource = parseExcludedSet(listSearch?.excludeSource)
    const nextExcludeServer = parseExcludedSet(listSearch?.excludeServer)

    setSearch(current => current === nextSearch ? current : nextSearch)
    setSortField(current => current === nextSortField ? current : nextSortField)
    setSortDir(current => current === nextSortDir ? current : nextSortDir)
    setPage(current => current === nextPage ? current : nextPage)
    setPageSize(current => current === nextPageSize ? current : nextPageSize)
    setExcludeStatus(current => areSetsEqual(current, nextExcludeStatus) ? current : nextExcludeStatus)
    setExcludeSource(current => areSetsEqual(current, nextExcludeSource) ? current : nextExcludeSource)
    setExcludeServer(current => areSetsEqual(current, nextExcludeServer) ? current : nextExcludeServer)
  }, [listSearch, view])

  const summary = useMemo(() => ({
    total: operations.length,
    active: operations.filter(item => isActiveStatus(item.status)).length,
    completed: operations.filter(item => item.status === 'success').length,
    failed: operations.filter(item => item.status === 'failed').length,
  }), [operations])

  const latestOperations = useMemo(
    () => [...operations].sort((left, right) => String(right.updated || '').localeCompare(String(left.updated || ''))).slice(0, 5),
    [operations]
  )

  const manualDialogCopy = useMemo(() => {
    switch (manualEntryMode) {
      case 'docker-command':
        return {
          title: 'Convert Docker Command to Deployment',
          description: 'Use the shared compose deployment path. Translate the docker run command into docker-compose content before submission.',
          helper: 'Docker command deployment is surfaced as a guided manual compose flow in this MVP.',
        }
      case 'install-script':
        return {
          title: 'Review Source Packages as Deployment Input',
          description: 'Use user-provided compressed source packages as the deployment input for the shared flow.',
          helper: 'Supported source package formats include zip and tar.gz. Review the package and prepare deployable content before submission.',
        }
      case 'store-prefill':
        return {
          title: 'Create Deployment Task',
          description: 'App Store inputs have been prefilled. Review the target server, deployment name, and compose content before starting.',
          helper: 'This deployment uses the same shared manual compose pipeline as custom deployments.',
        }
      case 'installed-prefill':
        return {
          title: 'Create Deployment Task',
          description: 'The current installed compose config has been prefilled. Review and submit the redeploy or upgrade task.',
          helper: 'This entry reuses the same deployment path so history, logs, and detail views stay consistent.',
        }
      default:
        return {
          title: 'Create Deployment Task',
          description: 'Minimal input set: target server, deployment name, and docker-compose content.',
          helper: 'Compose deployment is the recommended custom path for external files and one-off stacks.',
        }
    }
  }, [manualEntryMode])

  const filterOptions = useMemo(() => ({
    status: Array.from(new Set(operations.map(item => item.status))).sort().map(value => ({ value, label: value })),
    source: Array.from(new Set(operations.map(item => item.source))).sort().map(value => ({ value, label: value })),
    server: Array.from(new Set(operations.map(item => item.server_id || 'local'))).sort().map(value => {
      const matched = operations.find(item => (item.server_id || 'local') === value)
      return { value, label: matched ? getServerLabel(matched) : value }
    }),
  }), [operations, serverMap])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return operations.filter(item => {
      if (excludeStatus.has(item.status)) return false
      if (excludeSource.has(item.source)) return false
      if (excludeServer.has(item.server_id || 'local')) return false
      if (!query) return true
      return [item.id, item.compose_project_name, item.source, item.server_id, item.server_label, item.server_host, item.user_id, item.user_email]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query))
    })
  }, [operations, excludeServer, excludeSource, excludeStatus, search])

  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems
    const factor = sortDir === 'asc' ? 1 : -1
    return [...filteredItems].sort((left, right) => String(left[sortField] || '').localeCompare(String(right[sortField] || '')) * factor)
  }, [filteredItems, sortDir, sortField])

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize))
  const pagedItems = useMemo(() => sortedItems.slice((page - 1) * pageSize, page * pageSize), [page, pageSize, sortedItems])

  useEffect(() => {
    setPage(1)
  }, [excludeServer, excludeSource, excludeStatus, search, sortDir, sortField])

  useEffect(() => {
    if (view !== 'list') return

    const nextSearch = buildListSearchState({
      search,
      sortField,
      sortDir,
      page,
      pageSize,
      excludeStatus,
      excludeSource,
      excludeServer,
    })
    const currentSearch = {
      q: listSearch?.q,
      sortField: listSearch?.sortField,
      sortDir: listSearch?.sortDir,
      page: listSearch?.page,
      pageSize: listSearch?.pageSize,
      excludeStatus: listSearch?.excludeStatus,
      excludeSource: listSearch?.excludeSource,
      excludeServer: listSearch?.excludeServer,
    }

    if (areListSearchEqual(nextSearch, currentSearch)) return

    void navigate({ to: '/operations' as never, search: nextSearch as never, replace: true })
  }, [excludeServer, excludeSource, excludeStatus, listSearch, navigate, page, pageSize, search, sortDir, sortField, view])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchOperations()
    }, summary.active > 0 ? 3000 : 6000)
    return () => window.clearInterval(timer)
  }, [summary.active])

  useEffect(() => {
    setSelectedIds(current => {
      const validIds = new Set(operations.map(item => item.id))
      const next = new Set(Array.from(current).filter(id => validIds.has(id)))
      return areSetsEqual(current, next) ? current : next
    })
  }, [operations])

  async function fetchServers() {
    try {
      const response = await pb.send<ServerEntry[]>('/api/ext/docker/servers', { method: 'GET' })
      if (Array.isArray(response) && response.length > 0) {
        setServers(response)
        setServerId(current => (response.some(item => item.id === current) ? current : response[0].id))
      }
    } catch {
      // Keep local fallback.
    }
  }

  async function fetchStoreShortcuts() {
    try {
      const [products, categories] = await Promise.all([
        fetchStoreJson<Product[]>(locale, 'product'),
        fetchStoreJson<PrimaryCategory[]>(locale, 'catalog'),
      ])
      const uniqueProducts = Array.from(new Map(products.map(item => [item.key, item])).values())
      const favoriteOrder = new Map(
        userApps
          .filter(item => item.is_favorite)
          .sort((left, right) => String(right.updated || '').localeCompare(String(left.updated || '')))
          .map((item, index) => [item.app_key, index])
      )
      const favorites = uniqueProducts
        .filter(item => favoriteOrder.has(item.key))
        .sort((left, right) => (favoriteOrder.get(left.key) ?? 0) - (favoriteOrder.get(right.key) ?? 0))
      const nonFavorites = uniqueProducts
        .filter(item => !favoriteOrder.has(item.key))
        .sort(() => Math.random() - 0.5)
      const ordered = [...favorites, ...nonFavorites]
      const detailedProducts = ordered.map(item => ({
        ...item,
        primaryCategoryKey: null,
        secondaryCategoryKeys: item.catalogCollection.items.map(entry => entry.key),
      }))
      setStoreProducts(detailedProducts)
      setStorePrimaryCategories(categories)
      setStoreShortcuts(
        detailedProducts.slice(0, STORE_SHORTCUT_COUNT).map(item => ({
          key: item.key,
          trademark: item.trademark,
          logo: item.logo,
        }))
      )
    } catch {
      setStoreShortcuts([])
      setStoreProducts([])
      setStorePrimaryCategories([])
    }
  }

  async function fetchOperations() {
    try {
      const response = await pb.send<OperationRecord[]>('/api/operations', { method: 'GET' })
      setOperations(Array.isArray(response) ? response : [])
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to load operations')
    } finally {
      setLoading(false)
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDir('asc')
  }

  function setPageSelection(ids: string[], checked: boolean) {
    setSelectedIds(current => {
      const next = new Set(current)
      ids.forEach(id => {
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  function toggleOperationSelection(id: string, checked: boolean) {
    setPageSelection([id], checked)
  }

  function openStoreShortcut(app: StoreShortcut) {
    setSelectedStoreProduct(storeProducts.find(item => item.key === app.key) ?? null)
    setStoreDetailOpen(true)
  }

  function deployFromStoreProduct(product: StoreShortcut | ProductWithCategories) {
    setStoreDetailOpen(false)
    void navigate({
      to: '/deploy',
      search: {
        prefillMode: 'target',
        prefillSource: 'library',
        prefillAppId: undefined,
        prefillAppKey: product.key,
        prefillAppName: product.trademark,
        prefillServerId: undefined,
      },
    })
  }

  function openManualDialog(mode: ManualEntryMode) {
    setManualEntryMode(mode)
    if ((mode === 'docker-command' || mode === 'install-script') && compose === SAMPLE_COMPOSE) {
      setCompose('')
    }
    if (mode === 'compose' && !compose.trim()) {
      setCompose(SAMPLE_COMPOSE)
    }
    setCreateOpen(true)
  }

  function openOperationDetail(id: string) {
    const nextListSearch = view === 'list'
      ? buildListSearchState({
          search,
          sortField,
          sortDir,
          page,
          pageSize,
          excludeStatus,
          excludeSource,
          excludeServer,
        })
      : undefined
    const currentListSearch = nextListSearch && Object.keys(nextListSearch).length > 0 ? nextListSearch : undefined
    const detailSearch = buildOperationDetailSearch(currentListSearch, true)
    void navigate({
      to: '/operations/$operationId' as never,
      params: { operationId: id } as never,
      search: detailSearch as never,
    })
  }

  function openLatestOperationDetail(id: string) {
    void navigate({
      to: '/operations/$operationId' as never,
      params: { operationId: id } as never,
      search: { returnTo: 'list' } as never,
    })
  }

  function getServerLabel(item: OperationRecord): string {
    if (item.server_label) return item.server_label
    if (item.server_id && serverMap.has(item.server_id)) return serverMap.get(item.server_id)?.label || item.server_id
    return item.server_id || 'local'
  }

  function getServerHost(item: OperationRecord): string {
    if (item.server_host) return item.server_host
    if (item.server_id && serverMap.has(item.server_id)) return serverMap.get(item.server_id)?.host || '-'
    return item.server_id === 'local' || !item.server_id ? 'local' : '-'
  }

  function getUserLabel(item: OperationRecord): string {
    return item.user_email || item.user_id || '-'
  }

  async function submitManualOperation() {
    setSubmitting(true)
    setNotice(null)
    try {
      const created = await pb.send<OperationRecord>('/api/operations/install/manual-compose', {
        method: 'POST',
        body: { server_id: serverId, project_name: projectName, compose },
      })
      showNotice('default', `Operation ${created.compose_project_name || created.id} created`)
      setCreateOpen(false)
      await fetchOperations()
      openOperationDetail(created.id)
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to create operation')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitGitOperation() {
    setGitSubmitting(true)
    setNotice(null)
    try {
      const created = await pb.send<OperationRecord>('/api/operations/install/git-compose', {
        method: 'POST',
        body: {
          server_id: serverId,
          project_name: gitProjectName,
          repository_url: gitRepositoryUrl,
          ref: gitRef,
          compose_path: gitComposePath,
          auth_header_name: gitAuthHeaderValue.trim() ? gitAuthHeaderName : '',
          auth_header_value: gitAuthHeaderValue,
        },
      })
      showNotice('default', `Operation ${created.compose_project_name || created.id} created from Git repository`)
      setGitCreateOpen(false)
      await fetchOperations()
      openOperationDetail(created.id)
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to create git operation')
    } finally {
      setGitSubmitting(false)
    }
  }

  async function deleteOperations(ids: string[]) {
    const targets = operations.filter(item => ids.includes(item.id))
    setNotice(null)
    try {
      await Promise.all(ids.map(id => pb.send(`/api/operations/${id}`, { method: 'DELETE' })))
      await fetchOperations()
      setSelectedIds(current => {
        const next = new Set(current)
        ids.forEach(id => next.delete(id))
        return next
      })
      showNotice('default', ids.length === 1
        ? `Operation ${targets[0]?.compose_project_name || ids[0]} deleted`
        : `${ids.length} operations deleted`)
      setPendingDelete([])
    } catch (err) {
      showNotice('destructive', err instanceof Error ? err.message : 'Failed to delete actions')
    }
  }

  const selectedOperations = useMemo(
    () => operations.filter(item => selectedIds.has(item.id)),
    [operations, selectedIds]
  )

  const selectedActiveCount = useMemo(
    () => selectedOperations.filter(item => isActiveStatus(item.status)).length,
    [selectedOperations]
  )

  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = []
    if (search.trim()) chips.push({ key: 'search', label: `Keyword: ${search.trim()}` })

    const statusMap = new Map(filterOptions.status.map(option => [option.value, option.label]))
    const sourceMap = new Map(filterOptions.source.map(option => [option.value, option.label]))
    const serverLabelMap = new Map(filterOptions.server.map(option => [option.value, option.label]))

    Array.from(excludeStatus).sort().forEach(value => chips.push({ key: `status:${value}`, label: `Excluded status: ${statusMap.get(value) || value}` }))
    Array.from(excludeSource).sort().forEach(value => chips.push({ key: `source:${value}`, label: `Excluded source: ${sourceMap.get(value) || value}` }))
    Array.from(excludeServer).sort().forEach(value => chips.push({ key: `server:${value}`, label: `Excluded server: ${serverLabelMap.get(value) || value}` }))

    return chips
  }, [excludeServer, excludeSource, excludeStatus, filterOptions.server, filterOptions.source, filterOptions.status, search])

  function removeFilterChip(chipKey: string) {
    if (chipKey === 'search') {
      setSearch('')
      return
    }

    const [group, value] = chipKey.split(':')
    if (!value) return

    if (group === 'status') {
      setExcludeStatus(current => {
        const next = new Set(current)
        next.delete(value)
        return next
      })
      return
    }

    if (group === 'source') {
      setExcludeSource(current => {
        const next = new Set(current)
        next.delete(value)
        return next
      })
      return
    }

    if (group === 'server') {
      setExcludeServer(current => {
        const next = new Set(current)
        next.delete(value)
        return next
      })
    }
  }

  function clearAllFilters() {
    setSearch('')
    setExcludeStatus(new Set())
    setExcludeSource(new Set())
    setExcludeServer(new Set())
  }

  function openDeleteDialogForIds(ids: string[]) {
    const targets = operations.filter(item => ids.includes(item.id))
    if (targets.length === 0) return
    setPendingDelete(targets)
  }

  const allPageSelected = pagedItems.length > 0 && pagedItems.every(item => selectedIds.has(item.id))
  const somePageSelected = pagedItems.some(item => selectedIds.has(item.id)) && !allPageSelected

  return {
    servers,
    storeShortcuts,
    storePrimaryCategories,
    selectedStoreProduct,
    storeDetailOpen,
    setStoreDetailOpen,
    userApps,
    summary,
    latestOperations,
    manualDialogCopy,
    filterOptions,
    pagedItems,
    totalPages,
    search,
    setSearch,
    loading,
    page,
    setPage,
    pageSize,
    setPageSize,
    selectedIds,
    selectedCount: selectedIds.size,
    selectedActiveCount,
    activeFilterChips,
    sortField,
    sortDir,
    excludeStatus,
    excludeSource,
    excludeServer,
    setExcludeStatus,
    setExcludeSource,
    setExcludeServer,
    sortedItemsCount: sortedItems.length,
    notice,
    setNotice,
    prefillLoading,
    prefillReady,
    createOpen,
    setCreateOpen,
    gitCreateOpen,
    setGitCreateOpen,
    serverId,
    setServerId,
    projectName,
    setProjectName,
    compose,
    setCompose,
    gitProjectName,
    setGitProjectName,
    gitRepositoryUrl,
    setGitRepositoryUrl,
    gitRef,
    setGitRef,
    gitComposePath,
    setGitComposePath,
    gitAuthHeaderName,
    setGitAuthHeaderName,
    gitAuthHeaderValue,
    setGitAuthHeaderValue,
    submitting,
    gitSubmitting,
    pendingDelete,
    setPendingDelete,
    handleSort,
    toggleOperationSelection,
    togglePageSelection: (checked: boolean) => setPageSelection(pagedItems.map(item => item.id), checked),
    allPageSelected,
    somePageSelected,
    removeFilterChip,
    clearAllFilters,
    openDeleteDialogForIds,
    openStoreShortcut,
    deployFromStoreProduct,
    openManualDialog,
    openOperationDetail,
    openLatestOperationDetail,
    getUserLabel,
    getServerLabel,
    getServerHost,
    submitManualOperation,
    submitGitOperation,
    deleteOperations,
    fetchOperations,
  }
}