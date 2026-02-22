import { useState, useEffect, useCallback, useRef, type ReactNode, type FormEvent, type ChangeEvent } from "react"
import { Link } from "@tanstack/react-router"
import { Plus, Pencil, Trash2, Loader2, Upload, ChevronLeft } from "lucide-react"
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

// ─── Types ───────────────────────────────────────────────

/** Fields for the inline "create new relation" mini-dialog */
export interface RelCreateField {
  key: string
  label: string
  type: "text" | "password" | "select" | "textarea" | "file-textarea"
  required?: boolean
  hidden?: boolean
  defaultValue?: unknown
  placeholder?: string
  options?: { label: string; value: string }[]
  fileAccept?: string
  /** Switch type based on another field's current value */
  dynamicType?: { field: string; values: string[]; as: "textarea" | "file-textarea" }
  /** Only show when another field has one of these values */
  showWhen?: { field: string; values: string[] }
}

export interface Column {
  key: string
  label: string
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode
}

export interface FieldDef {
  key: string
  label: string
  type: "text" | "number" | "select" | "textarea" | "password" | "boolean" | "relation" | "file-textarea"
  required?: boolean
  placeholder?: string
  options?: { label: string; value: string }[]
  defaultValue?: unknown
  hidden?: boolean
  /** Relation: load options from this API path */
  relationApiPath?: string
  /** Relation: which field to use as label (default: "name") */
  relationLabelKey?: string
  /** Relation: filter options via query params (e.g. { type: "password" }) */
  relationFilter?: Record<string, string>
  /** Relation: show an inline "+" button to create a new record */
  relationCreate?: {
    label: string
    apiPath: string
    fields: RelCreateField[]
  }
  /** Only show when another field has one of these values */
  showWhen?: { field: string; values: string[] }
  /** Switch type when another field has one of these values */
  dynamicType?: { field: string; values: string[]; as: "textarea" | "file-textarea" }
  /** Enable file upload button (textarea / file-textarea) */
  fileAccept?: string
  /** Side effect: when this field changes, update other fields too */
  onValueChange?: (value: unknown, update: (key: string, value: unknown) => void) => void
}

export interface ResourcePageConfig {
  title: string
  description?: string
  apiPath: string           // e.g., "/api/ext/resources/servers"
  columns: Column[]
  fields: FieldDef[]
  nameField?: string        // field used as display name (default: "name")
  autoCreate?: boolean      // open Create dialog on mount (from ?create=1)
  parentNav?: { label: string; href: string }  // breadcrumb back link
}

const INPUT_CLASS =
  "w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground text-sm"

type RelOpt = { id: string; label: string }

// ─── ResourcePage ────────────────────────────────────────

export function ResourcePage({ config }: { config: ResourcePageConfig }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Record<string, unknown> | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")

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
  const [createRelError, setCreateRelError] = useState("")

  const nameField = config.nameField || "name"

  // ─── Fetch ───────────────────────────

  const fetchItems = useCallback(async () => {
    try {
      const data = await pb.send<Record<string, unknown>[]>(config.apiPath, {})
      setItems(Array.isArray(data) ? data : [])
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data")
    } finally {
      setLoading(false)
    }
  }, [config.apiPath])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Auto-open Create dialog once data has loaded (triggered by ?create=1)
  useEffect(() => {
    if (config.autoCreate && !loading) openCreateDialog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Load relation options whenever dialog opens
  useEffect(() => {
    if (!dialogOpen) return
    config.fields
      .filter(f => f.type === "relation" && f.relationApiPath)
      .forEach(f => {
        pb.send<Record<string, unknown>[]>(f.relationApiPath!, {})
          .then(data => {
            let records = Array.isArray(data) ? data : []
            // Client-side filter (backend list endpoint has no query filter support yet)
            if (f.relationFilter) {
              for (const [fk, fv] of Object.entries(f.relationFilter)) {
                records = records.filter(item => String(item[fk] ?? "") === fv)
              }
            }
            const opts: RelOpt[] = records.map(item => ({
              id: String(item.id),
              label: String(item[f.relationLabelKey ?? "name"] ?? item.id),
            }))
            setRelOpts(prev => ({ ...prev, [f.key]: opts }))
          })
          .catch(() => setRelOpts(prev => ({ ...prev, [f.key]: [] })))
      })
  }, [dialogOpen, config.fields])

  // ─── Form helpers ────────────────────

  function openCreateDialog() {
    setEditingItem(null)
    const defaults: Record<string, unknown> = {}
    for (const f of config.fields) {
      defaults[f.key] = f.defaultValue ?? (f.type === "boolean" ? false : f.type === "number" ? 0 : "")
    }
    setFormData(defaults)
    setFormError("")
    setDialogOpen(true)
  }

  function openEditDialog(item: Record<string, unknown>) {
    setEditingItem(item)
    const data: Record<string, unknown> = {}
    for (const f of config.fields) {
      data[f.key] = item[f.key] ?? (f.defaultValue ?? "")
    }
    setFormData(data)
    setFormError("")
    setDialogOpen(true)
  }

  function updateField(key: string, value: unknown) {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  function handleChange(field: FieldDef, raw: unknown) {
    const value = field.type === "number" ? Number(raw) : raw
    updateField(field.key, value)
    field.onValueChange?.(value, updateField)
  }

  function handleFileUpload(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => updateField(key, String(ev.target?.result ?? ""))
    reader.readAsText(file)
    e.target.value = ""
  }

  function handleCreateRelFileUpload(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCreateRelData(prev => ({ ...prev, [key]: String(ev.target?.result ?? "") }))
    reader.readAsText(file)
    e.target.value = ""
  }

  function openCreateRelDialog(field: FieldDef) {
    const defaults: Record<string, unknown> = {}
    for (const f of field.relationCreate!.fields) {
      defaults[f.key] = f.defaultValue ?? ""
    }
    setCreateRelField(field)
    setCreateRelData(defaults)
    setCreateRelError("")
    setCreateRelOpen(true)
  }

  async function handleCreateRelSubmit(e: FormEvent) {
    e.preventDefault()
    if (!createRelField?.relationCreate) return
    setCreateRelSaving(true)
    setCreateRelError("")
    try {
      const created = await pb.send<Record<string, unknown>>(createRelField.relationCreate.apiPath, {
        method: "POST",
        body: createRelData,
      })
      const labelKey = createRelField.relationLabelKey ?? "name"
      const newLabel = String(created[labelKey] ?? created.id)
      setRelOpts(prev => ({
        ...prev,
        [createRelField!.key]: [...(prev[createRelField!.key] ?? []), { id: String(created.id), label: newLabel }],
      }))
      updateField(createRelField!.key, String(created.id))
      setCreateRelOpen(false)
    } catch (err) {
      setCreateRelError(err instanceof Error ? err.message : "Create failed")
    } finally {
      setCreateRelSaving(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError("")

    try {
      if (editingItem) {
        await pb.send(`${config.apiPath}/${editingItem.id}`, {
          method: "PUT",
          body: formData,
        })
      } else {
        await pb.send(config.apiPath, {
          method: "POST",
          body: formData,
        })
      }
      setDialogOpen(false)
      await fetchItems()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  // ─── Delete ──────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await pb.send(`${config.apiPath}/${deleteTarget.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      await fetchItems()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
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
          {config.description && (
            <p className="text-muted-foreground mt-1">{config.description}</p>
          )}
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Create
        </Button>
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
                  {config.columns.map((col) => (
                    <TableHead key={col.key}>{col.label}</TableHead>
                  ))}
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={String(item.id)}>
                    {config.columns.map((col) => (
                      <TableCell key={col.key}>
                        {col.render
                          ? col.render(item[col.key], item)
                          : String(item[col.key] ?? "")}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(item)}
                      >
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
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setCreateRelOpen(false) }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? `Edit ${config.title.replace(/s$/, "")}` : `Create ${config.title.replace(/s$/, "")}`}
            </DialogTitle>
            <DialogDescription>
              {editingItem ? "Update the resource details below." : "Fill in the details to create a new resource."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {config.fields
              .filter(f => !f.hidden)
              .filter(f => {
                if (!f.showWhen) return true
                return f.showWhen.values.includes(String(formData[f.showWhen.field] ?? ""))
              })
              .map(field => {
                // Resolve effective type (dynamic override)
                const effectiveType = field.dynamicType
                  ? field.dynamicType.values.includes(String(formData[field.dynamicType.field] ?? ""))
                    ? field.dynamicType.as
                    : field.type
                  : field.type
                const isUploadable = effectiveType === "file-textarea" || !!field.fileAccept
                return (
                  <div key={field.key} className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </label>

                    {effectiveType === "select" ? (
                      <select
                        className={INPUT_CLASS}
                        value={String(formData[field.key] ?? "")}
                        onChange={e => handleChange(field, e.target.value)}
                        required={field.required}
                      >
                        <option value="">Select…</option>
                        {field.options?.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>

                    ) : effectiveType === "relation" ? (
                      <div className="flex gap-2 items-center">
                        <select
                          className={INPUT_CLASS + " flex-1"}
                          value={String(formData[field.key] ?? "")}
                          onChange={e => handleChange(field, e.target.value)}
                          required={field.required}
                        >
                          <option value="">None</option>
                          {(relOpts[field.key] ?? []).map(o => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                        {field.relationCreate && (
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

                    ) : effectiveType === "textarea" || effectiveType === "file-textarea" ? (
                      <div className="space-y-1">
                        <textarea
                          className={INPUT_CLASS + " min-h-[120px] resize-y font-mono text-xs"}
                          value={String(formData[field.key] ?? "")}
                          onChange={e => updateField(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          required={field.required}
                          rows={5}
                        />
                        {isUploadable && (
                          <>
                            <input
                              ref={el => { fileRefs.current[field.key] = el }}
                              type="file"
                              accept={field.fileAccept ?? ".pem,.key,.crt,.txt"}
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

                    ) : effectiveType === "boolean" ? (
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
                        type={effectiveType === "password" ? "password" : effectiveType === "number" ? "number" : "text"}
                        className={INPUT_CLASS}
                        value={String(formData[field.key] ?? "")}
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
                {editingItem ? "Save" : "Create"}
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
              .filter(f => !f.showWhen || f.showWhen.values.includes(String(createRelData[f.showWhen.field] ?? "")))
              .map(f => {
              const effectiveType = f.dynamicType
                ? f.dynamicType.values.includes(String(createRelData[f.dynamicType.field] ?? ""))
                  ? f.dynamicType.as
                  : f.type
                : f.type
              return (
                <div key={f.key} className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {f.label}
                    {f.required && <span className="text-destructive ml-1">*</span>}
                  </label>
                  {effectiveType === "select" ? (
                    <select
                      className={INPUT_CLASS}
                      value={String(createRelData[f.key] ?? "")}
                      onChange={e => setCreateRelData(prev => ({ ...prev, [f.key]: e.target.value }))}
                      required={f.required}
                    >
                      <option value="">Select…</option>
                      {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : effectiveType === "textarea" || effectiveType === "file-textarea" ? (
                    <div className="space-y-1">
                      <textarea
                        className={INPUT_CLASS + " min-h-[120px] resize-y font-mono text-xs"}
                        value={String(createRelData[f.key] ?? "")}
                        onChange={e => setCreateRelData(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        required={f.required}
                        rows={5}
                      />
                      {effectiveType === "file-textarea" && (
                        <>
                          <input
                            ref={el => { createRelFileRefs.current[f.key] = el }}
                            type="file"
                            accept={f.fileAccept ?? ".pem,.key,.crt,.txt"}
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
                      type={effectiveType === "password" ? "password" : "text"}
                      className={INPUT_CLASS}
                      value={String(createRelData[f.key] ?? "")}
                      onChange={e => setCreateRelData(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      required={f.required}
                    />
                  )}
                </div>
              )
            })}
            {createRelError && <p className="text-destructive text-sm">{createRelError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateRelOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createRelSaving}>
                {createRelSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {config.title.replace(/s$/, "")}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{String(deleteTarget?.[nameField] ?? "")}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
