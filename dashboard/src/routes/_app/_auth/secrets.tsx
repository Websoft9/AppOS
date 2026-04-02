import { Fragment, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Filter,
  MoreVertical,
  RefreshCw,
  Search,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { SecretForm, type SecretTemplate } from '@/components/secrets/SecretForm'
import { RevealOverlay } from '@/components/secrets/RevealOverlay'
import { getLocale } from '@/lib/i18n'
import { settingsEntryPath } from '@/lib/settings-api'
import {
  canRevealSecret,
  DEFAULT_SECRET_ACCESS_MODE,
  DEFAULT_SECRET_POLICY,
  normalizeSecretPolicy,
  SECRET_ACCESS_MODE_OPTIONS,
  type SecretPolicy,
} from '@/lib/secrets-policy'

interface SecretRecord {
  id: string
  name: string
  description?: string
  type?: string
  template_id: string
  created_source?: string
  scope: string
  access_mode: string
  status: string
  expires_at?: string
  last_used_at?: string
  last_used_by?: string
  created?: string
}

type ConfirmAction =
  | { type: 'revoke'; id: string; name: string }
  | { type: 'delete'; id: string; name: string }
  | null

type SortField = 'name' | 'last_used_at' | 'last_used_by' | 'created' | 'expires_at'
type SortDir = 'asc' | 'desc'

// Schema-level enums for Create/Edit forms. These must list ALL possible values
// (not just what exists in data) so users can select any valid option.
const SCOPE_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'user_private', label: 'User Private' },
]

const ACCESS_MODE_OPTIONS = [...SECRET_ACCESS_MODE_OPTIONS]

const PAGE_SIZE = 20

/** Format ISO date to short locale string, return '—' for empty/invalid. */
function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const bcp47 = getLocale() === 'zh' ? 'zh-CN' : 'en-US'
  return d.toLocaleString(bcp47, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Reusable components ─────────────────────────────────

function OptionGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? 'default' : 'outline'}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function SortableHeader({
  label,
  field,
  current,
  dir,
  onSort,
  withDisclosureHint,
}: {
  label: string
  field: SortField
  current: SortField | null
  dir: SortDir
  onSort: (f: SortField) => void
  withDisclosureHint?: boolean
}) {
  const active = current === field
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {withDisclosureHint ? <ChevronRight className="h-3.5 w-3.5 opacity-60" /> : null}
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUp className="h-3.5 w-3.5 opacity-40" />
      )}
    </button>
  )
}

type ExpiryStatus = 'expired' | 'expiring-soon' | 'ok' | 'none'

function getExpiryStatus(
  expiresAt: string | undefined,
  warnBeforeExpiryDays: number,
): ExpiryStatus {
  if (!expiresAt) return 'none'
  const exp = new Date(expiresAt)
  if (isNaN(exp.getTime())) return 'none'
  const now = new Date()
  if (now > exp) return 'expired'
  if (
    warnBeforeExpiryDays > 0 &&
    now.getTime() + warnBeforeExpiryDays * 86_400_000 > exp.getTime()
  )
    return 'expiring-soon'
  return 'ok'
}

function humanize(value: string): string {
  return value
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function FilterHeader({
  label,
  options,
  excluded,
  onChange,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  excluded: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const active = excluded.size > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1 hover:text-foreground">
          {label}
          <Filter className={cn('h-3.5 w-3.5', active ? 'text-primary' : 'opacity-40')} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px] p-2 space-y-1">
        {options.map(opt => (
          <label
            key={opt.value}
            className="flex items-center gap-2 px-1 py-0.5 text-sm cursor-pointer"
          >
            <Checkbox
              checked={!excluded.has(opt.value)}
              onCheckedChange={checked => {
                const next = new Set(excluded)
                if (checked) next.delete(opt.value)
                else next.add(opt.value)
                onChange(next)
              }}
            />
            {opt.label}
          </label>
        ))}
        {active && (
          <button
            type="button"
            className="mt-1 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(new Set())}
          >
            Reset
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Main page ───────────────────────────────────────────

export function SecretsPage() {
  const { id: idFilter, returnGroup, returnType } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [allItems, setAllItems] = useState<SecretRecord[]>([])
  const [templates, setTemplates] = useState<SecretTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealPayload, setRevealPayload] = useState<Record<string, unknown> | null>(null)
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const [revealFieldLabels, setRevealFieldLabels] = useState<Record<string, string> | undefined>(
    undefined
  )
  const [secretPolicy, setSecretPolicy] = useState<SecretPolicy>(DEFAULT_SECRET_POLICY)

  // Search, sort, filter, pagination
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [excludeType, setExcludeType] = useState<Set<string>>(new Set())
  const [excludeScope, setExcludeScope] = useState<Set<string>>(new Set())
  const [excludeAccessMode, setExcludeAccessMode] = useState<Set<string>>(new Set())
  const [excludeStatus, setExcludeStatus] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Create form
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createScope, setCreateScope] = useState('global')
  const [createAccessMode, setCreateAccessMode] = useState(DEFAULT_SECRET_ACCESS_MODE)
  const [createTemplateId, setCreateTemplateId] = useState('')
  const [createPayload, setCreatePayload] = useState<Record<string, string>>({})
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createAdvancedOpen, setCreateAdvancedOpen] = useState(false)

  // Edit form
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState('')
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editScope, setEditScope] = useState('global')
  const [editAccessMode, setEditAccessMode] = useState(DEFAULT_SECRET_ACCESS_MODE)
  const [editTemplateId, setEditTemplateId] = useState('')
  const [editPayload, setEditPayload] = useState<Record<string, string>>({})
  const [editSavingMeta, setEditSavingMeta] = useState(false)
  const [editSavingPayload, setEditSavingPayload] = useState(false)
  const [editError, setEditError] = useState('')
  const [editNotice, setEditNotice] = useState('')

  const templateLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const template of templates) {
      map.set(template.id, template.label)
    }
    return map
  }, [templates])

  const filterOptions = useMemo(() => {
    const types = new Map<string, string>()
    const scopes = new Set<string>()
    const accessModes = new Set<string>()
    const statuses = new Set<string>()
    for (const item of allItems) {
      if (item.template_id)
        types.set(
          item.template_id,
          templateLabelMap.get(item.template_id) ?? humanize(item.template_id)
        )
      if (item.scope) scopes.add(item.scope)
      if (item.access_mode) accessModes.add(item.access_mode)
      if (item.status) statuses.add(item.status)
    }
    return {
      type: [...types.entries()].map(([value, label]) => ({ value, label })),
      scope: [...scopes].map(v => ({ value: v, label: humanize(v) })),
      accessMode: [...accessModes].map(v => ({ value: v, label: humanize(v) })),
      status: [...statuses].map(v => ({ value: v, label: humanize(v) })),
    }
  }, [allItems, templateLabelMap])

  const filteredItems = useMemo(() => {
    // Exclude system-managed secrets (e.g. tunnel tokens) from the user-facing list.
    let result = allItems.filter(item => item.type !== 'tunnel_token')

    // ID filter from URL param
    if (idFilter) {
      result = result.filter(item => item.id === idFilter)
    }

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        item =>
          item.id.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.last_used_by?.toLowerCase().includes(q)
      )
    }

    // Exclude filters
    if (excludeType.size > 0) result = result.filter(i => !excludeType.has(i.template_id))
    if (excludeScope.size > 0) result = result.filter(i => !excludeScope.has(i.scope))
    if (excludeAccessMode.size > 0)
      result = result.filter(i => !excludeAccessMode.has(i.access_mode))
    if (excludeStatus.size > 0) result = result.filter(i => !excludeStatus.has(i.status))

    // Sort
    if (sortField) {
      result = [...result].sort((a, b) => {
        const nullFallback = sortField === 'expires_at' ? '\uFFFF' : ''
        const av = (a[sortField] ?? nullFallback) as string
        const bv = (b[sortField] ?? nullFallback) as string
        const cmp = av.localeCompare(bv)
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return result
  }, [
    allItems,
    idFilter,
    search,
    excludeType,
    excludeScope,
    excludeAccessMode,
    excludeStatus,
    sortField,
    sortDir,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, page])

  function normalizeTemplates(input: unknown): SecretTemplate[] {
    if (!Array.isArray(input)) return []
    return input
      .filter(
        item =>
          item &&
          typeof item === 'object' &&
          typeof (item as { id?: unknown }).id === 'string' &&
          typeof (item as { label?: unknown }).label === 'string'
      )
      .map(item => {
        const record = item as {
          id: string
          label: string
          fields?: Array<{
            key: string
            label: string
            type: string
            required?: boolean
            upload?: boolean
          }>
        }
        return {
          id: record.id,
          label: record.label,
          fields: Array.isArray(record.fields) ? record.fields : [],
        }
      })
  }

  async function fetchTemplates() {
    const data = await pb.send<unknown>('/api/secrets/templates', { method: 'GET' })
    const next = normalizeTemplates(data)
    setTemplates(next)
    return next
  }

  async function loadData() {
    setLoading(true)
    setError('')

    try {
      const result = await pb.collection('secrets').getFullList<SecretRecord>({
        sort: '-created',
        filter: `(created_source = '' || created_source = 'user') && type != 'tunnel_token'`,
      })
      setAllItems(result)
    } catch (err) {
      setAllItems([])
      setError(err instanceof Error ? err.message : 'Failed to load secrets')
    } finally {
      setLoading(false)
    }
  }

  // Load templates once on mount — they are static server config and never need
  // to reload when the user clicks Refresh (which only refreshes records).
  useEffect(() => {
    void fetchTemplates().catch(err =>
      setError(err instanceof Error ? err.message : 'Failed to load secret types')
    )
  }, [])

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    void pb
      .send<{ value?: unknown }>(settingsEntryPath('secrets-policy'), { method: 'GET' })
      .then(result => {
        setSecretPolicy(normalizeSecretPolicy(result.value))
      })
      .catch(() => {
        setSecretPolicy(DEFAULT_SECRET_POLICY)
      })
  }, [])

  // Auto-open create dialog when arriving from Group Add Items flow
  useEffect(() => {
    if (returnGroup && !loading) openCreate()
  }, [returnGroup, loading])

  // Reset to page 1 when filters/search/sort change
  useEffect(() => {
    setPage(1)
  }, [search, sortField, sortDir, excludeType, excludeScope, excludeAccessMode, excludeStatus])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── Create form ─────────────────────────────────────

  function resetCreateForm() {
    setCreateName('')
    setCreateDescription('')
    setCreateScope('global')
    setCreateAccessMode(secretPolicy.defaultAccessMode)
    setCreateTemplateId('')
    setCreatePayload({})
    setCreateError('')
    setCreateAdvancedOpen(false)
  }

  async function openCreate() {
    resetCreateForm()
    setCreateOpen(true)
    try {
      await fetchTemplates()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to load secret types')
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault()
    setCreateSaving(true)
    setCreateError('')
    try {
      const created = (await pb.collection('secrets').create({
        name: createName,
        description: createDescription,
        template_id: createTemplateId,
        scope: createScope,
        access_mode: createAccessMode,
        payload: createPayload,
      })) as { id: string }
      setCreateOpen(false)
      resetCreateForm()
      if (returnGroup) {
        navigate({
          to: '/groups/$id',
          params: { id: returnGroup },
          search: { addOpen: returnType ?? 'secret', newItem: created.id },
        })
      } else {
        await loadData()
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreateSaving(false)
    }
  }

  // ─── Edit form ───────────────────────────────────────

  function resetEditForm() {
    setEditId('')
    setEditName('')
    setEditDescription('')
    setEditScope('global')
    setEditAccessMode(DEFAULT_SECRET_ACCESS_MODE)
    setEditTemplateId('')
    setEditPayload({})
    setEditError('')
    setEditNotice('')
  }

  async function openEdit(item: SecretRecord) {
    setEditId(item.id)
    setEditName(item.name)
    setEditDescription(item.description || '')
    setEditScope(item.scope || 'global')
    setEditAccessMode(item.access_mode || DEFAULT_SECRET_ACCESS_MODE)
    setEditTemplateId(item.template_id)
    setEditPayload({})
    setEditError('')
    setEditNotice('')
    setEditOpen(true)
    try {
      await fetchTemplates()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to load secret types')
    }
  }

  async function handleEditMetadataSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setEditSavingMeta(true)
    setEditError('')
    setEditNotice('')
    try {
      await pb.collection('secrets').update(editId, {
        name: editName,
        description: editDescription,
        scope: editScope,
        access_mode: editAccessMode,
      })
      setEditNotice('Metadata updated')
      await loadData()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Metadata update failed')
    } finally {
      setEditSavingMeta(false)
    }
  }

  const editPayloadHasValues = useMemo(() => {
    return Object.values(editPayload).some(v => v.trim() !== '')
  }, [editPayload])

  async function handleEditPayloadSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId || !editPayloadHasValues) return
    setEditSavingPayload(true)
    setEditError('')
    setEditNotice('')
    try {
      await pb.send(`/api/secrets/${editId}/payload`, {
        method: 'PUT',
        body: { payload: editPayload },
      })
      setEditPayload({})
      setEditNotice('Payload updated')
      await loadData()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Payload update failed')
    } finally {
      setEditSavingPayload(false)
    }
  }

  // ─── Actions ─────────────────────────────────────────

  async function handleConfirm() {
    if (!confirmAction) return
    const target = confirmAction
    setConfirmAction(null)
    setError('')
    try {
      if (target.type === 'revoke') {
        await pb.collection('secrets').update(target.id, { status: 'revoked' })
      } else {
        await pb.collection('secrets').delete(target.id)
      }
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    }
  }

  async function handleReveal(item: SecretRecord) {
    setRevealingId(item.id)
    try {
      const data = await pb.send<{ payload: Record<string, unknown> }>(
        `/api/secrets/${item.id}/reveal`,
        {
          method: 'GET',
        }
      )
      const tpl = templates.find(t => t.id === item.template_id)
      setRevealFieldLabels(
        tpl ? Object.fromEntries(tpl.fields.map(f => [f.key, f.label])) : undefined
      )
      setRevealPayload(data.payload)
      setRevealOpen(true)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reveal failed')
    } finally {
      setRevealingId(null)
    }
  }

  // ─── Render ──────────────────────────────────────────

  return (
    <div className="space-y-4 p-4 cursor-default">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Secrets</h1>
          <p className="text-muted-foreground mt-1">
            The single source of truth for all your platform credentials.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void loadData()}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button onClick={() => void openCreate()}>Create Secret</Button>
        </div>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search secrets..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {idFilter && (
          <div className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 text-sm">
            <span className="text-muted-foreground">ID:</span>
            <span className="font-mono text-xs">{idFilter}</span>
            <button
              type="button"
              className="ml-1 text-muted-foreground hover:text-foreground"
              onClick={() =>
                void navigate({
                  to: '.',
                  search: prev => ({ ...prev, id: undefined }),
                })
              }
              aria-label="Clear ID filter"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? null : pagedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">No secrets found.</p>
          {allItems.length > 0 ? (
            <button
              type="button"
              className="mt-2 text-sm text-primary hover:underline"
              onClick={() => {
                setSearch('')
                setExcludeType(new Set())
                setExcludeScope(new Set())
                setExcludeAccessMode(new Set())
                setExcludeStatus(new Set())
                if (idFilter) {
                  void navigate({
                    to: '.',
                    search: prev => ({ ...prev, id: undefined }),
                  })
                }
              }}
            >
              Clear all filters
            </button>
          ) : (
            <button
              type="button"
              className="mt-2 text-sm text-primary hover:underline"
              onClick={() => void openCreate()}
            >
              Create your first one
            </button>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableHeader
                  label="Name"
                  field="name"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                  withDisclosureHint
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label="Type"
                  options={filterOptions.type}
                  excluded={excludeType}
                  onChange={setExcludeType}
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label="Scope"
                  options={filterOptions.scope}
                  excluded={excludeScope}
                  onChange={setExcludeScope}
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label="Access Mode"
                  options={filterOptions.accessMode}
                  excluded={excludeAccessMode}
                  onChange={setExcludeAccessMode}
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label="Status"
                  options={filterOptions.status}
                  excluded={excludeStatus}
                  onChange={setExcludeStatus}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label="Created"
                  field="created"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label="Last Used At"
                  field="last_used_at"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label="Last Used By"
                  field="last_used_by"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label="Expires At"
                  field="expires_at"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedItems.map(item => (
              <Fragment key={item.id}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-left font-medium hover:text-foreground"
                      onClick={() => toggleExpanded(item.id)}
                    >
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 text-muted-foreground transition-transform',
                          expandedIds.has(item.id) && 'rotate-90'
                        )}
                      />
                      <span>{item.name}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    {templateLabelMap.get(item.template_id) ?? item.template_id}
                  </TableCell>
                  <TableCell>{item.scope || 'global'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.access_mode || DEFAULT_SECRET_ACCESS_MODE}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'revoked' ? 'secondary' : 'default'}>
                      {item.status || 'active'}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(item.created)}</TableCell>
                  <TableCell>{formatDate(item.last_used_at)}</TableCell>
                  <TableCell>{item.last_used_by || '—'}</TableCell>
                  <TableCell>
                    {(() => {
                      const status = getExpiryStatus(
                        item.expires_at,
                        secretPolicy.warnBeforeExpiryDays,
                      )
                      if (status === 'none') return '—'
                      const label = formatDate(item.expires_at)
                      if (status === 'expired')
                        return (
                          <span className="flex items-center gap-1.5">
                            <span className="text-destructive">{label}</span>
                            <Badge variant="destructive">Expired</Badge>
                          </span>
                        )
                      if (status === 'expiring-soon')
                        return (
                          <span className="flex items-center gap-1.5">
                            <span className="text-orange-500">{label}</span>
                            <Badge
                              variant="outline"
                              className="border-orange-400 text-orange-500"
                            >
                              Expiring Soon
                            </Badge>
                          </span>
                        )
                      return <span className="text-muted-foreground">{label}</span>
                    })()} 
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void openEdit(item)}>
                          Edit
                        </DropdownMenuItem>
                        {canRevealSecret(item.access_mode, secretPolicy) && (
                          <DropdownMenuItem
                            disabled={revealingId === item.id}
                            onClick={() => void handleReveal(item)}
                          >
                            {revealingId === item.id ? 'Revealing...' : 'Reveal'}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {item.status === 'revoked' ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() =>
                              setConfirmAction({ type: 'delete', id: item.id, name: item.name })
                            }
                          >
                            Delete
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() =>
                              setConfirmAction({ type: 'revoke', id: item.id, name: item.name })
                            }
                          >
                            Revoke
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>

                {expandedIds.has(item.id) && (
                  <TableRow>
                    <TableCell colSpan={10} className="bg-muted/30 py-3">
                      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <span className="text-muted-foreground">ID:</span>{' '}
                          <span className="font-mono text-xs">{item.id}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Name:</span>{' '}
                          <span>{item.name}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Type:</span>{' '}
                          <span>{templateLabelMap.get(item.template_id) ?? item.template_id}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Scope:</span>{' '}
                          <span>{item.scope || 'global'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Access Mode:</span>{' '}
                          <span>{item.access_mode || DEFAULT_SECRET_ACCESS_MODE}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Status:</span>{' '}
                          <span>{item.status || 'active'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Created:</span>{' '}
                          <span>{formatDate(item.created)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Last Used At:</span>{' '}
                          <span>{formatDate(item.last_used_at)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Last Used By:</span>{' '}
                          <span>{item.last_used_by || '—'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Expires At:</span>{' '}
                          <span>{formatDate(item.expires_at)}</span>
                        </div>
                        {item.description && (
                          <div className="sm:col-span-2 lg:col-span-3">
                            <span className="text-muted-foreground">Description:</span>{' '}
                            <span>{item.description}</span>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {filteredItems.length} total · Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ─── Edit Dialog ─── */}
      <Dialog
        open={editOpen}
        onOpenChange={open => {
          setEditOpen(open)
          if (!open) resetEditForm()
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Secret</DialogTitle>
            <DialogDescription>Update metadata or replace encrypted values.</DialogDescription>
          </DialogHeader>

          {editError && <div className="text-sm text-destructive">{editError}</div>}
          {editNotice && <div className="text-sm text-primary">{editNotice}</div>}

          {/* ── Metadata section ── */}
          <form className="space-y-4" onSubmit={e => void handleEditMetadataSubmit(e)}>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <OptionGroup
              label="Scope"
              value={editScope}
              options={SCOPE_OPTIONS}
              onChange={setEditScope}
            />
            <OptionGroup
              label="Access Mode"
              value={editAccessMode}
              options={ACCESS_MODE_OPTIONS}
              onChange={setEditAccessMode}
            />
            <Button type="submit" disabled={editSavingMeta || !editId}>
              {editSavingMeta ? 'Saving...' : 'Save Metadata'}
            </Button>
          </form>

          <Separator />

          {/* ── Payload section ── */}
          <form className="space-y-4" onSubmit={e => void handleEditPayloadSubmit(e)}>
            <div>
              <h4 className="text-sm font-medium">Update Secret Values</h4>
              <p className="text-xs text-muted-foreground">
                Fill in fields to replace current encrypted values.
              </p>
            </div>
            <SecretForm
              templates={templates}
              templateId={editTemplateId}
              payload={editPayload}
              disableTemplateChange
              onTemplateChange={() => {}}
              onPayloadChange={(key, value) => setEditPayload(prev => ({ ...prev, [key]: value }))}
            />
            <Button type="submit" disabled={editSavingPayload || !editId || !editPayloadHasValues}>
              {editSavingPayload ? 'Updating...' : 'Update Values'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Create Dialog ─── */}
      <Dialog
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Secret</DialogTitle>
            <DialogDescription>
              Create a credential secret with encrypted payload.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={e => void handleCreateSubmit(e)}>
            {createError && <div className="text-sm text-destructive">{createError}</div>}

            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={createName} onChange={e => setCreateName(e.target.value)} required />
            </div>

            <SecretForm
              templates={templates}
              templateId={createTemplateId}
              payload={createPayload}
              onTemplateChange={next => {
                setCreateTemplateId(next)
                setCreatePayload({})
              }}
              onPayloadChange={(key, value) =>
                setCreatePayload(prev => ({ ...prev, [key]: value }))
              }
            />

            <Collapsible open={createAdvancedOpen} onOpenChange={setCreateAdvancedOpen}>
              <CollapsibleTrigger
                type="button"
                className="flex w-full items-center justify-start gap-2 py-1 text-left text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', createAdvancedOpen && 'rotate-180')}
                />
                <span>Advanced</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={createDescription}
                    onChange={e => setCreateDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
                <OptionGroup
                  label="Scope"
                  value={createScope}
                  options={SCOPE_OPTIONS}
                  onChange={setCreateScope}
                />
                <OptionGroup
                  label="Access Mode"
                  value={createAccessMode}
                  options={ACCESS_MODE_OPTIONS}
                  onChange={setCreateAccessMode}
                />
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createSaving || !createTemplateId}>
                {createSaving ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Confirm Dialog ─── */}
      <AlertDialog open={!!confirmAction} onOpenChange={open => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'revoke' ? 'Revoke Secret' : 'Delete Secret'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'revoke'
                ? `Revoke ${confirmAction.name}? This will block future resolves.`
                : `Delete ${confirmAction?.name}? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirm()}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Reveal Overlay ─── */}
      <RevealOverlay
        open={revealOpen}
        payload={revealPayload}
        fieldLabels={revealFieldLabels}
        clearAfterSeconds={secretPolicy.clipboardClearSeconds}
        onClose={() => {
          setRevealOpen(false)
          setRevealPayload(null)
          setRevealFieldLabels(undefined)
        }}
      />
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/secrets')({
  component: SecretsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : undefined,
    returnGroup: typeof search.returnGroup === 'string' ? search.returnGroup : undefined,
    returnType: typeof search.returnType === 'string' ? search.returnType : undefined,
  }),
})
