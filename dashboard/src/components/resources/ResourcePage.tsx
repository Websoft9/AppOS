import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
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
  ChevronLeft,
  Tags,
  X,
  RefreshCw,
  MoreVertical,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { type PBList, pbFilterValue } from '@/lib/groups'

// ─── Types ───────────────────────────────────────────────

/** Fields for the inline "create new relation" mini-dialog */
export interface RelCreateField {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea' | 'file-textarea'
  required?: boolean
  hidden?: boolean
  defaultValue?: unknown
  placeholder?: string
  options?: { label: string; value: string }[]
  fileAccept?: string
  /** Switch type based on another field's current value */
  dynamicType?: { field: string; values: string[]; as: 'textarea' | 'file-textarea' }
  /** Only show when another field has one of these values */
  showWhen?: { field: string; values: string[] }
  /** Transform flat form data before POSTing (e.g. nest payload for new secrets API) */
  prepareData?: (data: Record<string, unknown>) => Record<string, unknown>
}

export interface Column {
  key: string
  label: string
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode
}

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
  options?: { label: string; value: string }[]
  defaultValue?: unknown
  hidden?: boolean
  /** Relation: load options from this API path */
  relationApiPath?: string
  /** Relation: which field to use as label (default: "name") */
  relationLabelKey?: string
  /** Relation: custom label formatter — receives the raw record, returns display string */
  relationFormatLabel?: (raw: Record<string, unknown>) => string
  /** Relation: filter options via query params (e.g. { type: "password" }) */
  relationFilter?: Record<string, string>
  /** Relation: show an inline "+" button to create a new record */
  relationCreate?: {
    label: string
    apiPath: string
    fields: RelCreateField[]
    /** Transform flat form data before POSTing to the create endpoint */
    prepareData?: (data: Record<string, unknown>) => Record<string, unknown>
  }
  /** Relation: allow selecting multiple options (renders as checkboxes) */
  multiSelect?: boolean
  /** Relation + multiSelect: auto-select the option with is_default=true when creating */
  relationAutoSelectDefault?: boolean
  /** Only show when another field has one of these values */
  showWhen?: { field: string; values: string[] }
  /** Switch type when another field has one of these values */
  dynamicType?: { field: string; values: string[]; as: 'textarea' | 'file-textarea' }
  /** Enable file upload button (textarea / file-textarea) */
  fileAccept?: string
  /** Custom handler for the "+" button on a relation field (replaces built-in mini-dialog) */
  relationCreateButton?: {
    label: string
    onClick: (callbacks: {
      /** Call after creating a record to add it to the dropdown and auto-select it */
      addOption: (id: string, label: string) => void
    }) => void
  }
  /** Side effect: when this field changes, update other fields too */
  onValueChange?: (value: unknown, update: (key: string, value: unknown) => void) => void
}

export interface ResourcePageConfig {
  title: string
  description?: string
  apiPath: string // e.g., "/api/collections/servers/records"
  columns: Column[]
  fields: FieldDef[]
  nameField?: string // field used as display name (default: "name")
  autoCreate?: boolean // open Create dialog on mount (from ?create=1)
  parentNav?: { label: string; href: string } // breadcrumb back link
  enableGroupAssign?: boolean // show batch assign-to-group toolbar on list
  onCreateSuccess?: (record: Record<string, unknown>) => void
  showRefreshButton?: boolean // show a manual refresh button next to Create
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

const INPUT_CLASS =
  'w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground text-sm'

type RelOpt = { id: string; label: string; raw?: Record<string, unknown> }

const GROUPS_API_PATH = '/api/collections/groups/records?perPage=500&sort=name'

function buildOrFilter(field: string, values: string[]): string {
  return values.map(value => `${field}='${pbFilterValue(value)}'`).join('||')
}

// ─── ResourcePage ────────────────────────────────────────

export function ResourcePage({ config }: { config: ResourcePageConfig }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Record<string, unknown> | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Relation options cache: fieldKey → list of {id, label}
  const [relOpts, setRelOpts] = useState<Record<string, RelOpt[]>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const createRelFileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Inline "create relation" mini-dialog
  const [createRelOpen, setCreateRelOpen] = useState(false)
  const [createRelField, setCreateRelField] = useState<FieldDef | null>(null)
  const [createRelData, setCreateRelData] = useState<Record<string, unknown>>({})
  const [createRelSaving, setCreateRelSaving] = useState(false)
  const [createRelError, setCreateRelError] = useState('')

  // Batch group assignment
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [availableGroups, setAvailableGroups] = useState<RelOpt[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [assigningGroups, setAssigningGroups] = useState(false)
  const [groupAssignDialogOpen, setGroupAssignDialogOpen] = useState(false)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())

  const nameField = config.nameField || 'name'
  const groupField = config.fields.find(f => f.key === 'groups' && f.type === 'relation')
  const resourceObjectType = config.resourceType || ''

  const listGroupMemberships = useCallback(
    async (objectType: string, objectIds: string[]) => {
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
    },
    []
  )

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

  const fetchItems = useCallback(async () => {
    try {
      const data = config.listItems
        ? await config.listItems()
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

  // Auto-open Create dialog once data has loaded (triggered by ?create=1)
  useEffect(() => {
    if (config.autoCreate && !loading) openCreateDialog()
  }, [loading])

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
    config.fields
      .filter(f => f.type === 'relation' && f.relationApiPath)
      .forEach(f => {
        pb.send<Record<string, unknown>[] | Record<string, unknown>>(f.relationApiPath!, {})
          .then(raw => {
            // Handle both flat arrays and PocketBase paginated responses { items: [...] }
            let records: Record<string, unknown>[] = []
            if (Array.isArray(raw)) {
              records = raw
            } else if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)) {
              records = (raw as Record<string, unknown>).items as Record<string, unknown>[]
            }
            let data = records
            // Client-side filter
            if (f.relationFilter) {
              for (const [fk, fv] of Object.entries(f.relationFilter)) {
                data = data.filter(item => String(item[fk] ?? '') === fv)
              }
            }
            const opts: RelOpt[] = data.map(item => ({
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
  }, [dialogOpen, config.fields, editingItem])

  // ─── Form helpers ────────────────────

  function openCreateDialog() {
    setEditingItem(null)
    const defaults: Record<string, unknown> = {}
    for (const f of config.fields) {
      if (f.multiSelect) {
        defaults[f.key] = Array.isArray(f.defaultValue) ? f.defaultValue : []
      } else {
        defaults[f.key] =
          f.defaultValue ?? (f.type === 'boolean' ? false : f.type === 'number' ? 0 : '')
      }
    }
    setFormData(defaults)
    setFormError('')
    setDialogOpen(true)
  }

  function openEditDialog(item: Record<string, unknown>) {
    setEditingItem(item)
    const data: Record<string, unknown> = {}
    for (const f of config.fields) {
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
      const payload = { ...formData }
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
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(items.map(i => String(i.id))))
    }
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
          membership => `${String(membership['group_id'] ?? '')}:${String(membership['object_id'] ?? '')}`
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
              size="icon"
              onClick={() => {
                void handleRefresh()
              }}
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create
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

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p>No {config.title.toLowerCase()} found</p>
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
                        checked={items.length > 0 && selectedItems.size === items.length}
                        onChange={toggleSelectAll}
                      />
                    </TableHead>
                  )}
                  {config.columns.map(col => (
                    <TableHead key={col.key}>{col.label}</TableHead>
                  ))}
                  <TableHead className="w-[72px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow
                    key={String(item.id)}
                    data-selected={selectedItems.has(String(item.id))}
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" title="More actions">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {config.extraActions?.(item, () => {
                            void fetchItems()
                          })}
                          {config.extraActions && <DropdownMenuSeparator />}
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
        open={dialogOpen}
        onOpenChange={v => {
          setDialogOpen(v)
          if (!v) setCreateRelOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem
                ? `Edit ${config.title.replace(/s$/, '')}`
                : `Create ${config.title.replace(/s$/, '')}`}
            </DialogTitle>
            <DialogDescription>
              {editingItem
                ? 'Update the resource details below.'
                : 'Fill in the details to create a new resource.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {config.fields
              .filter(f => !f.hidden)
              .filter(f => {
                if (!f.showWhen) return true
                return f.showWhen.values.includes(String(formData[f.showWhen.field] ?? ''))
              })
              .map(field => {
                // Resolve effective type (dynamic override)
                const effectiveType = field.dynamicType
                  ? field.dynamicType.values.includes(
                      String(formData[field.dynamicType.field] ?? '')
                    )
                    ? field.dynamicType.as
                    : field.type
                  : field.type
                const isUploadable = effectiveType === 'file-textarea' || !!field.fileAccept
                return (
                  <div key={field.key} className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </label>

                    {effectiveType === 'select' ? (
                      <select
                        className={INPUT_CLASS}
                        value={String(formData[field.key] ?? '')}
                        onChange={e => handleChange(field, e.target.value)}
                        required={field.required}
                      >
                        <option value="">Select…</option>
                        {field.options?.map(o => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : effectiveType === 'relation' && field.multiSelect ? (
                      <div className="border border-input rounded-md p-2 max-h-44 overflow-y-auto space-y-1 bg-background">
                        {(relOpts[field.key] ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground px-1">No options available</p>
                        ) : (
                          (relOpts[field.key] ?? []).map(o => {
                            const selected = ((formData[field.key] as string[]) ?? []).includes(
                              o.id
                            )
                            return (
                              <label
                                key={o.id}
                                className="flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded hover:bg-muted transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-input"
                                  checked={selected}
                                  onChange={e => {
                                    const current = (formData[field.key] as string[]) ?? []
                                    if (e.target.checked) {
                                      updateField(field.key, [...current, o.id])
                                    } else {
                                      updateField(
                                        field.key,
                                        current.filter(id => id !== o.id)
                                      )
                                    }
                                  }}
                                />
                                <span className="text-sm">{o.label}</span>
                              </label>
                            )
                          })
                        )}
                      </div>
                    ) : effectiveType === 'relation' ? (
                      <div className="flex gap-2 items-center">
                        <select
                          className={INPUT_CLASS + ' flex-1'}
                          value={String(formData[field.key] ?? '')}
                          onChange={e => handleChange(field, e.target.value)}
                          required={field.required}
                        >
                          <option value="">None</option>
                          {(relOpts[field.key] ?? []).map(o => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {field.relationCreateButton && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title={field.relationCreateButton.label}
                            onClick={() => {
                              const fieldKey = field.key
                              field.relationCreateButton!.onClick({
                                addOption: (id: string, label: string) => {
                                  setRelOpts(prev => ({
                                    ...prev,
                                    [fieldKey]: [
                                      ...(prev[fieldKey] ?? []),
                                      { id, label },
                                    ],
                                  }))
                                  updateField(fieldKey, id)
                                },
                              })
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        )}
                        {field.relationCreate && !field.relationCreateButton && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title={`Create new: ${field.relationCreate.label}`}
                            onClick={() => openCreateRelDialog(field)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ) : effectiveType === 'textarea' || effectiveType === 'file-textarea' ? (
                      <div className="space-y-1">
                        <textarea
                          className={INPUT_CLASS + ' min-h-[120px] resize-y font-mono text-xs'}
                          value={String(formData[field.key] ?? '')}
                          onChange={e => updateField(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          required={field.required}
                          rows={5}
                        />
                        {isUploadable && (
                          <>
                            <input
                              ref={el => {
                                fileRefs.current[field.key] = el
                              }}
                              type="file"
                              accept={field.fileAccept ?? '.pem,.key,.crt,.txt'}
                              className="hidden"
                              onChange={e => handleFileUpload(field.key, e)}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => fileRefs.current[field.key]?.click()}
                            >
                              <Upload className="h-3 w-3 mr-1" />
                              Upload file
                            </Button>
                          </>
                        )}
                      </div>
                    ) : effectiveType === 'boolean' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={Boolean(formData[field.key])}
                          onChange={e => updateField(field.key, e.target.checked)}
                        />
                        <span className="text-sm text-muted-foreground">Enabled</span>
                      </label>
                    ) : (
                      <input
                        type={
                          effectiveType === 'password'
                            ? 'password'
                            : effectiveType === 'number'
                              ? 'number'
                              : 'text'
                        }
                        className={INPUT_CLASS}
                        value={String(formData[field.key] ?? '')}
                        onChange={e => handleChange(field, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                      />
                    )}
                  </div>
                )
              })}

            {formError && <p className="text-destructive text-sm">{formError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
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
                        {f.options?.map(o => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
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
