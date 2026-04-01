import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUp, MoreVertical, Play, RotateCcw, Square, Trash2 } from 'lucide-react'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { copyToClipboard } from '@/lib/clipboard'
import { iacRead, iacSaveFile } from '@/lib/iac-api'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { ActionRecord } from '@/pages/deploy/actions/action-types'
import { AppDetailHeader } from '@/pages/apps/AppDetailHeader'
import { AppDetailTabRail } from '@/pages/apps/AppDetailTabRail'
import {
  AppDetailAccessTab,
  AppDetailActionsTab,
  AppDetailAutomationTab,
  AppDetailComposeTab,
  AppDetailDataTab,
  AppDetailObservabilityTab,
  AppDetailOverviewTab,
  AppDetailRuntimeTab,
  AppDetailSettingsTab,
} from '@/pages/apps/AppDetailTabPanels'
import {
  type BackupProjection,
  type DockerVolume,
  getActionLabel,
  hasAccessHints,
  isPocketBaseAutoCancelled,
  normalizeMatchValue,
  parentDir,
  parseBackupProjection,
  parseCpuPercent,
  parseDockerInspect,
  parseDockerJsonLines,
  parseMemoryUsageBytes,
  parseReleaseAttribution,
  parseResourceList,
  type ResourceDatabase,
  type RuntimeContainer,
  type RuntimeContainerMount,
  type RuntimeContainerStats,
  stringField,
} from '@/pages/apps/app-detail-utils'
import {
  type AppConfigResponse,
  type AppExposure,
  type AppInstance,
  type AppLogsResponse,
  type AppOperationResponse,
  type AppRelease,
  buildUnifiedDiff,
} from '@/pages/apps/types'

type ValidationState = {
  valid: boolean
  message: string
  validatedContent: string
} | null

type AppAction = 'start' | 'stop' | 'restart' | 'uninstall'

type AppDisplayMetadata = {
  icon: string
  label: string
  tags: string[]
}

const DISPLAY_METADATA_STORAGE_PREFIX = 'app-detail-display:'

function normalizeDisplayTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map(tag => tag.trim()).filter(Boolean)))
}

function serializeDisplayTags(tags: string[]): string {
  return tags.join(', ')
}

function loadDisplayMetadata(appId: string): AppDisplayMetadata {
  if (typeof window === 'undefined') return { icon: '', label: '', tags: [] }
  try {
    const raw = window.localStorage.getItem(`${DISPLAY_METADATA_STORAGE_PREFIX}${appId}`)
    if (!raw) return { icon: '', label: '', tags: [] }
    const parsed = JSON.parse(raw) as Partial<AppDisplayMetadata>
    return {
      icon: typeof parsed.icon === 'string' ? parsed.icon : '',
      label: typeof parsed.label === 'string' ? parsed.label : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean) : [],
    }
  } catch {
    return { icon: '', label: '', tags: [] }
  }
}

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
  const [refreshing, setRefreshing] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [configLoading, setConfigLoading] = useState(false)
  const [envFileLoading, setEnvFileLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [envFileSaving, setEnvFileSaving] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [deploying, setDeploying] = useState<'redeploy' | 'upgrade' | ''>('')
  const [actionLoading, setActionLoading] = useState('')
  const [pendingUninstall, setPendingUninstall] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [envFileError, setEnvFileError] = useState('')
  const [rollbackMeta, setRollbackMeta] = useState<{ available: boolean; savedAt?: string; sourceAction?: string }>({ available: false })
  const [serverHost, setServerHost] = useState('')
  const [serverName, setServerName] = useState('')
  const [accessUsernameDraft, setAccessUsernameDraft] = useState('')
  const [accessSecretHintDraft, setAccessSecretHintDraft] = useState('')
  const [accessRetrievalMethodDraft, setAccessRetrievalMethodDraft] = useState('')
  const [accessNotesDraft, setAccessNotesDraft] = useState('')
  const [editingAccess, setEditingAccess] = useState(false)
  const [accessSaving, setAccessSaving] = useState(false)
  const [actionHistory, setActionHistory] = useState<ActionRecord[]>([])
  const [actionsLoading, setActionsLoading] = useState(false)
  const [actionsLoaded, setActionsLoaded] = useState(false)
  const [actionSearch, setActionSearch] = useState('')
  const [actionStatusFilter, setActionStatusFilter] = useState('all')
  const [actionTypeFilter, setActionTypeFilter] = useState('all')
  const [displayIconDraft, setDisplayIconDraft] = useState('')
  const [displayLabelDraft, setDisplayLabelDraft] = useState('')
  const [displayTagsDraft, setDisplayTagsDraft] = useState('')
  const [savedDisplayMetadata, setSavedDisplayMetadata] = useState<AppDisplayMetadata>({ icon: '', label: '', tags: [] })
  const [displaySaving, setDisplaySaving] = useState(false)
  const [runtimeContainers, setRuntimeContainers] = useState<RuntimeContainer[]>([])
  const [runtimeStats, setRuntimeStats] = useState<Record<string, RuntimeContainerStats>>({})
  const [runtimeInspectMap, setRuntimeInspectMap] = useState<Record<string, Record<string, unknown>>>({})
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [runtimeLoaded, setRuntimeLoaded] = useState(false)
  const [databaseResources, setDatabaseResources] = useState<ResourceDatabase[]>([])
  const [dataVolumes, setDataVolumes] = useState<DockerVolume[]>([])
  const [backupProjection, setBackupProjection] = useState<BackupProjection>({
    status: 'not-implemented',
    items: [],
    message: 'Platform backup inventory is not connected yet.',
  })
  const [dataLoading, setDataLoading] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [dataError, setDataError] = useState('')
  const [runtimeLogsTarget, setRuntimeLogsTarget] = useState<RuntimeContainer | null>(null)
  const [runtimeLogsContent, setRuntimeLogsContent] = useState('')
  const [runtimeLogsLoading, setRuntimeLogsLoading] = useState(false)
  const [selectedRelease, setSelectedRelease] = useState<AppRelease | null>(null)
  const [releaseCopyState, setReleaseCopyState] = useState<'idle' | 'artifact-copied' | 'source-copied' | 'failed'>('idle')
  const [envFileText, setEnvFileText] = useState('')
  const [originalEnvFileText, setOriginalEnvFileText] = useState('')
  const [envFileLoaded, setEnvFileLoaded] = useState(false)
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const selectedReleaseAttribution = useMemo(() => parseReleaseAttribution(selectedRelease?.notes), [selectedRelease?.notes])

  const syncAccessDrafts = useCallback((detail: AppInstance | null) => {
    setAccessUsernameDraft(detail?.access_username || '')
    setAccessSecretHintDraft(detail?.access_secret_hint || '')
    setAccessRetrievalMethodDraft(detail?.access_retrieval_method || '')
    setAccessNotesDraft(detail?.access_notes || '')
  }, [])

  const fetchDetail = useCallback(async () => {
    try {
      const response = await pb.send<AppInstance>(`/api/apps/${appId}`, { method: 'GET' })
      setApp(response)
      if (!editingAccess) {
        syncAccessDrafts(response)
      }
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load app detail'))
    } finally {
      setLoading(false)
    }
  }, [appId, editingAccess, syncAccessDrafts])

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
      const response = await pb.send<AppConfigResponse>(`/api/apps/${appId}/config`, {
        method: 'GET',
        requestKey: null,
      })
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
      if (isPocketBaseAutoCancelled(err)) return
      setError(getApiErrorMessage(err, 'Failed to load compose config'))
    } finally {
      setConfigLoading(false)
    }
  }, [appId, originalConfig])

  const fetchActionHistory = useCallback(async () => {
    setActionsLoading(true)
    try {
      const response = await pb.send<ActionRecord[]>('/api/actions', { method: 'GET' })
      setActionHistory(Array.isArray(response) ? response : [])
      setActionsLoaded(true)
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load action history'))
    } finally {
      setActionsLoading(false)
    }
  }, [])

  const fetchRuntimeInventory = useCallback(async () => {
    const query = app?.server_id && app.server_id !== 'local' ? `?server_id=${encodeURIComponent(app.server_id)}` : ''
    setRuntimeLoading(true)
    try {
      const [containersResponse, statsResponse] = await Promise.all([
        pb.send<{ output?: string }>(`/api/ext/docker/containers${query}`, { method: 'GET' }),
        pb.send<{ output?: string }>(`/api/ext/docker/containers/stats${query}`, { method: 'GET' }),
      ])
      const nextContainers = parseDockerJsonLines<RuntimeContainer>(containersResponse.output || '')
      const nextStats = parseDockerJsonLines<RuntimeContainerStats>(statsResponse.output || '')
      setRuntimeContainers(nextContainers)
      setRuntimeStats(Object.fromEntries(nextStats.filter(item => item.ID).map(item => [item.ID, item])))
      setRuntimeLoaded(true)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load runtime containers'))
    } finally {
      setRuntimeLoading(false)
    }
  }, [app?.server_id])

  const fetchRuntimeInspect = useCallback(async (containerIds: string[]) => {
    if (containerIds.length === 0) return
    const query = app?.server_id && app.server_id !== 'local' ? `?server_id=${encodeURIComponent(app.server_id)}` : ''
    const results = await Promise.all(containerIds.map(async containerId => {
      try {
        const response = await pb.send<{ output?: string }>(`/api/ext/docker/containers/${containerId}${query}`, { method: 'GET' })
        return [containerId, parseDockerInspect(response.output)] as const
      } catch {
        return [containerId, null] as const
      }
    }))
    setRuntimeInspectMap(current => {
      const next = { ...current }
      for (const [containerId, inspect] of results) {
        if (inspect) next[containerId] = inspect
      }
      return next
    })
  }, [app?.server_id])

  const fetchDataResources = useCallback(async () => {
    const volumeQuery = app?.server_id && app.server_id !== 'local' ? `?server_id=${encodeURIComponent(app.server_id)}` : ''
    setDataLoading(true)
    setDataError('')

    const [databaseResult, volumeResult, backupResult] = await Promise.allSettled([
      pb.send<unknown>('/api/ext/resources/databases', { method: 'GET' }),
      pb.send<{ output?: string }>(`/api/ext/docker/volumes${volumeQuery}`, { method: 'GET' }),
      pb.send<unknown>('/api/ext/backup/list', { method: 'GET' }),
    ])

    if (databaseResult.status === 'fulfilled') {
      const records = parseResourceList(databaseResult.value)
      setDatabaseResources(records.map(record => ({
        id: stringField(record, 'id') || stringField(record, 'name'),
        name: stringField(record, 'name'),
        type: stringField(record, 'type'),
        host: stringField(record, 'host'),
        port: stringField(record, 'port'),
        db_name: stringField(record, 'db_name'),
        user: stringField(record, 'user'),
        description: stringField(record, 'description'),
      })))
    } else {
      setDatabaseResources([])
    }

    if (volumeResult.status === 'fulfilled') {
      setDataVolumes(parseDockerJsonLines<DockerVolume>(volumeResult.value.output || ''))
    } else {
      setDataVolumes([])
    }

    if (backupResult.status === 'fulfilled') {
      setBackupProjection(parseBackupProjection(backupResult.value))
    } else {
      setBackupProjection({
        status: 'error',
        items: [],
        message: getApiErrorMessage(backupResult.reason, 'Failed to load backup inventory'),
      })
    }

    if (databaseResult.status === 'rejected' && volumeResult.status === 'rejected') {
      setDataError('Failed to load app-scoped data resources')
    }

    setDataLoaded(true)
    setDataLoading(false)
  }, [app?.server_id])

  const fetchEnvFile = useCallback(async (path: string) => {
    if (!path) return
    setEnvFileLoading(true)
    setEnvFileError('')
    try {
      const response = await iacRead(path)
      setEnvFileText(response.content || '')
      setOriginalEnvFileText(response.content || '')
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 404) {
        setEnvFileText('')
        setOriginalEnvFileText('')
      } else {
        setEnvFileError(err instanceof Error ? err.message : 'Failed to load environment file')
      }
    } finally {
      setEnvFileLoaded(true)
      setEnvFileLoading(false)
    }
  }, [])

  const saveEnvFile = useCallback(async (path: string) => {
    if (!path) return
    setEnvFileSaving(true)
    setEnvFileError('')
    setError('')
    setSuccess('')
    try {
      await iacSaveFile(path, envFileText)
      setOriginalEnvFileText(envFileText)
      setSuccess('Environment file saved')
    } catch (err) {
      setEnvFileError(err instanceof Error ? err.message : 'Failed to save environment file')
    } finally {
      setEnvFileSaving(false)
    }
  }, [envFileText])

  const refreshDetailView = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        fetchDetail(),
        fetchLifecycleResources(),
        ...(tab === 'actions' || actionsLoaded ? [fetchActionHistory()] : []),
        ...(tab === 'runtime' || runtimeLoaded ? [fetchRuntimeInventory()] : []),
        ...(tab === 'data' || dataLoaded ? [fetchDataResources()] : []),
      ])
    } finally {
      setRefreshing(false)
    }
  }, [actionsLoaded, dataLoaded, fetchActionHistory, fetchDataResources, fetchDetail, fetchLifecycleResources, fetchRuntimeInventory, runtimeLoaded, tab])

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
    if (!app?.server_id || app.server_id === 'local') {
      setServerHost('')
      setServerName('')
      return
    }
    let cancelled = false
    void pb.send<Record<string, unknown>>(`/api/collections/servers/records/${app.server_id}`, { method: 'GET' })
      .then(response => {
        if (cancelled) return
        setServerHost(typeof response.host === 'string' ? response.host : '')
        setServerName(typeof response.name === 'string' ? response.name : '')
      })
      .catch(() => {
        if (cancelled) return
        setServerHost('')
        setServerName('')
      })
    return () => {
      cancelled = true
    }
  }, [app?.server_id])

  useEffect(() => {
    if (tab === 'actions' && !actionsLoaded) {
      void fetchActionHistory()
    }
  }, [actionsLoaded, fetchActionHistory, tab])

  useEffect(() => {
    if (tab === 'runtime' && !runtimeLoaded) {
      void fetchRuntimeInventory()
    }
  }, [fetchRuntimeInventory, runtimeLoaded, tab])

  useEffect(() => {
    if (tab === 'data' && !dataLoaded) {
      void fetchDataResources()
    }
    if (tab === 'data' && !runtimeLoaded) {
      void fetchRuntimeInventory()
    }
  }, [dataLoaded, fetchDataResources, fetchRuntimeInventory, runtimeLoaded, tab])

  useEffect(() => {
    if (tab === 'observability') {
      void fetchLogs()
      if (!actionsLoaded) {
        void fetchActionHistory()
      }
      if (!runtimeLoaded) {
        void fetchRuntimeInventory()
      }
      const timer = window.setInterval(() => {
        void fetchLogs()
      }, 5000)
      return () => window.clearInterval(timer)
    }
    if (tab === 'compose') {
      const nextEnvFilePath = app?.iac_path ? `${parentDir(app.iac_path)}/.env` : ''
      void fetchConfig()
      if (nextEnvFilePath && !envFileLoaded && !envFileLoading) {
        void fetchEnvFile(nextEnvFilePath)
      }
    }
    return undefined
  }, [actionsLoaded, app?.iac_path, envFileLoaded, envFileLoading, fetchActionHistory, fetchConfig, fetchEnvFile, fetchLogs, fetchRuntimeInventory, runtimeLoaded, tab])

  useEffect(() => {
    setEnvFileLoaded(false)
    setEnvFileText('')
    setOriginalEnvFileText('')
    setEnvFileError('')
  }, [app?.iac_path])

  useEffect(() => {
    if (!logViewportRef.current || !stickToBottomRef.current) return
    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
  }, [logs?.output])

  useEffect(() => {
    const metadata = loadDisplayMetadata(appId)
    setSavedDisplayMetadata(metadata)
    setDisplayIconDraft(metadata.icon)
    setDisplayLabelDraft(metadata.label)
    setDisplayTagsDraft(serializeDisplayTags(metadata.tags))
  }, [appId])

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

  const openReleaseDetail = useCallback((release: AppRelease) => {
    setSelectedRelease(release)
    setReleaseCopyState('idle')
  }, [])

  const openSelectedReleaseAction = useCallback(() => {
    if (!selectedRelease?.created_by_operation) return
    setSelectedRelease(null)
    setReleaseCopyState('idle')
    navigateToActionDetail(selectedRelease.created_by_operation)
  }, [navigateToActionDetail, selectedRelease])

  const copySelectedReleaseValue = useCallback(async (kind: 'artifact' | 'source') => {
    const value = kind === 'artifact' ? selectedRelease?.artifact_digest : selectedRelease?.source_ref
    if (!value) return
    const ok = await copyToClipboard(value)
    setReleaseCopyState(ok ? (kind === 'artifact' ? 'artifact-copied' : 'source-copied') : 'failed')
    window.setTimeout(() => {
      setReleaseCopyState(current => (current === 'failed' || current === 'artifact-copied' || current === 'source-copied' ? 'idle' : current))
    }, 1500)
  }, [selectedRelease])

  const cancelAccessEditing = useCallback(() => {
    syncAccessDrafts(app)
    setEditingAccess(false)
  }, [app, syncAccessDrafts])

  const hasConfigChanges = configText !== originalConfig
  const saveDisabled = !hasConfigChanges || !validation?.valid || validation.validatedContent !== configText || saving
  const diffText = useMemo(() => buildUnifiedDiff(originalConfig, configText), [configText, originalConfig])
  const hasActivePipeline = Boolean(
    app?.current_pipeline && !['completed', 'failed', 'cancelled', 'canceled', 'succeeded', 'success'].includes((app.current_pipeline.status || '').toLowerCase()),
  )
  const hasBusyAction = Boolean(actionLoading || deploying || pendingUninstall || hasActivePipeline)
  const normalizedRuntimeStatus = (app?.runtime_status || '').toLowerCase()
  const canStartAction = Boolean(app) && !['running', 'starting'].includes(normalizedRuntimeStatus)
  const canStopAction = Boolean(app) && ['running', 'starting'].includes(normalizedRuntimeStatus)
  const canRestartAction = Boolean(app) && normalizedRuntimeStatus === 'running'
  const primaryExposure = exposures.find(item => item.is_primary)
  const currentRelease = releases.find(item => item.is_active)
  const domainExposure = primaryExposure?.domain ? primaryExposure : exposures.find(item => item.domain)
  const exposurePath = primaryExposure?.path || ''
  const effectiveServerHost = useMemo(() => {
    if (serverHost.trim()) return serverHost.trim()
    if (app?.server_id === 'local' && typeof window !== 'undefined') return window.location.hostname
    return ''
  }, [app?.server_id, serverHost])
  const primaryDomainUrl = useMemo(() => {
    if (!domainExposure?.domain) return ''
    const scheme = domainExposure.certificate_id ? 'https' : 'http'
    const normalizedPath = domainExposure.path ? (domainExposure.path.startsWith('/') ? domainExposure.path : `/${domainExposure.path}`) : ''
    return `${scheme}://${domainExposure.domain}${normalizedPath}`
  }, [domainExposure])
  const publicAccessUrl = useMemo(() => {
    if (!effectiveServerHost) return ''
    const port = primaryExposure?.target_port && primaryExposure.target_port > 0 ? `:${primaryExposure.target_port}` : ''
    const normalizedPath = exposurePath ? (exposurePath.startsWith('/') ? exposurePath : `/${exposurePath}`) : ''
    return `http://${effectiveServerHost}${port}${normalizedPath}`
  }, [effectiveServerHost, exposurePath, primaryExposure?.target_port])
  const hasAccessDraftChanges = useMemo(() => {
    return accessUsernameDraft !== (app?.access_username || '')
      || accessSecretHintDraft !== (app?.access_secret_hint || '')
      || accessRetrievalMethodDraft !== (app?.access_retrieval_method || '')
      || accessNotesDraft !== (app?.access_notes || '')
  }, [accessNotesDraft, accessRetrievalMethodDraft, accessSecretHintDraft, accessUsernameDraft, app?.access_notes, app?.access_retrieval_method, app?.access_secret_hint, app?.access_username])
  const scopedActions = useMemo(() => {
    return actionHistory
      .filter(action => action.app_id === appId || action.pipeline?.app_id === appId)
      .sort((left, right) => new Date(right.created).getTime() - new Date(left.created).getTime())
  }, [actionHistory, appId])
  const accessHintsPresent = hasAccessHints(app)
  const projectNameCandidates = useMemo(() => {
    const rawValues = [
      scopedActions[0]?.compose_project_name,
      app?.project_dir.split('/').filter(Boolean).pop(),
      app?.name,
    ].filter(Boolean) as string[]
    return Array.from(new Set(rawValues.map(value => normalizeMatchValue(value))))
  }, [app?.name, app?.project_dir, scopedActions])
  const actionStatusOptions = useMemo(() => Array.from(new Set(scopedActions.map(item => item.status))).sort(), [scopedActions])
  const actionTypeOptions = useMemo(() => Array.from(new Set(scopedActions
    .map(item => (item.pipeline?.selector?.operation_type || item.pipeline_selector?.operation_type || '').trim().toLowerCase())
    .filter(Boolean))).sort(), [scopedActions])
  const filteredScopedActions = useMemo(() => {
    const query = actionSearch.trim().toLowerCase()
    return scopedActions.filter(action => {
      const actionType = (action.pipeline?.selector?.operation_type || action.pipeline_selector?.operation_type || '').toLowerCase()
      if (actionStatusFilter !== 'all' && action.status !== actionStatusFilter) return false
      if (actionTypeFilter !== 'all' && actionType !== actionTypeFilter) return false
      if (!query) return true
      return [
        action.id,
        getActionLabel(action),
        action.status,
        action.source,
        action.compose_project_name,
        action.server_label,
        action.server_id,
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(query))
    })
  }, [actionSearch, actionStatusFilter, actionTypeFilter, scopedActions])
  const relatedRuntimeContainers = useMemo(() => {
    if (projectNameCandidates.length === 0) return []
    return runtimeContainers.filter(container => {
      const normalizedName = normalizeMatchValue(container.Names || '')
      return projectNameCandidates.some(candidate => normalizedName.includes(candidate))
    })
  }, [projectNameCandidates, runtimeContainers])
  const runtimeSummary = useMemo(() => {
    const running = relatedRuntimeContainers.filter(item => item.State === 'running').length
    const totalCpu = relatedRuntimeContainers.reduce((sum, container) => sum + parseCpuPercent(runtimeStats[container.ID]?.CPUPerc), 0)
    const totalMemory = relatedRuntimeContainers.reduce((sum, container) => sum + parseMemoryUsageBytes(runtimeStats[container.ID]?.MemUsage), 0)
    return {
      total: relatedRuntimeContainers.length,
      running,
      cpu: totalCpu,
      memory: totalMemory,
    }
  }, [relatedRuntimeContainers, runtimeStats])
  const matchedDatabaseResources = useMemo(() => {
    if (projectNameCandidates.length === 0) return []
    return databaseResources.filter(database => {
      const haystack = normalizeMatchValue([
        database.name,
        database.db_name,
        database.host,
        database.description,
      ].filter(Boolean).join(' '))
      return projectNameCandidates.some(candidate => haystack.includes(candidate))
    })
  }, [databaseResources, projectNameCandidates])
  const matchedDataVolumes = useMemo(() => {
    if (projectNameCandidates.length === 0) return []
    return dataVolumes.filter(volume => {
      const haystack = normalizeMatchValue([volume.Name, volume.Mountpoint].filter(Boolean).join(' '))
      return projectNameCandidates.some(candidate => haystack.includes(candidate))
    })
  }, [dataVolumes, projectNameCandidates])
  const latestScopedAction = scopedActions[0]
  const serverDisplayName = serverName || app?.server_id || 'local'
  const canOpenServerDetail = Boolean(app?.server_id && app.server_id !== 'local')
  const canOpenServerWorkspace = Boolean(app?.server_id && app.server_id !== 'local')
  const iacDirectoryPath = app?.iac_path ? parentDir(app.iac_path) : ''
  const envFilePath = iacDirectoryPath ? `${iacDirectoryPath}/.env` : ''
  const hasEnvFileChanges = envFileText !== originalEnvFileText
  const displayTags = useMemo(() => normalizeDisplayTags(displayTagsDraft), [displayTagsDraft])
  const hasDisplayChanges = displayIconDraft.trim() !== savedDisplayMetadata.icon
    || displayLabelDraft.trim() !== savedDisplayMetadata.label
    || serializeDisplayTags(displayTags) !== serializeDisplayTags(savedDisplayMetadata.tags)
  const containerMountRows = useMemo(() => {
    return relatedRuntimeContainers.flatMap(container => {
      const inspect = runtimeInspectMap[container.ID]
      const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts as RuntimeContainerMount[] : []
      return mounts.map((mount, index) => ({
        id: `${container.ID}-${mount.Destination || mount.Source || mount.Name || index}`,
        containerId: container.ID,
        containerName: container.Names || container.ID,
        type: mount.Type || '-',
        source: mount.Source || mount.Name || '-',
        destination: mount.Destination || '-',
        writable: mount.RW !== false,
      }))
    })
  }, [relatedRuntimeContainers, runtimeInspectMap])
  const mountProjectionLoading = tab === 'data' && relatedRuntimeContainers.length > 0 && containerMountRows.length === 0

  useEffect(() => {
    if (tab !== 'data' || relatedRuntimeContainers.length === 0) return
    const missingIds = relatedRuntimeContainers
      .map(container => container.ID)
      .filter(containerId => !runtimeInspectMap[containerId])
    if (missingIds.length > 0) {
      void fetchRuntimeInspect(missingIds)
    }
  }, [fetchRuntimeInspect, relatedRuntimeContainers, runtimeInspectMap, tab])

  const openAllActionsForApp = useCallback(() => {
    void navigate({
      to: '/actions' as never,
      search: {
        appId,
        q: scopedActions[0]?.compose_project_name || app?.name || undefined,
      } as never,
    })
  }, [app?.name, appId, navigate, scopedActions])

  const buildActionDetailHref = useCallback((actionId: string) => {
    return `/actions/${actionId}?returnTo=list`
  }, [])

  const openServerWorkspace = useCallback((options?: {
    panel?: 'none' | 'files' | 'docker'
    path?: string
    lockedRoot?: string
  }) => {
    if (!app?.server_id || app.server_id === 'local') return
    void navigate({
      to: '/terminal/server/$serverId' as never,
      params: { serverId: app.server_id } as never,
      search: {
        panel: options?.panel && options.panel !== 'none' ? options.panel : undefined,
        path: options?.path || undefined,
        lockedRoot: options?.lockedRoot || undefined,
      } as never,
    })
  }, [app?.server_id, navigate])

  const openServerDetail = useCallback(() => {
    if (!app?.server_id || app.server_id === 'local') return
    void navigate({
      to: '/resources/servers' as never,
      search: { edit: app.server_id } as never,
    })
  }, [app?.server_id, navigate])

  const openIacWindow = useCallback(() => {
    if (!app?.iac_path || typeof window === 'undefined') return
    const targetUrl = new URL('/iac', window.location.origin)
    targetUrl.searchParams.set('path', app.iac_path)
    const opened = window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer')
    if (!opened) {
      void navigate({
        to: '/iac' as never,
        search: { path: app.iac_path } as never,
      })
    }
  }, [app?.iac_path, navigate])

  const openRuntimeContainerLogs = useCallback(async (container: RuntimeContainer) => {
    const query = app?.server_id && app.server_id !== 'local' ? `?server_id=${encodeURIComponent(app.server_id)}&tail=200` : '?tail=200'
    setRuntimeLogsTarget(container)
    setRuntimeLogsLoading(true)
    try {
      const response = await pb.send<{ output?: string }>(`/api/ext/docker/containers/${container.ID}/logs${query}`, { method: 'GET' })
      setRuntimeLogsContent(typeof response.output === 'string' ? response.output : '')
    } catch (err) {
      setRuntimeLogsContent(getApiErrorMessage(err, 'Failed to load container logs'))
    } finally {
      setRuntimeLogsLoading(false)
    }
  }, [app?.server_id])

  const saveAccessHints = useCallback(async () => {
    setAccessSaving(true)
    setError('')
    setSuccess('')
    try {
      const response = await pb.send<Pick<AppInstance, 'access_username' | 'access_secret_hint' | 'access_retrieval_method' | 'access_notes'>>(`/api/apps/${appId}/access`, {
        method: 'PUT',
        body: {
          access_username: accessUsernameDraft,
          access_secret_hint: accessSecretHintDraft,
          access_retrieval_method: accessRetrievalMethodDraft,
          access_notes: accessNotesDraft,
        },
      })
      setApp(current => current ? ({
        ...current,
        access_username: response.access_username || '',
        access_secret_hint: response.access_secret_hint || '',
        access_retrieval_method: response.access_retrieval_method || '',
        access_notes: response.access_notes || '',
      }) : current)
      syncAccessDrafts({
        ...(app || {} as AppInstance),
        access_username: response.access_username || '',
        access_secret_hint: response.access_secret_hint || '',
        access_retrieval_method: response.access_retrieval_method || '',
        access_notes: response.access_notes || '',
      })
      setEditingAccess(false)
      setSuccess('Access account hints saved')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to save access hints'))
    } finally {
      setAccessSaving(false)
    }
  }, [accessNotesDraft, accessRetrievalMethodDraft, accessSecretHintDraft, accessUsernameDraft, app, appId, syncAccessDrafts])

  const saveDisplayMetadata = useCallback(async () => {
    const nextMetadata: AppDisplayMetadata = {
      icon: displayIconDraft.trim(),
      label: displayLabelDraft.trim(),
      tags: displayTags,
    }
    setDisplaySaving(true)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`${DISPLAY_METADATA_STORAGE_PREFIX}${appId}`, JSON.stringify(nextMetadata))
      }
      setSavedDisplayMetadata(nextMetadata)
      setDisplayTagsDraft(serializeDisplayTags(nextMetadata.tags))
      setSuccess('Display metadata saved in this browser')
      setError('')
    } finally {
      setDisplaySaving(false)
    }
  }, [appId, displayIconDraft, displayLabelDraft, displayTags])

  const resetDisplayMetadata = useCallback(() => {
    setDisplayIconDraft(savedDisplayMetadata.icon)
    setDisplayLabelDraft(savedDisplayMetadata.label)
    setDisplayTagsDraft(serializeDisplayTags(savedDisplayMetadata.tags))
  }, [savedDisplayMetadata.icon, savedDisplayMetadata.label, savedDisplayMetadata.tags])

  function renderActionMenu() {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={loading || hasBusyAction}>
            Actions
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => void runAction('start')} disabled={hasBusyAction || loading || !canStartAction}>
            <Play className="h-4 w-4" />
            {actionLoading === 'start' ? 'Starting...' : 'Start'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void runAction('stop')} disabled={hasBusyAction || loading || !canStopAction}>
            <Square className="h-4 w-4" />
            {actionLoading === 'stop' ? 'Stopping...' : 'Stop'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void runAction('restart')} disabled={hasBusyAction || loading || !canRestartAction}>
            <RotateCcw className="h-4 w-4" />
            {actionLoading === 'restart' ? 'Restarting...' : 'Restart'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void triggerOperation('redeploy')} disabled={hasBusyAction || !app}>
            <RotateCcw className="h-4 w-4" />
            {deploying === 'redeploy' ? 'Redeploying...' : 'Redeploy'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void triggerOperation('upgrade')} disabled={hasBusyAction || !app}>
            <ArrowUp className="h-4 w-4" />
            {deploying === 'upgrade' ? 'Upgrading...' : 'Upgrade'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPendingUninstall(true)} disabled={hasBusyAction || loading} variant="destructive">
            <Trash2 className="h-4 w-4" />
            Uninstall
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <AppDetailHeader
        app={app}
        refreshing={refreshing}
        refreshDisabled={hasBusyAction}
        onRefresh={() => void refreshDetailView()}
        actionMenu={renderActionMenu()}
      />

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {success ? <Alert><AlertDescription>{success}</AlertDescription></Alert> : null}

      {loading ? (
        <div className="rounded-xl border p-6 text-sm text-muted-foreground">Loading app detail...</div>
      ) : app ? (
        <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="gap-5 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
          <AppDetailTabRail />
          <AppDetailOverviewTab
            app={app}
            currentRelease={currentRelease}
            releases={releases}
            openReleaseDetail={openReleaseDetail}
            serverDisplayName={serverDisplayName}
            canOpenServerDetail={canOpenServerDetail}
            openServerDetail={openServerDetail}
            primaryExposure={primaryExposure}
            exposures={exposures}
            openOperationStatus={openOperationStatus}
            setTab={setTab}
            displaySection={{
              iconValue: displayIconDraft,
              labelValue: displayLabelDraft,
              tagsValue: displayTagsDraft,
              tags: displayTags,
              saving: displaySaving,
              hasChanges: hasDisplayChanges,
              onIconChange: setDisplayIconDraft,
              onLabelChange: setDisplayLabelDraft,
              onTagsChange: setDisplayTagsDraft,
              onSave: () => void saveDisplayMetadata(),
              onReset: resetDisplayMetadata,
            }}
          />
          <AppDetailAccessTab
            app={app}
            primaryExposure={primaryExposure}
            effectiveServerHost={effectiveServerHost}
            primaryDomainUrl={primaryDomainUrl}
            publicAccessUrl={publicAccessUrl}
            editingAccess={editingAccess}
            accessHintsPresent={accessHintsPresent}
            accessUsernameDraft={accessUsernameDraft}
            accessSecretHintDraft={accessSecretHintDraft}
            accessRetrievalMethodDraft={accessRetrievalMethodDraft}
            accessNotesDraft={accessNotesDraft}
            hasAccessDraftChanges={hasAccessDraftChanges}
            accessSaving={accessSaving}
            setEditingAccess={setEditingAccess}
            setAccessUsernameDraft={setAccessUsernameDraft}
            setAccessSecretHintDraft={setAccessSecretHintDraft}
            setAccessRetrievalMethodDraft={setAccessRetrievalMethodDraft}
            setAccessNotesDraft={setAccessNotesDraft}
            saveAccessHints={() => void saveAccessHints()}
            cancelAccessEditing={cancelAccessEditing}
          />
          <AppDetailActionsTab
            app={app}
            actionsLoading={actionsLoading}
            actionSearch={actionSearch}
            setActionSearch={setActionSearch}
            actionStatusFilter={actionStatusFilter}
            setActionStatusFilter={setActionStatusFilter}
            actionTypeFilter={actionTypeFilter}
            setActionTypeFilter={setActionTypeFilter}
            actionStatusOptions={actionStatusOptions}
            actionTypeOptions={actionTypeOptions}
            scopedActions={scopedActions}
            filteredScopedActions={filteredScopedActions}
            fetchActionHistory={() => void fetchActionHistory()}
            openAllActionsForApp={openAllActionsForApp}
            openOperationStatus={openOperationStatus}
            buildActionDetailHref={buildActionDetailHref}
          />
          <AppDetailRuntimeTab
            app={app}
            runtimeSummary={runtimeSummary}
            runtimeLoading={runtimeLoading}
            runtimeLoaded={runtimeLoaded}
            relatedRuntimeContainers={relatedRuntimeContainers}
            runtimeStats={runtimeStats}
            canOpenServerWorkspace={canOpenServerWorkspace}
            openRuntimeContainerLogs={container => void openRuntimeContainerLogs(container)}
            openServerWorkspace={openServerWorkspace}
            projectNameCandidates={projectNameCandidates}
            setTab={setTab}
          />
          <AppDetailComposeTab
            app={app}
            configLoading={configLoading}
            fetchConfig={force => void fetchConfig(force)}
            validating={validating}
            validateDraft={() => void validateDraft()}
            rollingBack={rollingBack}
            rollbackConfig={() => void rollbackConfig()}
            rollbackMeta={rollbackMeta}
            openIacWindow={openIacWindow}
            saveDisabled={saveDisabled}
            saving={saving}
            saveConfig={() => void saveConfig()}
            configText={configText}
            setConfigText={setConfigText}
            validation={validation}
            envFilePath={envFilePath}
            envFileLoading={envFileLoading}
            fetchEnvFile={path => void fetchEnvFile(path)}
            hasEnvFileChanges={hasEnvFileChanges}
            envFileSaving={envFileSaving}
            saveEnvFile={path => void saveEnvFile(path)}
            envFileLoaded={envFileLoaded}
            envFileError={envFileError}
            envFileText={envFileText}
            setEnvFileText={setEnvFileText}
            diffText={diffText}
          />
          <AppDetailObservabilityTab
            app={app}
            logsLoading={logsLoading}
            fetchLogs={showSpinner => void fetchLogs(showSpinner)}
            runtimeLoaded={runtimeLoaded}
            runtimeSummary={runtimeSummary}
            latestScopedAction={latestScopedAction}
            primaryExposure={primaryExposure}
            logs={logs}
            logViewportRef={logViewportRef}
            stickToBottomRef={stickToBottomRef}
          />
          <AppDetailDataTab
            app={app}
            dataError={dataError}
            dataLoading={dataLoading}
            dataLoaded={dataLoaded}
            matchedDatabaseResources={matchedDatabaseResources}
            matchedDataVolumes={matchedDataVolumes}
            backupProjection={backupProjection}
            mountProjectionLoading={mountProjectionLoading}
            containerMountRows={containerMountRows}
            canOpenServerWorkspace={canOpenServerWorkspace}
            openServerWorkspace={openServerWorkspace}
          />
          <AppDetailAutomationTab />
          <AppDetailSettingsTab app={app} />
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

      <Dialog open={Boolean(runtimeLogsTarget)} onOpenChange={open => {
        if (!open) {
          setRuntimeLogsTarget(null)
          setRuntimeLogsContent('')
        }
      }}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Container Logs: {runtimeLogsTarget?.Names || '-'}</DialogTitle>
            <DialogDescription>Recent log output for the selected app-scoped runtime container.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-black px-4 py-3 font-mono text-[11px] leading-5 text-slate-100">
            <pre className={cn('max-h-[55vh] overflow-auto whitespace-pre-wrap break-words', runtimeLogsLoading && 'text-slate-500')}>
              {runtimeLogsLoading ? 'Loading logs...' : runtimeLogsContent || 'No logs available.'}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedRelease)} onOpenChange={open => {
    if (!open) {
      setSelectedRelease(null)
      setReleaseCopyState('idle')
    }
  }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Release Detail: {selectedRelease?.version_label || selectedRelease?.id || '-'}</DialogTitle>
        <DialogDescription>Candidate and active release attribution from the lifecycle release store.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-muted-foreground">Role</div>
          <div>{selectedRelease?.release_role || '-'}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Version</div>
          <div>{selectedRelease?.version_label || '-'}</div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-muted-foreground">Artifact</div>
          <div className="break-all font-mono text-[12px]">{selectedRelease?.artifact_digest || '-'}</div>
          {selectedRelease?.artifact_digest ? <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-[11px]" onClick={() => void copySelectedReleaseValue('artifact')}>{releaseCopyState === 'artifact-copied' ? 'Copied' : releaseCopyState === 'failed' ? 'Copy failed' : 'Copy Artifact'}</Button> : null}
        </div>
        {selectedReleaseAttribution.localImageRef ? (
          <div className="sm:col-span-2">
            <div className="text-muted-foreground">Local Image</div>
            <div className="break-all font-mono text-[12px]">{selectedReleaseAttribution.localImageRef}</div>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <div className="text-muted-foreground">Source</div>
          <div className="break-all">{selectedRelease?.source_ref || '-'}</div>
          {selectedRelease?.source_ref ? <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-[11px]" onClick={() => void copySelectedReleaseValue('source')}>{releaseCopyState === 'source-copied' ? 'Copied' : releaseCopyState === 'failed' ? 'Copy failed' : 'Copy Source'}</Button> : null}
        </div>
        <div>
          <div className="text-muted-foreground">Source Type</div>
          <div>{selectedRelease?.source_type || '-'}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Updated</div>
          <div>{selectedRelease?.updated || '-'}</div>
        </div>
        {selectedReleaseAttribution.targetService ? (
          <div>
            <div className="text-muted-foreground">Target Service</div>
            <div>{selectedReleaseAttribution.targetService}</div>
          </div>
        ) : null}
        <div>
          <div className="text-muted-foreground">Created By Operation</div>
          <div className="break-all">{selectedRelease?.created_by_operation || '-'}</div>
        </div>
        {selectedRelease?.notes ? (
          <div className="sm:col-span-2">
            <div className="text-muted-foreground">Notes</div>
            <div className="whitespace-pre-wrap">{selectedReleaseAttribution.summaryNotes.length > 0 ? selectedReleaseAttribution.summaryNotes.join(' | ') : selectedRelease.notes}</div>
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {selectedRelease?.created_by_operation ? (
          <Button variant="outline" size="sm" onClick={openSelectedReleaseAction}>Open Related Action</Button>
        ) : null}
      </div>
    </DialogContent>
  </Dialog>
    </div>
  )
}