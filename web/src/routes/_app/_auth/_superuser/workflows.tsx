import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Workflow, RefreshCw, Play, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { IconBreadcrumb } from '@/components/layout/IconBreadcrumb'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  approveWorkflowNode,
  cancelWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  listWorkflowNodeRuns,
  listWorkflowRuns,
  listWorkflows,
  rejectWorkflowNode,
  runWorkflow,
  updateWorkflow,
  type WorkflowDefinitionRecord,
  type WorkflowNodeRunRecord,
  type WorkflowRunRecord,
} from '@/lib/workflows-api'

export function WorkflowsPage() {
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
  const [items, setItems] = useState<WorkflowDefinitionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<WorkflowDefinitionRecord | null>(null)
  const [selectedRun, setSelectedRun] = useState<WorkflowRunRecord | null>(null)
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([])
  const [nodeRuns, setNodeRuns] = useState<WorkflowNodeRunRecord[]>([])
  const [runningId, setRunningId] = useState('')
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runTarget, setRunTarget] = useState<WorkflowDefinitionRecord | null>(null)
  const [runParamsText, setRunParamsText] = useState('{}')
  const [form, setForm] = useState({
    name: '',
    description: '',
    default_server_id: '',
    is_enabled: true,
    definition_yaml: '',
  })

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <IconBreadcrumb
        icon={<Workflow className="h-4 w-4" />}
        parentLabel="System"
        parentHref="/status"
        currentPage="Workflows"
      />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent])

  async function load() {
    setLoading(true)
    setError('')
    try {
      setItems(await listWorkflows())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const summary = useMemo(
    () => ({ total: items.length, enabled: items.filter(item => item.is_enabled).length }),
    [items]
  )

  function beginCreate() {
    setSelected(null)
    setForm({ name: '', description: '', default_server_id: '', is_enabled: true, definition_yaml: '' })
    setEditorOpen(true)
  }

  function beginEdit(item: WorkflowDefinitionRecord) {
    setSelected(item)
    setForm({
      name: item.name,
      description: item.description ?? '',
      default_server_id: item.default_server_id ?? '',
      is_enabled: item.is_enabled,
      definition_yaml: item.definition_yaml,
    })
    setEditorOpen(true)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      if (selected) {
        await updateWorkflow(selected.id, form)
      } else {
        await createWorkflow(form)
      }
      setEditorOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(item: WorkflowDefinitionRecord) {
    setError('')
    try {
      await deleteWorkflow(item.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workflow.')
    }
  }

  async function launch(item: WorkflowDefinitionRecord) {
    setRunTarget(item)
    setRunParamsText('{}')
    setRunDialogOpen(true)
  }

  async function openRuns(item: WorkflowDefinitionRecord) {
    setSelected(item)
    const nextRuns = await listWorkflowRuns(item.id)
    setRuns(nextRuns)
    setSelectedRun(nextRuns[0] ?? null)
    if (nextRuns[0]) {
      setNodeRuns(await listWorkflowNodeRuns(nextRuns[0].id))
    } else {
      setNodeRuns([])
    }
    setRunsOpen(true)
  }

  async function selectRun(run: WorkflowRunRecord) {
    setSelectedRun(run)
    setNodeRuns(await listWorkflowNodeRuns(run.id))
  }

  async function decideNode(node: WorkflowNodeRunRecord, approve: boolean) {
    if (!selectedRun || !selected) return
    if (approve) {
      await approveWorkflowNode(selectedRun.id, node.node_key)
    } else {
      await rejectWorkflowNode(selectedRun.id, node.node_key)
    }
    await openRuns(selected)
  }

  async function cancelRun() {
    if (!selectedRun || !selected) return
    await cancelWorkflowRun(selectedRun.id)
    await openRuns(selected)
  }

  async function toggleEnabled(item: WorkflowDefinitionRecord) {
    setError('')
    try {
      await updateWorkflow(item.id, { ...item, is_enabled: !item.is_enabled })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workflow.')
    }
  }

  async function confirmRun() {
    if (!runTarget) return
    setRunningId(runTarget.id)
    setError('')
    try {
      const parsed = JSON.parse(runParamsText || '{}')
      const result = await runWorkflow(runTarget.id, parsed)
      setRunDialogOpen(false)
      await load()
      if (result.run) {
        await openRuns(runTarget)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run workflow.')
    } finally {
      setRunningId('')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            YAML-backed workflow definitions with manual and cron execution.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={beginCreate}>Create Workflow</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Total</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.total}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Enabled</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.enabled}</CardContent>
        </Card>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Target Server</TableHead>
                <TableHead>Triggers</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Loading workflows...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No workflows yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      {item.description ? (
                        <div className="text-xs text-muted-foreground">{item.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.is_enabled ? 'default' : 'outline'}>
                        {item.is_enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.default_server_id || '—'}</TableCell>
                    <TableCell>{formatTriggerTypes(item.trigger_types_json)}</TableCell>
                    <TableCell>{formatDate(item.updated)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => beginEdit(item)}>Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => void openRuns(item)}>Runs</Button>
                        <Button size="sm" variant="outline" onClick={() => void toggleEnabled(item)}>
                          {item.is_enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button size="sm" onClick={() => void launch(item)} disabled={runningId === item.id}>
                          <Play className="mr-1 h-4 w-4" />Run
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void remove(item)}>Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{selected ? 'Edit Workflow' : 'Create Workflow'}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <label className="block text-sm font-medium">
              Name
              <Input aria-label="Name" value={form.name} onChange={e => setForm(current => ({ ...current, name: e.target.value }))} />
            </label>
            <label className="block text-sm font-medium">
              Description
              <Input aria-label="Description" value={form.description} onChange={e => setForm(current => ({ ...current, description: e.target.value }))} />
            </label>
            <label className="block text-sm font-medium">
              Target Server
              <Input aria-label="Target Server" value={form.default_server_id} onChange={e => setForm(current => ({ ...current, default_server_id: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                aria-label="Enabled"
                type="checkbox"
                checked={form.is_enabled}
                onChange={e => setForm(current => ({ ...current, is_enabled: e.target.checked }))}
              />
              Enabled
            </label>
            <label className="block text-sm font-medium">
              Definition YAML
              <Textarea
                aria-label="Definition YAML"
                rows={18}
                value={form.definition_yaml}
                onChange={e => setForm(current => ({ ...current, definition_yaml: e.target.value }))}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={runsOpen} onOpenChange={setRunsOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-5xl">
          <SheetHeader>
            <SheetTitle>{selected ? `Workflow Runs · ${selected.name}` : 'Workflow Runs'}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <CardHeader><CardTitle>Runs</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {runs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No runs yet.</div>
                ) : (
                  runs.map(run => (
                    <button
                      key={run.id}
                      type="button"
                      className={`w-full rounded-md border p-3 text-left transition ${selectedRun?.id === run.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
                      onClick={() => void selectRun(run)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{run.trigger_type}</span>
                        <RunStatusBadge status={run.status} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatDate(run.created)}</div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Run Detail</CardTitle>
                {selectedRun ? <Button variant="outline" size="sm" onClick={() => void cancelRun()}>Cancel Run</Button> : null}
              </CardHeader>
              <CardContent>
                {selectedRun ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
                        <div className="mt-1"><RunStatusBadge status={selectedRun.status} /></div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Trigger</div>
                        <div className="mt-1 text-sm">{selectedRun.trigger_type}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Target Server</div>
                        <div className="mt-1 text-sm">{selectedRun.resolved_server_id || '—'}</div>
                      </div>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Node</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Output</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {nodeRuns.map(node => (
                          <TableRow key={node.id}>
                            <TableCell>{node.display_name}</TableCell>
                            <TableCell>{node.node_type}</TableCell>
                            <TableCell><RunStatusBadge status={node.status} /></TableCell>
                            <TableCell>
                              <pre className="max-w-[420px] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
                                {node.execution_log || node.output_json || node.error_message || '—'}
                              </pre>
                            </TableCell>
                            <TableCell className="text-right">
                              {node.status === 'manual_gate' ? (
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" onClick={() => void decideNode(node, true)}>Approve</Button>
                                  <Button size="sm" variant="destructive" onClick={() => void decideNode(node, false)}>Reject</Button>
                                </div>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Select a run to inspect details.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Workflow</DialogTitle>
            <DialogDescription>
              Provide optional JSON parameters for this manual run.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm font-medium">
            Run Parameters JSON
            <Textarea
              aria-label="Run Parameters JSON"
              rows={10}
              value={runParamsText}
              onChange={e => setRunParamsText(e.target.value)}
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void confirmRun()} disabled={!runTarget || runningId === runTarget.id}>Run Now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatTriggerTypes(raw: string) {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.join(', ') : raw || '—'
  } catch {
    return raw || '—'
  }
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'succeeded') {
    return <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Succeeded</Badge>
  }
  if (status === 'failed' || status === 'cancelled') {
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />{status}</Badge>
  }
  return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />{status}</Badge>
}

export const Route = createFileRoute('/_app/_auth/_superuser/workflows' as never)({
  component: WorkflowsPage,
})
