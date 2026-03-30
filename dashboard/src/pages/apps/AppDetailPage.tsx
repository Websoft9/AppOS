import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowUp, ExternalLink, Loader2, Play, RefreshCw, RotateCcw, Save, ShieldCheck, Square, Trash2 } from 'lucide-react'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  type AppConfigResponse,
  type AppExposure,
  type AppInstance,
  type AppLogsResponse,
  type AppOperationResponse,
  type AppRelease,
  buildUnifiedDiff,
  formatTime,
  formatUptime,
  runtimeVariant,
} from '@/pages/apps/types'

type ValidationState = {
  valid: boolean
  message: string
  validatedContent: string
} | null

type AppAction = 'start' | 'stop' | 'restart' | 'uninstall'

export function AppDetailPage({ appId }: { appId: string }) {
  const navigate = useNavigate()
  const [app, setApp] = useState<AppInstance | null>(null)
  const [releases, setReleases] = useState<AppRelease[]>([])
  const [exposures, setExposures] = useState<AppExposure[]>([])
  const [logs, setLogs] = useState<AppLogsResponse | null>(null)
  const [configText, setConfigText] = useState('')
  const [originalConfig, setOriginalConfig] = useState('')
  const [validation, setValidation] = useState<ValidationState>(null)
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(false)
  const [configLoading, setConfigLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [deploying, setDeploying] = useState<'redeploy' | 'upgrade' | ''>('')
  const [actionLoading, setActionLoading] = useState('')
  const [pendingUninstall, setPendingUninstall] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [rollbackMeta, setRollbackMeta] = useState<{ available: boolean; savedAt?: string; sourceAction?: string }>({ available: false })
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  const fetchDetail = useCallback(async () => {
    try {
      const response = await pb.send<AppInstance>(`/api/apps/${appId}`, { method: 'GET' })
      setApp(response)
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load app detail'))
    } finally {
      setLoading(false)
    }
  }, [appId])

  const fetchLifecycleResources = useCallback(async () => {
    try {
      const [releaseResponse, exposureResponse] = await Promise.all([
        pb.send<AppRelease[]>(`/api/apps/${appId}/releases`, { method: 'GET' }),
        pb.send<AppExposure[]>(`/api/apps/${appId}/exposures`, { method: 'GET' }),
      ])
      setReleases(Array.isArray(releaseResponse) ? releaseResponse : [])
      setExposures(Array.isArray(exposureResponse) ? exposureResponse : [])
    } catch {
      setReleases([])
      setExposures([])
    }
  }, [appId])

  const fetchLogs = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLogsLoading(true)
    try {
      const response = await pb.send<AppLogsResponse>(`/api/apps/${appId}/logs`, { method: 'GET' })
      setLogs(response)
    } catch (err) {
      setLogs({
        id: appId,
        name: app?.name || appId,
        server_id: app?.server_id || 'local',
        project_dir: app?.project_dir || '-',
        runtime_status: 'error',
        output: getApiErrorMessage(err, 'Failed to load app logs'),
      })
    } finally {
      if (showSpinner) setLogsLoading(false)
    }
  }, [app, appId])

  const fetchConfig = useCallback(async (force = false) => {
    if (!force && originalConfig) return
    setConfigLoading(true)
    try {
      const response = await pb.send<AppConfigResponse>(`/api/apps/${appId}/config`, { method: 'GET' })
      setConfigText(response.content || '')
      setOriginalConfig(response.content || '')
      setValidation(null)
      setRollbackMeta({
        available: Boolean(response.rollback_available),
        savedAt: response.rollback_saved_at,
        sourceAction: response.rollback_source_action,
      })
      setApp(current => (current ? { ...current, iac_path: response.iac_path || current.iac_path } : current))
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load compose config'))
    } finally {
      setConfigLoading(false)
    }
  }, [appId, originalConfig])

  useEffect(() => {
    void fetchDetail()
    void fetchLifecycleResources()
  }, [fetchDetail, fetchLifecycleResources])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchDetail()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [fetchDetail])

  useEffect(() => {
    if (tab === 'logs') {
      void fetchLogs()
      const timer = window.setInterval(() => {
        void fetchLogs()
      }, 5000)
      return () => window.clearInterval(timer)
    }
    if (tab === 'config' || tab === 'diff') {
      void fetchConfig()
    }
    return undefined
  }, [fetchConfig, fetchLogs, tab])

  useEffect(() => {
    if (!logViewportRef.current || !stickToBottomRef.current) return
    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
  }, [logs?.output])

  const validateDraft = useCallback(async () => {
    setValidating(true)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<{ valid: boolean; message: string; iac_path?: string }>(`/api/apps/${appId}/config/validate`, {
        method: 'POST',
        body: { content: configText },
      })
      setValidation({ valid: Boolean(response.valid), message: response.message, validatedContent: configText })
      if (response.iac_path) setApp(current => (current ? { ...current, iac_path: response.iac_path } : current))
      if (response.valid) setSuccess('Compose draft validated successfully')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to validate compose config'))
    } finally {
      setValidating(false)
    }
  }, [appId, configText])

  const saveConfig = useCallback(async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<AppConfigResponse & { message: string }>(`/api/apps/${appId}/config`, {
        method: 'PUT',
        body: { content: configText },
      })
      setOriginalConfig(configText)
      setValidation({ valid: true, message: 'compose config is valid', validatedContent: configText })
      setRollbackMeta({
        available: Boolean(response.rollback_available),
        savedAt: response.rollback_saved_at,
        sourceAction: response.rollback_source_action,
      })
      if (response.iac_path) setApp(current => (current ? { ...current, iac_path: response.iac_path } : current))
      setSuccess(response.message || 'Compose config saved')
      await fetchDetail()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to save compose config'))
    } finally {
      setSaving(false)
    }
  }, [appId, configText, fetchDetail])

  const rollbackConfig = useCallback(async () => {
    setRollingBack(true)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<AppConfigResponse & { message?: string }>(`/api/apps/${appId}/config/rollback`, {
        method: 'POST',
        body: {},
      })
      setConfigText(response.content || '')
      setOriginalConfig(response.content || '')
      setValidation({ valid: true, message: 'rollback restored', validatedContent: response.content || '' })
      setRollbackMeta({
        available: Boolean(response.rollback_available),
        savedAt: response.rollback_saved_at,
        sourceAction: response.rollback_source_action,
      })
      if (response.iac_path) setApp(current => (current ? { ...current, iac_path: response.iac_path || current.iac_path } : current))
      setSuccess(response.message || 'Rollback restored')
      await fetchDetail()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to restore rollback point'))
    } finally {
      setRollingBack(false)
    }
  }, [appId, fetchDetail])

  const navigateToActionDetail = useCallback((actionId: string) => {
    void navigate({
      to: '/actions/$actionId' as never,
      params: { actionId } as never,
      search: { returnTo: 'list' } as never,
    })
  }, [navigate])

  const runAction = useCallback(async (action: AppAction) => {
    setActionLoading(action)
    setError('')
    setSuccess('')
    try {
      const response = action === 'uninstall'
        ? await pb.send<AppOperationResponse>(`/api/apps/${appId}`, { method: 'DELETE' })
        : await pb.send<AppOperationResponse>(`/api/apps/${appId}/${action}`, { method: 'POST' })
      if (response?.id) {
        navigateToActionDetail(response.id)
        return
      }
      setSuccess(`${app?.name || 'App'} ${action} operation created`)
      await fetchDetail()
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to ${action} app`))
    } finally {
      setActionLoading('')
    }
  }, [app?.name, appId, fetchDetail, navigateToActionDetail])

  const triggerOperation = useCallback(async (action: 'redeploy' | 'upgrade') => {
    if (!app) return
    setDeploying(action)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<{ id: string }>(`/api/apps/${app.id}/${action}`, {
        method: 'POST',
      })
      setSuccess(`${app.name} ${action} operation created`)
      await fetchDetail()
      navigateToActionDetail(response.id)
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to ${action} app`))
    } finally {
      setDeploying('')
    }
  }, [app, fetchDetail, navigateToActionDetail])

  const openOperationStatus = useCallback(() => {
    if (!app?.last_operation) return
    navigateToActionDetail(app.last_operation)
  }, [app, navigateToActionDetail])

  const hasConfigChanges = configText !== originalConfig
  const saveDisabled = !hasConfigChanges || !validation?.valid || validation.validatedContent !== configText || saving
  const diffText = useMemo(() => buildUnifiedDiff(originalConfig, configText), [configText, originalConfig])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" className="w-fit px-0 text-muted-foreground" asChild>
            <Link to="/apps">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Installed
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{app?.name || 'App Detail'}</h1>
            <p className="text-sm text-muted-foreground">This is a dedicated multi-tab page for runtime, config validation, diff preview, logs, and IaC editing handoff.</p>
          </div>
          {app ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={runtimeVariant(app.runtime_status)}>{app.runtime_status}</Badge>
              <Badge variant="outline">{app.status}</Badge>
              <span className="text-sm text-muted-foreground">Uptime {formatUptime(app)}</span>
              <span className="text-sm text-muted-foreground">Server {app.server_id || 'local'}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void fetchDetail()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          {app?.last_operation ? <Button variant="outline" onClick={openOperationStatus} disabled={loading}><ExternalLink className="mr-2 h-4 w-4" />Execution Status</Button> : null}
          <Button variant="outline" onClick={() => void triggerOperation('redeploy')} disabled={loading || deploying !== ''}><RotateCcw className="mr-2 h-4 w-4" />{deploying === 'redeploy' ? 'Redeploying...' : 'Redeploy'}</Button>
          <Button variant="outline" onClick={() => void triggerOperation('upgrade')} disabled={loading || deploying !== ''}><ArrowUp className="mr-2 h-4 w-4" />{deploying === 'upgrade' ? 'Upgrading...' : 'Upgrade'}</Button>
          <Button variant="outline" onClick={() => void runAction('start')} disabled={actionLoading !== '' || loading}><Play className="mr-2 h-4 w-4" />{actionLoading === 'start' ? 'Starting...' : 'Start'}</Button>
          <Button variant="outline" onClick={() => void runAction('stop')} disabled={actionLoading !== '' || loading}><Square className="mr-2 h-4 w-4" />{actionLoading === 'stop' ? 'Stopping...' : 'Stop'}</Button>
          <Button variant="outline" onClick={() => void runAction('restart')} disabled={actionLoading !== '' || loading}><RotateCcw className="mr-2 h-4 w-4" />{actionLoading === 'restart' ? 'Restarting...' : 'Restart'}</Button>
          <Button variant="destructive" onClick={() => setPendingUninstall(true)} disabled={actionLoading !== '' || loading}><Trash2 className="mr-2 h-4 w-4" />Uninstall</Button>
        </div>
      </div>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {success ? <Alert><AlertDescription>{success}</AlertDescription></Alert> : null}

      {loading ? (
        <div className="rounded-xl border p-6 text-sm text-muted-foreground">Loading app detail...</div>
      ) : app ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="config">Compose Config</TabsTrigger>
            <TabsTrigger value="diff">Diff Preview</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card><CardHeader><CardTitle className="text-sm">Created</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{formatTime(app.created)}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">Updated</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{formatTime(app.updated)}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">Installed</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{formatTime(app.installed_at)}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">Current Execution</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{app.current_pipeline?.family || '-' } {app.current_pipeline?.current_phase ? `· ${app.current_pipeline.current_phase}` : ''}</CardContent></Card>
            </div>
            <Card className="mt-4">
              <CardHeader><CardTitle className="text-sm">Lifecycle Metadata</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <div><span className="text-muted-foreground">App ID:</span> <span className="font-mono text-xs">{app.id}</span></div>
                <div>
                  <span className="text-muted-foreground">Last Action:</span>{' '}
                  {app.last_operation ? (
                    <button type="button" className="font-mono text-xs text-primary underline-offset-4 hover:underline" onClick={openOperationStatus}>
                      {app.last_operation}
                    </button>
                  ) : (
                    <span className="font-mono text-xs">-</span>
                  )}
                </div>
                <div><span className="text-muted-foreground">Source:</span> {app.source || app.current_pipeline?.selector?.source || '-'}</div>
                <div><span className="text-muted-foreground">Project Dir:</span> <span className="break-all">{app.project_dir}</span></div>
                <div><span className="text-muted-foreground">Lifecycle State:</span> {app.lifecycle_state || '-'}</div>
                <div><span className="text-muted-foreground">Publication Summary:</span> {app.publication_summary || '-'}</div>
                <div><span className="text-muted-foreground">Release Count:</span> {releases.length}</div>
                <div><span className="text-muted-foreground">Exposure Count:</span> {exposures.length}</div>
                <div><span className="text-muted-foreground">Current Release:</span> {releases.find(item => item.is_active)?.version_label || '-'}</div>
                <div><span className="text-muted-foreground">Primary Exposure:</span> {exposures.find(item => item.is_primary)?.domain || exposures.find(item => item.is_primary)?.path || '-'}</div>
                <div className="md:col-span-2"><span className="text-muted-foreground">IaC Path:</span> <span className="font-mono text-xs">{app.iac_path || '-'}</span></div>
                {app.runtime_reason ? <div className="md:col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{app.runtime_reason}</div> : null}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="config" className="mt-4">
            <Card>
              <CardHeader><CardTitle>Compose Config</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void fetchConfig(true)} disabled={configLoading}>{configLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Reload</Button>
                  <Button variant="outline" onClick={() => void validateDraft()} disabled={validating || !configText.trim()}>{validating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Validate Draft</Button>
                  <Button variant="outline" onClick={() => void rollbackConfig()} disabled={rollingBack || !rollbackMeta.available}>{rollingBack ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Rollback</Button>
                  {app.iac_path ? <Button variant="outline" asChild><Link to="/iac" search={{ path: app.iac_path, root: 'apps' }}><ExternalLink className="mr-2 h-4 w-4" />Open in IaC</Link></Button> : null}
                  <Button onClick={() => void saveConfig()} disabled={saveDisabled}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button>
                </div>
                {rollbackMeta.available ? <p className="text-xs text-muted-foreground">Rollback point available{rollbackMeta.savedAt ? ` from ${formatTime(rollbackMeta.savedAt)}` : ''}{rollbackMeta.sourceAction ? ` via ${rollbackMeta.sourceAction}` : ''}.</p> : null}
                {validation ? <Alert variant={validation.valid ? 'default' : 'destructive'}><AlertDescription>{validation.message}</AlertDescription></Alert> : <Alert><AlertDescription>Validate the current draft before saving. Save remains disabled until the current content passes validation.</AlertDescription></Alert>}
                <Textarea className="min-h-[520px] font-mono text-xs" value={configText} onChange={event => setConfigText(event.target.value)} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="diff" className="mt-4">
            <Card><CardHeader><CardTitle>Diff Preview</CardTitle></CardHeader><CardContent><pre className="max-h-[620px] overflow-auto rounded-xl border bg-muted/20 p-4 font-mono text-xs leading-6">{diffText}</pre></CardContent></Card>
          </TabsContent>
          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle>Compose Logs</CardTitle><Button variant="outline" onClick={() => void fetchLogs(true)} disabled={logsLoading}>{logsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button></CardHeader>
              <CardContent>
                <div ref={logViewportRef} className="h-[620px] overflow-auto rounded-xl bg-black px-4 py-3 font-mono text-[11px] leading-5 text-slate-100" onScroll={event => {
                  const target = event.currentTarget
                  stickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 32
                }}>
                  <pre className={cn('whitespace-pre-wrap break-words', !logs?.output && 'text-slate-500')}>{logs?.output || 'No logs yet.'}</pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : null}

      <AlertDialog open={pendingUninstall} onOpenChange={setPendingUninstall}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall App</AlertDialogTitle>
            <AlertDialogDescription>{app ? `Uninstall ${app.name}? This creates a shared uninstall operation and moves execution tracking to the canonical action detail view.` : 'This action cannot be undone.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void runAction('uninstall')}>Confirm Uninstall</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}