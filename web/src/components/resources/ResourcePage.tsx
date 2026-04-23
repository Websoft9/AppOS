import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type FormEvent,
  type ChangeEvent,
} from 'react'
import { Link } from '@tanstack/react-router'
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Upload,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Tags,
  X,
  RefreshCw,
  MoreVertical,
  Star,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { type PBList, pbFilterValue } from '@/lib/groups'
import { getDrawerTierStyle } from '@/lib/drawer-tiers'
import { cn } from '@/lib/utils'
import { ResourceFormField } from './ResourceFormField'
import type {
  FieldDef,
  RelationOption,
  ResourcePageConfig,
  SelectOption,
} from './resource-page-types'

export type {
  Column,
  FieldDef,
  RelCreateField,
  ResourcePageConfig,
  SelectOption,
} from './resource-page-types'

const INPUT_CLASS =
  'w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground text-sm'

const GROUPS_API_PATH = '/api/collections/groups/records?perPage=500&sort=name'

type SortDir = 'asc' | 'desc'

function readFavoriteIds(storageKey: string | undefined) {
  if (!storageKey || typeof window === 'undefined') {
    return new Set<string>()
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set<string>()
  } catch {
    return new Set<string>()
  }
}

function writeFavoriteIds(storageKey: string | undefined, ids: Set<string>) {
  if (!storageKey || typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)))
  } catch {
    // Ignore persistence failures and keep the in-memory state usable.
  }
}

function buildOrFilter(field: string, values: string[]): string {
  return values.map(value => `${field}='${pbFilterValue(value)}'`).join('||')
}

function renderSelectOptions(options: SelectOption[] | undefined) {
  if (!options || options.length === 0) {
    return null
  }

  const hasGroups = options.some(option => option.group)
  if (!hasGroups) {
    return options.map(option => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))
  }

  const groups: { group: string; options: SelectOption[] }[] = []
  for (const option of options) {
    const groupName = option.group ?? 'Other'
    const existing = groups.find(group => group.group === groupName)
    if (existing) {
      existing.options.push(option)
      continue
    }
    groups.push({ group: groupName, options: [option] })
  }

  return groups.map(group => (
    <optgroup key={group.group} label={group.group}>
      {group.options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </optgroup>
  ))
}

// ─── ResourcePage ────────────────────────────────────────

export function ResourcePage({ config }: { config: ResourcePageConfig }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(config.defaultSort?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(config.defaultSort?.dir ?? 'asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(config.pageSize ?? 10)
  const [excludedFilters, setExcludedFilters] = useState<Record<string, Set<string>>>({})
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() =>
    readFavoriteIds(config.favoriteStorageKey)
  )
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [createSelectionOpen, setCreateSelectionOpen] = useState(false)
  const [createSelectionQuery, setCreateSelectionQuery] = useState('')
  const [editingItem, setEditingItem] = useState<Record<string, unknown> | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Relation options cache: fieldKey → list of {id, label}
  const [relOpts, setRelOpts] = useState<Record<string, RelationOption[]>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const createRelFileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const listItemsRef = useRef(config.listItems)

  // Inline "create relation" mini-dialog
  const [createRelOpen, setCreateRelOpen] = useState(false)
  const [createRelField, setCreateRelField] = useState<FieldDef | null>(null)
  const [createRelData, setCreateRelData] = useState<Record<string, unknown>>({})
  const [createRelSaving, setCreateRelSaving] = useState(false)
  const [createRelError, setCreateRelError] = useState('')

  // Batch group assignment
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [availableGroups, setAvailableGroups] = useState<RelationOption[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [assigningGroups, setAssigningGroups] = useState(false)
  const [groupAssignDialogOpen, setGroupAssignDialogOpen] = useState(false)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())

  const getFields = useCallback(
    (nextFormData: Record<string, unknown>, nextEditingItem: Record<string, unknown> | null) =>
      config.resolveFields
        ? config.resolveFields({ formData: nextFormData, editingItem: nextEditingItem })
        : config.fields,
    [config.fields, config.resolveFields]
  )

  const activeFields = useMemo(
    () => getFields(formData, editingItem),
    [editingItem, formData, getFields]
  )
  const searchableColumns = useMemo(
    () => config.columns.filter(column => column.searchable),
    [config.columns]
  )
  const filterableColumns = useMemo(
    () => config.columns.filter(column => column.filterOptions || column.filterValue),
    [config.columns]
  )
  const filterOptionMap = useMemo(() => {
    const entries = filterableColumns.map(column => {
      const options = column.filterOptions?.length
        ? column.filterOptions
        : Array.from(
            new Set(
              items
                .map(item => column.filterValue?.(item) ?? item[column.key])
                .map(value => String(value ?? '').trim())
                .filter(Boolean)
            )
          )
            .sort((a, b) => a.localeCompare(b))
            .map(value => ({ label: value, value }))

      return [column.key, options]
    })

    return Object.fromEntries(entries) as Record<string, SelectOption[]>
  }, [filterableColumns, items])

  const processedItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    let next = [...items]

    if (query) {
      next = next.filter(item => {
        const haystack = searchableColumns
          .map(column => {
            const raw = column.sortValue?.(item) ?? item[column.key]
            return String(raw ?? '').toLowerCase()
          })
          .join(' ')
        return haystack.includes(query)
      })
    }

    if (filterableColumns.length > 0) {
      next = next.filter(item => {
        return filterableColumns.every(column => {
          const excluded = excludedFilters[column.key]
          if (!excluded || excluded.size === 0) return true
          const value = String(column.filterValue?.(item) ?? item[column.key] ?? '')
          return !excluded.has(value)
        })
      })
    }

    if (config.favoriteStorageKey && showFavoritesOnly) {
      next = next.filter(item => favoriteIds.has(String(item.id ?? '')))
    }

    if (sortKey) {
      const column = config.columns.find(entry => entry.key === sortKey)
      if (column) {
        next.sort((left, right) => {
          if (config.favoriteStorageKey) {
            const favoriteCompare =
              Number(favoriteIds.has(String(right.id ?? ''))) -
              Number(favoriteIds.has(String(left.id ?? '')))
            if (favoriteCompare !== 0) {
              return favoriteCompare
            }
          }

          const leftRaw = column.sortValue?.(left) ?? left[column.key]
          const rightRaw = column.sortValue?.(right) ?? right[column.key]
          const leftValue = typeof leftRaw === 'number' ? leftRaw : String(leftRaw ?? '')
          const rightValue = typeof rightRaw === 'number' ? rightRaw : String(rightRaw ?? '')

          let comparison = 0
          if (typeof leftValue === 'number' && typeof rightValue === 'number') {
            comparison = leftValue - rightValue
          } else {
            comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
              numeric: true,
              sensitivity: 'base',
            })
          }

          return sortDir === 'asc' ? comparison : -comparison
        })
      }
    } else if (config.favoriteStorageKey) {
      next.sort(
        (left, right) =>
          Number(favoriteIds.has(String(right.id ?? ''))) -
          Number(favoriteIds.has(String(left.id ?? '')))
      )
    }

    return next
  }, [
    config.columns,
    config.favoriteStorageKey,
    excludedFilters,
    favoriteIds,
    filterableColumns,
    items,
    searchQuery,
    searchableColumns,
    showFavoritesOnly,
    sortDir,
    sortKey,
  ])

  const totalPages = Math.max(1, Math.ceil(processedItems.length / pageSize))
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return processedItems.slice(start, start + pageSize)
  }, [page, pageSize, processedItems])
  const selectedDetailItem = useMemo(
    () =>
      config.selectedItemId
        ? items.find(item => String(item.id) === config.selectedItemId) ?? null
        : null,
    [config.selectedItemId, items]
  )
  const showListControls =
    searchableColumns.length > 0 ||
    Boolean(config.favoriteStorageKey) ||
    (filterableColumns.length > 0 && !config.headerFilters) ||
    (config.pageSizeSelectorPlacement ?? 'header') === 'header'
  const showHeaderPageSizeSelector =
    (config.pageSizeSelectorPlacement ?? 'header') === 'header'
  const showFooterPageSizeSelector =
    (config.pageSizeSelectorPlacement ?? 'header') === 'footer'
  const paginationPlacement = config.paginationPlacement ?? 'footer'
  const paginationVariant = config.paginationVariant ?? 'default'
  const showHeaderPagination = paginationPlacement === 'header'
  const showFooterPagination = paginationPlacement === 'footer'
  const showPaginationSummary = config.paginationSummary ?? true
  const pageSizeOptions = config.pageSizeOptions ?? [10, 20, 50]
  const paginationTotalLabel = config.paginationTotalLabel?.(processedItems.length)
  const detailPresentation = config.detailPresentation ?? 'inline'
  const detailDrawerSide = config.detailDrawerSide ?? 'right'
  const detailDrawerTitle = config.detailDrawerTitle ?? `${config.title.replace(/s$/, '')} Detail`
  const detailDrawerTier = config.detailDrawerTier ?? 'lg'
  const showInlinePageSizeSelector =
    paginationVariant === 'minimal' &&
    ((showHeaderPagination && showHeaderPageSizeSelector) ||
      (showFooterPagination && showFooterPageSizeSelector))
  const showListControlsBorder = config.listControlsBorder ?? true
  const showListControlsReset = config.listControlsShowReset ?? true
  const favoriteActionPlacement = config.favoriteActionPlacement ?? 'beforeExtraActions'
  const emptyStateLabel = config.emptyStateLabel ?? `No ${config.title.toLowerCase()} found`

  const filteredCreateSelectionOptions = useMemo(() => {
    const selection = config.createSelection
    if (!selection) return []

    const query = createSelectionQuery.trim().toLowerCase()
    if (!query) return selection.options

    return selection.options.filter(option => {
      const haystack = [option.title, option.description, option.meta, option.searchText]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [config.createSelection, createSelectionQuery])

  const nameField = config.nameField || 'name'
  const groupField = activeFields.find(f => f.key === 'groups' && f.type === 'relation')
  const resourceObjectType = config.resourceType || ''
  const visibleFields = useMemo(
    () =>
      activeFields
        .filter(f => !f.hidden)
        .filter(f => {
          if (!f.showWhen) return true
          return f.showWhen.values.includes(String(formData[f.showWhen.field] ?? ''))
        }),
    [activeFields, formData]
  )
  const headerFields = useMemo(() => visibleFields.filter(field => field.header), [visibleFields])
  const primaryFields = useMemo(
    () => visibleFields.filter(field => !field.header && !field.advanced),
    [visibleFields]
  )
  const advancedFields = useMemo(
    () => visibleFields.filter(field => !field.header && field.advanced),
    [visibleFields]
  )
  const defaultDialogTitle = editingItem
    ? `Edit ${config.title.replace(/s$/, '')}`
    : `Create ${config.title.replace(/s$/, '')}`
  const defaultDialogDescription = editingItem
    ? 'Update the resource details below.'
    : 'Fill in the details to create a new resource.'
  const dialogHeader = config.dialogHeader?.({
    formData,
    editingItem,
    updateField,
    title: defaultDialogTitle,
    description: defaultDialogDescription,
  })

  const listGroupMemberships = useCallback(async (objectType: string, objectIds: string[]) => {
    if (!objectType || objectIds.length === 0) return [] as Record<string, unknown>[]

    const filter = [
      `object_type='${pbFilterValue(objectType)}'`,
      `(${buildOrFilter('object_id', objectIds)})`,
    ].join('&&')
    const params = new URLSearchParams({
      perPage: '500',
      filter: `(${filter})`,
    })
    const response = await pb.send<PBList<Record<string, unknown>>>(
      `/api/collections/group_items/records?${params.toString()}`,
      {}
    )
    return response.items ?? []
  }, [])

  const syncGroupMemberships = useCallback(
    async (objectId: string, nextGroupIds: string[]) => {
      if (!groupField || !resourceObjectType || !objectId) return

      const memberships = await listGroupMemberships(resourceObjectType, [objectId])
      const existingByGroupId = new Map(
        memberships
          .map(membership => {
            const groupId = String(membership['group_id'] ?? '')
            const membershipId = String(membership['id'] ?? '')
            return groupId && membershipId ? [groupId, membershipId] : null
          })
          .filter((entry): entry is [string, string] => entry !== null)
      )

      const desiredGroupIds = new Set(nextGroupIds)
      const createOps = nextGroupIds
        .filter(groupId => !existingByGroupId.has(groupId))
        .map(groupId =>
          pb.send('/api/collections/group_items/records', {
            method: 'POST',
            body: {
              group_id: groupId,
              object_type: resourceObjectType,
              object_id: objectId,
            },
          })
        )
      const deleteOps = Array.from(existingByGroupId.entries())
        .filter(([groupId]) => !desiredGroupIds.has(groupId))
        .map(([, membershipId]) =>
          pb.send(`/api/collections/group_items/records/${membershipId}`, {
            method: 'DELETE',
          })
        )

      await Promise.all([...createOps, ...deleteOps])
    },
    [groupField, listGroupMemberships, resourceObjectType]
  )

  // ─── Fetch ───────────────────────────

  useEffect(() => {
    listItemsRef.current = config.listItems
  }, [config.listItems])

  const fetchItems = useCallback(async () => {
    try {
      const data = listItemsRef.current
        ? await listItemsRef.current()
        : await pb.send<Record<string, unknown>[]>(config.apiPath, {})
      setItems(Array.isArray(data) ? data : [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [config.apiPath])

  const handleRefresh = useCallback(async () => {
    if (config.onRefresh) {
      await config.onRefresh({ items, refreshList: fetchItems })
      return
    }
    await fetchItems()
  }, [config, items, fetchItems])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const previousRefreshKeyRef = useRef(config.refreshKey)
  useEffect(() => {
    if (config.refreshKey === undefined) {
      previousRefreshKeyRef.current = config.refreshKey
      return
    }
    if (config.refreshKey === previousRefreshKeyRef.current) {
      return
    }
    previousRefreshKeyRef.current = config.refreshKey
    void fetchItems()
  }, [config.refreshKey, fetchItems])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, pageSize, excludedFilters, showFavoritesOnly])

  useEffect(() => {
    setFavoriteIds(readFavoriteIds(config.favoriteStorageKey))
  }, [config.favoriteStorageKey])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  // Pre-load available groups on mount when batch assign is enabled
  useEffect(() => {
    if (!config.enableGroupAssign) return
    setGroupsLoading(true)
    pb.send<PBList<Record<string, unknown>>>(GROUPS_API_PATH, {})
      .then(data => {
        const records = Array.isArray(data.items) ? data.items : []
        setAvailableGroups(
          records.map(g => ({ id: String(g.id), label: String(g['name'] ?? g.id) }))
        )
      })
      .catch(() => setAvailableGroups([]))
      .finally(() => setGroupsLoading(false))
  }, [config.enableGroupAssign])
  const hasAutoOpenedCreateRef = useRef(false)
  const createSelectionReady =
    !config.createSelection || config.createSelection.options.length > 0

  // Auto-open Create dialog once data has loaded (triggered by ?create=1)
  useEffect(() => {
    if (!config.autoCreate) {
      hasAutoOpenedCreateRef.current = false
      return
    }
    if (hasAutoOpenedCreateRef.current || loading || !createSelectionReady) {
      return
    }
    hasAutoOpenedCreateRef.current = true
    openCreateDialog()
  }, [config.autoCreate, loading, createSelectionReady])

  useEffect(() => {
    if (!config.initialEditId || loading || dialogOpen) return

    const target = items.find(item => String(item.id) === config.initialEditId)
    if (target) {
      openEditDialog(target)
    }
    config.onInitialEditHandled?.()
  }, [config.initialEditId, loading, dialogOpen, items])

  // Load relation options whenever dialog opens
  useEffect(() => {
    if (!dialogOpen) return
    activeFields
      .filter(f => f.type === 'relation' && f.relationApiPath)
      .forEach(f => {
        pb.send<Record<string, unknown>[] | Record<string, unknown>>(f.relationApiPath!, {})
          .then(raw => {
            // Handle both flat arrays and PocketBase paginated responses { items: [...] }
            let records: Record<string, unknown>[] = []
            if (Array.isArray(raw)) {
              records = raw
            } else if (
              raw &&
              typeof raw === 'object' &&
              Array.isArray((raw as Record<string, unknown>).items)
            ) {
              records = (raw as Record<string, unknown>).items as Record<string, unknown>[]
            }
            let data = records
            // Client-side filter
            if (f.relationFilter) {
              for (const [fk, fv] of Object.entries(f.relationFilter)) {
                data = data.filter(item => String(item[fk] ?? '') === fv)
              }
            }
            const opts: RelationOption[] = data.map(item => ({
              id: String(item.id),
              label: f.relationFormatLabel
                ? f.relationFormatLabel(item)
                : String(item[f.relationLabelKey ?? 'name'] ?? item.id),
              raw: item,
            }))
            setRelOpts(prev => ({ ...prev, [f.key]: opts }))
            // Auto-select default option on create
            if (f.multiSelect && f.relationAutoSelectDefault && !editingItem) {
              const defaultOpt = opts.find(o => o.raw?.['is_default'] === true)
              if (defaultOpt) {
                setFormData(prev => {
                  const existing = Array.isArray(prev[f.key]) ? (prev[f.key] as string[]) : []
                  if (existing.includes(defaultOpt.id)) return prev
                  return { ...prev, [f.key]: [...existing, defaultOpt.id] }
                })
              }
            }
          })
          .catch(() => setRelOpts(prev => ({ ...prev, [f.key]: [] })))
      })
  }, [dialogOpen, activeFields, editingItem])

  // ─── Form helpers ────────────────────

  function buildDefaultFormData(initialData: Record<string, unknown>, nextEditingItem: Record<string, unknown> | null) {
    const defaults: Record<string, unknown> = {}
    for (const f of getFields(initialData, nextEditingItem)) {
      if (f.multiSelect) {
        defaults[f.key] = Array.isArray(f.defaultValue) ? f.defaultValue : []
      } else {
        defaults[f.key] =
          f.defaultValue ?? (f.type === 'boolean' ? false : f.type === 'number' ? 0 : '')
      }
    }
    return defaults
  }

  function openCreateForm(initialData: Record<string, unknown> = {}) {
    setEditingItem(null)
    setAdvancedOpen(false)
    const defaults = buildDefaultFormData(initialData, null)
    setFormData({ ...defaults, ...initialData })
    setFormError('')
    setDialogOpen(true)
  }

  function openCreateDialog() {
    if (config.createSelection) {
      setCreateSelectionQuery('')
      setCreateSelectionOpen(true)
      return
    }
    openCreateForm(config.initialCreateData?.() ?? {})
  }

  function openEditDialog(item: Record<string, unknown>) {
    setEditingItem(item)
    setAdvancedOpen(false)
    const data: Record<string, unknown> = {}
    for (const f of getFields(item, item)) {
      const val = item[f.key]
      if (f.multiSelect) {
        // Normalize to string array
        data[f.key] = Array.isArray(val) ? val.map(String) : val ? [String(val)] : []
      } else {
        data[f.key] = val ?? f.defaultValue ?? ''
      }
    }
    setFormData(data)
    setFormError('')
    setDialogOpen(true)

    if (groupField && resourceObjectType) {
      void listGroupMemberships(resourceObjectType, [String(item.id)])
        .then(memberships => {
          const groupIds = memberships
            .map(membership => String(membership['group_id'] ?? ''))
            .filter(Boolean)
          setFormData(prev => ({ ...prev, [groupField.key]: groupIds }))
        })
        .catch(() => {
          setFormData(prev => ({ ...prev, [groupField.key]: [] }))
        })
    }
  }

  function updateField(key: string, value: unknown) {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  function resetFormDialog() {
    setFormError('')
    if (editingItem) {
      openEditDialog(editingItem)
      return
    }
    setAdvancedOpen(false)
    setFormData(buildDefaultFormData(formData, null))
  }

  function handleChange(field: FieldDef, raw: unknown) {
    const value = field.type === 'number' ? Number(raw) : raw
    updateField(field.key, value)
    field.onValueChange?.(value, updateField)
  }

  function handleFileUpload(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => updateField(key, String(ev.target?.result ?? ''))
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleCreateRelFileUpload(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev =>
      setCreateRelData(prev => ({ ...prev, [key]: String(ev.target?.result ?? '') }))
    reader.readAsText(file)
    e.target.value = ''
  }

  function openCreateRelDialog(field: FieldDef) {
    const defaults: Record<string, unknown> = {}
    for (const f of field.relationCreate!.fields) {
      defaults[f.key] = f.defaultValue ?? ''
    }
    setCreateRelField(field)
    setCreateRelData(defaults)
    setCreateRelError('')
    setCreateRelOpen(true)
  }

  async function handleCreateRelSubmit(e: FormEvent) {
    e.preventDefault()
    if (!createRelField?.relationCreate) return
    setCreateRelSaving(true)
    setCreateRelError('')
    try {
      const body = createRelField.relationCreate.prepareData
        ? createRelField.relationCreate.prepareData(createRelData)
        : createRelData
      const created = await pb.send<Record<string, unknown>>(
        createRelField.relationCreate.apiPath,
        {
          method: 'POST',
          body,
        }
      )
      const labelKey = createRelField.relationLabelKey ?? 'name'
      const newLabel = createRelField.relationFormatLabel
        ? createRelField.relationFormatLabel(created)
        : String(created[labelKey] ?? created.id)
      setRelOpts(prev => ({
        ...prev,
        [createRelField!.key]: [
          ...(prev[createRelField!.key] ?? []),
          { id: String(created.id), label: newLabel },
        ],
      }))
      updateField(createRelField!.key, String(created.id))
      setCreateRelOpen(false)
    } catch (err) {
      setCreateRelError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreateRelSaving(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError('')

    try {
      const validationMessage = config.validateForm?.({
        formData,
        editingItem,
        activeFields,
      })
      if (validationMessage) {
        setFormError(validationMessage)
        return
      }

      const payload = { ...formData }
      for (const field of activeFields) {
        if (field.readOnly) {
          delete payload[field.key]
        }
      }
      const selectedGroups = groupField
        ? Array.isArray(payload[groupField.key])
          ? (payload[groupField.key] as string[])
          : []
        : []
      if (groupField) delete payload[groupField.key]

      if (editingItem) {
        if (config.updateItem) {
          await config.updateItem(String(editingItem.id), payload)
        } else {
          await pb.send(`${config.apiPath}/${editingItem.id}`, {
            method: 'PUT',
            body: payload,
          })
        }
        await syncGroupMemberships(String(editingItem.id), selectedGroups)
      } else {
        const created = config.createItem
          ? await config.createItem(payload)
          : await pb.send(config.apiPath, {
              method: 'POST',
              body: payload,
            })
        await syncGroupMemberships(
          String((created as Record<string, unknown>).id ?? ''),
          selectedGroups
        )
        setDialogOpen(false)
        await fetchItems()
        config.onCreateSuccess?.(created as Record<string, unknown>)
        return
      }
      setDialogOpen(false)
      await fetchItems()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ─── Batch selection ─────────────────

  function toggleSelectItem(id: string) {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const pageIds = pagedItems.map(item => String(item.id))
    const allVisibleSelected = pageIds.every(id => selectedItems.has(id))
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        pageIds.forEach(id => next.delete(id))
      } else {
        pageIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  function toggleSort(columnKey: string) {
    setSortKey(current => {
      if (current === columnKey) {
        setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
        return current
      }
      setSortDir('asc')
      return columnKey
    })
  }

  function toggleFilterValue(columnKey: string, value: string, included: boolean) {
    setExcludedFilters(prev => {
      const next = new Set(prev[columnKey] ?? [])
      if (included) next.delete(value)
      else next.add(value)
      return { ...prev, [columnKey]: next }
    })
  }

  function resetListControls() {
    setSearchQuery('')
    setExcludedFilters({})
    setShowFavoritesOnly(false)
    setPage(1)
    setPageSize(config.pageSize ?? 10)
    setSortKey(config.defaultSort?.key ?? null)
    setSortDir(config.defaultSort?.dir ?? 'asc')
  }

  function toggleFavorite(itemId: string) {
    setFavoriteIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      writeFavoriteIds(config.favoriteStorageKey, next)
      return next
    })
  }

  function isInteractiveTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    return Boolean(target.closest('button,a,input,textarea,select,[role="menuitem"],[role="checkbox"]'))
  }

  function renderFilterMenu(column: (typeof config.columns)[number]) {
    const options = filterOptionMap[column.key] ?? []
    const excluded = excludedFilters[column.key] ?? new Set<string>()
    const active = excluded.size > 0
    if (options.length === 0) return null

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Filter ${column.label}`}
          >
            <Filter className={`h-3.5 w-3.5 ${active ? 'text-primary' : ''}`} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48 p-2">
          <div className="space-y-1">
            {options.map(option => {
              const checked = !excluded.has(option.value)
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={value =>
                      toggleFilterValue(column.key, option.value, value === true)
                    }
                  />
                  <span>{option.label}</span>
                </label>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderColumnHeader(column: (typeof config.columns)[number]) {
    const hasSort = Boolean(column.sortable || column.sortValue)
    const hasFilter = Boolean(config.headerFilters && (column.filterOptions || column.filterValue))
    const showSort = hasSort && !hasFilter

    return (
      <div className="flex items-center gap-1">
        {showSort ? (
          <button
            type="button"
            className="flex items-center gap-1 hover:text-foreground"
            onClick={() => toggleSort(column.key)}
          >
            <span>{column.label}</span>
            {sortKey === column.key ? (
              sortDir === 'asc' ? (
                <ArrowUp className="h-3.5 w-3.5" />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" />
              )
            ) : (
              <ArrowUp className="h-3.5 w-3.5 opacity-30" />
            )}
          </button>
        ) : (
          <span>{column.label}</span>
        )}
        {hasFilter ? renderFilterMenu(column) : null}
      </div>
    )
  }

  function renderPageSizeSelector(className?: string) {
    return (
      <select
        value={pageSize}
        onChange={event => setPageSize(Number(event.target.value))}
        className={cn(INPUT_CLASS, 'h-8 w-auto py-1 pr-8 text-sm', className)}
        aria-label="Rows per page"
      >
        {pageSizeOptions.map(option => (
          <option key={option} value={option}>
            {option} / page
          </option>
        ))}
      </select>
    )
  }

  function renderPaginationControls() {
    if (paginationPlacement === 'none') {
      return null
    }

    if (paginationVariant === 'minimal') {
      if (processedItems.length === 0) return null
      return (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {paginationTotalLabel ? (
            <span className="whitespace-nowrap">{paginationTotalLabel}</span>
          ) : showPaginationSummary ? (
            <span className="whitespace-nowrap">{processedItems.length} total</span>
          ) : null}
          {showInlinePageSizeSelector ? renderPageSizeSelector() : null}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-5 text-center font-medium text-foreground">{page}</span>
            <button
              type="button"
              className="rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )
    }

    // default full pager — only render when there's something to page through
    if (processedItems.length === 0 || totalPages <= 1) return null
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {(paginationTotalLabel || showPaginationSummary) && (
          <span>
            {paginationTotalLabel ?? `${processedItems.length} total`} · Page {page} of {totalPages}
          </span>
        )}
        {showFooterPageSizeSelector && (
          renderPageSizeSelector('h-9')
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    )
  }

  async function handleAssignToGroups() {
    if (selectedGroupIds.size === 0) return
    setAssigningGroups(true)
    try {
      if (!resourceObjectType) {
        throw new Error('Missing resource type for group assignment')
      }

      const resourceIds = Array.from(selectedItems)
      const targetGroupIds = Array.from(selectedGroupIds)
      const existingMemberships = await listGroupMemberships(resourceObjectType, resourceIds)
      const existingKeys = new Set(
        existingMemberships.map(
          membership =>
            `${String(membership['group_id'] ?? '')}:${String(membership['object_id'] ?? '')}`
        )
      )
      const createOps = targetGroupIds.flatMap(groupId =>
        resourceIds
          .filter(resourceId => !existingKeys.has(`${groupId}:${resourceId}`))
          .map(resourceId =>
            pb.send('/api/collections/group_items/records', {
              method: 'POST',
              body: {
                group_id: groupId,
                object_type: resourceObjectType,
                object_id: resourceId,
              },
            })
          )
      )

      await Promise.all(createOps)
      setSelectedItems(new Set())
      setSelectedGroupIds(new Set())
      setGroupAssignDialogOpen(false)
      await fetchItems()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch assign failed')
    } finally {
      setAssigningGroups(false)
    }
  }

  // ─── Delete ──────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (config.deleteItem) {
        await config.deleteItem(String(deleteTarget.id))
      } else {
        await pb.send(`${config.apiPath}/${deleteTarget.id}`, { method: 'DELETE' })
      }
      setDeleteTarget(null)
      await fetchItems()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  // ─── Render ──────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {config.parentNav && (
            <Link
              to={config.parentNav.href as never}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1 w-fit transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {config.parentNav.label}
            </Link>
          )}
          <h1 className="text-2xl font-bold tracking-tight">{config.title}</h1>
          {config.description && <p className="text-muted-foreground mt-1">{config.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {config.showRefreshButton && (
            <Button
              variant="outline"
              size={config.refreshButtonIconOnly === false ? 'default' : 'icon'}
              onClick={() => {
                void handleRefresh()
              }}
              title={config.refreshButtonLabel ?? 'Refresh'}
            >
              {(config.refreshButtonShowIcon ?? true) && (
                <RefreshCw
                  className={`h-4 w-4 ${config.refreshButtonIconOnly === false ? 'mr-2' : ''}`}
                />
              )}
              {config.refreshButtonIconOnly === false && (config.refreshButtonLabel ?? 'Refresh')}
            </Button>
          )}
          <Button
            onClick={openCreateDialog}
            size={config.createButtonIconOnly ? 'icon' : 'default'}
            title={config.createButtonLabel ?? 'Create'}
          >
            {(config.createButtonShowIcon ?? true) && (
              <Plus className={`h-4 w-4 ${config.createButtonIconOnly ? '' : 'mr-2'}`} />
            )}
            {!config.createButtonIconOnly && (config.createButtonLabel ?? 'Create')}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={fetchItems}>
            Retry
          </Button>
        </div>
      )}

      {showListControls && (
        <div
          className={cn(
            'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
            showListControlsBorder ? 'rounded-lg border bg-muted/20 p-3' : 'p-0'
          )}
        >
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            {searchableColumns.length > 0 && (
              <div className={cn('relative', config.searchContainerClassName ?? 'w-full sm:max-w-sm')}>
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder={config.searchPlaceholder ?? `Search ${config.title.toLowerCase()}...`}
                  className="pl-9"
                />
              </div>
            )}
            {filterableColumns.length > 0 && !config.headerFilters && (
              <div className="flex flex-wrap items-center gap-2">
                {filterableColumns.map(column => {
                  const options = filterOptionMap[column.key] ?? []
                  const excluded = excludedFilters[column.key] ?? new Set<string>()
                  const active = excluded.size > 0
                  return (
                    <DropdownMenu key={column.key}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2">
                          <Filter className={`h-3.5 w-3.5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                          {column.label}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-48 p-2">
                        <div className="space-y-1">
                          {options.map(option => {
                            const checked = !excluded.has(option.value)
                            return (
                              <label
                                key={option.value}
                                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={value =>
                                    toggleFilterValue(column.key, option.value, value === true)
                                  }
                                />
                                <span>{option.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                })}
              </div>
            )}
            {config.favoriteStorageKey && (
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={showFavoritesOnly}
                  onCheckedChange={checked => setShowFavoritesOnly(checked === true)}
                />
                <span>{config.favoritesFilterLabel ?? 'Favorites only'}</span>
              </label>
            )}
          </div>
          {(showHeaderPageSizeSelector || showListControlsReset || showHeaderPagination) && (
            <div className="flex items-center gap-2 self-end sm:self-auto">
              {showHeaderPageSizeSelector && paginationVariant !== 'minimal'
                ? renderPageSizeSelector('h-9')
                : null}
              {showListControlsReset && (
                <Button variant="ghost" size="sm" onClick={resetListControls}>
                  Reset
                </Button>
              )}
              {showHeaderPagination ? renderPaginationControls() : null}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {config.wrapTableInCard === false ? (
        <div>
          {processedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p>{emptyStateLabel}</p>
              {items.length > 0 ? (
                <Button variant="link" onClick={resetListControls}>
                  Clear current filters
                </Button>
              ) : (
                <Button variant="link" onClick={openCreateDialog}>
                  Create your first one
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {config.enableGroupAssign && (
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={
                          pagedItems.length > 0 &&
                          pagedItems.every(item => selectedItems.has(String(item.id)))
                        }
                        onChange={toggleSelectAll}
                      />
                    </TableHead>
                  )}
                  {config.columns.map(col => (
                    <TableHead key={col.key}>{renderColumnHeader(col)}</TableHead>
                  ))}
                  <TableHead className={config.primaryAction ? 'w-[220px] text-right' : 'w-[72px] text-right'}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedItems.map(item => (
                  <TableRow
                    key={String(item.id)}
                    data-selected={selectedItems.has(String(item.id))}
                    className={config.selectedItemId === String(item.id) ? 'bg-muted/40' : undefined}
                    onClick={
                      config.onSelectItem
                        ? event => {
                            if (isInteractiveTarget(event.target)) return
                            config.onSelectItem?.(item)
                          }
                        : undefined
                    }
                  >
                    {config.enableGroupAssign && (
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={selectedItems.has(String(item.id))}
                          onChange={() => toggleSelectItem(String(item.id))}
                        />
                      </TableCell>
                    )}
                    {config.columns.map(col => (
                      <TableCell key={col.key}>
                        {col.render ? col.render(item[col.key], item) : String(item[col.key] ?? '')}
                      </TableCell>
                    ))}
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {config.primaryAction?.(item, () => {
                          void fetchItems()
                        })}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" title="More actions">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                          {favoriteActionPlacement === 'beforeExtraActions' && config.favoriteStorageKey && (
                            <>
                              <DropdownMenuItem onClick={() => toggleFavorite(String(item.id ?? ''))}>
                                <Star
                                  className="h-4 w-4"
                                  fill={favoriteIds.has(String(item.id ?? '')) ? 'currentColor' : 'none'}
                                />
                                {favoriteIds.has(String(item.id ?? ''))
                                  ? 'Remove Favorite'
                                  : 'Add Favorite'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          {config.extraActions?.(item, () => {
                            void fetchItems()
                          })}
                          {favoriteActionPlacement === 'afterExtraActions' && config.favoriteStorageKey && (
                            <>
                              {config.extraActions && <DropdownMenuSeparator />}
                              <DropdownMenuItem onClick={() => toggleFavorite(String(item.id ?? ''))}>
                                <Star
                                  className="h-4 w-4"
                                  fill={favoriteIds.has(String(item.id ?? '')) ? 'currentColor' : 'none'}
                                />
                                {favoriteIds.has(String(item.id ?? ''))
                                  ? 'Remove Favorite'
                                  : 'Add Favorite'}
                              </DropdownMenuItem>
                            </>
                          )}
                          {(config.extraActions || (favoriteActionPlacement === 'afterExtraActions' && config.favoriteStorageKey)) && <DropdownMenuSeparator />}
                          <DropdownMenuItem onClick={() => openEditDialog(item)}>
                            <Pencil className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteTarget(item)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <p>{emptyStateLabel}</p>
                <Button variant="link" onClick={openCreateDialog}>
                  Create your first one
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {config.enableGroupAssign && (
                      <TableHead className="w-[40px]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={
                            pagedItems.length > 0 &&
                            pagedItems.every(item => selectedItems.has(String(item.id)))
                          }
                          onChange={toggleSelectAll}
                        />
                      </TableHead>
                    )}
                    {config.columns.map(col => (
                      <TableHead key={col.key}>{renderColumnHeader(col)}</TableHead>
                    ))}
                    <TableHead className={config.primaryAction ? 'w-[220px] text-right' : 'w-[72px] text-right'}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                    {pagedItems.map(item => (
                    <TableRow
                      key={String(item.id)}
                      data-selected={selectedItems.has(String(item.id))}
                        className={config.selectedItemId === String(item.id) ? 'bg-muted/40' : undefined}
                        onClick={
                          config.onSelectItem
                            ? event => {
                                if (isInteractiveTarget(event.target)) return
                                config.onSelectItem?.(item)
                              }
                            : undefined
                        }
                    >
                      {config.enableGroupAssign && (
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input"
                            checked={selectedItems.has(String(item.id))}
                            onChange={() => toggleSelectItem(String(item.id))}
                          />
                        </TableCell>
                      )}
                      {config.columns.map(col => (
                        <TableCell key={col.key}>
                          {col.render
                            ? col.render(item[col.key], item)
                            : String(item[col.key] ?? '')}
                        </TableCell>
                      ))}
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {config.primaryAction?.(item, () => {
                            void fetchItems()
                          })}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" title="More actions">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                            {favoriteActionPlacement === 'beforeExtraActions' && config.favoriteStorageKey && (
                              <>
                                <DropdownMenuItem onClick={() => toggleFavorite(String(item.id ?? ''))}>
                                  <Star
                                    className="h-4 w-4"
                                    fill={favoriteIds.has(String(item.id ?? '')) ? 'currentColor' : 'none'}
                                  />
                                  {favoriteIds.has(String(item.id ?? ''))
                                    ? 'Remove Favorite'
                                    : 'Add Favorite'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            {config.extraActions?.(item, () => {
                              void fetchItems()
                            })}
                            {favoriteActionPlacement === 'afterExtraActions' && config.favoriteStorageKey && (
                              <>
                                {config.extraActions && <DropdownMenuSeparator />}
                                <DropdownMenuItem onClick={() => toggleFavorite(String(item.id ?? ''))}>
                                  <Star
                                    className="h-4 w-4"
                                    fill={favoriteIds.has(String(item.id ?? '')) ? 'currentColor' : 'none'}
                                  />
                                  {favoriteIds.has(String(item.id ?? ''))
                                    ? 'Remove Favorite'
                                    : 'Add Favorite'}
                                </DropdownMenuItem>
                              </>
                            )}
                            {(config.extraActions || (favoriteActionPlacement === 'afterExtraActions' && config.favoriteStorageKey)) && <DropdownMenuSeparator />}
                            <DropdownMenuItem onClick={() => openEditDialog(item)}>
                              <Pencil className="h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(item)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {showFooterPagination ? renderPaginationControls() : null}

      {config.renderDetailPanel && selectedDetailItem && detailPresentation === 'inline' && (
        <div className={cn('border-t-2 border-border/70 pt-6', config.detailPanelWrapperClassName)}>
          <div className={cn('rounded-xl border bg-background p-5 shadow-sm', config.detailPanelClassName)}>
            {config.renderDetailPanel(selectedDetailItem, fetchItems)}
          </div>
        </div>
      )}

      {config.renderDetailPanel && detailPresentation === 'drawer' && (
        <Sheet
          open={selectedDetailItem !== null}
          onOpenChange={open => {
            if (!open) {
              config.onSelectItem?.(null)
            }
          }}
        >
          <SheetContent
            side={detailDrawerSide}
            className={cn('overflow-y-auto p-6', config.detailDrawerClassName)}
            style={getDrawerTierStyle(detailDrawerTier)}
          >
            <SheetTitle className="sr-only">{detailDrawerTitle}</SheetTitle>
            {selectedDetailItem ? config.renderDetailPanel(selectedDetailItem, fetchItems) : null}
          </SheetContent>
        </Sheet>
      )}

      {/* Batch assign toolbar */}
      {config.enableGroupAssign && selectedItems.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-muted rounded-lg border">
          <span className="text-sm font-medium">{selectedItems.size} selected</span>
          <Button
            variant="outline"
            size="sm"
            disabled={assigningGroups || groupsLoading}
            onClick={() => {
              setSelectedGroupIds(new Set())
              setGroupAssignDialogOpen(true)
            }}
          >
            <Tags className="h-4 w-4 mr-2" />
            Assign to Groups
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      )}

      {/* Assign to Groups dialog */}
      <Dialog
        open={groupAssignDialogOpen}
        onOpenChange={v => {
          setGroupAssignDialogOpen(v)
          if (!v) setSelectedGroupIds(new Set())
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign to Groups</DialogTitle>
            <DialogDescription>
              Select one or more groups to assign the {selectedItems.size} selected resource
              {selectedItems.size > 1 ? 's' : ''} to.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {groupsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : availableGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No groups available</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {availableGroups.map(g => {
                  const checked = selectedGroupIds.has(g.id)
                  return (
                    <label
                      key={g.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={checked}
                        onChange={() => {
                          setSelectedGroupIds(prev => {
                            const next = new Set(prev)
                            if (next.has(g.id)) next.delete(g.id)
                            else next.add(g.id)
                            return next
                          })
                        }}
                      />
                      <span className="text-sm">{g.label}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssignToGroups}
              disabled={assigningGroups || selectedGroupIds.size === 0}
            >
              {assigningGroups && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign
              {selectedGroupIds.size > 0
                ? ` to ${selectedGroupIds.size} group${selectedGroupIds.size > 1 ? 's' : ''}`
                : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Dialog */}
      <Dialog
        open={createSelectionOpen}
        onOpenChange={v => {
          setCreateSelectionOpen(v)
          if (!v) setCreateSelectionQuery('')
        }}
      >
        <DialogContent className={config.createSelection?.dialogClassName ?? 'sm:max-w-2xl'}>
          <DialogHeader>
            <DialogTitle>{config.createSelection?.title ?? 'Choose an option'}</DialogTitle>
            {config.createSelection?.description && (
              <DialogDescription>{config.createSelection.description}</DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-4">
            <input
              type="text"
              className={INPUT_CLASS}
              placeholder={config.createSelection?.searchPlaceholder ?? 'Search...'}
              value={createSelectionQuery}
              onChange={e => setCreateSelectionQuery(e.target.value)}
              autoFocus
            />

            {filteredCreateSelectionOptions.length === 0 ? (
              <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {config.createSelection?.emptyMessage ?? 'No matching options found.'}
              </div>
            ) : (
              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {filteredCreateSelectionOptions.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    className="w-full rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted"
                    onClick={() => {
                      const initialData = config.createSelection?.onSelect(option.id) ?? {}
                      setCreateSelectionOpen(false)
                      openCreateForm(initialData)
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{option.title}</div>
                        {option.description && (
                          <div className="mt-1 text-sm text-muted-foreground">
                            {option.description}
                          </div>
                        )}
                      </div>
                      {option.meta && (
                        <div className="shrink-0 text-xs text-muted-foreground">{option.meta}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onOpenChange={v => {
          setDialogOpen(v)
          if (!v) setCreateRelOpen(false)
          if (!v) setAdvancedOpen(false)
        }}
      >
        <DialogContent
          className={`${config.dialogContentClassName ?? 'sm:max-w-lg'} max-h-[85vh] overflow-y-auto`}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{dialogHeader?.title ?? defaultDialogTitle}</DialogTitle>
              <DialogDescription>
                {dialogHeader?.description ?? defaultDialogDescription}
              </DialogDescription>

              {headerFields.length > 0 && (
                <div className="mt-4 grid gap-3">
                  {headerFields.map(field => (
                    <ResourceFormField
                      key={field.key}
                      field={field}
                      formData={formData}
                      editingItem={editingItem}
                      relationOptions={relOpts[field.key] ?? []}
                      updateField={updateField}
                      handleChange={handleChange}
                      addRelationOption={(id, label, raw) => {
                        setRelOpts(prev => ({
                          ...prev,
                          [field.key]: [...(prev[field.key] ?? []), { id, label, raw }],
                        }))
                      }}
                      openRelationCreate={openCreateRelDialog}
                      handleFileUpload={handleFileUpload}
                      fileInputRef={(key, element) => {
                        fileRefs.current[key] = element
                      }}
                    />
                  ))}
                </div>
              )}
            </DialogHeader>

            {!dialogHeader?.hideSelectedProductSummary &&
              String(formData['selected_product'] ?? '').trim() && (
                <div className="rounded-lg border bg-muted/40 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Selected Product
                    </span>
                    <span className="font-semibold text-foreground">
                      {String(formData['selected_product'] ?? '')}
                    </span>
                    {String(formData['selected_product_meta'] ?? '').trim() && (
                      <span className="text-xs text-muted-foreground">
                        {String(formData['selected_product_meta'] ?? '')}
                      </span>
                    )}
                    {String(formData['selected_product_description'] ?? '').trim() && (
                      <span className="text-sm text-muted-foreground">
                        {String(formData['selected_product_description'] ?? '')}
                      </span>
                    )}
                  </div>
                </div>
              )}

            {primaryFields.map(field => (
              <ResourceFormField
                key={field.key}
                field={field}
                formData={formData}
                editingItem={editingItem}
                relationOptions={relOpts[field.key] ?? []}
                updateField={updateField}
                handleChange={handleChange}
                addRelationOption={(id, label, raw) => {
                  setRelOpts(prev => ({
                    ...prev,
                    [field.key]: [...(prev[field.key] ?? []), { id, label, raw }],
                  }))
                }}
                openRelationCreate={openCreateRelDialog}
                handleFileUpload={handleFileUpload}
                fileInputRef={(key, element) => {
                  fileRefs.current[key] = element
                }}
              />
            ))}

            {advancedFields.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-muted/70 via-muted/30 to-background shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 border-b border-border/70 px-5 py-4 text-left"
                  onClick={() => setAdvancedOpen(prev => !prev)}
                >
                  <div>
                    <div className="text-sm font-medium text-foreground">Advanced</div>
                  </div>
                  {advancedOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {advancedOpen && (
                  <div className="space-y-4 bg-background/90 px-5 py-5">
                    {advancedFields.map(field => (
                      <ResourceFormField
                        key={field.key}
                        field={field}
                        formData={formData}
                        editingItem={editingItem}
                        relationOptions={relOpts[field.key] ?? []}
                        updateField={updateField}
                        handleChange={handleChange}
                        addRelationOption={(id, label, raw) => {
                          setRelOpts(prev => ({
                            ...prev,
                            [field.key]: [...(prev[field.key] ?? []), { id, label, raw }],
                          }))
                        }}
                        openRelationCreate={openCreateRelDialog}
                        handleFileUpload={handleFileUpload}
                        fileInputRef={(key, element) => {
                          fileRefs.current[key] = element
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {formError && <p className="text-destructive text-sm">{formError}</p>}

            <DialogFooter>
              {config.resetFormButtonLabel ? (
                <Button type="button" variant="outline" onClick={resetFormDialog}>
                  {config.resetFormButtonLabel}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingItem ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Inline "create relation" mini-dialog */}
      <Dialog open={createRelOpen} onOpenChange={setCreateRelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createRelField?.relationCreate?.label}</DialogTitle>
            <DialogDescription>Create a new record and select it automatically.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRelSubmit} className="space-y-4">
            {(createRelField?.relationCreate?.fields ?? [])
              .filter(f => !f.hidden)
              .filter(
                f =>
                  !f.showWhen ||
                  f.showWhen.values.includes(String(createRelData[f.showWhen.field] ?? ''))
              )
              .map(f => {
                const effectiveType = f.dynamicType
                  ? f.dynamicType.values.includes(String(createRelData[f.dynamicType.field] ?? ''))
                    ? f.dynamicType.as
                    : f.type
                  : f.type
                return (
                  <div key={f.key} className="space-y-1.5">
                    <label className="text-sm font-medium">
                      {f.label}
                      {f.required && <span className="text-destructive ml-1">*</span>}
                    </label>
                    {effectiveType === 'select' ? (
                      <select
                        className={INPUT_CLASS}
                        value={String(createRelData[f.key] ?? '')}
                        onChange={e =>
                          setCreateRelData(prev => ({ ...prev, [f.key]: e.target.value }))
                        }
                        required={f.required}
                      >
                        <option value="">Select…</option>
                        {renderSelectOptions(f.options)}
                      </select>
                    ) : effectiveType === 'textarea' || effectiveType === 'file-textarea' ? (
                      <div className="space-y-1">
                        <textarea
                          className={INPUT_CLASS + ' min-h-[120px] resize-y font-mono text-xs'}
                          value={String(createRelData[f.key] ?? '')}
                          onChange={e =>
                            setCreateRelData(prev => ({ ...prev, [f.key]: e.target.value }))
                          }
                          placeholder={f.placeholder}
                          required={f.required}
                          rows={5}
                        />
                        {effectiveType === 'file-textarea' && (
                          <>
                            <input
                              ref={el => {
                                createRelFileRefs.current[f.key] = el
                              }}
                              type="file"
                              accept={f.fileAccept ?? '.pem,.key,.crt,.txt'}
                              className="hidden"
                              onChange={e => handleCreateRelFileUpload(f.key, e)}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => createRelFileRefs.current[f.key]?.click()}
                            >
                              <Upload className="h-3 w-3 mr-1" />
                              Upload file
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <input
                        type={effectiveType === 'password' ? 'password' : 'text'}
                        className={INPUT_CLASS}
                        value={String(createRelData[f.key] ?? '')}
                        onChange={e =>
                          setCreateRelData(prev => ({ ...prev, [f.key]: e.target.value }))
                        }
                        placeholder={f.placeholder}
                        required={f.required}
                      />
                    )}
                  </div>
                )
              })}
            {createRelError && <p className="text-destructive text-sm">{createRelError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateRelOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createRelSaving}>
                {createRelSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {config.title.replace(/s$/, '')}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{String(deleteTarget?.[nameField] ?? '')}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
