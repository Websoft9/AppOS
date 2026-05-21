import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  CircleHelp,
  Loader2,
  MoreVertical,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  deleteSoftwareOperation,
  getConfiguredAppURL,
  getSoftwareOperation,
  getSoftwareComponent,
  invokeSoftwareAction,
  type InstallSource,
  listSoftwareOperations,
  listSoftwareComponents,
  type SoftwareOperation,
  type SoftwareActionType,
  type SoftwareComponentSummary,
  type SoftwareLastOperation,
} from '@/lib/software-api'
import type {
  DockerDependencyIssueCode,
  DockerFocusSource,
} from '@/components/docker/DockerDependencyAlert'

const PREREQUISITE_COMPONENT_KEYS = new Set(['docker'])
const MONITOR_AGENT_COMPONENT_KEY = 'appos-monitor-collector'
const MONITOR_AGENT_ADDRESS_ACTIONS = new Set<SoftwareActionType>([
  'install',
  'upgrade',
  'reinstall',
])
const ADDON_ACTIONS: SoftwareActionType[] = [
  'install',
  'verify',
  'start',
  'restart',
  'stop',
  'upgrade',
  'reinstall',
  'uninstall',
]
const DANGEROUS_ADDON_ACTIONS = new Set<SoftwareActionType>(['stop', 'reinstall', 'uninstall'])

export type ServerComponentActionIntent = {
  serverId: string
  componentKey: string
  action: SoftwareActionType
  nonce: number
}

function isPrerequisiteComponent(component: SoftwareComponentSummary): boolean {
  return PREREQUISITE_COMPONENT_KEYS.has(component.component_key)
}

function primaryAddonAction(component: SoftwareComponentSummary): SoftwareActionType | null {
  const actions = new Set(component.available_actions ?? [])
  const detected = component.detected_version?.trim() || ''
  const packaged = component.packaged_version?.trim() || ''
  if (component.installed_state !== 'installed' && actions.has('install')) return 'install'
  if (component.verification_state === 'degraded' && actions.has('reinstall')) return 'reinstall'
  if (detected && packaged && packaged !== detected && actions.has('upgrade')) return 'upgrade'
  if (component.verification_state !== 'healthy' && actions.has('start')) return 'start'
  if (component.verification_state === 'healthy' && actions.has('verify')) return 'verify'
  if (component.installed_state === 'installed' && actions.has('restart')) return 'restart'
  if (actions.has('verify')) return 'verify'
  if (component.verification_state !== 'healthy' && actions.has('stop')) return 'stop'
  return null
}

function isStoppedAddon(component: SoftwareComponentSummary): boolean {
  const reason = component.verification?.reason?.toLowerCase() ?? ''
  return (
    component.installed_state === 'installed' &&
    component.verification_state === 'degraded' &&
    ((component.available_actions ?? []).includes('start') ||
      reason.includes('stopped') ||
      reason.includes('inactive') ||
      reason.includes('not running'))
  )
}

function addonActionLabel(action: SoftwareActionType): string {
  if (action === 'verify') return 'Check'
  if (action === 'reinstall') return 'Repair'
  if (action === 'uninstall') return 'Remove'
  return action.charAt(0).toUpperCase() + action.slice(1)
}

function softwareActionLabel(action: SoftwareActionType | string | undefined): string {
  if (!action) return 'Action'
  if (action === 'verify') return 'Check'
  if (action === 'reinstall') return 'Repair'
  if (action === 'uninstall') return 'Remove'
  return action.charAt(0).toUpperCase() + action.slice(1)
}

function addonActionGroups(component: SoftwareComponentSummary): Array<{
  label: 'Recommended' | 'Secondary' | 'Dangerous'
  actions: SoftwareActionType[]
}> {
  const primary = primaryAddonAction(component)
  const recommended = primary ? [primary] : []
  const secondary = ADDON_ACTIONS.filter(
    action => action !== primary && !DANGEROUS_ADDON_ACTIONS.has(action)
  )
  const dangerous = ADDON_ACTIONS.filter(
    action => action !== primary && DANGEROUS_ADDON_ACTIONS.has(action)
  )
  const groups: Array<{
    label: 'Recommended' | 'Secondary' | 'Dangerous'
    actions: SoftwareActionType[]
  }> = [
    { label: 'Recommended', actions: recommended },
    { label: 'Secondary', actions: secondary },
    { label: 'Dangerous', actions: dangerous },
  ]
  return groups.filter(group => group.actions.length > 0)
}

function actionLogTone(operation: SoftwareOperation): ActionLogEntry['tone'] {
  if (operation.phase === 'failed' || operation.terminal_status === 'failed') return 'error'
  if (operation.phase === 'succeeded' || operation.terminal_status === 'success') return 'success'
  if (
    operation.phase === 'attention_required' ||
    operation.terminal_status === 'attention_required'
  ) {
    return 'error'
  }
  return 'muted'
}

// Returns a human-readable format label for artifact distribution kind.
function addonFormatLabel(kind: string | undefined): string | null {
  if (kind === 'package') return 'package'
  if (kind === 'binary') return 'binary'
  if (kind === 'docker') return 'docker'
  if (kind === 'script') return 'script'
  return null
}

function primaryPrerequisiteAction(component: SoftwareComponentSummary): SoftwareActionType | null {
  const actions = new Set(component.available_actions ?? [])
  if (component.installed_state !== 'installed' && actions.has('install')) return 'install'
  if (component.verification_state === 'degraded' && actions.has('reinstall')) return 'reinstall'
  if (component.verification_state === 'degraded' && actions.has('upgrade')) return 'upgrade'
  return null
}

function isDangerousPrerequisiteAction(action: SoftwareActionType): boolean {
  return action === 'upgrade' || action === 'reinstall'
}

function prerequisiteActionLabel(action: SoftwareActionType): string {
  if (action === 'verify') return 'Recheck'
  if (action === 'reinstall') return 'Repair'
  if (action === 'upgrade') return 'Upgrade'
  if (action === 'install') return 'Install'
  return addonActionLabel(action)
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

function addonInventoryBlockingError(component: SoftwareComponentSummary): string | null {
  const readinessIssues = component.preflight?.issues ?? []
  const readinessBlocker = readinessIssues.find(issue => !issue.startsWith('network_required:'))
  if (readinessBlocker) {
    return readinessBlocker
  }

  const verificationReason = component.verification?.reason?.trim()
  if (!verificationReason || component.verification_state !== 'degraded') {
    return null
  }

  const normalized = verificationReason.toLowerCase()
  if (
    normalized.includes('sudo') ||
    normalized.includes('permission') ||
    normalized.includes('privilege') ||
    normalized.includes('denied') ||
    normalized.includes('authentication') ||
    normalized.includes('auth ') ||
    normalized.includes('ssh') ||
    normalized.includes('operation not permitted') ||
    normalized.includes('not allowed')
  ) {
    return verificationReason
  }

  return null
}

function readVerificationDetails(
  component: SoftwareComponentSummary
): Record<string, unknown> | null {
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

function browserAppOSBaseURL(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.origin) return undefined
  return normalizeAppOSBaseURL(window.location.origin) || undefined
}

function normalizeAppOSBaseURL(value: string | undefined): string {
  const raw = value?.trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (!parsed.protocol || !parsed.host) return ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function needsMonitorAgentAddressChoice(componentKey: string, action: SoftwareActionType): boolean {
  return componentKey === MONITOR_AGENT_COMPONENT_KEY && MONITOR_AGENT_ADDRESS_ACTIONS.has(action)
}

function isMonitorAgentReportingAction(componentKey: string, action: SoftwareActionType): boolean {
  return componentKey === MONITOR_AGENT_COMPONENT_KEY && MONITOR_AGENT_ADDRESS_ACTIONS.has(action)
}

function acceptedActionSummary(
  componentKey: string,
  action: SoftwareActionType,
  actionLabel: string,
  operationId?: string
): string {
  const base = operationId ? `${actionLabel} accepted (${operationId})` : `${actionLabel} accepted`
  if (!isMonitorAgentReportingAction(componentKey, action)) {
    return base
  }
  return `${base}. Waiting for the first metrics sample from this server.`
}

function acceptedActionMessage(
  componentKey: string,
  action: SoftwareActionType,
  operationId?: string
): string {
  const base = operationId
    ? `${action} accepted for ${componentKey} (${operationId})`
    : `${action} accepted for ${componentKey}`
  if (!isMonitorAgentReportingAction(componentKey, action)) {
    return base
  }
  return `${base}. Waiting for the first metrics sample; AppOS Connection will show Connecting until trend data arrives.`
}

function phaseLabel(op: SoftwareLastOperation | undefined): string {
  if (!op) return ''
  if (op.terminal_status === 'success') return 'Succeeded'
  if (op.terminal_status === 'failed')
    return op.failure_reason ? `Failed: ${op.failure_reason}` : 'Failed'
  if (op.terminal_status === 'attention_required')
    return op.failure_reason ? `Attention required: ${op.failure_reason}` : 'Attention required'
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
  if (op.terminal_status === 'attention_required') {
    return op.failure_reason ? `Attention required: ${op.failure_reason}` : 'Attention required'
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

function isInProgress(op: SoftwareLastOperation | SoftwareOperation | undefined): boolean {
  return !!op && op.terminal_status === 'none'
}

function operationTone(op: SoftwareOperation): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (op.terminal_status === 'success' || op.phase === 'succeeded') return 'default'
  if (op.terminal_status === 'failed' || op.phase === 'failed') return 'destructive'
  if (op.terminal_status === 'attention_required' || op.phase === 'attention_required')
    return 'outline'
  return 'secondary'
}

function operationStatusBadgeLabel(op: SoftwareOperation): string {
  if (op.terminal_status === 'success') return 'Succeeded'
  if (op.terminal_status === 'failed') return 'Failed'
  if (op.terminal_status === 'attention_required') return 'Attention required'
  return phaseLabelFromOperation(op)
}

function operationEventLines(op: SoftwareOperation | undefined): string[] {
  if (!op?.event_log) return []
  return op.event_log
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function operationLogEntries(operation: SoftwareOperation, actionLabel: string): ActionLogEntry[] {
  const eventLines = operationEventLines(operation)
  if (eventLines.length > 0) {
    return eventLines.map((line, index) => ({
      id: `${operation.id}:event:${index}:${line}`,
      tone: actionLogTone(operation),
      text: line,
    }))
  }

  return [
    {
      id: `${operation.id}:${operation.phase}:${operation.terminal_status}:${operation.updated}`,
      tone: actionLogTone(operation),
      text: `${formatTimestamp(operation.updated) || 'Now'} · ${actionLabel}: ${phaseLabelFromOperation(operation)}`,
    },
  ]
}

function latestOperationEventLine(op: SoftwareOperation): string {
  const lines = operationEventLines(op)
  return lines.length > 0 ? lines[lines.length - 1] : ''
}

function isOperationInFlightError(message: string): boolean {
  return /operation already in flight|software operation already in flight/i.test(message)
}

function extractInFlightComponentKey(message: string): string | null {
  const match = message.match(/component\s+"([^"]+)"/i)
  return match?.[1]?.trim() || null
}

function statusTone(
  component: SoftwareComponentSummary
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (component.service_status === 'needs_attention') return 'destructive'
  if (component.service_status === 'stopped') return 'outline'
  if (component.service_status === 'running') return 'default'
  if (component.service_status === 'not_installed') return 'secondary'
  if (isStoppedAddon(component)) return 'outline'
  if (component.verification_state === 'degraded') return 'destructive'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return 'default'
  if (component.installed_state === 'not_installed') return 'secondary'
  return 'outline'
}

function statusLabel(component: SoftwareComponentSummary): string {
  switch (component.service_status) {
    case 'running':
      return 'Running'
    case 'stopped':
      return 'Stopped'
    case 'installed':
      return 'Installed'
    case 'not_installed':
      return 'Not Installed'
    case 'needs_attention':
      return 'Needs Attention'
    case 'unknown':
      return 'Unknown'
  }
  if (isStoppedAddon(component)) return 'Stopped'
  if (component.verification_state === 'degraded') return 'Needs Attention'
  // installed + healthy = runtime verified running — distinct from merely being installed
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return 'Running'
  // installed + unknown = deployment confirmed, runtime not yet verified
  if (component.installed_state === 'installed') return 'Installed'
  if (component.installed_state === 'not_installed') return 'Not Installed'
  return 'Unknown'
}

function appOSConnectionLabel(component: SoftwareComponentSummary): string | null {
  const reasons = (component.health_reasons ?? []).map(reason => String(reason).trim().toLowerCase())
  const awaitingFirstSample =
    reasons.includes('appos_connection:not_connected_no_sample') ||
    reasons.includes('appos_connection:unknown_monitor_summary')

  switch (component.appos_connection) {
    case 'connected':
      return 'Connected'
    case 'stale':
      return 'Stale'
    case 'not_connected':
      if (awaitingFirstSample) return 'Connecting'
      return 'Not Connected'
    case 'auth_failed':
      return 'Auth Failed'
    case 'misconfigured':
      return 'Misconfigured'
    case 'unknown':
      if (awaitingFirstSample) return 'Connecting'
      return 'Unknown'
    case 'not_applicable':
    case undefined:
      return null
  }
}

function healthReasonLabel(component: SoftwareComponentSummary): string {
  const reasons = component.health_reasons ?? []
  return reasons.length > 0 ? reasons.join(' | ') : '—'
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
  label: string
  action: SoftwareActionType | null
}> {
  const actions = new Set(component.available_actions ?? [])
  const repairOrUpgradeAction = actions.has('reinstall')
    ? 'reinstall'
    : actions.has('upgrade')
      ? 'upgrade'
      : null
  const slots: Array<{
    label: string
    action: SoftwareActionType | null
  }> = [
    {
      label: 'Recheck',
      action: actions.has('verify') ? 'verify' : null,
    },
    {
      label: repairOrUpgradeAction ? prerequisiteActionLabel(repairOrUpgradeAction) : 'Repair',
      action: repairOrUpgradeAction,
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

type PrerequisitePanelMode = 'checklist' | 'operation' | 'history'

function dockerFocusHintTitle(source: DockerFocusSource): string {
  if (source === 'compose') return 'Opened from Docker > Compose'
  if (source === 'containers') return 'Opened from Docker > Containers'
  if (source === 'images') return 'Opened from Docker > Images'
  if (source === 'volumes') return 'Opened from Docker > Volumes'
  if (source === 'networks') return 'Opened from Docker > Networks'
  return 'Opened from Docker > Overview'
}

function dockerFocusHintDescription({
  source,
  panelMode,
  issueCode,
}: {
  source: DockerFocusSource
  panelMode: PrerequisitePanelMode
  issueCode?: DockerDependencyIssueCode | null
}) {
  const sourceLabel =
    source === 'compose'
      ? 'Compose'
      : source === 'containers'
        ? 'Containers'
        : source === 'images'
          ? 'Images'
          : source === 'volumes'
            ? 'Volumes'
            : source === 'networks'
              ? 'Networks'
              : 'Overview'
  if (panelMode === 'history') {
    if (issueCode === 'docker_daemon_unavailable') {
      return `Docker prerequisite recovery was opened from the Docker ${sourceLabel} view. Review recent checks and repair history first, then verify the Docker daemon is running before retrying there.`
    }
    if (issueCode === 'docker_permission_denied') {
      return `Docker prerequisite recovery was opened from the Docker ${sourceLabel} view. Review recent checks and repair history first, then fix Docker socket access or privilege setup before retrying there.`
    }
    return `Docker prerequisite recovery was opened from the Docker ${sourceLabel} view. Review recent checks and repair history before retrying there.`
  }

  if (issueCode === 'compose_missing') {
    return `Docker prerequisite checks were opened from the Docker ${sourceLabel} view. Start by checking Docker Compose availability here, then return to that Docker screen and retry.`
  }
  if (issueCode === 'docker_missing') {
    return `Docker prerequisite checks were opened from the Docker ${sourceLabel} view. Start by checking Docker Engine installation here, then return to that Docker screen and retry.`
  }
  return `Docker prerequisite checks were opened from the Docker ${sourceLabel} view. Fix the baseline requirement here, then return to that Docker screen and retry.`
}

type ActionLogEntry = {
  id: string
  tone: 'muted' | 'success' | 'error'
  text: string
}

type AddonPanelMode = 'details' | 'operation' | 'history'

type MonitorAgentAddressChoice = {
  componentKey: string
  action: SoftwareActionType
  detectedURL: string
  configuredURL: string
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

function OperationHistory({
  serverId,
  componentKey,
  enabled = true,
  reloadKey,
}: {
  serverId: string
  componentKey: string
  enabled?: boolean
  reloadKey?: string
}) {
  const [operations, setOperations] = useState<SoftwareOperation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingOperationId, setDeletingOperationId] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    if (!serverId || !componentKey || !enabled) return
    setLoading(true)
    setError('')
    try {
      setOperations(await listSoftwareOperations(serverId, componentKey))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operation history')
    } finally {
      setLoading(false)
    }
  }, [componentKey, enabled, serverId])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory, reloadKey])

  const handleDelete = useCallback(
    async (operation: SoftwareOperation) => {
      if (isInProgress(operation)) return
      setDeletingOperationId(operation.id)
      setError('')
      try {
        await deleteSoftwareOperation(serverId, operation.id)
        setOperations(current => current.filter(item => item.id !== operation.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete operation history record')
      } finally {
        setDeletingOperationId(null)
      }
    },
    [serverId]
  )

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-medium text-foreground">
          Operation History ({operations.length})
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void loadHistory()}
          className="h-7 w-7 shrink-0 p-0"
          aria-label="Refresh operation history"
          title="Refresh operation history"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      {loading && operations.length === 0 ? (
        <div className="py-3 text-sm text-muted-foreground">Loading operation history...</div>
      ) : operations.length === 0 ? (
        <div className="py-3 text-sm text-muted-foreground">No operation history yet.</div>
      ) : (
        <div className="max-h-72 min-w-0 divide-y divide-border/60 overflow-y-auto overflow-x-hidden">
          {operations.map(operation => (
            <div
              key={operation.id}
              className={`grid min-w-0 max-w-full gap-2 py-2 text-sm sm:grid-cols-[minmax(0,8rem)_minmax(0,6rem)_minmax(0,1fr)_1.75rem] sm:items-start ${
                isInProgress(operation)
                  ? 'rounded-md border border-amber-300/70 bg-amber-50/40 px-2 dark:border-amber-500/40 dark:bg-amber-500/5'
                  : ''
              }`}
            >
              <div className="min-w-0 truncate text-xs text-muted-foreground">
                {formatTimestamp(operation.updated || operation.created) || '—'}
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                {isInProgress(operation) ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
                <span className="min-w-0 truncate text-xs font-medium capitalize text-foreground">
                  {operation.action}
                </span>
              </div>
              <div className="min-w-0 max-w-full space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={operationTone(operation)}
                    className="max-w-full truncate text-[11px]"
                  >
                    {operationStatusBadgeLabel(operation)}
                  </Badge>
                  {isInProgress(operation) ? (
                    <Badge variant="outline" className="text-[11px] font-normal">
                      Current
                    </Badge>
                  ) : null}
                </div>
                {operation.failure_reason ? (
                  <div className="max-w-full break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {operation.failure_reason}
                  </div>
                ) : latestOperationEventLine(operation) ? (
                  <div className="max-w-full break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {latestOperationEventLine(operation)}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isInProgress(operation) || deletingOperationId === operation.id}
                onClick={() => void handleDelete(operation)}
                className="h-7 w-7 justify-self-end p-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
                aria-label={`Delete ${operation.action} operation history record`}
                title={
                  isInProgress(operation)
                    ? 'In-flight operations cannot be deleted'
                    : 'Delete history record'
                }
              >
                {deletingOperationId === operation.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddonDetailRows({ component }: { component: SoftwareComponentSummary }) {
  const installSource = installSourceSummary(component)
  const lastOp = component.last_operation
  const lastActionAt = formatTimestamp(component.last_action?.at || lastOp?.updated_at)
  const readinessIssues = component.preflight?.issues ?? []
  const detected = component.detected_version?.trim() || null
  const packaged = component.packaged_version?.trim() || null
  const hasUpgrade = Boolean(detected && packaged && packaged !== detected)
  const apposConnection = appOSConnectionLabel(component)
  return [
    { label: 'Service Status', value: statusLabel(component) },
    ...(apposConnection ? [{ label: 'AppOS Connection', value: apposConnection }] : []),
    { label: 'Installed', value: detected || '—' },
    ...(hasUpgrade ? [{ label: 'Latest', value: packaged! }] : []),
    { label: 'Artifact', value: addonFormatLabel(component.template_kind) || '—' },
    { label: 'Install Source', value: installSource?.replace(/^Install source:\s*/i, '') || '—' },
    {
      label: 'Last Action',
      value:
        phaseLabel(lastOp) ||
        (component.last_action
          ? `${component.last_action.action} · ${component.last_action.result}`
          : '—'),
    },
    { label: 'Updated', value: lastActionAt || '—' },
    { label: 'Issues', value: readinessIssues.length ? readinessIssues.join(' | ') : '—' },
    {
      label: 'Verification',
      value: component.verification?.reason || component.verification_state || '—',
    },
    { label: 'Health Reasons', value: healthReasonLabel(component) },
  ]
}

function AddonActions({
  component,
  onAction,
  actionsLocked,
  actionLoading,
  moreActionsLabel,
  onBeforeAction,
}: {
  component: SoftwareComponentSummary
  onAction: (componentKey: string, action: SoftwareActionType) => void
  actionsLocked: boolean
  actionLoading: string | null
  moreActionsLabel: string
  onBeforeAction?: () => void
}) {
  const primary = primaryAddonAction(component)
  const availableActions = new Set(component.available_actions ?? [])

  const runAction = (action: SoftwareActionType) => {
    if (!availableActions.has(action) || actionsLocked) return
    onBeforeAction?.()
    onAction(component.component_key, action)
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {primary ? (
        <Button
          variant="default"
          size="sm"
          disabled={actionsLocked || actionLoading === `${component.component_key}:${primary}`}
          onClick={() => runAction(primary)}
          className="h-7 px-2 text-xs"
        >
          {actionLoading === `${component.component_key}:${primary}` ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : null}
          {addonActionLabel(primary)}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={actionsLocked}
            className="h-7 px-2 text-xs"
            aria-label={moreActionsLabel}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {addonActionGroups(component).map((group, groupIndex) => (
            <div key={group.label}>
              {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {group.label}
              </DropdownMenuLabel>
              {group.actions.map(action => {
                const available = availableActions.has(action)
                const loading = actionLoading === `${component.component_key}:${action}`
                return (
                  <DropdownMenuItem
                    key={`${group.label}:${action}`}
                    disabled={!available || actionsLocked}
                    variant={DANGEROUS_ADDON_ACTIONS.has(action) ? 'destructive' : 'default'}
                    onSelect={() => runAction(action)}
                    className="cursor-pointer text-xs"
                  >
                    {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    <span>{addonActionLabel(action)}</span>
                    {!available ? <span className="ml-auto text-[10px]">Locked</span> : null}
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function AddonInventoryRow({
  component,
  selected,
  onSelect,
  onAction,
  actionsLocked,
  actionLoading,
}: {
  component: SoftwareComponentSummary
  selected: boolean
  onSelect: (componentKey: string) => void
  onAction: (componentKey: string, action: SoftwareActionType) => void
  actionsLocked: boolean
  actionLoading: string | null
}) {
  const detected = component.detected_version?.trim() || null
  const packaged = component.packaged_version?.trim() || null
  const hasUpgrade = Boolean(detected && packaged && packaged !== detected)
  const apposConnection = appOSConnectionLabel(component)
  const inProgress = isInProgress(component.last_operation)

  const handleSelect = () => onSelect(component.component_key)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }

  const stopRowSelection = (event: React.SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className={`grid w-full grid-cols-[minmax(0,1.1fr)_11rem_6rem_9rem_10rem] items-center gap-3 px-3 py-2 text-left text-sm ${selected ? 'bg-accent/40' : 'hover:bg-accent/20'}`}
      aria-label={component.label}
    >
      <div className="min-w-0 space-y-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <div className="min-w-0 truncate font-medium text-foreground">{component.label}</div>
                {inProgress ? (
                  <Badge variant="outline" className="shrink-0 text-[11px] font-normal">
                    In progress
                  </Badge>
                ) : null}
              </div>
            </TooltipTrigger>
            {component.description ? (
              <TooltipContent side="right" className="max-w-xs">
                {component.description}
              </TooltipContent>
            ) : null}
          </Tooltip>
        </TooltipProvider>
        <div className="truncate text-[11px] font-mono text-muted-foreground">
          {component.component_key}
        </div>
      </div>
      <div className="min-w-0 space-y-0.5">
        <div className="truncate text-muted-foreground/70">
          Installed: {detected || '—'}
        </div>
        <div
          className={`truncate ${hasUpgrade ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70'}`}
        >
          Latest: {packaged || detected || '—'}
        </div>
      </div>
      <div className="truncate text-muted-foreground/80">
        {addonFormatLabel(component.template_kind) || '—'}
      </div>
      <div className="min-w-0 space-y-0.5 text-muted-foreground/80">
        <div className="truncate">Service: {statusLabel(component)}</div>
        {apposConnection ? <div className="truncate">AppOS: {apposConnection}</div> : null}
        {inProgress ? (
          <div className="truncate text-foreground/80">
            Operation: {phaseLabel(component.last_operation)}
          </div>
        ) : null}
      </div>
      <div
        className="flex items-center justify-end gap-1"
        onClick={stopRowSelection}
        onKeyDown={stopRowSelection}
        onPointerDown={stopRowSelection}
      >
        <AddonActions
          component={component}
          onAction={onAction}
          actionsLocked={actionsLocked}
          actionLoading={actionLoading}
          moreActionsLabel={`More actions for ${component.label}`}
          onBeforeAction={handleSelect}
        />
      </div>
    </div>
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
      label: 'Check Docker Engine installation',
      ready: component.installed_state === 'installed',
    },
    {
      label: 'Check Docker Engine version',
      ready: engineVersion !== '',
    },
    {
      label: 'Check Docker Compose availability',
      ready: composeAvailable,
    },
    {
      label: 'Check Docker Compose version',
      ready: composeVersion !== '',
    },
    ...prerequisiteChecks(component).map(check => ({
      label: `Check ${check.label}`,
      ready: check.ready,
    })),
  ]
  const summary = blockingSummary(
    component.installed_state,
    readinessIssues,
    composeAvailable,
    primaryAction
  )

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
        <div
          key={`${component.component_key}:${item.label}`}
          className="flex items-center gap-2 text-sm"
        >
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
  actionsLocked,
}: {
  component: SoftwareComponentSummary
  onAction: (componentKey: string, action: SoftwareActionType) => Promise<void>
  actionLoading: string | null
  actionsLocked: boolean
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
          const disabled = !slot.action || isThisLoading || actionsLocked
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
  onPanelModeChange,
  activeActionLabel,
  actionLogs,
  serverId,
  actionsLocked,
  focusHint,
}: {
  component: SoftwareComponentSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (componentKey: string, action: SoftwareActionType) => Promise<void>
  actionLoading: string | null
  panelMode: PrerequisitePanelMode
  onPanelModeChange: (mode: PrerequisitePanelMode) => void
  activeActionLabel: string | null
  actionLogs: ActionLogEntry[]
  serverId: string
  actionsLocked: boolean
  focusHint?: {
    source: DockerFocusSource
    panelMode: PrerequisitePanelMode
    issueCode?: DockerDependencyIssueCode | null
  } | null
}) {
  const context = readPrerequisiteContext(component)
  const lastOp = component.last_operation
  const liveLogStreaming = panelMode === 'operation' && isInProgress(lastOp)
  const lastActionAt = formatTimestamp(component.last_action?.at || lastOp?.updated_at)
  const headerSummary =
    component.verification_state === 'healthy'
      ? 'Checks passed'
      : 'Open details for verification and recovery actions'

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
              <div className="text-xs text-muted-foreground">{headerSummary}</div>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4 border-t border-border/60 px-4 py-4 text-sm">
            {focusHint && component.component_key === 'docker' ? (
              <Alert>
                <AlertTitle>{dockerFocusHintTitle(focusHint.source)}</AlertTitle>
                <AlertDescription>{dockerFocusHintDescription(focusHint)}</AlertDescription>
              </Alert>
            ) : null}
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
                    {context.composeAvailable && context.composeVersion
                      ? context.composeVersion
                      : 'Missing'}
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
                  actionsLocked={actionsLocked}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/35 p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onPanelModeChange('checklist')}
                    className={`h-7 rounded-sm px-2.5 text-xs ${panelMode === 'checklist' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-transparent hover:text-foreground'}`}
                  >
                    Checklist
                  </Button>
                  {actionLogs.length > 0 || panelMode === 'operation' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onPanelModeChange('operation')}
                      className={`h-7 rounded-sm px-2.5 text-xs ${panelMode === 'operation' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-transparent hover:text-foreground'}`}
                    >
                      Live Log
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onPanelModeChange('history')}
                    className={`h-7 rounded-sm px-2.5 text-xs ${panelMode === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-transparent hover:text-foreground'}`}
                  >
                    History
                  </Button>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 truncate text-sm font-medium text-foreground">
                    {panelMode === 'operation'
                      ? `${activeActionLabel || 'Action'} Log`
                      : panelMode === 'history'
                        ? 'Operation History'
                        : 'Verification Checklist'}
                  </div>
                  {liveLogStreaming ? (
                    <Badge variant="secondary" className="inline-flex items-center gap-1 text-[11px]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Streaming
                    </Badge>
                  ) : null}
                </div>
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
                    <div className="text-sm text-muted-foreground">
                      Waiting for operation updates...
                    </div>
                  )
                ) : panelMode === 'history' ? (
                  <OperationHistory
                    serverId={serverId}
                    componentKey={component.component_key}
                    enabled={open && panelMode === 'history'}
                    reloadKey={lastOp?.updated_at}
                  />
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

export function ServerComponentsPanel({
  serverId,
  actionIntent,
  onActionIntentConsumed,
  focusComponentKey,
  focusPanelMode,
  focusSource,
  focusIssueCode,
  onFocusRequestConsumed,
}: {
  serverId: string
  actionIntent?: ServerComponentActionIntent | null
  onActionIntentConsumed?: (nonce: number) => void
  focusComponentKey?: string | null
  focusPanelMode?: PrerequisitePanelMode | null
  focusSource?: DockerFocusSource | null
  focusIssueCode?: DockerDependencyIssueCode | null
  onFocusRequestConsumed?: (
    componentKey: string,
    panelMode: PrerequisitePanelMode,
    source?: DockerFocusSource | null,
    issueCode?: DockerDependencyIssueCode | null
  ) => void
}) {
  const [prerequisiteOpen, setPrerequisiteOpen] = useState<Record<string, boolean>>({})
  const [prerequisitePanelMode, setPrerequisitePanelMode] = useState<
    Record<string, PrerequisitePanelMode>
  >({})
  const [prerequisiteActiveActionLabel, setPrerequisiteActiveActionLabel] = useState<
    Record<string, string | null>
  >({})
  const [prerequisiteActionLogs, setPrerequisiteActionLogs] = useState<
    Record<string, ActionLogEntry[]>
  >({})
  const [selectedAddonKey, setSelectedAddonKey] = useState<string | null>(null)
  const [addonPanelMode, setAddonPanelMode] = useState<Record<string, AddonPanelMode>>({})
  const [addonActiveActionLabel, setAddonActiveActionLabel] = useState<
    Record<string, string | null>
  >({})
  const [addonActionLogs, setAddonActionLogs] = useState<Record<string, ActionLogEntry[]>>({})

  const [prerequisiteComponents, setPrerequisiteComponents] = useState<SoftwareComponentSummary[]>(
    []
  )
  const [addonComponents, setAddonComponents] = useState<SoftwareComponentSummary[]>([])
  const [prerequisitesLoading, setPrerequisitesLoading] = useState(true)
  const [addonsLoading, setAddonsLoading] = useState(true)
  const [prerequisiteError, setPrerequisiteError] = useState('')
  const [addonError, setAddonError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionConflictComponentKey, setActionConflictComponentKey] = useState<string | null>(null)
  const [confirmDangerAction, setConfirmDangerAction] = useState<{
    componentKey: string
    action: SoftwareActionType
    label: string
  } | null>(null)
  const [monitorAddressChoice, setMonitorAddressChoice] =
    useState<MonitorAgentAddressChoice | null>(null)
  const [activeOperationKeys, setActiveOperationKeys] = useState<Record<string, boolean>>({})
  const [focusHint, setFocusHint] = useState<{
    componentKey: string
    panelMode: PrerequisitePanelMode
    source: DockerFocusSource
    issueCode?: DockerDependencyIssueCode | null
  } | null>(null)
  const loading = prerequisitesLoading || addonsLoading
  const operationPollersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const restoredOperationIdsRef = useRef<Record<string, string>>({})
  const handledActionIntentRef = useRef<number | null>(null)
  const handledFocusRequestRef = useRef<string | null>(null)
  const prerequisiteCardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const selectedAddon = useMemo(
    () => addonComponents.find(component => component.component_key === selectedAddonKey) ?? null,
    [addonComponents, selectedAddonKey]
  )
  const allComponents = useMemo(
    () => [...prerequisiteComponents, ...addonComponents],
    [addonComponents, prerequisiteComponents]
  )
  const actionConflictComponent = useMemo(
    () =>
      actionConflictComponentKey
        ? allComponents.find(component => component.component_key === actionConflictComponentKey) ?? null
        : null,
    [actionConflictComponentKey, allComponents]
  )

  const actionsLocked =
    actionLoading !== null ||
    Object.values(activeOperationKeys).some(Boolean)

  useEffect(() => {
    if (!selectedAddon) return
    const currentMode = addonPanelMode[selectedAddon.component_key] ?? 'details'
    if (isInProgress(selectedAddon.last_operation) && currentMode === 'details') {
      setAddonPanelMode(current => ({ ...current, [selectedAddon.component_key]: 'operation' }))
    }
  }, [addonPanelMode, selectedAddon])

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
    if (!focusComponentKey) {
      handledFocusRequestRef.current = null
      return
    }
    const nextPanelMode = focusPanelMode ?? 'checklist'
    const focusRequestKey = `${focusComponentKey}:${nextPanelMode}`
    if (handledFocusRequestRef.current === focusRequestKey) return

    const target = prerequisiteComponents.find(
      component => component.component_key === focusComponentKey
    )
    if (!target) return

    handledFocusRequestRef.current = focusRequestKey
    setPrerequisiteOpen(current => ({ ...current, [focusComponentKey]: true }))
    setPrerequisitePanelMode(current => ({
      ...current,
      [focusComponentKey]: nextPanelMode,
    }))
    if (focusSource) {
      setFocusHint({
        componentKey: focusComponentKey,
        panelMode: nextPanelMode,
        source: focusSource,
        issueCode: focusIssueCode,
      })
    }

    requestAnimationFrame(() => {
      prerequisiteCardRefs.current[focusComponentKey]?.scrollIntoView?.({
        block: 'start',
        behavior: 'smooth',
      })
    })

    onFocusRequestConsumed?.(focusComponentKey, nextPanelMode, focusSource, focusIssueCode)
  }, [focusComponentKey, focusIssueCode, focusPanelMode, focusSource, onFocusRequestConsumed, prerequisiteComponents])

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

  useEffect(() => {
    setAddonPanelMode(current => {
      const next = { ...current }
      for (const component of addonComponents) {
        if (!(component.component_key in next)) {
          next[component.component_key] = 'details'
        }
      }
      return next
    })
  }, [addonComponents])

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

  const appendAddonLog = useCallback((componentKey: string, entry: ActionLogEntry) => {
    setAddonActionLogs(current => {
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

  const stopOperationPolling = useCallback((componentKey: string, clearActive = true) => {
    const timer = operationPollersRef.current[componentKey]
    if (timer) {
      clearTimeout(timer)
      delete operationPollersRef.current[componentKey]
    }
    if (clearActive) {
      setActiveOperationKeys(current => {
        if (!current[componentKey]) return current
        return { ...current, [componentKey]: false }
      })
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
        return items
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load prerequisite components'
        setPrerequisiteComponents([])
        setPrerequisiteError(message)
        return message
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

    const prerequisiteLoadResult = await loadPrerequisites()
    if (typeof prerequisiteLoadResult === 'string') {
      setAddonComponents([])
      setAddonError(prerequisiteLoadResult)
      setAddonsLoading(false)
      return
    }

    const prerequisiteBlocker = (prerequisiteLoadResult ?? [])
      .map(component => addonInventoryBlockingError(component))
      .find((message): message is string => !!message)
    if (prerequisiteBlocker) {
      setAddonComponents([])
      setAddonError(prerequisiteBlocker)
      setAddonsLoading(false)
      return
    }

    await loadAddons()
  }, [serverId])

  const startOperationPolling = useCallback(
    (
      componentKey: string,
      operationId: string,
      actionLabel: string,
      kind: 'prerequisite' | 'addon'
    ) => {
      stopOperationPolling(componentKey, false)

      const poll = async () => {
        try {
          const operation = await getSoftwareOperation(serverId, operationId)
          const terminal =
            operation.terminal_status !== 'none' ||
            operation.phase === 'succeeded' ||
            operation.phase === 'failed' ||
            operation.phase === 'attention_required'

          operationLogEntries(operation, actionLabel).forEach(entry => {
            if (kind === 'prerequisite') {
              appendPrerequisiteLog(componentKey, entry)
            } else {
              appendAddonLog(componentKey, entry)
            }
          })

          if (terminal) {
            delete restoredOperationIdsRef.current[componentKey]
            if (kind === 'addon') {
              setAddonPanelMode(current => ({ ...current, [componentKey]: 'history' }))
            }
            stopOperationPolling(componentKey)
            await loadComponents()
            return
          }

          operationPollersRef.current[componentKey] = setTimeout(poll, 1500)
        } catch {
          try {
            const latestComponent = await getSoftwareComponent(serverId, componentKey)
            if (!isInProgress(latestComponent.last_operation)) {
              delete restoredOperationIdsRef.current[componentKey]
              stopOperationPolling(componentKey)
              await loadComponents()
              return
            }
          } catch {
            // Keep the live log quiet on transient fetch failures and retry while the
            // operation may still be running.
          }

          operationPollersRef.current[componentKey] = setTimeout(poll, 1500)
        }
      }

      void poll()
    },
    [appendAddonLog, appendPrerequisiteLog, loadComponents, serverId, stopOperationPolling]
  )

  useEffect(() => {
    const inFlightPrerequisites = prerequisiteComponents.filter(component =>
      isInProgress(component.last_operation)
    )
    const inFlightAddons = addonComponents.filter(component => isInProgress(component.last_operation))

    for (const component of [...prerequisiteComponents, ...addonComponents]) {
      if (!isInProgress(component.last_operation)) {
        delete restoredOperationIdsRef.current[component.component_key]
      }
    }

    const restoreOperation = async (
      component: SoftwareComponentSummary,
      kind: 'prerequisite' | 'addon'
    ) => {
      const componentKey = component.component_key
      if (operationPollersRef.current[componentKey] || activeOperationKeys[componentKey]) {
        return
      }

      try {
        const operations = await listSoftwareOperations(serverId, componentKey)
        const currentOperation = operations.find(operation => isInProgress(operation))
        if (!currentOperation) {
          return
        }
        if (restoredOperationIdsRef.current[componentKey] === currentOperation.id) {
          return
        }

        restoredOperationIdsRef.current[componentKey] = currentOperation.id
        const actionLabel =
          kind === 'prerequisite'
            ? prerequisiteActionLabel(currentOperation.action)
            : addonActionLabel(currentOperation.action)

        if (kind === 'prerequisite') {
          setPrerequisiteOpen(current => ({ ...current, [componentKey]: true }))
          setPrerequisitePanelMode(current => ({ ...current, [componentKey]: 'operation' }))
          setPrerequisiteActiveActionLabel(current => ({ ...current, [componentKey]: actionLabel }))
          setPrerequisiteActionLogs(current => ({
            ...current,
            [componentKey]: operationLogEntries(currentOperation, actionLabel),
          }))
        } else {
          setSelectedAddonKey(current => current ?? componentKey)
          setAddonPanelMode(current => ({ ...current, [componentKey]: 'operation' }))
          setAddonActiveActionLabel(current => ({ ...current, [componentKey]: actionLabel }))
          setAddonActionLogs(current => ({
            ...current,
            [componentKey]: operationLogEntries(currentOperation, actionLabel),
          }))
        }

        setActiveOperationKeys(current => ({ ...current, [componentKey]: true }))
        startOperationPolling(componentKey, currentOperation.id, actionLabel, kind)
      } catch {
        // Fall back to the in-progress status badge/history view if history restoration fails.
      }
    }

    inFlightPrerequisites.forEach(component => {
      void restoreOperation(component, 'prerequisite')
    })
    inFlightAddons.forEach(component => {
      void restoreOperation(component, 'addon')
    })
  }, [activeOperationKeys, addonComponents, prerequisiteComponents, serverId, startOperationPolling])

  useEffect(() => {
    void loadComponents()
  }, [loadComponents])

  const executeAction = useCallback(
    async (componentKey: string, action: SoftwareActionType, apposBaseUrl?: string) => {
      setActionLoading(`${componentKey}:${action}`)
      setActionError('')
      setActionConflictComponentKey(null)
      setActionMessage('')
      const isPrerequisite = PREREQUISITE_COMPONENT_KEYS.has(componentKey)
      const actionLabel = isPrerequisite ? prerequisiteActionLabel(action) : addonActionLabel(action)

      if (isPrerequisite) {
        setPrerequisiteOpen(current => ({ ...current, [componentKey]: true }))
      }
      setActiveOperationKeys(current => ({ ...current, [componentKey]: true }))

      try {
        const response = await invokeSoftwareAction(serverId, componentKey, action, {
          apposBaseUrl: apposBaseUrl ?? browserAppOSBaseURL(),
        })

        if (isPrerequisite) {
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
              {
                id: `${componentKey}:${action}:accepted:${response.operation_id || 'local'}`,
                tone: 'muted',
                text: acceptedActionSummary(
                  componentKey,
                  action,
                  actionLabel,
                  response.operation_id || undefined
                ),
              },
            ],
          }))
          stopOperationPolling(componentKey)
        } else {
          setAddonPanelMode(current => ({ ...current, [componentKey]: 'operation' }))
          setAddonActiveActionLabel(current => ({ ...current, [componentKey]: actionLabel }))
          setAddonActionLogs(current => ({
            ...current,
            [componentKey]: [
              {
                id: `${componentKey}:${action}:requested`,
                tone: 'muted',
                text: `${actionLabel} requested...`,
              },
              {
                id: `${componentKey}:${action}:accepted:${response.operation_id || 'local'}`,
                tone: 'muted',
                text: acceptedActionSummary(
                  componentKey,
                  action,
                  actionLabel,
                  response.operation_id || undefined
                ),
              },
            ],
          }))
          stopOperationPolling(componentKey)
        }

        setActionMessage(acceptedActionMessage(componentKey, action, response.operation_id || undefined))

        if (isPrerequisite && response.operation_id) {
          setActiveOperationKeys(current => ({ ...current, [componentKey]: true }))
          startOperationPolling(componentKey, response.operation_id, actionLabel, 'prerequisite')
        } else if (response.operation_id) {
          setActiveOperationKeys(current => ({ ...current, [componentKey]: true }))
          startOperationPolling(componentKey, response.operation_id, actionLabel, 'addon')
        } else {
          setActiveOperationKeys(current => {
            if (!current[componentKey]) return current
            return { ...current, [componentKey]: false }
          })
          await loadComponents()
          if (!isPrerequisite) {
            setAddonPanelMode(current => ({ ...current, [componentKey]: 'history' }))
          }
        }
      } catch (err) {
        setActiveOperationKeys(current => {
          if (!current[componentKey]) return current
          return { ...current, [componentKey]: false }
        })
        const message = err instanceof Error ? err.message : `${action} failed`
        const conflictComponentKey = isOperationInFlightError(message)
          ? componentKey
          : extractInFlightComponentKey(message)
        setActionError(message)
        setActionConflictComponentKey(conflictComponentKey)
        if (conflictComponentKey) {
          if (PREREQUISITE_COMPONENT_KEYS.has(conflictComponentKey)) {
            setPrerequisiteOpen(current => ({ ...current, [conflictComponentKey]: true }))
            setPrerequisitePanelMode(current => ({ ...current, [conflictComponentKey]: 'history' }))
          } else {
            setSelectedAddonKey(conflictComponentKey)
            setAddonPanelMode(current => ({ ...current, [conflictComponentKey]: 'history' }))
          }
        }
      } finally {
        setActionLoading(null)
      }
    },
    [appendPrerequisiteLog, loadComponents, serverId, startOperationPolling, stopOperationPolling]
  )

  const resolveMonitorAgentAddressChoice = useCallback(
    async (componentKey: string, action: SoftwareActionType): Promise<string | null> => {
      const detectedURL = browserAppOSBaseURL()
      if (!needsMonitorAgentAddressChoice(componentKey, action)) {
        return detectedURL ?? null
      }

      let configuredURL = ''
      try {
        configuredURL = normalizeAppOSBaseURL(await getConfiguredAppURL())
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to load App URL')
        return null
      }

      if (!detectedURL) {
        if (configuredURL) return configuredURL
        setActionError('Cannot detect the AppOS callback address from this browser session.')
        return null
      }

      if (configuredURL && configuredURL !== detectedURL) {
        setMonitorAddressChoice({ componentKey, action, detectedURL, configuredURL })
        return null
      }

      return detectedURL
    },
    []
  )

  const handleAction = useCallback(
    async (componentKey: string, action: SoftwareActionType) => {
      if (PREREQUISITE_COMPONENT_KEYS.has(componentKey) && isDangerousPrerequisiteAction(action)) {
        setConfirmDangerAction({
          componentKey,
          action,
          label: prerequisiteActionLabel(action),
        })
        return
      }

      const apposBaseUrl = await resolveMonitorAgentAddressChoice(componentKey, action)
      if (needsMonitorAgentAddressChoice(componentKey, action) && !apposBaseUrl) return
      await executeAction(componentKey, action, apposBaseUrl ?? undefined)
    },
    [executeAction, resolveMonitorAgentAddressChoice]
  )

  useEffect(() => {
    if (!actionIntent || actionIntent.serverId !== serverId) return
    if (handledActionIntentRef.current === actionIntent.nonce) return
    if (addonsLoading || actionLoading !== null || actionsLocked) return
    const component = addonComponents.find(item => item.component_key === actionIntent.componentKey)
    if (!component) return
    if (!(component.available_actions ?? []).includes(actionIntent.action)) {
      setActionError(`${actionIntent.action} is not available for ${actionIntent.componentKey}`)
      handledActionIntentRef.current = actionIntent.nonce
      onActionIntentConsumed?.(actionIntent.nonce)
      return
    }

    handledActionIntentRef.current = actionIntent.nonce
    setSelectedAddonKey(actionIntent.componentKey)
    onActionIntentConsumed?.(actionIntent.nonce)
    void (async () => {
      const apposBaseUrl = await resolveMonitorAgentAddressChoice(
        actionIntent.componentKey,
        actionIntent.action
      )
      if (
        needsMonitorAgentAddressChoice(actionIntent.componentKey, actionIntent.action) &&
        !apposBaseUrl
      ) {
        return
      }
      await executeAction(actionIntent.componentKey, actionIntent.action, apposBaseUrl ?? undefined)
    })()
  }, [
    actionIntent,
    actionLoading,
    actionsLocked,
    addonComponents,
    addonsLoading,
    executeAction,
    onActionIntentConsumed,
    resolveMonitorAgentAddressChoice,
    serverId,
  ])

  return (
    <div className="space-y-4">
      <AlertDialog
        open={!!confirmDangerAction}
        onOpenChange={open => {
          if (!open) setConfirmDangerAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {confirmDangerAction?.label ?? 'Action'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDangerAction?.label ?? 'This action'} may{' '}
              {confirmDangerAction?.action === 'upgrade'
                ? 'upgrade or replace Docker components'
                : 'reinstall or replace Docker components'}{' '}
              on this server. Continue only if you are ready to interrupt the current runtime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDangerAction) return
                const next = confirmDangerAction
                setConfirmDangerAction(null)
                void executeAction(next.componentKey, next.action)
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!monitorAddressChoice}
        onOpenChange={open => {
          if (!open) setMonitorAddressChoice(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose monitor callback address</AlertDialogTitle>
            <AlertDialogDescription>
              The monitor agent will send metrics back to AppOS. The address detected from this
              browser session differs from the configured App URL. Choose the address that the
              target server can reach.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {monitorAddressChoice ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="font-medium text-foreground">Detected address</div>
                <div className="break-all text-muted-foreground">
                  {monitorAddressChoice.detectedURL}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="font-medium text-foreground">App URL</div>
                <div className="break-all text-muted-foreground">
                  {monitorAddressChoice.configuredURL}
                </div>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!monitorAddressChoice) return
                const next = monitorAddressChoice
                setMonitorAddressChoice(null)
                void executeAction(next.componentKey, next.action, next.detectedURL)
              }}
            >
              Use detected address
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (!monitorAddressChoice) return
                const next = monitorAddressChoice
                setMonitorAddressChoice(null)
                void executeAction(next.componentKey, next.action, next.configuredURL)
              }}
            >
              Use App URL
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
      {actionError && actionConflictComponent && isInProgress(actionConflictComponent.last_operation) ? (
        <Alert variant="destructive">
          <AlertTitle>Operation already in progress</AlertTitle>
          <AlertDescription className="space-y-2">
            <div>
              {actionConflictComponent.label} already has an active{' '}
              {softwareActionLabel(actionConflictComponent.last_operation?.action).toLowerCase()} request.
            </div>
            <div>
              Current phase: {phaseLabel(actionConflictComponent.last_operation)}. Last updated:{' '}
              {formatTimestamp(actionConflictComponent.last_operation?.updated_at) || '—'}.
            </div>
            <div className="flex items-center gap-2">
              {!PREREQUISITE_COMPONENT_KEYS.has(actionConflictComponent.component_key) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedAddonKey(actionConflictComponent.component_key)
                    setAddonPanelMode(current => ({
                      ...current,
                      [actionConflictComponent.component_key]: 'history',
                    }))
                  }}
                >
                  Open operation history
                </Button>
              ) : null}
              <span className="text-xs text-destructive/80">{actionError}</span>
            </div>
          </AlertDescription>
        </Alert>
      ) : actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}

      <section className="space-y-3" aria-label="Prerequisites section">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h4 className="text-sm font-semibold text-foreground">Prerequisites</h4>
            <SectionHelp label="Prerequisites help">
              Core platform requirements that should be ready before AppOS manages workloads on this
              server.
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
                <div
                  key={component.component_key}
                  ref={node => {
                    prerequisiteCardRefs.current[component.component_key] = node
                  }}
                  data-component-key={component.component_key}
                >
                  <PrerequisiteCard
                    component={component}
                    open={prerequisiteOpen[component.component_key] ?? false}
                    onOpenChange={open =>
                      setPrerequisiteOpen(current => ({
                        ...current,
                        [component.component_key]: open,
                      }))
                    }
                    onAction={handleAction}
                    actionLoading={actionLoading}
                    panelMode={prerequisitePanelMode[component.component_key] ?? 'checklist'}
                    onPanelModeChange={mode =>
                      setPrerequisitePanelMode(current => ({
                        ...current,
                        [component.component_key]: mode,
                      }))
                    }
                    activeActionLabel={prerequisiteActiveActionLabel[component.component_key] ?? null}
                    actionLogs={prerequisiteActionLogs[component.component_key] ?? []}
                    serverId={serverId}
                    actionsLocked={actionsLocked}
                    focusHint={focusHint?.componentKey === component.component_key ? focusHint : null}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-label="Addons section">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-semibold text-foreground">Addons</h4>
          <SectionHelp label="Addons help">
            Optional server-side components that AppOS can inspect, verify, install, or repair after
            the baseline is ready.
          </SectionHelp>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="space-y-4 rounded-md border p-4" aria-label="Addon inventory">
            <div className="grid grid-cols-[minmax(0,1.1fr)_11rem_6rem_9rem_10rem] gap-3 px-3 py-2 text-sm font-medium text-muted-foreground">
              <span>Component</span>
              <span>Version</span>
              <span>Artifact</span>
              <span>Health</span>
              <span className="text-right">Actions</span>
            </div>

            {addonError ? <p className="px-3 py-2 text-sm text-destructive">{addonError}</p> : null}

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
                    onAction={(componentKey, action) => {
                      void handleAction(componentKey, action)
                    }}
                    actionsLocked={actionsLocked}
                    actionLoading={actionLoading}
                  />
                ))}
              </div>
            )}
          </section>

          <section
            className="max-h-[calc(100vh-50px)] self-start overflow-auto space-y-4 rounded-md border p-4"
            aria-labelledby="selected-addon-heading"
          >
            <div>
              <h3 id="selected-addon-heading" className="text-sm font-semibold">
                Selected Addon
              </h3>
              <p className="text-xs text-muted-foreground">
                {selectedAddon ? selectedAddon.label : 'Select one addon from the inventory.'}
              </p>
            </div>

            {!selectedAddon ? (
              <div className="text-sm text-muted-foreground">
                Choose a component to inspect status, activity, readiness issues, and available
                actions.
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                {isInProgress(selectedAddon.last_operation) ? (
                  <Alert>
                    <AlertTitle>Operation in progress</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <div>
                        {softwareActionLabel(selectedAddon.last_operation?.action)} is still{' '}
                        {phaseLabel(selectedAddon.last_operation)} for {selectedAddon.label}.
                      </div>
                      <div>
                        Last updated:{' '}
                        {formatTimestamp(selectedAddon.last_operation?.updated_at) || '—'}.
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="space-y-2">
                  {(() => {
                    const selectedAddonMode = addonPanelMode[selectedAddon.component_key] ?? 'details'
                    const liveLogStreaming =
                      selectedAddonMode === 'operation' && isInProgress(selectedAddon.last_operation)

                    return (
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/35 p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setAddonPanelMode(current => ({
                            ...current,
                            [selectedAddon.component_key]: 'details',
                          }))
                        }
                        className={`h-7 rounded-sm px-2.5 text-xs ${
                          (addonPanelMode[selectedAddon.component_key] ?? 'details') === 'details'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-transparent hover:text-foreground'
                        }`}
                      >
                        Details
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setAddonPanelMode(current => ({
                            ...current,
                            [selectedAddon.component_key]: 'operation',
                          }))
                        }
                        className={`h-7 rounded-sm px-2.5 text-xs ${
                          (addonPanelMode[selectedAddon.component_key] ?? 'details') ===
                          'operation'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-transparent hover:text-foreground'
                        }`}
                      >
                        Live Log
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setAddonPanelMode(current => ({
                            ...current,
                            [selectedAddon.component_key]: 'history',
                          }))
                        }
                        className={`h-7 rounded-sm px-2.5 text-xs ${
                          (addonPanelMode[selectedAddon.component_key] ?? 'details') === 'history'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-transparent hover:text-foreground'
                        }`}
                      >
                        History
                      </Button>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 truncate text-sm font-medium text-foreground">
                        {selectedAddonMode === 'operation'
                          ? `${addonActiveActionLabel[selectedAddon.component_key] || 'Action'} Log`
                          : selectedAddonMode === 'history'
                            ? 'Operation History'
                            : 'Addon Details'}
                      </div>
                      {liveLogStreaming ? (
                        <Badge variant="secondary" className="inline-flex items-center gap-1 text-[11px]">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Streaming
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                    )
                  })()}

                  <div className="rounded-md border px-3 py-3">
                    {(addonPanelMode[selectedAddon.component_key] ?? 'details') === 'operation' ? (
                      (addonActionLogs[selectedAddon.component_key]?.length ?? 0) > 0 ? (
                        <div
                          aria-label="Addon action log entries"
                          className="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm"
                        >
                          {(addonActionLogs[selectedAddon.component_key] ?? []).map(entry => (
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
                        <div className="text-sm text-muted-foreground">
                          {addonActiveActionLabel[selectedAddon.component_key]
                            ? 'Waiting for operation updates...'
                            : 'No live log yet. Run an action to stream updates here.'}
                        </div>
                      )
                    ) : (addonPanelMode[selectedAddon.component_key] ?? 'details') === 'history' ? (
                      <OperationHistory
                        serverId={serverId}
                        componentKey={selectedAddon.component_key}
                        reloadKey={selectedAddon.last_operation?.updated_at}
                      />
                    ) : (
                      <div className="space-y-2">
                        {AddonDetailRows({ component: selectedAddon }).map(item => (
                          <div
                            key={`${selectedAddon.component_key}:${item.label}`}
                            className="flex flex-col gap-1 sm:flex-row sm:gap-2"
                          >
                            <span className="shrink-0 font-medium text-foreground">{item.label}:</span>
                            <span className="break-words text-muted-foreground">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
