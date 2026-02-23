import { useState, useEffect, useCallback, type FormEvent } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Plus, Pencil, Trash2, Loader2, Lock, ChevronLeft } from "lucide-react"
import { pb } from "@/lib/pb"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const INPUT_CLASS =
  "w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground text-sm"

interface Group {
  id: string
  name: string
  description: string
  is_default: boolean
  resource_count: number
}

function GroupsPage() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [formName, setFormName] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")

  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchGroups = useCallback(async () => {
    try {
      const data = await pb.send<Group[]>("/api/ext/resources/groups", {})
      setGroups(Array.isArray(data) ? data : [])
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGroups() }, [fetchGroups])

  function openCreate() {
    setEditingGroup(null)
    setFormName("")
    setFormDesc("")
    setFormError("")
    setDialogOpen(true)
  }

  function openEdit(g: Group) {
    setEditingGroup(g)
    setFormName(g.name)
    setFormDesc(g.description)
    setFormError("")
    setDialogOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError("")
    try {
      if (editingGroup) {
        await pb.send(`/api/ext/resources/groups/${editingGroup.id}`, {
          method: "PUT",
          body: { name: formName, description: formDesc },
        })
      } else {
        const created = await pb.send<{ id: string }>("/api/ext/resources/groups", {
          method: "POST",
          body: { name: formName, description: formDesc },
        })
        setDialogOpen(false)
        navigate({ to: "/resources/groups/$id", params: { id: created.id } })
        return
      }
      setDialogOpen(false)
      await fetchGroups()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await pb.send(`/api/ext/resources/groups/${deleteTarget.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      await fetchGroups()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

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
          <Link
            to="/resources"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1 w-fit transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Resources
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Resource Groups</h1>
          <p className="text-muted-foreground mt-1">Organize resources into cross-type groups</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Group
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={fetchGroups}>
            Retry
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p>No resource groups found</p>
              <Button variant="link" onClick={openCreate}>Create the first group</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Resources</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(g => (
                  <TableRow key={g.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link
                        to="/resources/groups/$id"
                        params={{ id: g.id }}
                        className="font-medium hover:underline"
                      >
                        {g.name}
                        {g.is_default && (
                          <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {g.description || "—"}
                    </TableCell>
                    <TableCell>{g.resource_count}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(g)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {g.is_default ? (
                        <Button variant="ghost" size="icon" disabled title="Default group cannot be deleted">
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(g)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Group" : "New Resource Group"}</DialogTitle>
            <DialogDescription>
              {editingGroup ? "Update group details." : "Create a new cross-type resource group."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                className={INPUT_CLASS}
                value={formName}
                onChange={e => setFormName(e.target.value)}
                required
                placeholder="production"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <input
                className={INPUT_CLASS}
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            {formError && <p className="text-destructive text-sm">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingGroup ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              Resources will not be deleted — only the group assignment is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute("/_app/_auth/resources/groups/")({
  component: GroupsPage,
})
