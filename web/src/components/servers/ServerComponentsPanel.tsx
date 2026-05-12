import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CircleHelp, Loader2, RefreshCw, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  getSoftwareOperation,
  getSoftwareComponent,
  invokeSoftwareAction,
  type InstallSource,
  listSoftwareComponents,
  type SoftwareOperation,
  type SoftwareActionType,
  type SoftwareComponentSummary,
  type SoftwareLastOperation,
} from '@/lib/software-api'

const PREREQUISITE_COMPONENT_KEYS = new Set(['docker'])

function isPrerequisiteComponent(component: SoftwareComponentSummary): boolean {
  return PREREQUISITE_COMPONENT_KEYS.has(component.component_key)
}

function primaryPrerequisiteAction(component: SoftwareComponentSummary): SoftwareActionType | null {
  const actions = new Set(component.available_actions ?? [])
  if (component.installed_state !== 'installed' && actions.has('install')) return 'install'
  if (component.verification_state === 'degraded' && actions.has('reinstall')) return 'reinstall'
  if (component.verification_state === 'degraded' && actions.has('upgrade')) return 'upgrade'
  return null
}

function prerequisiteChecks(component: SoftwareComponentSummary): Array<{
  label: string
  ready: boolean
}> {
  const readiness = component.preflight
  if (!readiness) {
    return []
  }

  return [
    {
      label: 'OS Support',
      ready: readiness.os_supported,
    },
    {
      label: 'Privileged Access',
      ready: readiness.privilege_ok,
    },
    {
      label: 'Network Access',
      ready: readiness.network_ok,
    },
    {
      label: 'Dependency Readiness',
      ready: readiness.dependency_ready,
    },
  ]
}

function blockingSummary(
  installedState: SoftwareComponentSummary['installed_state'],
  readinessIssues: string[],
  composeAvailable: boolean,
  primaryAction: SoftwareActionType | null
): string | null {
  const blockingIssue = readinessIssues.find(issue => !issue.startsWith('network_required:'))
  if (blockingIssue) {
    return blockingIssue
  }
  if (installedState === 'installed' && !composeAvailable) {
    return 'Docker Compose plugin is not available.'
  }
  if (installedState === 'installed' && primaryAction) {
    return 'A prerequisite check still needs attention.'
  }
  return null
}

function readVerificationDetails(component: SoftwareComponentSummary): Record<string, unknown> | null {
  const value = component.verification?.details
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function installSourceLabel(source: InstallSource | undefined): string {
  if (source === 'managed') return 'Managed'
  if (source === 'foreign_package') return 'Foreign package'
  if (source === 'manual') return 'Manual'
  if (source === 'unknown') return 'Unknown'
  return 'Unknown'
}

function installSourceSummary(component: SoftwareComponentSummary): string | null {
  if (component.installed_state !== 'installed') return null
  if (!component.install_source && !component.source_evidence) return null
  const label = installSourceLabel(component.install_source)
  return component.source_evidence
    ? `Install source: ${label} (${component.source_evidence})`
    : `Install source: ${label}`
}

function installSourceTone(component: SoftwareComponentSummary): string {
  if (component.install_source === 'foreign_package' || component.install_source === 'manual') {
    return 'text-amber-700 dark:text-amber-400'
  }
  return 'text-muted-foreground'
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return ''
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return value
  return timestamp.toLocaleString()
}

function phaseLabel(op: SoftwareLastOperation | undefined): string {
  if (!op) return ''
  if (op.terminal_status === 'success') return 'Succeeded'
  if (op.terminal_status === 'failed')
    return op.failure_reason ? `Failed: ${op.failure_reason}` : 'Failed'
  const labels: Record<string, string> = {
    accepted: 'Accepted',
    preflight: 'Preflight check…',
    executing: 'Executing…',
    verifying: 'Verifying…',
    succeeded: 'Succeeded',
    failed: 'Failed',
    attention_required: 'Attention required',
  }
  return labels[op.phase] ?? op.phase
}

function phaseLabelFromOperation(op: SoftwareOperation | undefined): string {
  if (!op) return ''
  if (op.terminal_status === 'success') return 'Succeeded'
  if (op.terminal_status === 'failed') {
    return op.failure_reason ? `Failed: ${op.failure_reason}` : 'Failed'
  }
  const labels: Record<string, string> = {
    accepted: 'Accepted',
    preflight: 'Preflight check…',
    executing: 'Executing…',
    verifying: 'Verifying…',
    succeeded: 'Succeeded',
    failed: 'Failed',
    attention_required: 'Attention required',
  }
  return labels[op.phase] ?? op.phase
}

function isInProgress(op: SoftwareLastOperation | undefined): boolean {
  return !!op && op.terminal_status === 'none'
}

function statusTone(
  component: SoftwareComponentSummary
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (component.verification_state === 'degraded') return 'destructive'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return 'default'
  if (component.installed_state === 'not_installed') return 'secondary'
  return 'outline'
}

function statusLabel(component: SoftwareComponentSummary): string {
  if (component.verification_state === 'degraded') return 'Degraded'
  // installed + healthy = runtime verified running — distinct from merely being installed
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return 'Running'
  // installed + unknown = deployment confirmed, runtime not yet verified
  if (component.installed_state === 'installed') return 'Installed'
  if (component.installed_state === 'not_installed') return 'Not Installed'
  return 'Unknown'
}

function prerequisiteStatusLabel(component: SoftwareComponentSummary): string {
  if (component.verification_state === 'degraded') return 'Needs Attention'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return 'Verified'
  if (component.installed_state === 'installed') return 'Detected'
  if (component.installed_state === 'not_installed') return 'Not Ready'
  return 'Unknown'
}

function prerequisiteActionSlots(component: SoftwareComponentSummary): Array<{
  label: 'Recheck' | 'Upgrade/Fix' | 'Install'
  action: SoftwareActionType | null
}> {
  const actions = new Set(component.available_actions ?? [])
  const slots: Array<{
    label: 'Recheck' | 'Upgrade/Fix' | 'Install'
    action: SoftwareActionType | null
  }> = [
    {
      label: 'Recheck',
      action: actions.has('verify') ? 'verify' : null,
    },
    {
      label: 'Upgrade/Fix',
      action: actions.has('reinstall') ? 'reinstall' : actions.has('upgrade') ? 'upgrade' : null,
    },
    {
      label: 'Install',
      action: actions.has('install') ? 'install' : null,
    },
  ]

  if (component.installed_state !== 'installed') {
    return slots.filter(slot => slot.label === 'Install' || slot.label === 'Recheck')
  }

  return slots.filter(slot => slot.label !== 'Install' || slot.action !== null)
}

type PrerequisitePanelMode = 'checklist' | 'operation'

type ActionLogEntry = {
  id: string
  tone: 'muted' | 'success' | 'error'
  text: string
}

function SectionHelp({ label, children }: { label: string; children: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 text-xs leading-5">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function AddonDetailRows({
  component,
}: {
  component: SoftwareComponentSummary
}) {
  const installSource = installSourceSummary(component)
  const versionLabel = component.detected_version || component.packaged_version || '—'
  const lastOp = component.last_operation
  const lastActionAt = formatTimestamp(component.last_action?.at || lastOp?.updated_at)
  const readinessIssues = component.preflight?.issues ?? []
  return [
    { label: 'Status', value: statusLabel(component) },
    { label: 'Version', value: versionLabel },
    { label: 'Template', value: component.template_kind },
    { label: 'Install Source', value: installSource?.replace(/^Install source:\s*/i, '') || '—' },
    { label: 'Last Activity', value: phaseLabel(lastOp) || (component.last_action ? `${component.last_action.action} · ${component.last_action.result}` : '—') },
    { label: 'Updated', value: lastActionAt || '—' },
    { label: 'Issues', value: readinessIssues.length ? readinessIssues.join(' | ') : '—' },
  ]
}

function AddonInventoryRow({
  component,
  selected,
  onSelect,
}: {
  component: SoftwareComponentSummary
  selected: boolean
  onSelect: (componentKey: string) => void
}) {
  const lastOp = component.last_operation
  const inProgress = isInProgress(lastOp)
  const phase = phaseLabel(lastOp)
  const activityLabel = inProgress ? phase : phase || statusLabel(component)

  return (
    <button
      type="button"
      onClick={() => onSelect(component.component_key)}
      className={`grid w-full grid-cols-[minmax(0,1.2fr)_6rem_7rem] items-center gap-3 px-3 py-2 text-left text-sm ${selected ? 'bg-accent/40' : 'hover:bg-accent/20'}`}
      aria-label={component.label}
    >
      <div className="min-w-0 space-y-1">
        <div className="truncate font-medium text-foreground">{component.label}</div>
        <div className="truncate text-[11px] font-mono text-muted-foreground">{component.component_key}</div>
      </div>
      <div className="truncate text-xs text-muted-foreground">{statusLabel(component)}</div>
      <div className="truncate text-xs text-muted-foreground">{activityLabel || '—'}</div>
    </button>
  )
}

function readPrerequisiteContext(component: SoftwareComponentSummary) {
  const readinessIssues = component.preflight?.issues ?? []
  const dockerVerificationDetails =
    component.component_key === 'docker' ? readVerificationDetails(component) : null
  const engineVersion =
    component.component_key === 'docker'
      ? String(dockerVerificationDetails?.engine_version ?? component.detected_version ?? '').trim()
      : ''
  const composeAvailable =
    component.component_key === 'docker'
      ? dockerVerificationDetails?.compose_available === true
      : false
  const composeVersion =
    component.component_key === 'docker'
      ? String(dockerVerificationDetails?.compose_version ?? '').trim()
      : ''
  const installSource = installSourceSummary(component)
  const primaryAction = primaryPrerequisiteAction(component)
  const checklistItems = [
    {
      label: 'Docker Engine installed',
      ready: component.installed_state === 'installed',
    },
    {
      label: 'Docker Engine version available',
      ready: engineVersion !== '',
    },
    {
      label: 'Docker Compose available',
      ready: composeAvailable,
    },
    {
      label: 'Docker Compose version available',
      ready: composeVersion !== '',
    },
    ...prerequisiteChecks(component).map(check => ({
      label: `${check.label} confirmed`,
      ready: check.ready,
    })),
  ]
  const summary = blockingSummary(component.installed_state, readinessIssues, composeAvailable, primaryAction)

  return {
    readinessIssues,
    engineVersion,
    composeAvailable,
    composeVersion,
    installSource,
    primaryAction,
    checklistItems,
    summary,
  }
}

function PrerequisiteChecklist({ component }: { component: SoftwareComponentSummary }) {
  const context = readPrerequisiteContext(component)
  return (
    <div className="space-y-2">
      {context.checklistItems.map(item => (
        <div key={`${component.component_key}:${item.label}`} className="flex items-center gap-2 text-sm">
          {item.ready ? (
            <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : (
            <X className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          )}
          <span className="text-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function PrerequisiteActions({
  component,
  onAction,
  actionLoading,
}: {
  component: SoftwareComponentSummary
  onAction: (componentKey: string, action: SoftwareActionType) => Promise<void>
  actionLoading: string | null
}) {
  const installSource = installSourceSummary(component)
  const actionSlots = prerequisiteActionSlots(component)

  return (
    <>
      {installSource ? (
        <div className={`text-xs ${installSourceTone(component)}`}>{installSource}</div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {actionSlots.map(slot => {
          const loadingKey = slot.action ? `${component.component_key}:${slot.action}` : null
          const isThisLoading = loadingKey !== null && actionLoading === loadingKey
          const disabled = !slot.action || isThisLoading
          return (
            <Button
              key={slot.label}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                if (!slot.action) return
                void onAction(component.component_key, slot.action)
              }}
              className="h-7 px-2 text-xs"
            >
              {isThisLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {slot.label}
            </Button>
          )
        })}
      </div>
    </>
  )
}

function PrerequisiteCard({
  component,
  open,
  onOpenChange,
  onAction,
  actionLoading,
  panelMode,
  activeActionLabel,
  actionLogs,
}: {
  component: SoftwareComponentSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (componentKey: string, action: SoftwareActionType) => Promise<void>
  actionLoading: string | null
  panelMode: PrerequisitePanelMode
  activeActionLabel: string | null
  actionLogs: ActionLogEntry[]
}) {
  const context = readPrerequisiteContext(component)
  const lastOp = component.last_operation
  const lastActionAt = formatTimestamp(component.last_action?.at || lastOp?.updated_at)

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-lg border border-border/60 bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            aria-label={`${component.label} details`}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{component.label}</div>
                <Badge variant={statusTone(component)} className="text-xs">
                  {prerequisiteStatusLabel(component)}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {context.summary || (context.composeAvailable ? 'Checks passed' : 'Compose missing')}
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4 border-t border-border/60 px-4 py-4 text-sm">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="space-y-2">
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Status:</span>
                  <span className="break-words text-muted-foreground">
                    {prerequisiteStatusLabel(component)}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Version:</span>
                  <span className="break-words text-muted-foreground">
                    {context.engineVersion || 'Unavailable'}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Docker Compose:</span>
                  <span className="break-words text-muted-foreground">
                    {context.composeAvailable && context.composeVersion ? context.composeVersion : 'Missing'}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Updated:</span>
                  <span className="break-words text-muted-foreground">{lastActionAt || '—'}</span>
                </div>
              </div>

              <div className="lg:min-w-[12rem] lg:justify-self-end">
                <PrerequisiteActions
                  component={component}
                  onAction={onAction}
                  actionLoading={actionLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium text-foreground">
                  {panelMode === 'operation' ? `${activeActionLabel || 'Action'} Log` : 'Verification Checklist'}
                </div>
                {context.summary ? (
                  <div className="text-right text-xs text-amber-700 dark:text-amber-400">
                    Blocking issue: {context.summary}
                  </div>
                ) : null}
              </div>
              <div className="rounded-md border px-3 py-3">
                {panelMode === 'operation' ? (
                  actionLogs.length > 0 ? (
                    <div
                      aria-label="Prerequisite action log entries"
                      className="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm"
                    >
                      {actionLogs.map(entry => (
                        <div
                          key={entry.id}
                          className={
                            entry.tone === 'error'
                              ? 'text-destructive'
                              : entry.tone === 'success'
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-muted-foreground'
                          }
                        >
                          {entry.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Waiting for operation updates...</div>
                  )
                ) : (
                  <PrerequisiteChecklist component={component} />
                )}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function ServerComponentsPanel({ serverId }: { serverId: string }) {
  const [prerequisiteOpen, setPrerequisiteOpen] = useState<Record<string, boolean>>({})
  const [prerequisitePanelMode, setPrerequisitePanelMode] = useState<Record<string, PrerequisitePanelMode>>({})
  const [prerequisiteActiveActionLabel, setPrerequisiteActiveActionLabel] = useState<Record<string, string | null>>({})
  const [prerequisiteActionLogs, setPrerequisiteActionLogs] = useState<Record<string, ActionLogEntry[]>>({})
  const [selectedAddonKey, setSelectedAddonKey] = useState<string | null>(null)

  const [prerequisiteComponents, setPrerequisiteComponents] = useState<SoftwareComponentSummary[]>([])
  const [addonComponents, setAddonComponents] = useState<SoftwareComponentSummary[]>([])
  const [prerequisitesLoading, setPrerequisitesLoading] = useState(true)
  const [addonsLoading, setAddonsLoading] = useState(true)
  const [prerequisiteError, setPrerequisiteError] = useState('')
  const [addonError, setAddonError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const loading = prerequisitesLoading || addonsLoading
  const operationPollersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const selectedAddon = useMemo(
    () => addonComponents.find(component => component.component_key === selectedAddonKey) ?? null,
    [addonComponents, selectedAddonKey]
  )

  useEffect(() => {
    setPrerequisiteOpen(current => {
      const next = { ...current }
      for (const component of prerequisiteComponents) {
        if (!(component.component_key in next)) {
          next[component.component_key] = false
        }
      }
      return next
    })
  }, [prerequisiteComponents])

  useEffect(() => {
    setPrerequisitePanelMode(current => {
      const next = { ...current }
      for (const component of prerequisiteComponents) {
        if (!(component.component_key in next)) {
          next[component.component_key] = 'checklist'
        }
      }
      return next
    })
  }, [prerequisiteComponents])

  useEffect(() => {
    return () => {
      Object.values(operationPollersRef.current).forEach(timer => clearTimeout(timer))
      operationPollersRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (selectedAddonKey == null) return
    if (!addonComponents.some(component => component.component_key === selectedAddonKey)) {
      setSelectedAddonKey(null)
    }
  }, [addonComponents, selectedAddonKey])

  const appendPrerequisiteLog = useCallback((componentKey: string, entry: ActionLogEntry) => {
    setPrerequisiteActionLogs(current => {
      const previous = current[componentKey] ?? []
      if (previous.some(item => item.id === entry.id)) {
        return current
      }
      return {
        ...current,
        [componentKey]: [...previous, entry],
      }
    })
  }, [])

  const stopOperationPolling = useCallback((componentKey: string) => {
    const timer = operationPollersRef.current[componentKey]
    if (timer) {
      clearTimeout(timer)
      delete operationPollersRef.current[componentKey]
    }
  }, [])

  const loadComponents = useCallback(async () => {
    if (!serverId) return
    setPrerequisitesLoading(true)
    setAddonsLoading(true)
    setPrerequisiteError('')
    setAddonError('')

    const loadPrerequisites = async () => {
      try {
        const items = await Promise.all(
          Array.from(PREREQUISITE_COMPONENT_KEYS).map(componentKey =>
            getSoftwareComponent(serverId, componentKey)
          )
        )
        setPrerequisiteComponents(items)
      } catch (err) {
        setPrerequisiteComponents([])
        setPrerequisiteError(
          err instanceof Error ? err.message : 'Failed to load prerequisite components'
        )
      } finally {
        setPrerequisitesLoading(false)
      }
    }

    const loadAddons = async () => {
      try {
        const items = await listSoftwareComponents(serverId)
        setAddonComponents(items.filter(component => !isPrerequisiteComponent(component)))
      } catch (err) {
        setAddonComponents([])
        setAddonError(err instanceof Error ? err.message : 'Failed to load addon components')
      } finally {
        setAddonsLoading(false)
      }
    }

    await loadPrerequisites()
    await loadAddons()
  }, [serverId])

  const startOperationPolling = useCallback(
    (componentKey: string, operationId: string, actionLabel: string) => {
      stopOperationPolling(componentKey)

      const poll = async () => {
        try {
          const operation = await getSoftwareOperation(serverId, operationId)
          const terminal =
            operation.terminal_status !== 'none' ||
            operation.phase === 'succeeded' ||
            operation.phase === 'failed' ||
            operation.phase === 'attention_required'

          appendPrerequisiteLog(componentKey, {
            id: `${operation.id}:${operation.phase}:${operation.terminal_status}:${operation.updated}`,
            tone:
              operation.phase === 'failed' || operation.terminal_status === 'failed'
                ? 'error'
                : operation.phase === 'succeeded' || operation.terminal_status === 'success'
                  ? 'success'
                  : 'muted',
            text: `${formatTimestamp(operation.updated) || 'Now'} · ${actionLabel}: ${phaseLabelFromOperation(operation)}`,
          })

          if (terminal) {
            stopOperationPolling(componentKey)
            await loadComponents()
            return
          }

          operationPollersRef.current[componentKey] = setTimeout(poll, 1500)
        } catch (err) {
          appendPrerequisiteLog(componentKey, {
            id: `${componentKey}:poll-error:${Date.now()}`,
            tone: 'error',
            text: err instanceof Error ? err.message : `Failed to poll ${actionLabel} progress`,
          })
          stopOperationPolling(componentKey)
        }
      }

      void poll()
    },
    [appendPrerequisiteLog, loadComponents, serverId, stopOperationPolling]
  )

  useEffect(() => {
    void loadComponents()
  }, [loadComponents])

  const handleAction = useCallback(
    async (componentKey: string, action: SoftwareActionType) => {
      setActionLoading(`${componentKey}:${action}`)
      setActionError('')
      setActionMessage('')
      const isPrerequisite = PREREQUISITE_COMPONENT_KEYS.has(componentKey)
      const actionLabel =
        action === 'verify'
          ? 'Recheck'
          : action === 'reinstall' || action === 'upgrade'
            ? 'Upgrade/Fix'
            : action === 'install'
              ? 'Install'
              : action

      if (isPrerequisite) {
        setPrerequisiteOpen(current => ({ ...current, [componentKey]: true }))
        setPrerequisitePanelMode(current => ({ ...current, [componentKey]: 'operation' }))
        setPrerequisiteActiveActionLabel(current => ({ ...current, [componentKey]: actionLabel }))
        setPrerequisiteActionLogs(current => ({
          ...current,
          [componentKey]: [
            {
              id: `${componentKey}:${action}:requested`,
              tone: 'muted',
              text: `${actionLabel} requested...`,
            },
          ],
        }))
        stopOperationPolling(componentKey)
      }

      try {
        const response = await invokeSoftwareAction(serverId, componentKey, action, {
          apposBaseUrl:
            typeof window !== 'undefined' && window.location?.origin
              ? window.location.origin
              : undefined,
        })

        if (isPrerequisite) {
          appendPrerequisiteLog(componentKey, {
            id: `${componentKey}:${action}:accepted:${response.operation_id || 'local'}`,
            tone: 'muted',
            text: response.operation_id
              ? `${actionLabel} accepted (${response.operation_id})`
              : `${actionLabel} accepted`,
          })
        }

        setActionMessage(
          response.operation_id
            ? `${action} accepted for ${componentKey} (${response.operation_id})`
            : `${action} accepted for ${componentKey}`
        )

        if (isPrerequisite && response.operation_id) {
          startOperationPolling(componentKey, response.operation_id, actionLabel)
        } else {
          await loadComponents()
        }
      } catch (err) {
        if (isPrerequisite) {
          appendPrerequisiteLog(componentKey, {
            id: `${componentKey}:${action}:error:${Date.now()}`,
            tone: 'error',
            text: err instanceof Error ? err.message : `${actionLabel} failed`,
          })
        }
        setActionError(err instanceof Error ? err.message : `${action} failed`)
      } finally {
        setActionLoading(null)
      }
    },
    [appendPrerequisiteLog, loadComponents, serverId, startOperationPolling, stopOperationPolling]
  )

  return (
    <div className="space-y-4">
      {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <section className="space-y-3" aria-label="Prerequisites section">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h4 className="text-sm font-semibold text-foreground">Prerequisites</h4>
            <SectionHelp label="Prerequisites help">
              Core platform requirements that should be ready before AppOS manages workloads on this server.
            </SectionHelp>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void loadComponents()}
            title="Refresh"
            aria-label="Refresh components"
            className="shrink-0"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        {prerequisiteError && <p className="text-sm text-destructive">{prerequisiteError}</p>}

        {prerequisiteComponents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
            {prerequisitesLoading
              ? 'Loading prerequisites...'
              : 'No prerequisite components are defined for this server.'}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div aria-label="Prerequisite targets" className="space-y-3">
              {prerequisiteComponents.map(component => (
                <PrerequisiteCard
                  key={component.component_key}
                  component={component}
                  open={prerequisiteOpen[component.component_key] ?? false}
                  onOpenChange={open =>
                    setPrerequisiteOpen(current => ({ ...current, [component.component_key]: open }))
                  }
                  onAction={handleAction}
                  actionLoading={actionLoading}
                  panelMode={prerequisitePanelMode[component.component_key] ?? 'checklist'}
                  activeActionLabel={prerequisiteActiveActionLabel[component.component_key] ?? null}
                  actionLogs={prerequisiteActionLogs[component.component_key] ?? []}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-label="Addons section">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-semibold text-foreground">Addons</h4>
          <SectionHelp label="Addons help">
            Optional server-side components that AppOS can inspect, verify, install, or repair after the baseline is ready.
          </SectionHelp>
        </div>

        {addonError && <p className="text-sm text-destructive">{addonError}</p>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="space-y-4 rounded-md border p-4" aria-label="Addon inventory">
            <div className="grid grid-cols-[minmax(0,1.2fr)_6rem_7rem] gap-3 px-3 py-2 text-sm font-medium text-muted-foreground">
              <span>Component</span>
              <span>Status</span>
              <span>Activity</span>
            </div>

            {addonComponents.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                {addonsLoading ? 'Loading addons...' : 'No addon components found for this server.'}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {addonComponents.map(component => (
                  <AddonInventoryRow
                    key={component.component_key}
                    component={component}
                    selected={selectedAddonKey === component.component_key}
                    onSelect={setSelectedAddonKey}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="max-h-[calc(100vh-50px)] self-start overflow-auto space-y-4 rounded-md border p-4" aria-labelledby="selected-addon-heading">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="selected-addon-heading" className="text-sm font-semibold">Selected Addon</h3>
                <p className="text-xs text-muted-foreground">
                  {selectedAddon ? selectedAddon.label : 'Select one addon from the inventory.'}
                </p>
              </div>
              {selectedAddon ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {(selectedAddon.available_actions ?? []).map(action => {
                    const loadingKey = `${selectedAddon.component_key}:${action}`
                    const isThisLoading = actionLoading === loadingKey
                    return (
                      <Button
                        key={action}
                        variant="outline"
                        size="sm"
                        disabled={isInProgress(selectedAddon.last_operation) || isThisLoading}
                        onClick={() => void handleAction(selectedAddon.component_key, action)}
                        className="h-7 px-2 text-xs capitalize"
                      >
                        {isThisLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                        {action}
                      </Button>
                    )
                  })}
                </div>
              ) : null}
            </div>

            {!selectedAddon ? (
              <div className="text-sm text-muted-foreground">
                Choose a component to inspect status, activity, readiness issues, and available actions.
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="space-y-2">
                  {AddonDetailRows({ component: selectedAddon }).map(item => (
                    <div key={`${selectedAddon.component_key}:${item.label}`} className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                      <span className="shrink-0 font-medium text-foreground">{item.label}:</span>
                      <span className="break-words text-muted-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Verification</div>
                  <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                    {selectedAddon.verification?.reason || selectedAddon.verification_state || 'No verification details.'}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}
