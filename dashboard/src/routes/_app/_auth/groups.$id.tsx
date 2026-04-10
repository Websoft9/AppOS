import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronDown, Loader2, Plus, X, Pencil, Search } from 'lucide-react'
import { pb } from '@/lib/pb'
import { OBJECT_TYPES, OBJECT_TYPE_MAP, getObjectTypeLabel } from '@/lib/object-types'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  type GroupRecord,
  type GroupItemRecord,
  type PBList,
  formatDate,
  pbFilterValue,
  buildDetailLink,
} from '@/lib/groups'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Link } from '@tanstack/react-router'

// ─── Types ───────────────────────────────────────────────

interface ResolvedItem extends GroupItemRecord {
  resolvedName: string
  resolvedSummary: string
  resolvedUpdated: string
}

// ─── Page Component ──────────────────────────────────────

function GroupDetailPage() {
  const { id } = Route.useParams()
  const { addOpen: addOpenParam, newItem: newItemParam } = Route.useSearch()
  const navigate = useNavigate()

  const [group, setGroup] = useState<GroupRecord | null>(null)
  const [items, setItems] = useState<GroupItemRecord[]>([])
  const [resolvedObjects, setResolvedObjects] = useState<Map<string, Record<string, unknown>>>(
    new Map()
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filter
  const [typeFilter, setTypeFilter] = useState('all')

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Add items dialog
  const [addOpen, setAddOpen] = useState(false)
  const [addType, setAddType] = useState(OBJECT_TYPES[0].type)
  const [addSearch, setAddSearch] = useState('')
  const [candidates, setCandidates] = useState<Record<string, unknown>[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set())
  const [addSaving, setAddSaving] = useState(false)
  const [addDropdownOpen, setAddDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ─── Auto-open Add Items dialog from URL params (return from create flow) ──

  useEffect(() => {
    if (loading || !addOpenParam) return
    const typeDef = OBJECT_TYPE_MAP[addOpenParam]
    if (!typeDef) return
    setAddType(addOpenParam)
    setAddSelected(newItemParam ? new Set([newItemParam]) : new Set())
    setAddSearch('')
    setAddOpen(true)
    loadCandidates(addOpenParam)
    // Clear params so this doesn't re-trigger
    void navigate({
      to: '/groups/$id',
      params: { id },
      search: { addOpen: undefined, newItem: undefined },
      replace: true,
    })
  }, [loading, addOpenParam])

  // ─── Data fetch ─────────────────────────────────────────

  const fetchGroup = useCallback(async () => {
    try {
      const [grp, itemsRes] = await Promise.all([
        pb.send<GroupRecord>(`/api/collections/groups/records/${id}`, {}),
        pb.send<PBList<GroupItemRecord>>(
          `/api/collections/group_items/records?perPage=500&filter=(group_id='${pbFilterValue(id)}')`,
          {}
        ),
      ])
      setGroup(grp)
      const itemsList = itemsRes.items ?? []
      setItems(itemsList)
      setError('')

      // Resolve object details
      await resolveItems(itemsList)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load group'))
    } finally {
      setLoading(false)
    }
  }, [id])

  async function resolveItems(itemsList: GroupItemRecord[]) {
    // Group items by type to batch-resolve
    const byType = new Map<string, string[]>()
    for (const m of itemsList) {
      const list = byType.get(m.object_type) ?? []
      list.push(m.object_id)
      byType.set(m.object_type, list)
    }

    const resolved = new Map<string, Record<string, unknown>>()

    await Promise.all(
      Array.from(byType.entries()).map(async ([type, ids]) => {
        const def = OBJECT_TYPE_MAP[type]
        if (!def) return
        try {
          const idFilter = ids.map(oid => `id='${pbFilterValue(oid)}'`).join('||')
          const res = await pb.send<PBList<Record<string, unknown>>>(
            `/api/collections/${def.collection}/records?perPage=500&filter=(${idFilter})`,
            {}
          )
          for (const rec of res.items ?? []) {
            resolved.set(`${type}:${rec.id}`, rec)
          }
        } catch {
          // If collection doesn't exist or fails, just skip resolution
        }
      })
    )

    setResolvedObjects(resolved)
  }

  useEffect(() => {
    fetchGroup()
  }, [fetchGroup])

  // ─── Resolved item rows ─────────────────────────────────

  const resolvedRows: ResolvedItem[] = useMemo(() => {
    return items.map(m => {
      const obj = resolvedObjects.get(`${m.object_type}:${m.object_id}`)
      const def = OBJECT_TYPE_MAP[m.object_type]
      return {
        ...m,
        resolvedName: obj && def ? String(obj[def.nameField] ?? m.object_id) : m.object_id,
        resolvedSummary: obj && def?.summaryField ? String(obj[def.summaryField] ?? '—') : '—',
        resolvedUpdated: obj ? formatDate(String(obj['updated'] ?? '')) : '—',
      }
    })
  }, [items, resolvedObjects])

  const filteredRows = useMemo(() => {
    if (typeFilter === 'all') return resolvedRows
    return resolvedRows.filter(r => r.object_type === typeFilter)
  }, [resolvedRows, typeFilter])

  // Per-type item counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const gi of items) {
      counts[gi.object_type] = (counts[gi.object_type] ?? 0) + 1
    }
    return counts
  }, [items])

  const presentTypes = useMemo(() => {
    return OBJECT_TYPES.filter(t => typeCounts[t.type])
  }, [typeCounts])

  // ─── Edit handlers ──────────────────────────────────────

  function openEdit() {
    if (!group) return
    setFormName(group.name)
    setFormDesc(group.description)
    setFormError('')
    setEditOpen(true)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = formName.trim()
    if (!trimmedName) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await pb.send(`/api/collections/groups/records/${id}`, {
        method: 'PATCH',
        body: { name: trimmedName, description: formDesc.trim() },
      })
      setEditOpen(false)
      await fetchGroup()
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  // ─── Remove item ───────────────────────────────────────

  async function handleRemoveItem(itemId: string) {
    try {
      await pb.send(`/api/collections/group_items/records/${itemId}`, { method: 'DELETE' })
      await fetchGroup()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to remove item'))
    }
  }

  // ─── Add items dialog ──────────────────────────────────

  const loadCandidates = useCallback(
    async (objectType: string) => {
      setCandidatesLoading(true)
      setCandidates([])
      const def = OBJECT_TYPE_MAP[objectType]
      if (!def) {
        setCandidatesLoading(false)
        return
      }
      try {
        // Load existing items for this type
        const existingIds = new Set(
          items.filter(gi => gi.object_type === objectType).map(gi => gi.object_id)
        )
        // Load all records of this type
        const res = await pb.send<PBList<Record<string, unknown>>>(
          `/api/collections/${def.collection}/records?perPage=500`,
          {}
        )
        const available = (res.items ?? []).filter(rec => !existingIds.has(String(rec.id)))
        setCandidates(available)
      } catch {
        setCandidates([])
      } finally {
        setCandidatesLoading(false)
      }
    },
    [items]
  )

  function openAddDialog() {
    setAddSelected(new Set())
    setAddSearch('')
    setAddDropdownOpen(false)
    setAddType(OBJECT_TYPES[0].type)
    setAddOpen(true)
    loadCandidates(OBJECT_TYPES[0].type)
  }

  function handleAddTypeChange(newType: string) {
    setAddType(newType)
    setAddSelected(new Set())
    setAddSearch('')
    setAddDropdownOpen(false)
    loadCandidates(newType)
  }

  function toggleCandidate(candidateId: string) {
    setAddSelected(prev => {
      const next = new Set(prev)
      if (next.has(candidateId)) next.delete(candidateId)
      else next.add(candidateId)
      return next
    })
  }

  async function handleAddItems() {
    if (addSelected.size === 0) {
      setAddOpen(false)
      return
    }
    setAddSaving(true)
    try {
      await Promise.all(
        Array.from(addSelected).map(objectId =>
          pb.send('/api/collections/group_items/records', {
            method: 'POST',
            body: { group_id: id, object_type: addType, object_id: objectId },
          })
        )
      )
      setAddOpen(false)
      await fetchGroup()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to add items'))
    } finally {
      setAddSaving(false)
    }
  }

  const filteredCandidates = useMemo(() => {
    if (!addSearch) return candidates
    const q = addSearch.toLowerCase()
    const def = OBJECT_TYPE_MAP[addType]
    return candidates.filter(c => {
      const name = String(c[def?.nameField ?? 'name'] ?? '').toLowerCase()
      return name.includes(q)
    })
  }, [candidates, addSearch, addType])

  // ─── Close dropdown on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!addDropdownOpen) return
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAddDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [addDropdownOpen])

  // ─── Create new object (navigate to create page with return params) ────────

  function handleCreateNew(type: string) {
    const def = OBJECT_TYPE_MAP[type]
    if (!def?.createRoute) return
    setAddOpen(false)
    // Navigate to the create destination with returnGroup + returnType so the
    // target page can redirect back here after creation.
    const navigateDynamic = navigate as unknown as (opts: {
      to: string
      search: Record<string, string>
    }) => Promise<void> | void
    void navigateDynamic({ to: def.createRoute, search: { returnGroup: id, returnType: type } })
  }

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !group) {
    return (
      <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
        {error}
        <Button variant="ghost" size="sm" className="ml-2" onClick={fetchGroup}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/groups"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1 w-fit transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Groups
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{group?.name}</h1>
          {group?.description && <p className="text-muted-foreground mt-1">{group.description}</p>}
        </div>
        <Button variant="outline" onClick={openEdit}>
          <Pencil className="h-4 w-4 mr-2" />
          Edit Group
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">Total Items: {items.length}</Badge>
        {presentTypes.map(t => (
          <Badge key={t.type} variant="outline">
            {t.label}: {typeCounts[t.type]}
          </Badge>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={openAddDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Items
        </Button>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All Types</option>
          {presentTypes.map(t => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Items table */}
      {filteredRows.length === 0 && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border rounded-lg">
          <p className="text-lg font-medium">This group has no items yet</p>
          <p className="text-sm mt-1">
            Add applications or reusable resources to start organizing this view.
          </p>
          <Button className="mt-4" onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Add Items
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(row => {
                const def = OBJECT_TYPE_MAP[row.object_type]
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge variant="outline">{getObjectTypeLabel(row.object_type)}</Badge>
                    </TableCell>
                    <TableCell>
                      {def ? (
                        def.listSearchKey ? (
                          <a
                            href={`${def.detailRoute}?${new URLSearchParams({ [def.listSearchKey]: row.object_id }).toString()}`}
                            className="font-medium hover:underline"
                          >
                            {row.resolvedName}
                          </a>
                        ) : (
                          <a
                            href={buildDetailLink(def.detailRoute, row.object_id)}
                            className="font-medium hover:underline"
                          >
                            {row.resolvedName}
                          </a>
                        )
                      ) : (
                        <span className="font-medium">{row.resolvedName}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.resolvedSummary}</TableCell>
                    <TableCell className="text-muted-foreground">{row.resolvedUpdated}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveItem(row.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Edit Group Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Group</DialogTitle>
              <DialogDescription>Update group details.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">Description</Label>
                <Textarea
                  id="edit-desc"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  rows={3}
                />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Items Dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={open => {
          setAddOpen(open)
          if (!open) setAddDropdownOpen(false)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Items</DialogTitle>
            <DialogDescription>
              Select an object type, then choose objects to add to this group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Object type tabs */}
            <div className="space-y-2">
              <Label>Object Type</Label>
              <select
                value={addType}
                onChange={e => handleAddTypeChange(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {OBJECT_TYPES.map(t => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Multi-select dropdown */}
            <div className="space-y-2">
              <Label>Select Items</Label>
              <div ref={dropdownRef} className="relative">
                {/* Trigger button */}
                <button
                  type="button"
                  onClick={() => setAddDropdownOpen(o => !o)}
                  className="w-full flex items-center justify-between h-9 rounded-md border border-input bg-background px-3 text-sm text-left focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <span className={addSelected.size === 0 ? 'text-muted-foreground' : ''}>
                    {addSelected.size === 0
                      ? `Select ${OBJECT_TYPE_MAP[addType]?.label ?? addType}s...`
                      : `${addSelected.size} item${addSelected.size > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${addDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Dropdown panel */}
                {addDropdownOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                    {/* Search bar */}
                    <div className="p-2 border-b">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          className="w-full h-8 pl-7 pr-3 text-sm rounded-sm border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                          placeholder={`Search ${OBJECT_TYPE_MAP[addType]?.label ?? addType}s...`}
                          value={addSearch}
                          onChange={e => setAddSearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Items list */}
                    <div className="max-h-[220px] overflow-y-auto">
                      {candidatesLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : filteredCandidates.length === 0 ? (
                        <p className="py-5 text-center text-sm text-muted-foreground">
                          {addSearch
                            ? 'No matches found.'
                            : `No available ${OBJECT_TYPE_MAP[addType]?.label ?? addType}s.`}
                        </p>
                      ) : (
                        filteredCandidates.map(c => {
                          const def = OBJECT_TYPE_MAP[addType]
                          const name = String(c[def?.nameField ?? 'name'] ?? c.id)
                          const summary = def?.summaryField ? String(c[def.summaryField] ?? '') : ''
                          const cid = String(c.id)
                          return (
                            <label
                              key={cid}
                              className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                            >
                              <Checkbox
                                checked={addSelected.has(cid)}
                                onCheckedChange={() => toggleCandidate(cid)}
                              />
                              <span className="flex-1 text-sm truncate">{name}</span>
                              {summary && (
                                <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                  {summary}
                                </span>
                              )}
                            </label>
                          )
                        })
                      )}
                    </div>

                    {/* Create new link */}
                    {OBJECT_TYPE_MAP[addType]?.createRoute && (
                      <>
                        <div className="border-t" />
                        <div className="p-1">
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-muted/50 rounded-sm transition-colors"
                            onClick={() => {
                              setAddDropdownOpen(false)
                              handleCreateNew(addType)
                            }}
                          >
                            <Plus className="h-3.5 w-3.5 shrink-0" />
                            Create a new {OBJECT_TYPE_MAP[addType]?.label}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddItems} disabled={addSaving || addSelected.size === 0}>
              {addSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add {addSelected.size > 0 ? `(${addSelected.size})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/groups/$id')({
  component: GroupDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    addOpen: typeof search.addOpen === 'string' ? search.addOpen : undefined,
    newItem: typeof search.newItem === 'string' ? search.newItem : undefined,
  }),
})
