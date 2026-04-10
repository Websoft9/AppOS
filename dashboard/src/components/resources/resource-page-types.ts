import type { ReactNode } from 'react'

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
  placeholder?: string
  options?: SelectOption[]
  defaultValue?: unknown
  hidden?: boolean
  header?: boolean
  advanced?: boolean
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
  showWhen?: { field: string; values: string[] }
  dynamicType?: { field: string; values: string[]; as: 'textarea' | 'file-textarea' }
  fileAccept?: string
  readOnly?: boolean
  render?: (ctx: {
    field: FieldDef
    inputId: string
    value: unknown
    formData: Record<string, unknown>
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
  onValueChange?: (value: unknown, update: (key: string, value: unknown) => void) => void
}

export interface ResourcePageConfig {
  title: string
  description?: string
  apiPath: string
  columns: Column[]
  fields: FieldDef[]
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
  resolveFields?: (ctx: {
    formData: Record<string, unknown>
    editingItem: Record<string, unknown> | null
  }) => FieldDef[]
  nameField?: string
  autoCreate?: boolean
  parentNav?: { label: string; href: string }
  enableGroupAssign?: boolean
  onCreateSuccess?: (record: Record<string, unknown>) => void
  showRefreshButton?: boolean
  createButtonIconOnly?: boolean
  wrapTableInCard?: boolean
  onRefresh?: (ctx: {
    items: Record<string, unknown>[]
    refreshList: () => Promise<void>
  }) => Promise<void> | void
  extraActions?: (item: Record<string, unknown>, refreshList: () => void) => ReactNode
  resourceType?: string
  listItems?: () => Promise<Record<string, unknown>[]>
  createItem?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  updateItem?: (id: string, payload: Record<string, unknown>) => Promise<void>
  deleteItem?: (id: string) => Promise<void>
  initialEditId?: string
  onInitialEditHandled?: () => void
}
