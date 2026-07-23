import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Workflow,
  RefreshCw,
  Play,
  CheckCircle2,
  Clock,
  XCircle,
  MoreVertical,
  Power,
  PowerOff,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import * as jsYaml from 'js-yaml'
import { IconBreadcrumb } from '@/components/layout/IconBreadcrumb'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  getWorkflowRun,
  listWorkflowNodeRuns,
  listWorkflowRuns,
  listWorkflowServers,
  listWorkflows,
  rejectWorkflowNode,
  runWorkflow,
  updateWorkflow,
  type ServerOptionRecord,
  type WorkflowDefinitionRecord,
  type WorkflowNodeRunRecord,
  type WorkflowRunRecord,
} from '@/lib/workflows-api'
import {
  createAICopilotSession,
  listAICopilotModels,
  sendAICopilotMessage,
} from '@/lib/ai-copilot-api'
import { saveAICopilotDraftHandoff } from '@/lib/ai-copilot-draft-handoff'
import { getDrawerTierStyle } from '@/lib/drawer-tiers'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

const PAGE_SIZE = 10

export function WorkflowsPage() {
  const { t } = useTranslation('superuser')
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
  const [items, setItems] = useState<WorkflowDefinitionRecord[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [selected, setSelected] = useState<WorkflowDefinitionRecord | null>(null)
  const [detailItem, setDetailItem] = useState<WorkflowDefinitionRecord | null>(null)
  const [selectedRun, setSelectedRun] = useState<WorkflowRunRecord | null>(null)
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([])
  const [nodeRuns, setNodeRuns] = useState<WorkflowNodeRunRecord[]>([])
  const [servers, setServers] = useState<ServerOptionRecord[]>([])
  const [runningId, setRunningId] = useState('')
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runTarget, setRunTarget] = useState<WorkflowDefinitionRecord | null>(null)
  const [runParamsText, setRunParamsText] = useState('{}')
  const [editorError, setEditorError] = useState('')
  const [runsError, setRunsError] = useState('')
  const [refreshingRun, setRefreshingRun] = useState(false)
  const [aiDraftPrompt, setAIDraftPrompt] = useState('')
  const [form, setForm] = useState({
    is_enabled: true,
    definition_yaml: '',
  })

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
        <IconBreadcrumb
          icon={<Workflow className="h-4 w-4" />}
          parentLabel={t('workflows.breadcrumb.parentLabel')}
          parentHref="/status"
          currentPage={t('workflows.breadcrumb.currentPage')}
        />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [nextItems, nextServers] = await Promise.all([listWorkflows(), listWorkflowServers()])
      setItems(nextItems)
      setServers(nextServers)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflows.errors.loadWorkflows'))
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
    setEditorError('')
    setAIDraftPrompt('')
    setForm({ is_enabled: true, definition_yaml: defaultWorkflowYAML(t) })
    setEditorOpen(true)
  }

  function beginEdit(item: WorkflowDefinitionRecord) {
    setSelected(item)
    setEditorError('')
    setAIDraftPrompt('')
    setForm({ is_enabled: item.is_enabled, definition_yaml: item.definition_yaml })
    setEditorOpen(true)
  }

  function openAICopilotDraft() {
    saveAICopilotDraftHandoff(
      buildWorkflowDraftPrompt({
        request: aiDraftPrompt,
        triggerType: yamlMetadata.triggerType,
        cronSchedule: yamlMetadata.cronSchedule,
        defaultServerId: yamlMetadata.defaultServerId,
        currentYAML: form.definition_yaml,
      })
    )
    window.open('/ai-copilot', '_blank', 'noopener,noreferrer')
  }

  async function generateYAMLWithAICopilot() {
    const request = buildWorkflowDraftPrompt({
      request: aiDraftPrompt,
      triggerType: yamlMetadata.triggerType,
      cronSchedule: yamlMetadata.cronSchedule,
      defaultServerId: yamlMetadata.defaultServerId,
      currentYAML: form.definition_yaml,
    })
    setGeneratingDraft(true)
    setEditorError('')
    try {
      const models = await listAICopilotModels()
      const firstModel = models[0]
      if (!firstModel) {
        throw new Error(t('workflows.errors.noAICopilotModel'))
      }
      const session = await createAICopilotSession({ title: t('workflows.ai.sessionTitle') })
      let generated = ''
      await sendAICopilotMessage(session.id, request, firstModel.provider_id, firstModel.model_id, {
        onChunk: chunk => {
          generated += chunk
        },
      })
      const nextYAML = stripMarkdownFence(generated).trim()
      const validated = validateWorkflowYAML(nextYAML, t)
      if (!validated.valid) {
        throw new Error(t('workflows.errors.invalidGeneratedYaml', { message: validated.message }))
      }
      setForm(current => ({ ...current, definition_yaml: nextYAML }))
    } catch (err) {
        setEditorError(
        err instanceof Error ? err.message : t('workflows.errors.generateYaml')
      )
    } finally {
      setGeneratingDraft(false)
    }
  }

  async function save() {
    setEditorError('')
    const validated = validateWorkflowYAML(form.definition_yaml, t)
    if (!validated.valid) {
      setEditorError(validated.message)
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        is_enabled: form.is_enabled,
        definition_yaml: form.definition_yaml,
      }
      if (selected) {
        await updateWorkflow(selected.id, payload)
      } else {
        await createWorkflow(payload)
      }
      setEditorOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflows.errors.saveWorkflow'))
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
      setError(err instanceof Error ? err.message : t('workflows.errors.deleteWorkflow'))
    }
  }

  async function launch(item: WorkflowDefinitionRecord) {
    setRunTarget(item)
    setRunParamsText('{}')
    setRunDialogOpen(true)
  }

  async function openRuns(item: WorkflowDefinitionRecord) {
    setRunsError('')
    setSelected(item)
    try {
      const nextRuns = await listWorkflowRuns(item.id)
      const nextSelectedRun = nextRuns[0] ?? null
      setRuns(nextRuns)
      setSelectedRun(nextSelectedRun)
      if (nextSelectedRun) {
        setNodeRuns(await listWorkflowNodeRuns(nextSelectedRun.id))
      } else {
        setNodeRuns([])
      }
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : t('workflows.errors.loadRuns'))
    }
    setRunsOpen(true)
  }

  async function selectRun(run: WorkflowRunRecord) {
    setRunsError('')
    try {
      const [nextRun, nextNodeRuns] = await Promise.all([
        getWorkflowRun(run.id),
        listWorkflowNodeRuns(run.id),
      ])
      setSelectedRun(nextRun)
      setNodeRuns(nextNodeRuns)
      setRuns(current => current.map(item => (item.id === nextRun.id ? nextRun : item)))
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : t('workflows.errors.loadRunDetail'))
    }
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
    setRunsError('')
    try {
      const updatedRun = await cancelWorkflowRun(selectedRun.id)
      setSelectedRun(updatedRun)
      setRuns(current => current.map(item => (item.id === updatedRun.id ? updatedRun : item)))
      await refreshSelectedRun(updatedRun.id)
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : t('workflows.errors.cancelRun'))
    }
  }

  async function toggleEnabled(item: WorkflowDefinitionRecord) {
    setError('')
    try {
      await updateWorkflow(item.id, {
        is_enabled: !item.is_enabled,
        definition_yaml: item.definition_yaml,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflows.errors.updateWorkflow'))
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
      setError(err instanceof Error ? err.message : t('workflows.errors.runWorkflow'))
    } finally {
      setRunningId('')
    }
  }

  async function refreshSelectedRun(runId = selectedRun?.id) {
    if (!runId) return
    setRefreshingRun(true)
    setRunsError('')
    try {
      const [nextRun, nextNodeRuns] = await Promise.all([
        getWorkflowRun(runId),
        listWorkflowNodeRuns(runId),
      ])
      setSelectedRun(nextRun)
      setNodeRuns(nextNodeRuns)
      setRuns(current => current.map(item => (item.id === nextRun.id ? nextRun : item)))
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : t('workflows.errors.refreshRunDetail'))
    } finally {
      setRefreshingRun(false)
    }
  }

  const yamlMetadata = useMemo(
    () => readWorkflowMetadata(form.definition_yaml),
    [form.definition_yaml]
  )
  const serverOptions = useMemo(
    () =>
      servers
        .filter(server => isEnabledServer(server.is_enabled))
        .map(server => ({
          id: String(server.id ?? '').trim(),
          name: String(server.name ?? '').trim() || String(server.id ?? '').trim(),
          host: String(server.host ?? '').trim(),
        }))
        .filter(server => server.id !== ''),
    [servers]
  )
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pagedItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('workflows.page.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('workflows.page.description')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('common:refresh')}
          </Button>
          <Button onClick={beginCreate}>{t('workflows.page.create')}</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card>
            <CardHeader>
              <CardTitle>{t('workflows.summary.total')}</CardTitle>
            </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.total}</CardContent>
        </Card>
        <Card>
            <CardHeader>
              <CardTitle>{t('workflows.summary.enabled')}</CardTitle>
            </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.enabled}</CardContent>
        </Card>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('workflows.table.name')}</TableHead>
                <TableHead>{t('workflows.table.status')}</TableHead>
                <TableHead>{t('workflows.table.targetServer')}</TableHead>
                <TableHead>{t('workflows.table.triggers')}</TableHead>
                <TableHead>{t('workflows.table.updated')}</TableHead>
                <TableHead className="text-right">{t('workflows.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t('workflows.table.loading')}
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t('workflows.table.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                pagedItems.map(item => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-medium text-left hover:underline"
                        onClick={() => {
                          setDetailItem(item)
                          setDetailOpen(true)
                        }}
                      >
                        {item.name}
                      </button>
                      {item.description ? (
                        <div className="text-xs text-muted-foreground">{item.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-1 text-sm',
                          item.is_enabled
                            ? 'text-green-600 hover:text-green-700'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        onClick={() => void toggleEnabled(item)}
                        title={
                          item.is_enabled
                            ? t('workflows.toggle.disable')
                            : t('workflows.toggle.enable')
                        }
                      >
                        {item.is_enabled ? (
                          <Power className="h-3.5 w-3.5" />
                        ) : (
                          <PowerOff className="h-3.5 w-3.5" />
                        )}
                        {item.is_enabled
                          ? t('workflows.toggle.enabled')
                          : t('workflows.toggle.disabled')}
                      </button>
                    </TableCell>
                    <TableCell>{serverLabel(item.default_server_id, servers, t)}</TableCell>
                    <TableCell>{formatTriggerTypes(item.trigger_types_json, t)}</TableCell>
                    <TableCell>{formatDate(item.updated, t)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={t('workflows.table.actions')}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => beginEdit(item)}>
                            {t('common:edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void openRuns(item)}>
                            {t('workflows.menu.runs')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void launch(item)}
                            disabled={runningId === item.id}
                          >
                            <Play className="h-4 w-4" />
                            {t('workflows.menu.run')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void toggleEnabled(item)}>
                            {item.is_enabled ? t('workflows.menu.disable') : t('workflows.menu.enable')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => void remove(item)}
                          >
                            {t('common:delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {items.length > PAGE_SIZE ? (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <Button
                variant="outline"
                size="icon"
                aria-label={t('common:previous')}
                disabled={page <= 1}
                onClick={() => setPage(current => Math.max(1, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {page}/{totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('common:next')}
                disabled={page >= totalPages}
                onClick={() => setPage(current => Math.min(totalPages, current + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {selected ? t('workflows.editor.editTitle') : t('workflows.editor.createTitle')}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {editorError ? <div className="text-sm text-destructive">{editorError}</div> : null}
            <label className="block text-sm font-medium">
              {t('workflows.editor.name')}
              <Input
                aria-label={t('workflows.editor.name')}
                value={yamlMetadata.name}
                onChange={e =>
                  setForm(current => ({
                    ...current,
                    definition_yaml: updateWorkflowYAMLMetadata(current.definition_yaml, {
                      name: e.target.value,
                    }),
                  }))
                }
              />
            </label>
            <label className="block text-sm font-medium">
              {t('workflows.editor.description')}
              <Input
                aria-label={t('workflows.editor.description')}
                value={yamlMetadata.description}
                onChange={e =>
                  setForm(current => ({
                    ...current,
                    definition_yaml: updateWorkflowYAMLMetadata(current.definition_yaml, {
                      description: e.target.value,
                    }),
                  }))
                }
              />
            </label>
            <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('workflows.editor.trigger')}</div>
                <Select
                  value={yamlMetadata.triggerType}
                  onValueChange={value => {
                    setEditorError('')
                    setForm(current => ({
                      ...current,
                      definition_yaml: updateWorkflowYAMLTrigger(current.definition_yaml, {
                        type: value === 'cron' ? 'cron' : 'manual',
                        schedule: yamlMetadata.cronSchedule,
                      }),
                    }))
                  }}
                >
                  <SelectTrigger aria-label={t('workflows.editor.triggerType')}>
                    <SelectValue placeholder={t('workflows.editor.selectTrigger')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">{t('workflows.editor.manual')}</SelectItem>
                    <SelectItem value="cron">{t('workflows.editor.cron')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {yamlMetadata.triggerType === 'cron' ? (
                <label className="block text-sm font-medium">
                  {t('workflows.editor.cronSchedule')}
                  <Input
                    aria-label={t('workflows.editor.cronSchedule')}
                    value={yamlMetadata.cronSchedule}
                    placeholder="0 6 * * *"
                    onChange={e =>
                      setForm(current => ({
                        ...current,
                        definition_yaml: updateWorkflowYAMLTrigger(current.definition_yaml, {
                          type: 'cron',
                          schedule: e.target.value,
                        }),
                      }))
                    }
                  />
                </label>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('workflows.editor.targetServer')}</div>
              <Select
                value={yamlMetadata.defaultServerId || unassignedServerValue}
                onValueChange={value => {
                  setEditorError('')
                  setForm(current => ({
                    ...current,
                    definition_yaml: updateWorkflowYAMLServer(
                      current.definition_yaml,
                      value === unassignedServerValue ? '' : value
                    ),
                  }))
                }}
              >
                  <SelectTrigger aria-label={t('workflows.editor.targetServer')}>
                    <SelectValue placeholder={t('workflows.editor.selectServer')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={unassignedServerValue}>
                      {t('workflows.editor.unassigned')}
                    </SelectItem>
                  {serverOptions.map(server => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name}
                      {server.host ? ` (${server.host})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('workflows.editor.targetServerHint')}
              </p>
            </div>
            <div className="space-y-3 rounded-lg border border-dashed p-4">
              <div>
                <div className="text-sm font-medium">{t('workflows.editor.draftTitle')}</div>
                <p className="text-xs text-muted-foreground">
                  {t('workflows.editor.draftDescription')}
                </p>
              </div>
              <Textarea
                aria-label={t('workflows.editor.draftRequest')}
                rows={4}
                value={aiDraftPrompt}
                placeholder={t('workflows.editor.draftPlaceholder')}
                onChange={e => setAIDraftPrompt(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="default"
                  onClick={() => void generateYAMLWithAICopilot()}
                  disabled={generatingDraft}
                >
                  <Sparkles className="h-4 w-4" />
                  {generatingDraft
                    ? t('workflows.editor.generatingYaml')
                    : t('workflows.editor.generateYaml')}
                </Button>
                <Button type="button" variant="outline" onClick={openAICopilotDraft}>
                  {t('workflows.editor.openInAICopilot')}
                </Button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                aria-label={t('workflows.editor.enabled')}
                type="checkbox"
                checked={form.is_enabled}
                onChange={e => setForm(current => ({ ...current, is_enabled: e.target.checked }))}
              />
              {t('workflows.editor.enabled')}
            </label>
            <label className="block text-sm font-medium">
              {t('workflows.editor.definitionYaml')}
              <Textarea
                aria-label={t('workflows.editor.definitionYaml')}
                rows={18}
                value={form.definition_yaml}
                onChange={e =>
                  setForm(current => ({ ...current, definition_yaml: e.target.value }))
                }
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditorOpen(false)}>
                {t('common:cancel')}
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? t('workflows.editor.saving') : t('common:save')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="overflow-y-auto p-6" style={getDrawerTierStyle('lg')}>
          <SheetTitle>{detailItem?.name || t('workflows.detail.titleFallback')}</SheetTitle>
          <SheetDescription>
            {t('workflows.detail.description')}
          </SheetDescription>
          {detailItem ? (
            <div className="mt-6 space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('workflows.detail.overview')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium">{t('workflows.detail.name')}:</span> {detailItem.name}
                    </div>
                    <div>
                      <span className="font-medium">{t('workflows.detail.descriptionLabel')}:</span>{' '}
                      {detailItem.description || t('workflows.values.none')}
                    </div>
                    <div>
                      <span className="font-medium">{t('workflows.detail.targetServer')}:</span>{' '}
                      {serverLabel(detailItem.default_server_id, servers, t)}
                    </div>
                    <div>
                      <span className="font-medium">{t('workflows.detail.triggers')}:</span>{' '}
                      {formatTriggerTypes(detailItem.trigger_types_json, t)}
                    </div>
                    <div>
                      <span className="font-medium">{t('workflows.detail.nodes')}:</span> {detailItem.node_count}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('workflows.detail.templates')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {workflowTemplates(t).map(template => (
                      <button
                        key={template.id}
                        type="button"
                        className="block w-full rounded-md border p-3 text-left hover:bg-muted/40"
                        onClick={() => {
                          setForm({ is_enabled: true, definition_yaml: template.yaml })
                          setEditorError('')
                          setEditorOpen(true)
                        }}
                      >
                        <div className="font-medium">{template.name}</div>
                        <div className="text-xs text-muted-foreground">{template.description}</div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t('workflows.detail.nodeReference')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {workflowNodeExamples(t).map(example => (
                    <div key={example.type} className="rounded-md border p-3">
                      <div className="font-medium">{example.type}</div>
                      <div className="mb-2 text-xs text-muted-foreground">
                        {example.description}
                      </div>
                      <pre className="overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
                        {example.yaml}
                      </pre>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={runsOpen} onOpenChange={setRunsOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-5xl">
          <SheetHeader>
            <SheetTitle>
              {selected
                ? t('workflows.runs.titleWithName', { name: selected.name })
                : t('workflows.runs.title')}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{t('workflows.runs.listTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {runsError ? <div className="text-sm text-destructive">{runsError}</div> : null}
                {runs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('workflows.runs.empty')}</div>
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
                        <RunStatusBadge status={run.status} t={t} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDate(run.created, t)}
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>{t('workflows.runs.detailTitle')}</CardTitle>
                <div className="flex gap-2">
                  {selectedRun ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshSelectedRun()}
                      disabled={refreshingRun}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {refreshingRun ? t('workflows.runs.refreshing') : t('common:refresh')}
                    </Button>
                  ) : null}
                  {selectedRun && !isTerminalStatus(selectedRun.status) ? (
                    <Button variant="outline" size="sm" onClick={() => void cancelRun()}>
                      {t('workflows.runs.cancelRun')}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {selectedRun ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t('workflows.runs.status')}
                        </div>
                        <div className="mt-1">
                          <RunStatusBadge status={selectedRun.status} t={t} />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t('workflows.runs.trigger')}
                        </div>
                        <div className="mt-1 text-sm">{selectedRun.trigger_type}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t('workflows.runs.requester')}
                        </div>
                        <div className="mt-1 text-sm">
                            {selectedRun.requested_by_email ||
                              selectedRun.requested_by ||
                              t('workflows.values.none')}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {t('workflows.runs.targetServer')}
                          </div>
                          <div className="mt-1 text-sm">
                            {serverLabel(selectedRun.resolved_server_id, servers, t)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {t('workflows.runs.started')}
                          </div>
                          <div className="mt-1 text-sm">
                            {formatDate(selectedRun.started_at || selectedRun.created, t)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {t('workflows.runs.ended')}
                          </div>
                          <div className="mt-1 text-sm">{formatDate(selectedRun.ended_at, t)}</div>
                        </div>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('workflows.runs.node')}</TableHead>
                            <TableHead>{t('workflows.runs.type')}</TableHead>
                            <TableHead>{t('workflows.runs.status')}</TableHead>
                            <TableHead>{t('workflows.runs.output')}</TableHead>
                            <TableHead className="text-right">{t('workflows.runs.actions')}</TableHead>
                          </TableRow>
                        </TableHeader>
                      <TableBody>
                        {nodeRuns.map(node => (
                          <TableRow key={node.id}>
                            <TableCell>{node.display_name}</TableCell>
                            <TableCell>{node.node_type}</TableCell>
                            <TableCell>
                                <RunStatusBadge status={node.status} t={t} />
                            </TableCell>
                            <TableCell>
                                <pre className="max-w-[420px] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
                                  {node.execution_log ||
                                    node.output_json ||
                                    node.error_message ||
                                    t('workflows.values.none')}
                                </pre>
                              </TableCell>
                              <TableCell className="text-right">
                                {node.status === 'manual_gate' ? (
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" onClick={() => void decideNode(node, true)}>
                                      {t('workflows.runs.approve')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => void decideNode(node, false)}
                                    >
                                      {t('workflows.runs.reject')}
                                    </Button>
                                  </div>
                                ) : (
                                  t('workflows.values.none')
                                )}
                              </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {t('workflows.runs.selectRun')}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workflows.runDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('workflows.runDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm font-medium">
            {t('workflows.runDialog.parameters')}
            <Textarea
              aria-label={t('workflows.runDialog.parameters')}
              rows={10}
              value={runParamsText}
              onChange={e => setRunParamsText(e.target.value)}
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunDialogOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button
              onClick={() => void confirmRun()}
              disabled={!runTarget || runningId === runTarget.id}
            >
              {t('workflows.runDialog.runNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function defaultWorkflowYAML(t: (key: string) => string) {
  return `name: ${t('workflows.editor.defaults.name')}
description: ${t('workflows.editor.defaults.description')}
triggers:
  - type: manual
nodes:
  - key: step_1
    type: shell
    config:
      command: hostname
`
}

function workflowTemplates(t: (key: string) => string): Array<{ id: string; name: string; description: string; yaml: string }> {
  return [
    {
      id: 'server-health-check',
      name: t('workflows.editor.templates.serverHealthCheck.name'),
      description: t('workflows.editor.templates.serverHealthCheck.description'),
      yaml: `name: Server Health Check
description: Check server disk usage and notify an endpoint
default_server_id: srv-1
triggers:
  - type: manual
nodes:
  - key: disk_usage
    type: shell
    config:
      command: df -h
  - key: notify
    type: http
    depends_on:
      - disk_usage
    config:
      method: POST
      url: https://example.com/webhook
      body: '{"report":"{{ index .outputs "disk_usage" "stdout" }}"}'
`,
    },
    {
      id: 'manual-approval',
      name: t('workflows.editor.templates.manualApproval.name'),
      description: t('workflows.editor.templates.manualApproval.description'),
      yaml: `name: Manual Approval Workflow
description: Gather facts, wait for approval, then continue
default_server_id: srv-1
triggers:
  - type: manual
nodes:
  - key: inspect
    type: shell
    config:
      command: uname -a
  - key: approve
    type: manual_gate
    depends_on:
      - inspect
  - key: follow_up
    type: http
    depends_on:
      - approve
    config:
      method: POST
      url: https://example.com/webhook
`,
    },
  ]
}

function workflowNodeExamples(t: (key: string) => string): Array<{ type: string; description: string; yaml: string }> {
  return [
    {
      type: 'shell',
      description: t('workflows.editor.nodeExamples.shell'),
      yaml: `- key: collect_logs
  type: shell
  config:
    command: journalctl -p err --since '1 hour ago' --no-pager | tail -50`,
    },
    {
      type: 'http',
      description: t('workflows.editor.nodeExamples.http'),
      yaml: `- key: notify
  type: http
  config:
    method: POST
    url: https://example.com/webhook
    body: '{"message":"done"}'`,
    },
    {
      type: 'manual_gate',
      description: t('workflows.editor.nodeExamples.manualGate'),
      yaml: `- key: approve_release
  type: manual_gate`,
    },
    {
      type: 'docker',
      description: t('workflows.editor.nodeExamples.docker'),
      yaml: `- key: run_tooling
  type: docker
  config:
    image: alpine:latest
    command: echo hello`,
    },
  ]
}

const unassignedServerValue = '__none__'

function validateWorkflowYAML(
  value: string,
  t: (key: string, values?: Record<string, unknown>) => string
): { valid: true } | { valid: false; message: string } {
  try {
    const parsed = jsYaml.load(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, message: t('workflows.errors.yamlObject') }
    }
    const record = parsed as Record<string, unknown>
    const name = String(record.name ?? '').trim()
    if (!name) {
      return { valid: false, message: t('workflows.errors.yamlNameRequired') }
    }
    if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
      return { valid: false, message: t('workflows.errors.yamlNodeRequired') }
    }
    return { valid: true }
  } catch (error) {
    if (error instanceof jsYaml.YAMLException) {
        if (error.mark?.line !== undefined) {
          return {
            valid: false,
            message: t('workflows.errors.yamlLine', {
              reason: error.reason || error.message,
              line: error.mark.line + 1,
            }),
          }
        }
        return { valid: false, message: error.reason || error.message }
      }
      return { valid: false, message: t('workflows.errors.invalidYaml') }
  }
}

function readWorkflowMetadata(value: string): {
  name: string
  description: string
  defaultServerId: string
  triggerType: 'manual' | 'cron'
  cronSchedule: string
} {
  try {
    const parsed = jsYaml.load(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        name: '',
        description: '',
        defaultServerId: '',
        triggerType: 'manual' as 'manual' | 'cron',
        cronSchedule: '',
      }
    }
    const record = parsed as Record<string, unknown>
    const firstTrigger = Array.isArray(record.triggers) ? record.triggers[0] : null
    const triggerRecord =
      firstTrigger && typeof firstTrigger === 'object' && !Array.isArray(firstTrigger)
        ? (firstTrigger as Record<string, unknown>)
        : null
    const triggerType = String(triggerRecord?.type ?? '').trim() === 'cron' ? 'cron' : 'manual'
    return {
      name: String(record.name ?? '').trim(),
      description: String(record.description ?? '').trim(),
      defaultServerId: String(record.default_server_id ?? '').trim(),
      triggerType,
      cronSchedule: triggerType === 'cron' ? String(triggerRecord?.schedule ?? '').trim() : '',
    }
  } catch {
    return {
      name: '',
      description: '',
      defaultServerId: '',
      triggerType: 'manual' as 'manual' | 'cron',
      cronSchedule: '',
    }
  }
}

function updateWorkflowYAMLMetadata(
  value: string,
  updates: { name?: string; description?: string }
) {
  let parsed: Record<string, unknown>
  try {
    const loaded = jsYaml.load(value)
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      return value
    }
    parsed = { ...(loaded as Record<string, unknown>) }
  } catch {
    return value
  }
  if (updates.name !== undefined) {
    parsed.name = updates.name
  }
  if (updates.description !== undefined) {
    parsed.description = updates.description
  }
  return jsYaml.dump(parsed, { lineWidth: -1 }).trimEnd()
}

function updateWorkflowYAMLTrigger(
  value: string,
  updates: { type: 'manual' | 'cron'; schedule?: string }
) {
  let parsed: Record<string, unknown>
  try {
    const loaded = jsYaml.load(value)
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      return value
    }
    parsed = { ...(loaded as Record<string, unknown>) }
  } catch {
    return value
  }
  parsed.triggers =
    updates.type === 'cron'
      ? [{ type: 'cron', schedule: updates.schedule?.trim() || '' }]
      : [{ type: 'manual' }]
  return jsYaml.dump(parsed, { lineWidth: -1 }).trimEnd()
}

function updateWorkflowYAMLServer(value: string, serverId: string) {
  let parsed: Record<string, unknown>
  try {
    const loaded = jsYaml.load(value)
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      return value
    }
    parsed = { ...(loaded as Record<string, unknown>) }
  } catch {
    return value
  }
  if (serverId.trim()) {
    parsed.default_server_id = serverId.trim()
  } else {
    delete parsed.default_server_id
  }
  return jsYaml.dump(parsed, { lineWidth: -1 }).trimEnd()
}

function buildWorkflowDraftPrompt(input: {
  request: string
  triggerType: 'manual' | 'cron'
  cronSchedule: string
  defaultServerId: string
  currentYAML: string
}) {
  const request = input.request.trim() || 'Create a useful AppOS workflow YAML definition.'
  const triggerSummary =
    input.triggerType === 'cron'
      ? `cron trigger with schedule ${input.cronSchedule || 'MISSING_SCHEDULE'}`
      : 'manual trigger'
  const serverSummary = input.defaultServerId.trim() || 'no default_server_id selected yet'
  return `You are drafting an AppOS workflow YAML document.

Return YAML only. Do not wrap the answer in markdown fences. Do not add explanation outside YAML.

Rules:
- Keep the workflow compatible with AppOS Workflow MVP.
- Supported trigger types: manual, cron.
- Supported node types: shell, http, llm, agent, docker, smtp, condition, manual_gate, subworkflow.
- If you use shell or docker nodes, include default_server_id.
- Prefer concise node keys and explicit names.

Current editor context:
- Trigger preference: ${triggerSummary}
- Selected default server: ${serverSummary}

Operator request:
${request}

Current YAML to improve or replace:
${input.currentYAML}`
}

function stripMarkdownFence(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }
  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
}

function serverLabel(
  serverId: string | null | undefined,
  servers: ServerOptionRecord[],
  t: (key: string) => string
) {
  const normalized = String(serverId ?? '').trim()
  if (!normalized) return t('workflows.values.none')
  const match = servers.find(server => String(server.id ?? '').trim() === normalized)
  if (!match) return normalized
  const name = String(match.name ?? '').trim()
  return name || normalized
}

function isEnabledServer(value: ServerOptionRecord['is_enabled']) {
  if (value == null) return true
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return !['0', 'false', 'no', 'off', 'disabled'].includes(String(value).trim().toLowerCase())
}

function isTerminalStatus(status: string) {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

function formatDate(value: string | null | undefined, t: (key: string) => string) {
  if (!value) return t('workflows.values.none')
  return new Date(value).toLocaleString()
}

function formatTriggerTypes(raw: string, t: (key: string) => string) {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.join(', ') : raw || t('workflows.values.none')
  } catch {
    return raw || t('workflows.values.none')
  }
}

function RunStatusBadge({
  status,
  t,
}: {
  status: string
  t: (key: string) => string
}) {
  if (status === 'succeeded') {
    return (
      <Badge className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {t('workflows.statuses.succeeded')}
      </Badge>
    )
  }
  if (status === 'failed' || status === 'cancelled') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {t(`workflows.statuses.${status}`)}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" />
      {t(`workflows.statuses.${status}`) !== `workflows.statuses.${status}`
        ? t(`workflows.statuses.${status}`)
        : status}
    </Badge>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/workflows' as never)({
  component: WorkflowsPage,
})
