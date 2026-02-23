import { useState, useEffect, useCallback } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronLeft, Loader2, Plus, X } from "lucide-react"
import { pb } from "@/lib/pb"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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

interface ResourceGroup {
  id: string
  name: string
  description: string
  is_default: boolean
}

interface ResourceItem {
  id: string
  name: string
  description?: string
  type: string
  [key: string]: unknown
}

// Maps API type key → friendly label
const TYPE_LABELS: Record<string, string> = {
  "servers": "Server",
  "secrets": "Secret",
  "env-groups": "Env Group",
  "databases": "Database",
  "cloud-accounts": "Cloud Account",
  "certificates": "Certificate",
  "integrations": "Integration",
  "scripts": "Script",
}

const ALL_TYPES = Object.keys(TYPE_LABELS)

function GroupDetailPage() {
  const { id } = Route.useParams()

  const [group, setGroup] = useState<ResourceGroup | null>(null)
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [typeFilter, setTypeFilter] = useState<string>("all")

  // Add Resources dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addTab, setAddTab] = useState<string>(ALL_TYPES[0])
  const [allResources, setAllResources] = useState<Record<string, ResourceItem[]>>({})
  const [allResourcesLoaded, setAllResourcesLoaded] = useState(false)
  const [addSelected, setAddSelected] = useState<Record<string, Set<string>>>({})
  const [addSaving, setAddSaving] = useState(false)

  const fetchGroup = useCallback(async () => {
    try {
      const [grp, items] = await Promise.all([
        pb.send<ResourceGroup>(`/api/ext/resources/groups/${id}`, {}),
        pb.send<ResourceItem[]>(`/api/ext/resources/groups/${id}/resources`, {}),
      ])
      setGroup(grp)
      setResources(Array.isArray(items) ? items : [])
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load group")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchGroup() }, [fetchGroup])

  // Load all resources for the add dialog
  async function openAddDialog() {
    setAddSelected({})
    setAddDialogOpen(true)
    if (allResourcesLoaded) return
    const loaded: Record<string, ResourceItem[]> = {}
    await Promise.all(
      ALL_TYPES.map(async type => {
        try {
          const data = await pb.send<ResourceItem[]>(`/api/ext/resources/${type}`, {})
          loaded[type] = Array.isArray(data) ? data : []
        } catch {
          loaded[type] = []
        }
      })
    )
    setAllResources(loaded)
    setAllResourcesLoaded(true)
  }

  function toggleAddItem(type: string, itemId: string) {
    setAddSelected(prev => {
      const existing = new Set(prev[type] ?? [])
      if (existing.has(itemId)) existing.delete(itemId)
      else existing.add(itemId)
      return { ...prev, [type]: existing }
    })
  }

  async function handleAddResources() {
    setAddSaving(true)
    const items = Object.entries(addSelected).flatMap(([type, ids]) =>
      Array.from(ids).map(itemId => ({ type, id: itemId }))
    )
    if (items.length === 0) {
      setAddDialogOpen(false)
      setAddSaving(false)
      return
    }
    try {
      await pb.send(`/api/ext/resources/groups/${id}/resources/batch`, {
        method: "POST",
        body: { action: "add", items },
      })
      setAddDialogOpen(false)
      await fetchGroup()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add resources")
    } finally {
      setAddSaving(false)
    }
  }

  async function handleRemoveResource(type: string, resourceId: string) {
    try {
      await pb.send(`/api/ext/resources/groups/${id}/resources/batch`, {
        method: "POST",
        body: { action: "remove", items: [{ type, id: resourceId }] },
      })
      await fetchGroup()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove resource")
    }
  }

  const filteredResources = typeFilter === "all"
    ? resources
    : resources.filter(r => r.type === typeFilter)

  const presentTypes = [...new Set(resources.map(r => r.type))]

  // Count total selected for add dialog
  const totalSelected = Object.values(addSelected).reduce((s, set) => s + set.size, 0)

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
        <Button variant="ghost" size="sm" className="ml-2" onClick={fetchGroup}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/resources/groups"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1 w-fit transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Resource Groups
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{group?.name}</h1>
          {group?.description && (
            <p className="text-muted-foreground mt-1">{group.description}</p>
          )}
        </div>
        <Button onClick={openAddDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Resources
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Type filter tabs */}
      {resources.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={typeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setTypeFilter("all")}
          >
            All ({resources.length})
          </Button>
          {presentTypes.map(t => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(t)}
            >
              {TYPE_LABELS[t] ?? t} ({resources.filter(r => r.type === t).length})
            </Button>
          ))}
        </div>
      )}

      {/* Resources table */}
      <Card>
        <CardContent className="p-0">
          {filteredResources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p>No resources in this group</p>
              <Button variant="link" onClick={openAddDialog}>Add resources</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResources.map(r => (
                  <TableRow key={`${r.type}-${r.id}`}>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABELS[r.type] ?? r.type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.description || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove from group"
                        onClick={() => handleRemoveResource(r.type, r.id)}
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Resources dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Resources to Group</DialogTitle>
            <DialogDescription>
              Select resources to add to &quot;{group?.name}&quot;. Resources already in the group will be skipped.
            </DialogDescription>
          </DialogHeader>

          {/* Type tabs */}
          <div className="flex gap-1 flex-wrap border-b pb-2">
            {ALL_TYPES.map(t => {
              const count = addSelected[t]?.size ?? 0
              return (
                <button
                  key={t}
                  onClick={() => setAddTab(t)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    addTab === t
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {TYPE_LABELS[t]}
                  {count > 0 && (
                    <span className="ml-1.5 bg-primary-foreground/20 text-xs px-1.5 py-0.5 rounded-full">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Resource list for current tab */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {!allResourcesLoaded ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (allResources[addTab] ?? []).length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                No {TYPE_LABELS[addTab]} resources found
              </p>
            ) : (
              <div className="space-y-1 p-1">
                {(allResources[addTab] ?? []).map(item => {
                  const alreadyIn = resources.some(r => r.type === addTab && r.id === item.id)
                  const selected = addSelected[addTab]?.has(item.id) ?? false
                  return (
                    <label
                      key={item.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                        alreadyIn
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selected || alreadyIn}
                        disabled={alreadyIn}
                        onChange={() => !alreadyIn && toggleAddItem(addTab, item.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.name}</div>
                        {item.description && (
                          <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                        )}
                      </div>
                      {alreadyIn && (
                        <span className="text-xs text-muted-foreground shrink-0">Already in group</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddResources} disabled={addSaving || totalSelected === 0}>
              {addSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add {totalSelected > 0 ? `${totalSelected} resource${totalSelected > 1 ? "s" : ""}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Route = createFileRoute("/_app/_auth/resources/groups/$id")({
  component: GroupDetailPage,
})
