import { type FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { getLocale } from '@/lib/i18n'

// ─── Types ───────────────────────────────────────────────

interface EnvSet {
  id: string
  name: string
  description?: string
  created?: string
}

interface EnvSetVar {
  id: string
  set: string
  key: string
  value: string
  is_secret: boolean
  secret: string
}

interface Secret {
  id: string
  name: string
}

interface FormVar {
  id?: string
  key: string
  value: string
  is_secret: boolean
  secret: string
  secretValue: string
  secretMode: 'select' | 'create'
}

type SortField = 'name' | 'created'
type SortDir = 'asc' | 'desc'

// ─── Helpers ─────────────────────────────────────────────

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const bcp47 = getLocale() === 'zh' ? 'zh-CN' : 'en-US'
  return d.toLocaleDateString(bcp47, { year: 'numeric', month: 'short', day: 'numeric' })
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

// ─── Detail Row ──────────────────────────────────────────

function DetailRow({ vars, colSpan }: { vars: EnvSetVar[]; colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="bg-muted/30 py-3 px-6">
        {vars.length === 0 ? (
          <p className="text-sm text-muted-foreground">No variables in this set.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[180px_1fr_80px] gap-x-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>Key</span>
              <span>Value</span>
              <span>Type</span>
            </div>
            {vars.map(v => (
              <div
                key={v.id}
                className="grid grid-cols-[180px_1fr_80px] gap-x-4 text-sm items-center"
              >
                <span className="font-mono truncate">{v.key}</span>
                <span className="truncate">{v.is_secret ? '•••••' : v.value || '—'}</span>
                <span>
                  {v.is_secret ? (
                    <Badge variant="secondary" className="text-xs">
                      Secret
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      Plain
                    </Badge>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

// ─── Page ────────────────────────────────────────────────

function SharedEnvsPage() {
  const [allItems, setAllItems] = useState<EnvSet[]>([])
  const [allVars, setAllVars] = useState<EnvSetVar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Search & sort
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Expansion
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [formVars, setFormVars] = useState<FormVar[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  // ─── Derived ──────────────────────────────────────────

  const varsBySet = useMemo(() => {
    const map: Record<string, EnvSetVar[]> = {}
    for (const v of allVars) (map[v.set] ||= []).push(v)
    return map
  }, [allVars])

  const filteredItems = useMemo(() => {
    let result = allItems
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        item =>
          item.name.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          (varsBySet[item.id] ?? []).some(v => v.key.toLowerCase().includes(q))
      )
    }
    if (sortField) {
      result = [...result].sort((a, b) => {
        const av = (a[sortField] ?? '') as string
        const bv = (b[sortField] ?? '') as string
        const cmp = av.localeCompare(bv)
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [allItems, search, sortField, sortDir, varsBySet])

  // ─── Data loading ─────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [items, vars] = await Promise.all([
        pb.collection('env_sets').getFullList({ sort: 'name' }),
        pb.collection('env_set_vars').getFullList({ sort: 'key' }),
      ])
      setAllItems(items as unknown as EnvSet[])
      setAllVars(vars as unknown as EnvSetVar[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!dialogOpen) return
    pb.collection('secrets')
      .getFullList({ fields: 'id,name', sort: 'name' })
      .then(data => setSecrets(data as unknown as Secret[]))
      .catch(() => setSecrets([]))
  }, [dialogOpen])

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // ─── Create / Edit ────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setName('')
    setDescription('')
    setFormVars([])
    setFormError('')
    setDialogOpen(true)
  }

  async function openEdit(item: EnvSet) {
    setFormError('')
    try {
      const vars = await pb.collection('env_set_vars').getFullList({
        filter: `set='${item.id}'`,
        sort: 'key',
      })
      setEditingId(item.id)
      setName(item.name)
      setDescription(item.description ?? '')
      setFormVars(
        (vars as unknown as EnvSetVar[]).map(v => ({
          id: v.id,
          key: v.key,
          value: v.value ?? '',
          is_secret: v.is_secret ?? false,
          secret: v.secret ?? '',
          secretValue: '',
          secretMode: (v.secret ? 'select' : 'create') as 'select' | 'create',
        }))
      )
      setDialogOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load env set')
    }
  }

  function addVar() {
    setFormVars(prev => [
      ...prev,
      { key: '', value: '', is_secret: false, secret: '', secretValue: '', secretMode: 'create' },
    ])
  }

  function updateVar(index: number, patch: Partial<FormVar>) {
    setFormVars(prev => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)))
  }

  function removeVar(index: number) {
    setFormVars(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Validate: secret vars must have either a selected secret or a typed value
    const invalid = formVars.find(v => v.is_secret && !v.secret && !v.secretValue.trim())
    if (invalid) {
      setFormError(`Variable "${invalid.key || '(unnamed)'}": secret value is required.`)
      return
    }

    setSaving(true)
    setFormError('')
    try {
      // Auto-create secrets for vars with typed values
      const resolved = [...formVars]
      for (let i = 0; i < resolved.length; i++) {
        const v = resolved[i]
        if (v.is_secret && v.secretMode === 'create' && v.secretValue.trim()) {
          const secretName = `Env_${name}_${v.key}`
          const created = await pb.collection('secrets').create({
            name: secretName,
            template_id: 'single_value',
            scope: 'global',
            payload: { value: v.secretValue },
          })
          resolved[i] = { ...v, secret: (created as { id: string }).id }
        }
      }

      let setId: string

      if (editingId) {
        await pb.collection('env_sets').update(editingId, { name, description })
        setId = editingId

        const existingVars = await pb.collection('env_set_vars').getFullList({
          filter: `set='${editingId}'`,
        })
        const existingIds = new Set(existingVars.map(v => v.id))
        const currentIds = new Set(resolved.filter(v => v.id).map(v => v.id!))

        for (const ev of existingVars) {
          if (!currentIds.has(ev.id)) {
            await pb.collection('env_set_vars').delete(ev.id)
          }
        }

        for (const v of resolved) {
          const payload = {
            set: setId,
            key: v.key,
            value: v.is_secret ? '' : v.value,
            is_secret: v.is_secret,
            secret: v.is_secret ? v.secret : '',
          }
          if (v.id && existingIds.has(v.id)) {
            await pb.collection('env_set_vars').update(v.id, payload)
          } else {
            await pb.collection('env_set_vars').create(payload)
          }
        }
      } else {
        const created = await pb.collection('env_sets').create({ name, description })
        setId = created.id

        for (const v of resolved) {
          await pb.collection('env_set_vars').create({
            set: setId,
            key: v.key,
            value: v.is_secret ? '' : v.value,
            is_secret: v.is_secret,
            secret: v.is_secret ? v.secret : '',
          })
        }
      }

      setDialogOpen(false)
      await fetchAll()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ─── Delete ───────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await pb.collection('env_sets').delete(deleteTarget.id)
      setDeleteTarget(null)
      await fetchAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setDeleteTarget(null)
    }
  }

  // ─── Render ───────────────────────────────────────────

  const colSpan = 5

  return (
    <div className="space-y-4 p-4 cursor-default">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Link
            to="/resources"
            search={{} as never}
            className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            &lt; Resources
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Shared Envs</h1>
          <p className="text-muted-foreground mt-1">
            Reusable environment variable sets for apps and workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" title="Refresh" onClick={() => void fetchAll()}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button onClick={openCreate}>New Env Set</Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sets or variables..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? null : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">No shared envs found.</p>
          {allItems.length > 0 ? (
            <button
              type="button"
              className="mt-2 text-sm text-primary hover:underline"
              onClick={() => setSearch('')}
            >
              Clear filters
            </button>
          ) : (
            <button
              type="button"
              className="mt-2 text-sm text-primary hover:underline"
              onClick={openCreate}
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
              <TableHead>Description</TableHead>
              <TableHead>Variables</TableHead>
              <TableHead>
                <SortableHeader
                  label="Created"
                  field="created"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map(item => {
              const isExpanded = expandedId === item.id
              const vars = varsBySet[item.id] ?? []
              return (
                <Fragment key={item.id}>
                  <TableRow className="group">
                    <TableCell
                      className="font-medium cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.description || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {vars.length} var{vars.length !== 1 ? 's' : ''}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(item.created)}</TableCell>
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
                            <Pencil className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {vars.length > 0 ? (
                            <DropdownMenuItem disabled className="text-xs">
                              Remove {vars.length} variable{vars.length !== 1 ? 's' : ''} first
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget({ id: item.id, name: item.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {isExpanded && <DetailRow vars={vars} colSpan={colSpan} />}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Env Set' : 'New Env Set'}</DialogTitle>
            <DialogDescription>
              Define a named set of environment variables that can be shared across apps.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="staging-env"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            {/* Variables editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Variables</Label>
                <Button type="button" variant="outline" size="sm" onClick={addVar}>
                  <Plus className="h-3 w-3 mr-1" /> Add variable
                </Button>
              </div>

              {formVars.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">
                  No variables yet. Click &ldquo;Add variable&rdquo; to start.
                </p>
              )}

              <div className="space-y-2">
                {formVars.map((v, i) => (
                  <div
                    key={i}
                    className="space-y-1.5 p-2 rounded-md border border-border bg-muted/30"
                  >
                    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_auto] gap-2 items-center">
                      {/* Key */}
                      <Input
                        className="font-mono"
                        value={v.key}
                        onChange={e => updateVar(i, { key: e.target.value })}
                        placeholder="KEY_NAME"
                      />

                      {/* Value or Secret */}
                      {v.is_secret ? (
                        v.secretMode === 'select' ? (
                          <div className="flex gap-1 items-center">
                            <select
                              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={v.secret}
                              onChange={e => updateVar(i, { secret: e.target.value })}
                            >
                              <option value="">Select secret…</option>
                              {secrets.map(s => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline whitespace-nowrap"
                              onClick={() => updateVar(i, { secretMode: 'create', secret: '' })}
                            >
                              or type
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1 items-center">
                            <Input
                              type="password"
                              value={v.secretValue}
                              onChange={e => updateVar(i, { secretValue: e.target.value })}
                              placeholder="Secret value (auto-creates)"
                            />
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline whitespace-nowrap"
                              onClick={() =>
                                updateVar(i, { secretMode: 'select', secretValue: '' })
                              }
                            >
                              or select
                            </button>
                          </div>
                        )
                      ) : (
                        <Input
                          value={v.value}
                          onChange={e => updateVar(i, { value: e.target.value })}
                          placeholder="value"
                        />
                      )}

                      {/* Secret toggle */}
                      <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={v.is_secret}
                          onChange={e =>
                            updateVar(i, {
                              is_secret: e.target.checked,
                              value: '',
                              secret: '',
                              secretValue: '',
                              secretMode: 'create',
                            })
                          }
                        />
                        Secret
                      </label>

                      {/* Remove */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeVar(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {formError && <p className="text-destructive text-sm">{formError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Env Set</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/shared-envs')({
  component: SharedEnvsPage,
})
