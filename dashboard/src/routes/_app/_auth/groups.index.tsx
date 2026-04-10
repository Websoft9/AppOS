import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus, Pencil, Trash2, Loader2, Search, ArrowUp, ArrowDown } from 'lucide-react'
import { pb } from '@/lib/pb'
import { OBJECT_TYPES, getObjectTypeLabel } from '@/lib/object-types'
import { getApiErrorMessage } from '@/lib/api-error'
import { useAuth } from '@/contexts/AuthContext'
import {
  type GroupRecord,
  type GroupItemRecord,
  type PBList,
  formatDate,
  formatCreator,
} from '@/lib/groups'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

// ─── Types ───────────────────────────────────────────────

interface GroupRow extends GroupRecord {
  totalItems: number
  breakdown: Record<string, number>
}

// ─── Helpers ─────────────────────────────────────────────

function breakdownText(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .map(([type, count]) => `${getObjectTypeLabel(type)}: ${count}`)
    .join(', ')
}

type SortField = 'name' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'

// ─── Page Component ──────────────────────────────────────

function GroupsListPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [items, setItems] = useState<GroupItemRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Search / filter / sort
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortField, setSortField] = useState<SortField>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupRecord | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<GroupRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [groupsRes, itemsRes] = await Promise.all([
        pb.send<PBList<GroupRecord>>('/api/collections/groups/records?perPage=500', {}),
        pb.send<PBList<GroupItemRecord>>('/api/collections/group_items/records?perPage=500', {}),
      ])
      setGroups(groupsRes.items ?? [])
      setItems(itemsRes.items ?? [])
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load groups'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Compute enriched rows
  const rows: GroupRow[] = useMemo(() => {
    const itemsByGroup = new Map<string, GroupItemRecord[]>()
    for (const gi of items) {
      const list = itemsByGroup.get(gi.group_id) ?? []
      list.push(gi)
      itemsByGroup.set(gi.group_id, list)
    }

    return groups.map(g => {
      const gItems = itemsByGroup.get(g.id) ?? []
      const breakdown: Record<string, number> = {}
      for (const gi of gItems) {
        breakdown[gi.object_type] = (breakdown[gi.object_type] ?? 0) + 1
      }
      return { ...g, totalItems: gItems.length, breakdown }
    })
  }, [groups, items])

  // Filter & sort
  const filteredRows = useMemo(() => {
    let result = rows

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(r => r.name.toLowerCase().includes(q))
    }

    if (typeFilter !== 'all') {
      result = result.filter(r => r.breakdown[typeFilter])
    }

    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = (a.name ?? '').localeCompare(b.name ?? '')
      else if (sortField === 'created') cmp = (a.created ?? '').localeCompare(b.created ?? '')
      else cmp = (a.updated ?? '').localeCompare(b.updated ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, search, typeFilter, sortField, sortDir])

  // Distinct types present across all items
  const presentTypes = useMemo(() => {
    const types = new Set(items.map(gi => gi.object_type))
    return OBJECT_TYPES.filter(t => types.has(t.type))
  }, [items])

  // ─── Dialog handlers ────────────────────────────────────

  function openCreate() {
    setEditingGroup(null)
    setFormName('')
    setFormDesc('')
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(g: GroupRecord) {
    setEditingGroup(g)
    setFormName(g.name)
    setFormDesc(g.description)
    setFormError('')
    setDialogOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmedName = formName.trim()
    if (!trimmedName) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (editingGroup) {
        await pb.send(`/api/collections/groups/records/${editingGroup.id}`, {
          method: 'PATCH',
          body: { name: trimmedName, description: formDesc.trim() },
        })
        setDialogOpen(false)
        await fetchData()
      } else {
        const created = await pb.send<{ id: string }>('/api/collections/groups/records', {
          method: 'POST',
          body: { name: trimmedName, description: formDesc.trim(), created_by: user?.id ?? '' },
        })
        setDialogOpen(false)
        navigate({
          to: '/groups/$id',
          params: { id: created.id },
          search: { addOpen: undefined, newItem: undefined },
        })
      }
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await pb.send(`/api/collections/groups/records/${deleteTarget.id}`, { method: 'DELETE' })
      setDeleteTarget(null)
      await fetchData()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Delete failed'))
    } finally {
      setDeleting(false)
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // ─── Render ─────────────────────────────────────────────

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
          <h1 className="text-2xl font-bold tracking-tight">Groups</h1>
          <p className="text-muted-foreground mt-1">
            Organize applications and reusable platform objects for clearer management
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Group
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={fetchData}>
            Retry
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
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

      {/* Table */}
      {filteredRows.length === 0 && !search && typeFilter === 'all' ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border rounded-lg">
          <p className="text-lg font-medium">No groups yet</p>
          <p className="text-sm mt-1">
            Create the first Group to organize related applications and resources.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Group
          </Button>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
          <p>No groups match your filters</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('name')}
                  >
                    Name
                    {sortField === 'name' &&
                      (sortDir === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                </TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Total Items</TableHead>
                <TableHead>Breakdown</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('created')}
                  >
                    Created
                    {sortField === 'created' &&
                      (sortDir === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('updated')}
                  >
                    Updated
                    {sortField === 'updated' &&
                      (sortDir === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                </TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(row => (
                <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link
                      to="/groups/$id"
                      params={{ id: row.id }}
                      search={{ addOpen: undefined, newItem: undefined }}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    {row.description || '—'}
                  </TableCell>
                  <TableCell>{row.totalItems}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {breakdownText(row.breakdown) || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatCreator(row.created_by, user?.id, user?.email)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.created)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.updated)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={e => {
                          e.stopPropagation()
                          openEdit(row)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={e => {
                          e.stopPropagation()
                          setDeleteTarget(row)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingGroup ? 'Edit Group' : 'New Group'}</DialogTitle>
              <DialogDescription>
                {editingGroup ? 'Update group details.' : 'Create a new group to organize objects.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="group-name">Name</Label>
                <Input
                  id="group-name"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Group name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-desc">Description</Label>
                <Textarea
                  id="group-desc"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {editingGroup ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? All items in this
              group will be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/groups/')({
  component: GroupsListPage,
})
