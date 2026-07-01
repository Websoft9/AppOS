import type { ReactNode } from 'react'
import type { DrawerTier } from '@/lib/drawer-tiers'

export interface RelCreateField {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea' | 'file-textarea'
  required?: boolean
  hidden?: boolean
  defaultValue?: unknown
  placeholder?: string
  options?: SelectOption[]
  fileAccept?: string
  dynamicType?: { field: string; values: string[]; as: 'textarea' | 'file-textarea' }
  showWhen?: { field: string; values: string[] }
  prepareData?: (data: Record<string, unknown>) => Record<string, unknown>
}

export interface Column {
  key: string
  label: string
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode
  searchable?: boolean
  sortable?: boolean
  sortValue?: (row: Record<string, unknown>) => string | number | null | undefined
  filterOptions?: SelectOption[]
  filterValue?: (row: Record<string, unknown>) => string | null | undefined
}

export interface SelectOption {
  label: string
  value: string
  group?: string
}

export type RelationOption = { id: string; label: string; raw?: Record<string, unknown> }

export interface FieldDef {
  key: string
  label: string
  type:
    | 'text'
    | 'number'
    | 'select'
    | 'textarea'
    | 'password'
    | 'boolean'
    | 'relation'
    | 'file-textarea'
  required?: boolean
  maxLength?: number
  placeholder?: string
  rows?: number
  options?: SelectOption[]
  defaultValue?: unknown
  hidden?: boolean
  hideLabel?: boolean
  header?: boolean
  advanced?: boolean
  helpUrl?: string
  helpText?: string
  relationApiPath?: string
  relationLabelKey?: string
  relationFormatLabel?: (raw: Record<string, unknown>) => string
  relationFilter?: Record<string, string>
  relationCreate?: {
    label: string
    apiPath: string
    fields: RelCreateField[]
    prepareData?: (data: Record<string, unknown>) => Record<string, unknown>
  }
  multiSelect?: boolean
  relationAutoSelectDefault?: boolean
  relationShowNoneOption?: boolean
  relationShowSelectedIndicator?: boolean
  relationBorderlessMenu?: boolean
  showWhen?: { field: string; values: string[] }
  dynamicType?: { field: string; values: string[]; as: 'textarea' | 'file-textarea' }
  fileAccept?: string
  readOnly?: boolean
  inputClassName?: string
  textareaClassName?: string
  render?: (ctx: {
    field: FieldDef
    inputId: string
    value: unknown
    formData: Record<string, unknown>
    editingItem: Record<string, unknown> | null
    updateField: (key: string, value: unknown) => void
    setValue: (value: unknown) => void
    relationOptions: RelationOption[]
    addRelationOption: (id: string, label: string, raw?: Record<string, unknown>) => void
    openRelationCreate: () => void
  }) => ReactNode
  relationCreateButton?: {
    label: string
    onClick: (callbacks: { addOption: (id: string, label: string) => void }) => void
  }
  relationEditButton?: {
    label: string
    onClick: (value: string) => void
  }
  onValueChange?: (value: unknown, update: (key: string, value: unknown) => void) => void
}

export interface ResourcePageListConfig {
  columns: Column[]
  searchPlaceholder?: string
  searchContainerClassName?: string
  searchInputClassName?: string
  pageSize?: number
  pageSizeValue?: number
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  headerFilters?: boolean
  listControlsBorder?: boolean
  listControlsShowReset?: boolean
  pageSizeSelectorPlacement?: 'header' | 'footer' | 'none'
  paginationSummary?: boolean
  paginationTotalLabel?: (totalCount: number) => ReactNode
  paginationPlacement?: 'header' | 'footer' | 'none'
  paginationVariant?: 'default' | 'minimal'
  headerTrailingControls?: (ctx: {
    pageSize: number
    setPageSize: (pageSize: number) => void
    totalCount: number
  }) => ReactNode
  favoriteStorageKey?: string
  favoritesFilterLabel?: string
  favoriteActionPlacement?: 'beforeExtraActions' | 'afterExtraActions'
  wrapTableInCard?: boolean
}

export interface ResourcePageFormConfig {
  fields: FieldDef[]
  createButtonLabel?: string
  createButtonShowIcon?: boolean
  onCreateClick?: () => void
  onEditOpen?: (item: Record<string, unknown>) => void
  cancelLabel?: string
  onCancel?: (editingItem: Record<string, unknown> | null) => void
  dialogExtra?: ReactNode
  compactHeaderActionsOnMobile?: boolean
  descriptionClassName?: string
  createSelection?: {
    title: string
    description?: string
    searchPlaceholder?: string
    emptyMessage?: string
    dialogClassName?: string
    options: Array<{
      id: string
      title: string
      description?: string
      meta?: string
      searchText?: string
    }>
    onSelect: (optionId: string) => Record<string, unknown>
  }
  dialogContentClassName?: string
  dialogHeader?: (ctx: {
    formData: Record<string, unknown>
    editingItem: Record<string, unknown> | null
    updateField: (key: string, value: unknown) => void
    title: ReactNode
    description?: ReactNode
  }) => {
    title: ReactNode
    description?: ReactNode
    hideSelectedProductSummary?: boolean
  }
  initialCreateData?: () => Record<string, unknown>
  validateForm?: (ctx: {
    formData: Record<string, unknown>
    editingItem: Record<string, unknown> | null
    activeFields: FieldDef[]
  }) => string | null
  resolveFields?: (ctx: {
    formData: Record<string, unknown>
    editingItem: Record<string, unknown> | null
  }) => FieldDef[]
  nameField?: string
  autoCreate?: boolean
  onAutoCreateHandled?: () => void
  enableGroupAssign?: boolean
  onCreateSuccess?: (record: Record<string, unknown>) => void
  resetFormButtonLabel?: string
  initialEditId?: string
  onInitialEditHandled?: () => void
}

export interface ResourcePageDetailConfig {
  expandedRowId?: string | null
  renderRowDetail?: (item: Record<string, unknown>, refreshList: () => Promise<void>) => ReactNode
  selectedItemId?: string
  onSelectItem?: (item: Record<string, unknown> | null) => void
  renderDetailPanel?: (item: Record<string, unknown>, refreshList: () => Promise<void>) => ReactNode
  detailPresentation?: 'inline' | 'drawer'
  detailPanelWrapperClassName?: string
  detailPanelClassName?: string
  detailDrawerTitle?: ReactNode
  detailDrawerTier?: DrawerTier
  detailDrawerSide?: 'left' | 'right'
  detailDrawerClassName?: string
}

export interface ResourcePageActionConfig {
  showRefreshButton?: boolean
  refreshButtonLabel?: string
  refreshButtonIconOnly?: boolean
  refreshButtonShowIcon?: boolean
  createButtonIconOnly?: boolean
  onRefresh?: (ctx: {
    items: Record<string, unknown>[]
    refreshList: () => Promise<void>
  }) => Promise<void> | void
  primaryAction?: (item: Record<string, unknown>, refreshList: () => void) => ReactNode
  extraActions?: (item: Record<string, unknown>, refreshList: () => void) => ReactNode
  actionsAlign?: 'left' | 'right'
  actionsMenuAlign?: 'start' | 'end'
}

export interface ResourcePageDataConfig {
  apiPath: string
  resourceType?: string
  listItems?: () => Promise<Record<string, unknown>[]>
  createItem?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  updateItem?: (id: string, payload: Record<string, unknown>) => Promise<void>
  deleteItem?: (id: string) => Promise<void>
  refreshKey?: number
}

export interface ResourcePageConfig
  extends ResourcePageListConfig,
    ResourcePageFormConfig,
    ResourcePageDetailConfig,
    ResourcePageActionConfig,
    ResourcePageDataConfig {
  title: string
  description?: string
  emptyStateLabel?: string
  headerStatus?: ReactNode
  selectedSummary?: ReactNode
  parentNav?: { label: string; href: string; icon?: React.ReactNode }
}
