import { createFileRoute, Link } from "@tanstack/react-router"
import { useState, useEffect, useCallback, useRef, type FormEvent, type ChangeEvent } from "react"
import { Plus, Trash2, Loader2, Pencil, Upload, ChevronLeft } from "lucide-react"
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

// ─── Types ───────────────────────────────────────────────

interface EnvVar {
  key: string
  value: string
  is_secret: boolean
  secret: string // secret record ID
}

interface EnvGroup {
  id: string
  name: string
  description?: string
  vars_count?: number
}

interface EnvGroupDetail extends EnvGroup {
  vars: EnvVar[]
  groups?: string[]
}

interface AvailableGroup {
  id: string
  name: string
  is_default: boolean
}

interface Secret {
  id: string
  name: string
  type?: string
}

// ─── Page ────────────────────────────────────────────────

function EnvGroupsPage() {
  const [items, setItems] = useState<EnvGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [vars, setVars] = useState<EnvVar[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [saving, setSaving] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [formError, setFormError] = useState("")

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<EnvGroup | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Inline create-secret mini-dialog (for var rows)
  const [createSecretOpen, setCreateSecretOpen] = useState(false)

  // Groups
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([])
  const [createSecretVarIdx, setCreateSecretVarIdx] = useState<number | null>(null)
  const [createSecretName, setCreateSecretName] = useState("")
  const [createSecretType, setCreateSecretType] = useState("password")
  const [createSecretUsername, setCreateSecretUsername] = useState("")
  const [createSecretValue, setCreateSecretValue] = useState("")
  const [createSecretSaving, setCreateSecretSaving] = useState(false)
  const [createSecretError, setCreateSecretError] = useState("")
  const createSecretFileRef = useRef<HTMLInputElement | null>(null)

  const fetchItems = useCallback(async () => {
    try {
      const data = await pb.send<EnvGroup[]>("/api/ext/resources/env-groups", {})
      setItems(Array.isArray(data) ? data : [])
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Auto-open Create dialog when ?create=1
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("create") === "1") openCreateDialog()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load secrets list when dialog opens (for the secret selector in vars)
  useEffect(() => {
    if (!dialogOpen) return
    pb.send<{id:string;name:string;type?:string}[]>("/api/ext/resources/secrets", {})
      .then(data => setSecrets(Array.isArray(data) ? data : []))
      .catch(() => setSecrets([]))
    pb.send<AvailableGroup[]>("/api/ext/resources/groups", {})
      .then(data => {
        const groups = Array.isArray(data) ? data : []
        setAvailableGroups(groups)
        // Auto-select default group when creating
        if (!editingId) {
          const def = groups.find(g => g.is_default)
          if (def) setSelectedGroups(prev => prev.includes(def.id) ? prev : [def.id])
        }
      })
      .catch(() => setAvailableGroups([]))
  }, [dialogOpen, editingId])

  function openCreateDialog() {
    setEditingId(null)
    setName("")
    setDescription("")
    setVars([])
    setSelectedGroups([])
    setFormError("")
    setDialogOpen(true)
  }

  async function openEditDialog(item: EnvGroup) {
    setLoadingEdit(true)
    setFormError("")
    try {
      const data = await pb.send<EnvGroupDetail>(`/api/ext/resources/env-groups/${item.id}`, {})
      setEditingId(item.id)
      setName(data.name ?? "")
      setDescription(data.description ?? "")
      setVars(data.vars ?? [])
      setSelectedGroups(Array.isArray(data.groups) ? data.groups.map(String) : [])
      setDialogOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load group")
    } finally {
      setLoadingEdit(false)
    }
  }

  function openCreateSecretForVar(idx: number) {
    setCreateSecretVarIdx(idx)
    setCreateSecretName("")
    setCreateSecretType("password")
    setCreateSecretUsername("")
    setCreateSecretValue("")
    setCreateSecretError("")
    setCreateSecretOpen(true)
  }

  function handleCreateSecretFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCreateSecretValue(String(ev.target?.result ?? ""))
    reader.readAsText(file)
    e.target.value = ""
  }

  async function handleCreateSecret(e: FormEvent) {
    e.preventDefault()
    setCreateSecretSaving(true)
    setCreateSecretError("")
    try {
      const body: Record<string, unknown> = { name: createSecretName, type: createSecretType, value: createSecretValue }
      if (createSecretType === "username_password") body.username = createSecretUsername
      const created = await pb.send<Secret>("/api/ext/resources/secrets", { method: "POST", body })
      setSecrets(prev => [...prev, { id: created.id, name: created.name, type: createSecretType }])
      if (createSecretVarIdx !== null) updateVar(createSecretVarIdx, { secret: created.id })
      setCreateSecretOpen(false)
    } catch (err) {
      setCreateSecretError(err instanceof Error ? err.message : "Create failed")
    } finally {
      setCreateSecretSaving(false)
    }
  }

  function addVar() {
    setVars(prev => [...prev, { key: "", value: "", is_secret: false, secret: "" }])
  }

  function updateVar(index: number, patch: Partial<EnvVar>) {
    setVars(prev => prev.map((v, i) => i === index ? { ...v, ...patch } : v))
  }

  function removeVar(index: number) {
    setVars(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError("")
    try {
      const body = { name, description, vars, groups: selectedGroups }
      if (editingId) {
        await pb.send(`/api/ext/resources/env-groups/${editingId}`, { method: "PUT", body })
      } else {
        await pb.send("/api/ext/resources/env-groups", { method: "POST", body })
      }
      setDialogOpen(false)
      await fetchItems()
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
      await pb.send(`/api/ext/resources/env-groups/${deleteTarget.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      await fetchItems()
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
            to={"/resources" as never}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1 w-fit transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Resources
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Env Groups</h1>
          <p className="text-muted-foreground mt-1">Reusable environment variable sets</p>
        </div>
        <div className="flex items-center gap-2">
          {loadingEdit && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={fetchItems}>Retry</Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p>No env groups found</p>
              <Button variant="link" onClick={openCreateDialog}>Create your first one</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Variables</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.description || "—"}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{item.vars_count ?? 0} vars</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(item)}
                        disabled={loadingEdit}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(item)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Env Group" : "Create Env Group"}</DialogTitle>
            <DialogDescription>
              Define a named set of environment variables that can be shared across apps.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                className={INPUT_CLASS}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="staging-env"
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <input
                className={INPUT_CLASS}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            {/* Groups multi-select */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Groups</label>
              <div className="border border-input rounded-md p-2 max-h-36 overflow-y-auto space-y-1 bg-background">
                {availableGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1">Loading groups…</p>
                ) : (
                  availableGroups.map(g => (
                    <label key={g.id} className="flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded hover:bg-muted transition-colors">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selectedGroups.includes(g.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedGroups(prev => [...prev, g.id])
                          } else {
                            setSelectedGroups(prev => prev.filter(id => id !== g.id))
                          }
                        }}
                      />
                      <span className="text-sm">{g.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Variables editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Variables</label>
                <Button type="button" variant="outline" size="sm" onClick={addVar}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add variable
                </Button>
              </div>

              {vars.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">
                  No variables yet. Click &ldquo;Add variable&rdquo; to start.
                </p>
              )}

              <div className="space-y-2">
                {vars.map((v, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_auto] gap-2 items-center p-2 rounded-md border border-border bg-muted/30"
                  >
                    {/* Key */}
                    <input
                      className={INPUT_CLASS + " font-mono"}
                      value={v.key}
                      onChange={e => updateVar(i, { key: e.target.value })}
                      placeholder="KEY_NAME"
                    />

                    {/* Value or Secret select */}
                    {v.is_secret ? (
                      <div className="flex gap-1 items-center">
                        <select
                          className={INPUT_CLASS + " flex-1"}
                          value={v.secret}
                          onChange={e => updateVar(i, { secret: e.target.value })}
                        >
                          <option value="">Select secret…</option>
                          {secrets.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name}{s.type ? ` (${s.type})` : ""}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          title="Create new secret"
                          onClick={() => openCreateSecretForVar(i)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <input
                        className={INPUT_CLASS}
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
                        onChange={e => updateVar(i, { is_secret: e.target.checked, value: "", secret: "" })}
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
                ))}
              </div>
            </div>

            {formError && <p className="text-destructive text-sm">{formError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Secret mini-dialog */}
      <Dialog open={createSecretOpen} onOpenChange={setCreateSecretOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Secret</DialogTitle>
            <DialogDescription>Create a secret and assign it to this variable.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSecret} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <input className={INPUT_CLASS} value={createSecretName} onChange={e => setCreateSecretName(e.target.value)} placeholder="my-api-key" required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type <span className="text-destructive">*</span></label>
              <select className={INPUT_CLASS} value={createSecretType} onChange={e => { setCreateSecretType(e.target.value); setCreateSecretValue(""); setCreateSecretUsername("") }} required>
                <option value="password">Password</option>
                <option value="username_password">Username + Password</option>
                <option value="api_key">API Key</option>
                <option value="token">Token</option>
                <option value="ssh_key">SSH Key</option>
              </select>
            </div>
            {createSecretType === "username_password" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Username</label>
                <input className={INPUT_CLASS} value={createSecretUsername} onChange={e => setCreateSecretUsername(e.target.value)} placeholder="admin" />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium">Password / Value <span className="text-destructive">*</span></label>
              {createSecretType === "ssh_key" ? (
                <>
                  <textarea
                    className={INPUT_CLASS + " min-h-[100px] resize-y font-mono text-xs"}
                    value={createSecretValue}
                    onChange={e => setCreateSecretValue(e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    required
                    rows={4}
                  />
                  <input ref={createSecretFileRef} type="file" accept=".pem,.key,.txt" className="hidden" onChange={handleCreateSecretFileUpload} />
                  <Button type="button" variant="outline" size="sm" onClick={() => createSecretFileRef.current?.click()}>
                    <Upload className="h-3 w-3 mr-1" />Upload file
                  </Button>
                </>
              ) : (
                <input type="password" className={INPUT_CLASS} value={createSecretValue} onChange={e => setCreateSecretValue(e.target.value)} required />
              )}
            </div>
            {createSecretError && <p className="text-destructive text-sm">{createSecretError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateSecretOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createSecretSaving}>
                {createSecretSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
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
            <AlertDialogTitle>Delete Env Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              All its variables will also be deleted. This action cannot be undone.
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

export const Route = createFileRoute("/_app/_auth/resources/env-groups")({
  component: EnvGroupsPage,
})
