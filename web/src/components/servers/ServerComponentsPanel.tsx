import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  listSupportedServerSoftware,
  listSoftwareOperations,
  listSoftwareComponents,
  type SoftwareOperation,
  type SoftwareActionType,
  type SoftwareComponentSummary,
  type SoftwareLastOperation,
  type SupportedServerSoftwareEntry,
} from '@/lib/software-api'
import type {
  DockerDependencyIssueCode,
  DockerFocusSource,
} from '@/components/docker/DockerDependencyAlert'

const PREREQUISITE_COMPONENT_KEYS = new Set(['docker'])
const MONITOR_AGENT_COMPONENT_KEYS = new Set(['telegraf', 'appos-monitor-collector'])
const MONITOR_AGENT_DISPLAY_KEY = 'appos-agent'
const MONITOR_AGENT_DISPLAY_LABEL = 'Monitor Agent (Native Telegraf)'
const MONITOR_AGENT_ADDRESS_ACTIONS = new Set<SoftwareActionType>([
  'install',
  'upgrade',
  'reinstall',
])
const POST_ACTION_REFRESH_DELAYS_MS = [1500, 5000, 12000, 25000]
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

type ResourcesT = TFunction<'resources'>

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
  if (hasStoppedAddonState(component) && actions.has('start')) return 'start'
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
    (reason.includes('stopped') || reason.includes('inactive') || reason.includes('not running'))
  )
}

function hasStoppedAddonState(component: SoftwareComponentSummary): boolean {
  return component.service_status === 'stopped' || isStoppedAddon(component)
}

function stoppedAddonGuidance(t: ResourcesT, component: SoftwareComponentSummary): string | null {
  if (!hasStoppedAddonState(component)) return null
  if ((component.available_actions ?? []).includes('start')) {
    return t('servers.componentsTab.guidance.stoppedWithStart')
  }
  return t('servers.componentsTab.guidance.stoppedWithoutStart')
}

function addonActionLabel(t: ResourcesT, action: SoftwareActionType): string {
  switch (action) {
    case 'verify':
      return t('servers.componentsTab.actionLabels.verify')
    case 'reinstall':
      return t('servers.componentsTab.actionLabels.reinstall')
    case 'uninstall':
      return t('servers.componentsTab.actionLabels.uninstall')
    case 'install':
      return t('servers.componentsTab.actionLabels.install')
    case 'upgrade':
      return t('servers.componentsTab.actionLabels.upgrade')
    case 'start':
      return t('servers.componentsTab.actionLabels.start')
    case 'restart':
      return t('servers.componentsTab.actionLabels.restart')
    case 'stop':
      return t('servers.componentsTab.actionLabels.stop')
    default:
      return String(action).charAt(0).toUpperCase() + String(action).slice(1)
  }
}

function softwareActionLabel(t: ResourcesT, action: SoftwareActionType | string | undefined): string {
  if (!action) return t('servers.componentsTab.actionLabels.default')
  if (action === 'verify') return t('servers.componentsTab.actionLabels.verify')
  if (action === 'reinstall') return t('servers.componentsTab.actionLabels.reinstall')
  if (action === 'uninstall') return t('servers.componentsTab.actionLabels.uninstall')
  if (action === 'install') return t('servers.componentsTab.actionLabels.install')
  if (action === 'upgrade') return t('servers.componentsTab.actionLabels.upgrade')
  if (action === 'start') return t('servers.componentsTab.actionLabels.start')
  if (action === 'restart') return t('servers.componentsTab.actionLabels.restart')
  if (action === 'stop') return t('servers.componentsTab.actionLabels.stop')
  return action.charAt(0).toUpperCase() + action.slice(1)
}

function addonActionGroupLabel(
  t: ResourcesT,
  label: 'Recommended' | 'Secondary' | 'Dangerous'
): string {
  if (label === 'Recommended') return t('servers.componentsTab.groups.recommended')
  if (label === 'Secondary') return t('servers.componentsTab.groups.secondary')
  return t('servers.componentsTab.groups.dangerous')
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

function addonArtifactLabel(
  component: Pick<SoftwareComponentSummary, 'artifact_kind' | 'template_kind'>,
  entry?: Pick<SupportedServerSoftwareEntry, 'artifact_kind'>
): string | null {
  return addonFormatLabel(
    component.artifact_kind ?? entry?.artifact_kind ?? component.template_kind
  )
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

function prerequisiteActionLabel(t: ResourcesT, action: SoftwareActionType): string {
  if (action === 'verify') return t('servers.componentsTab.actionLabels.recheck')
  if (action === 'reinstall') return t('servers.componentsTab.actionLabels.reinstall')
  if (action === 'upgrade') return t('servers.componentsTab.actionLabels.upgrade')
  if (action === 'install') return t('servers.componentsTab.actionLabels.install')
  return addonActionLabel(t, action)
}

function prerequisiteChecks(t: ResourcesT, component: SoftwareComponentSummary): Array<{
  label: string
  ready: boolean
}> {
  const readiness = component.preflight
  if (!readiness) {
    return []
  }

  return [
    {
      label: t('servers.componentsTab.prerequisiteChecks.osSupport'),
      ready: readiness.os_supported,
    },
    {
      label: t('servers.componentsTab.prerequisiteChecks.privilegedAccess'),
      ready: readiness.privilege_ok,
    },
    {
      label: t('servers.componentsTab.prerequisiteChecks.networkAccess'),
      ready: readiness.network_ok,
    },
    {
      label: t('servers.componentsTab.prerequisiteChecks.dependencyReadiness'),
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

function installSourceLabel(t: ResourcesT, source: InstallSource | undefined): string {
  if (source === 'managed') return t('servers.componentsTab.installSources.managed')
  if (source === 'foreign_package')
    return t('servers.componentsTab.installSources.foreignPackage')
  if (source === 'manual') return t('servers.componentsTab.installSources.manual')
  return t('servers.componentsTab.installSources.unknown')
}

function installSourceSummary(t: ResourcesT, component: SoftwareComponentSummary): string | null {
  if (component.installed_state !== 'installed') return null
  if (!component.install_source && !component.source_evidence) return null
  const label = installSourceLabel(t, component.install_source)
  return component.source_evidence
    ? t('servers.componentsTab.installSource.summaryWithEvidence', {
        label,
        evidence: component.source_evidence,
      })
    : t('servers.componentsTab.installSource.summary', { label })
}

function installSourceTone(component: SoftwareComponentSummary): string {
  if (component.install_source === 'foreign_package' || component.install_source === 'manual') {
    return 'text-amber-700 dark:text-amber-400'
  }
  return 'text-muted-foreground'
}

function isMonitorAgentComponentKey(componentKey: string): boolean {
  return MONITOR_AGENT_COMPONENT_KEYS.has(componentKey)
}

function displayComponentKey(componentKey: string): string {
  return isMonitorAgentComponentKey(componentKey) ? MONITOR_AGENT_DISPLAY_KEY : componentKey
}

function displayComponentLabel(
  component: Pick<SoftwareComponentSummary, 'component_key' | 'label'>
): string {
  if (isMonitorAgentComponentKey(component.component_key)) {
    return MONITOR_AGENT_DISPLAY_LABEL
  }
  const label = component.label?.trim()
  return label || component.component_key
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

function isMonitorAgentReportingAction(componentKey: string, action: SoftwareActionType): boolean {
  return isMonitorAgentComponentKey(componentKey) && MONITOR_AGENT_ADDRESS_ACTIONS.has(action)
}

function requiresAppOSBaseURL(
  entry: SupportedServerSoftwareEntry | undefined,
  action: SoftwareActionType
): boolean {
  return Boolean(entry?.requires_appos_base_url) && MONITOR_AGENT_ADDRESS_ACTIONS.has(action)
}

function acceptedActionSummary(
  t: ResourcesT,
  componentKey: string,
  action: SoftwareActionType,
  actionLabel: string,
  operationId?: string
): string {
  const base = operationId
    ? t('servers.componentsTab.actionFeedback.acceptedWithId', {
        action: actionLabel,
        operationId,
      })
    : t('servers.componentsTab.actionFeedback.accepted', { action: actionLabel })
  if (!isMonitorAgentReportingAction(componentKey, action)) {
    return base
  }
  return `${base}. ${t('servers.componentsTab.actionFeedback.waitingForFirstMetricsSample')}`
}

function acceptedActionMessage(
  t: ResourcesT,
  componentKey: string,
  action: SoftwareActionType,
  operationId?: string
): string {
  const componentDisplayKey = displayComponentKey(componentKey)
  const base = operationId
    ? t('servers.componentsTab.actionFeedback.acceptedForComponentWithId', {
        action,
        component: componentDisplayKey,
        operationId,
      })
    : t('servers.componentsTab.actionFeedback.acceptedForComponent', {
        action,
        component: componentDisplayKey,
      })
  if (!isMonitorAgentReportingAction(componentKey, action)) {
    return base
  }
  return `${base}. ${t('servers.componentsTab.actionFeedback.waitingForFirstMetricsSampleWithConnection')}`
}

function phaseLabel(t: ResourcesT, op: SoftwareLastOperation | undefined): string {
  if (!op) return ''
  if (op.failure_code === 'execution_timeout' || op.failure_code === 'verification_timeout') {
    return op.failure_reason
      ? t('servers.componentsTab.phase.timeoutWithReason', { reason: op.failure_reason })
      : t('servers.componentsTab.phase.timeout')
  }
  if (op.terminal_status === 'success') return t('servers.componentsTab.phase.succeeded')
  if (op.terminal_status === 'failed')
    return op.failure_reason
      ? t('servers.componentsTab.phase.failedWithReason', { reason: op.failure_reason })
      : t('servers.componentsTab.phase.failed')
  if (op.terminal_status === 'attention_required')
    return op.failure_reason
      ? t('servers.componentsTab.phase.attentionRequiredWithReason', { reason: op.failure_reason })
      : t('servers.componentsTab.phase.attentionRequired')
  switch (op.phase) {
    case 'accepted':
      return t('servers.componentsTab.phase.accepted')
    case 'preflight':
      return t('servers.componentsTab.phase.preflight')
    case 'executing':
      return t('servers.componentsTab.phase.executing')
    case 'verifying':
      return t('servers.componentsTab.phase.verifying')
    case 'succeeded':
      return t('servers.componentsTab.phase.succeeded')
    case 'failed':
      return t('servers.componentsTab.phase.failed')
    case 'attention_required':
      return t('servers.componentsTab.phase.attentionRequired')
    default:
      return op.phase
  }
}

function phaseLabelFromOperation(t: ResourcesT, op: SoftwareOperation | undefined): string {
  if (!op) return ''
  if (op.failure_code === 'execution_timeout' || op.failure_code === 'verification_timeout') {
    return op.failure_reason
      ? t('servers.componentsTab.phase.timeoutWithReason', { reason: op.failure_reason })
      : t('servers.componentsTab.phase.timeout')
  }
  if (op.terminal_status === 'success') return t('servers.componentsTab.phase.succeeded')
  if (op.terminal_status === 'failed') {
    return op.failure_reason
      ? t('servers.componentsTab.phase.failedWithReason', { reason: op.failure_reason })
      : t('servers.componentsTab.phase.failed')
  }
  if (op.terminal_status === 'attention_required') {
    return op.failure_reason
      ? t('servers.componentsTab.phase.attentionRequiredWithReason', { reason: op.failure_reason })
      : t('servers.componentsTab.phase.attentionRequired')
  }
  switch (op.phase) {
    case 'accepted':
      return t('servers.componentsTab.phase.accepted')
    case 'preflight':
      return t('servers.componentsTab.phase.preflight')
    case 'executing':
      return t('servers.componentsTab.phase.executing')
    case 'verifying':
      return t('servers.componentsTab.phase.verifying')
    case 'succeeded':
      return t('servers.componentsTab.phase.succeeded')
    case 'failed':
      return t('servers.componentsTab.phase.failed')
    case 'attention_required':
      return t('servers.componentsTab.phase.attentionRequired')
    default:
      return op.phase
  }
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

function operationStatusBadgeLabel(t: ResourcesT, op: SoftwareOperation): string {
  if (op.failure_code === 'execution_timeout' || op.failure_code === 'verification_timeout') {
    return t('servers.componentsTab.phase.timedOut')
  }
  if (op.terminal_status === 'success') return t('servers.componentsTab.phase.succeeded')
  if (op.terminal_status === 'failed') return t('servers.componentsTab.phase.failed')
  if (op.terminal_status === 'attention_required')
    return t('servers.componentsTab.phase.attentionRequired')
  return phaseLabelFromOperation(t, op)
}

function operationEventLines(op: SoftwareOperation | undefined): string[] {
  if (!op?.event_log) return []
  return op.event_log
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function operationLogEntries(
  t: ResourcesT,
  operation: SoftwareOperation,
  actionLabel: string
): ActionLogEntry[] {
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
      text: t('servers.componentsTab.actionFeedback.logEntry', {
        time: formatTimestamp(operation.updated) || t('servers.componentsTab.actionFeedback.now'),
        action: actionLabel,
        phase: phaseLabelFromOperation(t, operation),
      }),
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
  if (hasStoppedAddonState(component)) return 'outline'
  if (component.service_status === 'needs_attention') return 'destructive'
  if (component.service_status === 'stopped') return 'outline'
  if (component.service_status === 'running') return 'default'
  if (component.service_status === 'not_installed') return 'secondary'
  if (component.verification_state === 'degraded') return 'destructive'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return 'default'
  if (component.installed_state === 'not_installed') return 'secondary'
  return 'outline'
}

function statusLabel(t: ResourcesT, component: SoftwareComponentSummary): string {
  if (hasStoppedAddonState(component)) return t('servers.componentsTab.status.stopped')
  switch (component.service_status) {
    case 'running':
      return t('servers.componentsTab.status.running')
    case 'stopped':
      return t('servers.componentsTab.status.stopped')
    case 'installed':
      return t('servers.componentsTab.status.installed')
    case 'not_installed':
      return t('servers.componentsTab.status.notInstalled')
    case 'needs_attention':
      return t('servers.componentsTab.status.needsAttention')
    case 'unknown':
      return t('servers.componentsTab.status.unknown')
  }
  if (component.verification_state === 'degraded')
    return t('servers.componentsTab.status.needsAttention')
  // installed + healthy = runtime verified running — distinct from merely being installed
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return t('servers.componentsTab.status.running')
  // installed + unknown = deployment confirmed, runtime not yet verified
  if (component.installed_state === 'installed') return t('servers.componentsTab.status.installed')
  if (component.installed_state === 'not_installed')
    return t('servers.componentsTab.status.notInstalled')
  return t('servers.componentsTab.status.unknown')
}

function appOSConnectionLabel(t: ResourcesT, component: SoftwareComponentSummary): string | null {
  const reasons = (component.health_reasons ?? []).map(reason =>
    String(reason).trim().toLowerCase()
  )
  const awaitingFirstSample =
    reasons.includes('appos_connection:not_connected_no_sample') ||
    reasons.includes('appos_connection:unknown_monitor_summary')

  switch (component.appos_connection) {
    case 'connected':
      return t('servers.componentsTab.apposConnection.connected')
    case 'stale':
      return t('servers.componentsTab.apposConnection.stale')
    case 'not_connected':
      if (awaitingFirstSample) return t('servers.componentsTab.apposConnection.connecting')
      return t('servers.componentsTab.apposConnection.notConnected')
    case 'auth_failed':
      return t('servers.componentsTab.apposConnection.authFailed')
    case 'misconfigured':
      return t('servers.componentsTab.apposConnection.misconfigured')
    case 'unknown':
      if (awaitingFirstSample) return t('servers.componentsTab.apposConnection.connecting')
      return t('servers.componentsTab.apposConnection.unknown')
    case 'not_applicable':
    case undefined:
      return null
  }
}

function healthReasonLabel(component: SoftwareComponentSummary): string {
  const reasons = component.health_reasons ?? []
  return reasons.length > 0 ? reasons.join(' | ') : '—'
}

function prerequisiteStatusLabel(t: ResourcesT, component: SoftwareComponentSummary): string {
  if (component.verification_state === 'degraded')
    return t('servers.componentsTab.prerequisiteStatus.needsAttention')
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return t('servers.componentsTab.prerequisiteStatus.verified')
  if (component.installed_state === 'installed')
    return t('servers.componentsTab.prerequisiteStatus.detected')
  if (component.installed_state === 'not_installed')
    return t('servers.componentsTab.prerequisiteStatus.notReady')
  return t('servers.componentsTab.prerequisiteStatus.unknown')
}

function prerequisiteActionSlots(t: ResourcesT, component: SoftwareComponentSummary): Array<{
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
      label: t('servers.componentsTab.actionLabels.recheck'),
      action: actions.has('verify') ? 'verify' : null,
    },
    {
      label: repairOrUpgradeAction
        ? prerequisiteActionLabel(t, repairOrUpgradeAction)
        : t('servers.componentsTab.actionLabels.reinstall'),
      action: repairOrUpgradeAction,
    },
    {
      label: t('servers.componentsTab.actionLabels.install'),
      action: actions.has('install') ? 'install' : null,
    },
  ]

  if (component.installed_state !== 'installed') {
    return slots.filter(
      slot =>
        slot.label === t('servers.componentsTab.actionLabels.install') ||
        slot.label === t('servers.componentsTab.actionLabels.recheck')
    )
  }

  return slots.filter(slot => slot.label !== 'Install' || slot.action !== null)
}

type PrerequisitePanelMode = 'checklist' | 'operation' | 'history'

function dockerFocusSourceLabel(t: ResourcesT, source: DockerFocusSource): string {
  if (source === 'compose') return t('servers.componentsTab.dockerFocus.sources.compose')
  if (source === 'containers') return t('servers.componentsTab.dockerFocus.sources.containers')
  if (source === 'images') return t('servers.componentsTab.dockerFocus.sources.images')
  if (source === 'volumes') return t('servers.componentsTab.dockerFocus.sources.volumes')
  if (source === 'networks') return t('servers.componentsTab.dockerFocus.sources.networks')
  return t('servers.componentsTab.dockerFocus.sources.overview')
}

function dockerFocusHintTitle(t: ResourcesT, source: DockerFocusSource): string {
  return t('servers.componentsTab.dockerFocus.title', {
    source: dockerFocusSourceLabel(t, source),
  })
}

function dockerFocusHintDescription(t: ResourcesT, {
  source,
  panelMode,
  issueCode,
}: {
  source: DockerFocusSource
  panelMode: PrerequisitePanelMode
  issueCode?: DockerDependencyIssueCode | null
}) {
  const sourceLabel = dockerFocusSourceLabel(t, source)
  if (panelMode === 'history') {
    if (issueCode === 'docker_daemon_unavailable') {
      return t('servers.componentsTab.dockerFocus.history.daemonUnavailable', {
        source: sourceLabel,
      })
    }
    if (issueCode === 'docker_permission_denied') {
      return t('servers.componentsTab.dockerFocus.history.permissionDenied', {
        source: sourceLabel,
      })
    }
    return t('servers.componentsTab.dockerFocus.history.default', { source: sourceLabel })
  }

  if (issueCode === 'compose_missing') {
    return t('servers.componentsTab.dockerFocus.checks.composeMissing', {
      source: sourceLabel,
    })
  }
  if (issueCode === 'docker_missing') {
    return t('servers.componentsTab.dockerFocus.checks.dockerMissing', {
      source: sourceLabel,
    })
  }
  return t('servers.componentsTab.dockerFocus.checks.default', { source: sourceLabel })
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
  const { t } = useTranslation('resources')

  const loadHistory = useCallback(async () => {
    if (!serverId || !componentKey || !enabled) return
    setLoading(true)
    setError('')
    try {
      setOperations(await listSoftwareOperations(serverId, componentKey))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('servers.componentsTab.operationHistory.errors.load')
      )
    } finally {
      setLoading(false)
    }
  }, [componentKey, enabled, serverId, t])

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
        setError(
          err instanceof Error
            ? err.message
            : t('servers.componentsTab.operationHistory.errors.delete')
        )
      } finally {
        setDeletingOperationId(null)
      }
    },
    [serverId, t]
  )

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-medium text-foreground">
          {t('servers.componentsTab.operationHistory.title', { count: operations.length })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void loadHistory()}
          className="h-7 w-7 shrink-0 p-0"
          aria-label={t('servers.componentsTab.operationHistory.actions.refresh')}
          title={t('servers.componentsTab.operationHistory.actions.refresh')}
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
        <div className="py-3 text-sm text-muted-foreground">
          {t('servers.componentsTab.operationHistory.loading')}
        </div>
      ) : operations.length === 0 ? (
        <div className="py-3 text-sm text-muted-foreground">
          {t('servers.componentsTab.operationHistory.empty')}
        </div>
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
                    {operationStatusBadgeLabel(t, operation)}
                  </Badge>
                  {isInProgress(operation) ? (
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {t('servers.componentsTab.operationHistory.badges.current')}
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
                aria-label={t('servers.componentsTab.operationHistory.actions.deleteRecordFor', {
                  action: operation.action,
                })}
                title={
                  isInProgress(operation)
                    ? t('servers.componentsTab.operationHistory.actions.deleteBlocked')
                    : t('servers.componentsTab.operationHistory.actions.deleteRecord')
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

function addonDetailRows(
  t: ResourcesT,
  {
    component,
    entry,
  }: {
  component: SoftwareComponentSummary
  entry?: SupportedServerSoftwareEntry
}
) {
  const installSource = installSourceSummary(t, component)
  const lastOp = component.last_operation
  const lastActionAt = formatTimestamp(component.last_action?.at || lastOp?.updated_at)
  const readinessIssues = component.preflight?.issues ?? []
  const detected = component.detected_version?.trim() || null
  const packaged = component.packaged_version?.trim() || null
  const hasUpgrade = Boolean(detected && packaged && packaged !== detected)
  const apposConnection = appOSConnectionLabel(t, component)
  const guidance = stoppedAddonGuidance(t, component)
  return [
    { label: t('servers.componentsTab.detailRows.serviceStatus'), value: statusLabel(t, component) },
    ...(guidance ? [{ label: t('servers.componentsTab.detailRows.guidance'), value: guidance }] : []),
    ...(apposConnection
      ? [{ label: t('servers.componentsTab.detailRows.apposConnection'), value: apposConnection }]
      : []),
    { label: t('servers.componentsTab.detailRows.installed'), value: detected || '—' },
    ...(hasUpgrade ? [{ label: t('servers.componentsTab.detailRows.latest'), value: packaged! }] : []),
    {
      label: t('servers.componentsTab.detailRows.artifact'),
      value: addonArtifactLabel(component, entry) || '—',
    },
    {
      label: t('servers.componentsTab.detailRows.installSource'),
      value:
        installSource?.replace(/^Install source:\s*/i, '').replace(/^安装来源：\s*/i, '') || '—',
    },
    {
      label: t('servers.componentsTab.detailRows.lastAction'),
      value:
        phaseLabel(t, lastOp) ||
        (component.last_action
          ? `${component.last_action.action} · ${component.last_action.result}`
          : '—'),
    },
    { label: t('servers.componentsTab.detailRows.updated'), value: lastActionAt || '—' },
    {
      label: t('servers.componentsTab.detailRows.issues'),
      value: readinessIssues.length ? readinessIssues.join(' | ') : '—',
    },
    {
      label: t('servers.componentsTab.detailRows.verification'),
      value: component.verification?.reason || component.verification_state || '—',
    },
    { label: t('servers.componentsTab.detailRows.healthReasons'), value: healthReasonLabel(component) },
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
  const { t } = useTranslation('resources')
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
          {addonActionLabel(t, primary)}
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
                {addonActionGroupLabel(t, group.label)}
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
                    aria-label={
                      available
                        ? addonActionLabel(t, action)
                        : `${addonActionLabel(t, action)}Locked`
                    }
                  >
                    {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    <span>{addonActionLabel(t, action)}</span>
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
  entry,
  selected,
  onSelect,
  onAction,
  actionsLocked,
  actionLoading,
}: {
  component: SoftwareComponentSummary
  entry?: SupportedServerSoftwareEntry
  selected: boolean
  onSelect: (componentKey: string) => void
  onAction: (componentKey: string, action: SoftwareActionType) => void
  actionsLocked: boolean
  actionLoading: string | null
}) {
  const { t } = useTranslation('resources')
  const detected = component.detected_version?.trim() || null
  const packaged = component.packaged_version?.trim() || null
  const hasUpgrade = Boolean(detected && packaged && packaged !== detected)
  const artifact = addonArtifactLabel(component, entry)
  const apposConnection = appOSConnectionLabel(t, component)
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
      className={`grid w-full grid-cols-[minmax(0,1.35fr)_minmax(11rem,12rem)_minmax(13rem,1.1fr)_minmax(7.5rem,auto)] items-center gap-3 px-3 py-2 text-left text-sm ${selected ? 'bg-accent/40' : 'hover:bg-accent/20'}`}
      aria-label={displayComponentLabel(component)}
    >
      <div className="min-w-0 space-y-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <div className="min-w-0 truncate font-medium text-foreground">
                  {displayComponentLabel(component)}
                </div>
                {inProgress ? (
                  <Badge variant="outline" className="shrink-0 text-[11px] font-normal">
                    {t('servers.componentsTab.badges.inProgress')}
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
        {artifact ? <div className="text-[11px] text-muted-foreground">{artifact}</div> : null}
      </div>
      <div className="min-w-0 justify-self-start space-y-0.5 text-left">
        <div className="break-all text-muted-foreground/70">
          {t('servers.componentsTab.inventory.installed')}: {detected || '—'}
        </div>
        <div
          className={`break-all ${hasUpgrade ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70'}`}
        >
          {t('servers.componentsTab.inventory.latest')}: {packaged || detected || '—'}
        </div>
      </div>
      <div className="min-w-0 justify-self-start space-y-0.5 text-left text-muted-foreground/80">
        <div className="whitespace-normal break-words">
          {t('servers.componentsTab.inventory.service')}: {statusLabel(t, component)}
        </div>
        {apposConnection ? (
          <div className="whitespace-normal break-words">
            {t('servers.componentsTab.inventory.appos')}: {apposConnection}
          </div>
        ) : null}
        {inProgress ? (
          <div className="whitespace-normal break-words text-foreground/80">
            {t('servers.componentsTab.inventory.operation')}: {phaseLabel(t, component.last_operation)}
          </div>
        ) : null}
      </div>
      <div
        className="flex justify-self-start items-center justify-start gap-1 text-left"
        onClick={stopRowSelection}
        onKeyDown={stopRowSelection}
        onPointerDown={stopRowSelection}
      >
        <AddonActions
          component={component}
          onAction={onAction}
          actionsLocked={actionsLocked}
          actionLoading={actionLoading}
          moreActionsLabel={t('servers.componentsTab.inventory.moreActionsFor', {
            name: displayComponentLabel(component),
          })}
          onBeforeAction={handleSelect}
        />
      </div>
    </div>
  )
}

function readPrerequisiteContext(t: ResourcesT, component: SoftwareComponentSummary) {
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
  const installSource = installSourceSummary(t, component)
  const primaryAction = primaryPrerequisiteAction(component)
  const checklistItems = [
    {
      label: t('servers.componentsTab.checklist.checkDockerEngineInstallation'),
      ready: component.installed_state === 'installed',
    },
    {
      label: t('servers.componentsTab.checklist.checkDockerEngineVersion'),
      ready: engineVersion !== '',
    },
    {
      label: t('servers.componentsTab.checklist.checkDockerComposeAvailability'),
      ready: composeAvailable,
    },
    {
      label: t('servers.componentsTab.checklist.checkDockerComposeVersion'),
      ready: composeVersion !== '',
    },
    ...prerequisiteChecks(t, component).map(check => ({
      label: t('servers.componentsTab.checklist.checkItem', { label: check.label }),
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

function prerequisiteNeedsDetailHydration(component: SoftwareComponentSummary): boolean {
  if (component.component_key !== 'docker') return false
  const dockerVerificationDetails = readVerificationDetails(component)
  if (!dockerVerificationDetails) return true
  return !('compose_available' in dockerVerificationDetails) || !('compose_version' in dockerVerificationDetails)
}

function PrerequisiteChecklist({ component }: { component: SoftwareComponentSummary }) {
  const { t } = useTranslation('resources')
  const context = readPrerequisiteContext(t, component)
  return (
    <div className="space-y-2">
      {context.checklistItems.map((item, index) => (
        <div
          key={`${component.component_key}:${index}:${item.label}`}
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
  showInstallSource = true,
}: {
  component: SoftwareComponentSummary
  onAction: (componentKey: string, action: SoftwareActionType) => Promise<void>
  actionLoading: string | null
  actionsLocked: boolean
  showInstallSource?: boolean
}) {
  const { t } = useTranslation('resources')
  const installSource = installSourceSummary(t, component)
  const actionSlots = prerequisiteActionSlots(t, component)

  return (
    <>
      {showInstallSource && installSource ? (
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
  const { t } = useTranslation('resources')
  const context = readPrerequisiteContext(t, component)
  const lastOp = component.last_operation
  const liveLogStreaming = panelMode === 'operation' && isInProgress(lastOp)
  const lastActionAt = formatTimestamp(component.last_action?.at || lastOp?.updated_at)
  const headerSummary =
    component.verification_state === 'healthy'
      ? t('servers.componentsTab.prerequisiteCard.summary.checksPassed')
      : t('servers.componentsTab.prerequisiteCard.summary.openDetails')
  const installSource = installSourceSummary(t, component)

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="relative rounded-lg border border-border/60 bg-card">
        <div className="flex items-start gap-3 px-4 py-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 pr-8 text-left"
              aria-label={t('servers.componentsTab.prerequisiteCard.detailsFor', {
                name: displayComponentLabel(component),
              })}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-foreground">
                    {displayComponentLabel(component)}
                  </div>
                  <Badge variant={statusTone(component)} className="text-xs">
                    {prerequisiteStatusLabel(t, component)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">{headerSummary}</div>
              </div>
            </button>
          </CollapsibleTrigger>

          <div
            className="flex shrink-0 items-start gap-2"
            onClick={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
          >
            <PrerequisiteActions
              component={component}
              onAction={onAction}
              actionLoading={actionLoading}
              actionsLocked={actionsLocked}
              showInstallSource={false}
            />
          </div>
        </div>

        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute bottom-2 right-3 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground"
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4 border-t border-border/60 px-4 py-4 text-sm">
            {focusHint && component.component_key === 'docker' ? (
              <Alert>
                <AlertTitle>{dockerFocusHintTitle(t, focusHint.source)}</AlertTitle>
                <AlertDescription>{dockerFocusHintDescription(t, focusHint)}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="space-y-2">
                {installSource ? (
                  <div className={`text-xs ${installSourceTone(component)}`}>{installSource}</div>
                ) : null}
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">
                    {t('servers.componentsTab.prerequisiteCard.fields.status')}:
                  </span>
                  <span className="break-words text-muted-foreground">
                    {prerequisiteStatusLabel(t, component)}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">
                    {t('servers.componentsTab.prerequisiteCard.fields.version')}:
                  </span>
                  <span className="break-words text-muted-foreground">
                    {context.engineVersion || t('servers.componentsTab.prerequisiteCard.fallback.unavailable')}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">
                    {t('servers.componentsTab.prerequisiteCard.fields.dockerCompose')}:
                  </span>
                  <span className="break-words text-muted-foreground">
                    {context.composeAvailable && context.composeVersion
                      ? context.composeVersion
                      : t('servers.componentsTab.prerequisiteCard.fallback.missing')}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">
                    {t('servers.componentsTab.prerequisiteCard.fields.updated')}:
                  </span>
                  <span className="break-words text-muted-foreground">{lastActionAt || '—'}</span>
                </div>
              </div>

              <div className="lg:min-w-[12rem] lg:justify-self-end" />
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
                    {t('servers.componentsTab.panelTabs.checklist')}
                  </Button>
                  {actionLogs.length > 0 || panelMode === 'operation' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onPanelModeChange('operation')}
                      className={`h-7 rounded-sm px-2.5 text-xs ${panelMode === 'operation' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-transparent hover:text-foreground'}`}
                    >
                        {t('servers.componentsTab.panelTabs.liveLog')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onPanelModeChange('history')}
                    className={`h-7 rounded-sm px-2.5 text-xs ${panelMode === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-transparent hover:text-foreground'}`}
                  >
                    {t('servers.componentsTab.panelTabs.history')}
                  </Button>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 truncate text-sm font-medium text-foreground">
                    {panelMode === 'operation'
                      ? t('servers.componentsTab.panelTitles.actionLog', {
                          action: activeActionLabel || t('servers.componentsTab.actionLabels.default'),
                        })
                      : panelMode === 'history'
                        ? t('servers.componentsTab.panelTitles.operationHistory')
                        : t('servers.componentsTab.panelTitles.verificationChecklist')}
                  </div>
                  {liveLogStreaming ? (
                    <Badge
                      variant="secondary"
                      className="inline-flex items-center gap-1 text-[11px]"
                    >
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('servers.componentsTab.badges.streaming')}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="rounded-md border px-3 py-3">
                {panelMode === 'operation' ? (
                  actionLogs.length > 0 ? (
                    <div
                      aria-label={t('servers.componentsTab.logRegions.prerequisiteActionLogEntries')}
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
                      {t('servers.componentsTab.empty.waitingForOperationUpdates')}
                    </div>
                  )
                ) : panelMode === 'history' ? (
                  <OperationHistory
                    serverId={serverId}
                    componentKey={component.component_key}
                    reloadKey={component.last_operation?.updated_at}
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
  focusComponentKey,
  focusPanelMode,
  focusSource,
  focusIssueCode,
  onFocusRequestConsumed,
  actionIntent,
  onActionIntentConsumed,
  postActionRefreshDelaysMs = POST_ACTION_REFRESH_DELAYS_MS,
}: {
  serverId: string
  focusComponentKey?: string
  focusPanelMode?: PrerequisitePanelMode
  focusSource?: DockerFocusSource | null
  focusIssueCode?: DockerDependencyIssueCode | null
  onFocusRequestConsumed?: (
    componentKey: string,
    panelMode: PrerequisitePanelMode,
    source?: DockerFocusSource | null,
    issueCode?: DockerDependencyIssueCode | null
  ) => void
  actionIntent?: ServerComponentActionIntent | null
  onActionIntentConsumed?: (nonce: number) => void
  postActionRefreshDelaysMs?: number[]
}) {
  const { t } = useTranslation('resources')
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
  const [supportedCatalog, setSupportedCatalog] = useState<SupportedServerSoftwareEntry[]>([])
  const [activeOperationKeys, setActiveOperationKeys] = useState<Record<string, boolean>>({})
  const [focusHint, setFocusHint] = useState<{
    componentKey: string
    panelMode: PrerequisitePanelMode
    source: DockerFocusSource
    issueCode?: DockerDependencyIssueCode | null
  } | null>(null)
  const loading = prerequisitesLoading || addonsLoading
  const operationPollersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const postActionRefreshTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({})
  const restoredOperationIdsRef = useRef<Record<string, string>>({})
  const supportedCatalogPromiseRef = useRef<Promise<SupportedServerSoftwareEntry[]> | null>(null)
  const supportedCatalogLoadedRef = useRef(false)
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
  const supportedCatalogByKey = useMemo(
    () => new Map(supportedCatalog.map(item => [item.component_key, item])),
    [supportedCatalog]
  )
  const actionConflictComponent = useMemo(
    () =>
      actionConflictComponentKey
        ? (allComponents.find(
            component => component.component_key === actionConflictComponentKey
          ) ?? null)
        : null,
    [actionConflictComponentKey, allComponents]
  )

  const actionsLocked = actionLoading !== null || Object.values(activeOperationKeys).some(Boolean)

  const ensureSupportedCatalog = useCallback(async (): Promise<SupportedServerSoftwareEntry[]> => {
    if (supportedCatalogLoadedRef.current) return supportedCatalog
    if (supportedCatalogPromiseRef.current) return supportedCatalogPromiseRef.current
    const request = listSupportedServerSoftware()
      .then(items => {
        supportedCatalogLoadedRef.current = true
        setSupportedCatalog(items)
        return items
      })
      .catch(() => {
        supportedCatalogLoadedRef.current = true
        return []
      })
      .finally(() => {
        supportedCatalogPromiseRef.current = null
      })
    supportedCatalogPromiseRef.current = request
    return request
  }, [supportedCatalog])

  useEffect(() => {
    void ensureSupportedCatalog()
  }, [ensureSupportedCatalog])

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
  }, [
    focusComponentKey,
    focusIssueCode,
    focusPanelMode,
    focusSource,
    onFocusRequestConsumed,
    prerequisiteComponents,
  ])

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

  const cancelPostActionRefresh = useCallback((componentKey: string) => {
    const timers = postActionRefreshTimersRef.current[componentKey]
    if (!timers?.length) return
    timers.forEach(timer => clearTimeout(timer))
    delete postActionRefreshTimersRef.current[componentKey]
  }, [])

  const loadComponents = useCallback(async () => {
    if (!serverId) return
    setPrerequisitesLoading(true)
    setAddonsLoading(true)
    setPrerequisiteError('')
    setAddonError('')

    try {
      const items = await listSoftwareComponents(serverId)
      const prerequisites = items.filter(isPrerequisiteComponent)
      const addons = items.filter(component => !isPrerequisiteComponent(component))

      setPrerequisiteComponents(prerequisites)
      setPrerequisitesLoading(false)

      const prerequisiteBlocker = prerequisites
      .map(component => addonInventoryBlockingError(component))
      .find((message): message is string => !!message)
      if (prerequisiteBlocker) {
        setAddonComponents([])
        setAddonError(prerequisiteBlocker)
      } else {
        setAddonComponents(addons)
      }
      setAddonsLoading(false)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('servers.componentsTab.errors.loadPrerequisiteComponents')
      setPrerequisiteComponents([])
      setAddonComponents([])
      setPrerequisiteError(message)
      setAddonError(message)
      setPrerequisitesLoading(false)
      setAddonsLoading(false)
    }
  }, [serverId, t])

  const hydratePrerequisiteComponent = useCallback(
    async (componentKey: string) => {
      const currentComponent = prerequisiteComponents.find(
        component => component.component_key === componentKey
      )
      if (!currentComponent || !prerequisiteNeedsDetailHydration(currentComponent)) return

      try {
        const latestComponent = await getSoftwareComponent(serverId, componentKey)
        setPrerequisiteComponents(current =>
          current.map(component =>
            component.component_key === componentKey ? latestComponent : component
          )
        )
      } catch {
        // Keep the summary visible if detail hydration fails.
      }
    },
    [prerequisiteComponents, serverId]
  )

  const schedulePostActionRefresh = useCallback(
    (componentKey: string) => {
      cancelPostActionRefresh(componentKey)
      postActionRefreshTimersRef.current[componentKey] = postActionRefreshDelaysMs.map(delay =>
        setTimeout(() => {
          void loadComponents()
        }, delay)
      )
    },
    [cancelPostActionRefresh, loadComponents, postActionRefreshDelaysMs]
  )

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

          operationLogEntries(t, operation, actionLabel).forEach(entry => {
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
            schedulePostActionRefresh(componentKey)
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
              schedulePostActionRefresh(componentKey)
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
    [
      appendAddonLog,
      appendPrerequisiteLog,
      loadComponents,
      schedulePostActionRefresh,
      serverId,
      stopOperationPolling,
    ]
  )

  useEffect(() => {
    const inFlightPrerequisites = prerequisiteComponents.filter(component =>
      isInProgress(component.last_operation)
    )
    const inFlightAddons = addonComponents.filter(component =>
      isInProgress(component.last_operation)
    )

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
            ? prerequisiteActionLabel(t, currentOperation.action)
            : addonActionLabel(t, currentOperation.action)

        if (kind === 'prerequisite') {
          setPrerequisiteOpen(current => ({ ...current, [componentKey]: true }))
          setPrerequisitePanelMode(current => ({ ...current, [componentKey]: 'operation' }))
          setPrerequisiteActiveActionLabel(current => ({ ...current, [componentKey]: actionLabel }))
          setPrerequisiteActionLogs(current => ({
            ...current,
            [componentKey]: operationLogEntries(t, currentOperation, actionLabel),
          }))
        } else {
          setSelectedAddonKey(current => current ?? componentKey)
          setAddonPanelMode(current => ({ ...current, [componentKey]: 'operation' }))
          setAddonActiveActionLabel(current => ({ ...current, [componentKey]: actionLabel }))
          setAddonActionLogs(current => ({
            ...current,
            [componentKey]: operationLogEntries(t, currentOperation, actionLabel),
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
  }, [
    activeOperationKeys,
    addonComponents,
    prerequisiteComponents,
    serverId,
    startOperationPolling,
    t,
  ])

  useEffect(() => {
    void loadComponents()
  }, [loadComponents])

  const executeAction = useCallback(
    async (componentKey: string, action: SoftwareActionType, apposBaseUrl?: string) => {
      cancelPostActionRefresh(componentKey)
      setActionLoading(`${componentKey}:${action}`)
      setActionError('')
      setActionConflictComponentKey(null)
      setActionMessage('')
      const isPrerequisite = PREREQUISITE_COMPONENT_KEYS.has(componentKey)
      const actionLabel = isPrerequisite
        ? prerequisiteActionLabel(t, action)
        : addonActionLabel(t, action)

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
                  t,
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
                  t,
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

        setActionMessage(
          acceptedActionMessage(t, componentKey, action, response.operation_id || undefined)
        )

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
          schedulePostActionRefresh(componentKey)
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
    [
      appendPrerequisiteLog,
      cancelPostActionRefresh,
      loadComponents,
      schedulePostActionRefresh,
      serverId,
      startOperationPolling,
      stopOperationPolling,
    ]
  )

  useEffect(() => {
    return () => {
      Object.keys(postActionRefreshTimersRef.current).forEach(componentKey => {
        const timers = postActionRefreshTimersRef.current[componentKey] ?? []
        timers.forEach(timer => clearTimeout(timer))
      })
      postActionRefreshTimersRef.current = {}
    }
  }, [])

  const resolveMonitorAgentAddressChoice = useCallback(
    async (
      componentKey: string,
      action: SoftwareActionType
    ): Promise<{ apposBaseUrl: string | null; required: boolean }> => {
      const catalog = await ensureSupportedCatalog()
      const catalogEntry =
        supportedCatalogByKey.get(componentKey) ??
        catalog.find(item => item.component_key === componentKey)
      const required = requiresAppOSBaseURL(catalogEntry, action)
      const detectedURL = browserAppOSBaseURL()
      if (!required) {
        return { apposBaseUrl: detectedURL ?? null, required: false }
      }

      let configuredURL = ''
      try {
        configuredURL = normalizeAppOSBaseURL(await getConfiguredAppURL())
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : t('servers.componentsTab.dialogs.monitorAddress.errors.loadAppUrl')
        )
        return { apposBaseUrl: null, required: true }
      }

      if (!detectedURL) {
        if (configuredURL) return { apposBaseUrl: configuredURL, required: true }
        setActionError(t('servers.componentsTab.dialogs.monitorAddress.errors.detectCallback'))
        return { apposBaseUrl: null, required: true }
      }

      if (configuredURL && configuredURL !== detectedURL) {
        setMonitorAddressChoice({ componentKey, action, detectedURL, configuredURL })
        return { apposBaseUrl: null, required: true }
      }

      return { apposBaseUrl: detectedURL, required: true }
    },
    [ensureSupportedCatalog, supportedCatalogByKey, t]
  )

  const handleAction = useCallback(
    async (componentKey: string, action: SoftwareActionType) => {
      if (PREREQUISITE_COMPONENT_KEYS.has(componentKey) && isDangerousPrerequisiteAction(action)) {
        setConfirmDangerAction({
          componentKey,
          action,
            label: prerequisiteActionLabel(t, action),
        })
        return
      }

      const resolution = await resolveMonitorAgentAddressChoice(componentKey, action)
      if (resolution.required && !resolution.apposBaseUrl) return
      await executeAction(componentKey, action, resolution.apposBaseUrl ?? undefined)
    },
    [executeAction, resolveMonitorAgentAddressChoice, t]
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
      const resolution = await resolveMonitorAgentAddressChoice(
        actionIntent.componentKey,
        actionIntent.action
      )
      if (resolution.required && !resolution.apposBaseUrl) {
        return
      }
      await executeAction(
        actionIntent.componentKey,
        actionIntent.action,
        resolution.apposBaseUrl ?? undefined
      )
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
            <AlertDialogTitle>
              {t('servers.componentsTab.dialogs.confirmDanger.title', {
                action: confirmDangerAction?.label ?? t('servers.componentsTab.actionLabels.default'),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('servers.componentsTab.dialogs.confirmDanger.description', {
                action: confirmDangerAction?.label ?? t('servers.componentsTab.actionLabels.default'),
                consequence:
                  confirmDangerAction?.action === 'upgrade'
                    ? t('servers.componentsTab.dialogs.confirmDanger.upgradeConsequence')
                    : t('servers.componentsTab.dialogs.confirmDanger.reinstallConsequence'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('servers.componentsTab.dialogs.confirmDanger.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDangerAction) return
                const next = confirmDangerAction
                setConfirmDangerAction(null)
                void executeAction(next.componentKey, next.action)
              }}
            >
              {t('servers.componentsTab.dialogs.confirmDanger.continue')}
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
        <AlertDialogContent className="sm:max-w-xl">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setMonitorAddressChoice(null)}
            aria-label={t('servers.componentsTab.dialogs.monitorAddress.close')}
          >
            <X className="h-4 w-4" />
          </Button>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('servers.componentsTab.dialogs.monitorAddress.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('servers.componentsTab.dialogs.monitorAddress.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {monitorAddressChoice ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {t('servers.componentsTab.dialogs.monitorAddress.detectedAddress')}
                  </div>
                  <div className="break-all text-muted-foreground">
                    {monitorAddressChoice.detectedURL}
                  </div>
                </div>
                <Button
                  type="button"
                  className="shrink-0"
                  onClick={() => {
                    const next = monitorAddressChoice
                    setMonitorAddressChoice(null)
                    void executeAction(next.componentKey, next.action, next.detectedURL)
                  }}
                >
                  {t('servers.componentsTab.dialogs.monitorAddress.useDetectedAddress')}
                </Button>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {t('servers.componentsTab.dialogs.monitorAddress.appUrl')}
                  </div>
                  <div className="break-all text-muted-foreground">
                    {monitorAddressChoice.configuredURL}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    const next = monitorAddressChoice
                    setMonitorAddressChoice(null)
                    void executeAction(next.componentKey, next.action, next.configuredURL)
                  }}
                >
                  {t('servers.componentsTab.dialogs.monitorAddress.useAppUrl')}
                </Button>
              </div>
            </div>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
      {actionError &&
      actionConflictComponent &&
      isInProgress(actionConflictComponent.last_operation) ? (
        <Alert variant="destructive">
          <AlertTitle>{t('servers.componentsTab.alerts.operationAlreadyInProgress.title')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <div>
              {t('servers.componentsTab.alerts.operationAlreadyInProgress.description', {
                name: displayComponentLabel(actionConflictComponent),
                action: softwareActionLabel(t, actionConflictComponent.last_operation?.action).toLowerCase(),
              })}
            </div>
            <div>
              {t('servers.componentsTab.alerts.operationAlreadyInProgress.currentPhase')}:{' '}
              {phaseLabel(t, actionConflictComponent.last_operation)}. {t('servers.componentsTab.alerts.operationAlreadyInProgress.lastUpdated')}:{' '}
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
                  {t('servers.componentsTab.alerts.operationAlreadyInProgress.openOperationHistory')}
                </Button>
              ) : null}
              <span className="text-xs text-destructive/80">{actionError}</span>
            </div>
          </AlertDescription>
        </Alert>
      ) : actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}

      <section
        className="space-y-3"
        aria-label={t('servers.componentsTab.sections.prerequisitesRegion')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h4 className="text-sm font-semibold text-foreground">
              {t('servers.componentsTab.sections.prerequisites')}
            </h4>
            <SectionHelp label={t('servers.componentsTab.help.prerequisitesLabel')}>
              {t('servers.componentsTab.help.prerequisitesBody')}
            </SectionHelp>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void loadComponents()}
            title={t('servers.componentsTab.actions.refresh')}
            aria-label={t('servers.componentsTab.actions.refreshComponents')}
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
              ? t('servers.componentsTab.empty.loadingPrerequisites')
              : t('servers.componentsTab.empty.noPrerequisites')}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div
              aria-label={t('servers.componentsTab.sections.prerequisiteTargets')}
              className="space-y-3"
            >
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
                      {
                        setPrerequisiteOpen(current => ({
                          ...current,
                          [component.component_key]: open,
                        }))
                        if (open) {
                          void hydratePrerequisiteComponent(component.component_key)
                        }
                      }
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
                    activeActionLabel={
                      prerequisiteActiveActionLabel[component.component_key] ?? null
                    }
                    actionLogs={prerequisiteActionLogs[component.component_key] ?? []}
                    serverId={serverId}
                    actionsLocked={actionsLocked}
                    focusHint={
                      focusHint?.componentKey === component.component_key ? focusHint : null
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-label={t('servers.componentsTab.sections.addonsRegion')}>
        <div className="flex items-center gap-1.5">
          <h4 aria-label="Addons" className="text-sm font-semibold text-foreground">
            {t('servers.componentsTab.sections.addons')}
          </h4>
          <SectionHelp label={t('servers.componentsTab.help.addonsLabel')}>
            {t('servers.componentsTab.help.addonsBody')}
          </SectionHelp>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section
            className="space-y-4 rounded-md border p-4"
            aria-label={t('servers.componentsTab.sections.addonInventory')}
          >
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(11rem,12rem)_minmax(13rem,1.1fr)_minmax(7.5rem,auto)] gap-3 px-3 py-2 text-left text-sm font-medium text-muted-foreground">
              <span className="text-left">{t('servers.componentsTab.columns.name')}</span>
              <span className="justify-self-start text-left">
                {t('servers.componentsTab.columns.version')}
              </span>
              <span className="justify-self-start text-left">
                {t('servers.componentsTab.columns.health')}
              </span>
              <span className="justify-self-start text-left">
                {t('servers.componentsTab.columns.actions')}
              </span>
            </div>

            {addonError ? <p className="px-3 py-2 text-sm text-destructive">{addonError}</p> : null}

            {addonComponents.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                {addonsLoading
                  ? t('servers.componentsTab.empty.loadingAddons')
                  : t('servers.componentsTab.empty.noAddons')}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {addonComponents.map(component => (
                  <AddonInventoryRow
                    key={component.component_key}
                    component={component}
                    entry={supportedCatalogByKey.get(component.component_key)}
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
                {t('servers.componentsTab.selectedAddon.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {selectedAddon
                  ? displayComponentLabel(selectedAddon)
                  : t('servers.componentsTab.selectedAddon.selectFromInventory')}
              </p>
            </div>

            {!selectedAddon ? (
              <div className="text-sm text-muted-foreground">
                {t('servers.componentsTab.selectedAddon.empty')}
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                {isInProgress(selectedAddon.last_operation) ? (
                  <Alert>
                    <AlertTitle>{t('servers.componentsTab.selectedAddon.inProgress.title')}</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <div>
                        {softwareActionLabel(t, selectedAddon.last_operation?.action)} {t('servers.componentsTab.selectedAddon.inProgress.isStill')}{' '}
                        {phaseLabel(t, selectedAddon.last_operation)} for{' '}
                        {displayComponentLabel(selectedAddon)}.
                      </div>
                      <div>
                        {t('servers.componentsTab.selectedAddon.inProgress.lastUpdated')}:{' '}
                        {formatTimestamp(selectedAddon.last_operation?.updated_at) || '—'}.
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="space-y-2">
                  {(() => {
                    const selectedAddonMode =
                      addonPanelMode[selectedAddon.component_key] ?? 'details'
                    const liveLogStreaming =
                      selectedAddonMode === 'operation' &&
                      isInProgress(selectedAddon.last_operation)

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
                              (addonPanelMode[selectedAddon.component_key] ?? 'details') ===
                              'details'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-transparent hover:text-foreground'
                            }`}
                          >
                            {t('servers.componentsTab.panelTabs.details')}
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
                            {t('servers.componentsTab.panelTabs.liveLog')}
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
                              (addonPanelMode[selectedAddon.component_key] ?? 'details') ===
                              'history'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-transparent hover:text-foreground'
                            }`}
                          >
                            {t('servers.componentsTab.panelTabs.history')}
                          </Button>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 truncate text-sm font-medium text-foreground">
                            {selectedAddonMode === 'operation'
                              ? t('servers.componentsTab.panelTitles.actionLog', {
                                  action:
                                    addonActiveActionLabel[selectedAddon.component_key] ||
                                    t('servers.componentsTab.actionLabels.default'),
                                })
                              : selectedAddonMode === 'history'
                                ? t('servers.componentsTab.panelTitles.operationHistory')
                                : t('servers.componentsTab.panelTitles.addonDetails')}
                          </div>
                          {liveLogStreaming ? (
                            <Badge
                              variant="secondary"
                              className="inline-flex items-center gap-1 text-[11px]"
                            >
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t('servers.componentsTab.badges.streaming')}
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
                          aria-label={t('servers.componentsTab.logRegions.addonActionLogEntries')}
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
                            ? t('servers.componentsTab.empty.waitingForOperationUpdates')
                            : t('servers.componentsTab.empty.noLiveLogYet')}
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
                        {addonDetailRows(t, {
                          component: selectedAddon,
                          entry: supportedCatalogByKey.get(selectedAddon.component_key),
                        }).map(item => (
                          <div
                            key={`${selectedAddon.component_key}:${item.label}`}
                            className="flex flex-col gap-1 sm:flex-row sm:gap-2"
                          >
                            <span className="shrink-0 font-medium text-foreground">
                              {item.label}:
                            </span>
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
