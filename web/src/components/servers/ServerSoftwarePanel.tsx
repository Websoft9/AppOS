import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  invokeSoftwareAction,
  type InstallSource,
  listSoftwareComponents,
  type SoftwareActionType,
  type SoftwareComponentSummary,
  type SoftwareLastOperation,
} from '@/lib/software-api'

const PREREQUISITE_COMPONENT_KEYS = new Set(['docker'])

function isPrerequisiteComponent(component: SoftwareComponentSummary): boolean {
  return PREREQUISITE_COMPONENT_KEYS.has(component.component_key)
}

function primaryPrerequisiteAction(component: SoftwareComponentSummary): SoftwareActionType | null {
  const actions = new Set(component.available_actions)
  if (component.installed_state !== 'installed' && actions.has('install')) return 'install'
  if (component.verification_state === 'degraded' && actions.has('reinstall')) return 'reinstall'
  if (component.verification_state === 'degraded' && actions.has('upgrade')) return 'upgrade'
  return null
}

function prerequisiteRole(component: SoftwareComponentSummary): string {
  if (component.component_key === 'docker') {
    return 'Container runtime required for platform-managed workloads.'
  }
  return 'Platform baseline component.'
}

function prerequisiteImpact(component: SoftwareComponentSummary): string {
  if (component.installed_state !== 'installed') {
    return 'Missing this prerequisite blocks managed container delivery on the server.'
  }
  if (component.verification_state === 'degraded') {
    return 'The platform baseline is present but degraded and may block delivery or runtime operations.'
  }
  return 'The platform baseline is available for managed delivery workflows.'
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
  if (component.installed_state === 'installed' && component.verification_state === 'healthy')
    return 'Installed'
  if (component.installed_state === 'not_installed') return 'Not Installed'
  return 'Unknown'
}

function ComponentRow({
  component,
  onAction,
  actionLoading,
}: {
  component: SoftwareComponentSummary
  onAction: (componentKey: string, action: SoftwareActionType) => Promise<void>
  actionLoading: string | null
}) {
  const lastOp = component.last_operation
  const inProgress = isInProgress(lastOp)
  const phase = phaseLabel(lastOp)
  const isLastSucceeded = lastOp?.terminal_status === 'success'
  const isLastFailed = lastOp?.terminal_status === 'failed'
  const readinessIssues = component.preflight?.issues ?? []
  const installSource = installSourceSummary(component)
  const versionLabel = component.detected_version || component.packaged_version || '—'
  const lastActionAt = formatTimestamp(component.last_action?.at)
  const activityLabel = inProgress
    ? phase
    : isLastFailed || isLastSucceeded
      ? phase || '—'
      : component.last_action
        ? `${component.last_action.action} · ${component.last_action.result}`
        : '—'

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="py-3 align-top">
        <div className="min-w-0 space-y-2">
          <div className="text-sm font-medium">{component.label}</div>
          <div className="text-[11px] font-mono text-muted-foreground">
            {component.component_key}
          </div>
          {installSource ? (
            <div className={`text-[11px] ${installSourceTone(component)}`}>{installSource}</div>
          ) : null}
          {readinessIssues.length > 0 ? (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              {readinessIssues.join(' | ')}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="py-3 align-top">
        <Badge variant={statusTone(component)} className="text-xs">
          {statusLabel(component)}
        </Badge>
      </TableCell>
      <TableCell className="py-3 align-top text-xs text-muted-foreground">{versionLabel}</TableCell>
      <TableCell className="py-3 align-top">
        {inProgress ? (
          <div className="space-y-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {activityLabel}
            </span>
            {lastActionAt ? (
              <div className="text-[11px] text-muted-foreground">Updated {lastActionAt}</div>
            ) : null}
          </div>
        ) : isLastFailed ? (
          <div className="space-y-1">
            <span className="text-xs text-destructive">{activityLabel}</span>
            {lastActionAt ? (
              <div className="text-[11px] text-muted-foreground">{lastActionAt}</div>
            ) : null}
          </div>
        ) : isLastSucceeded ? (
          <div className="space-y-1">
            <span className="text-xs text-green-600 dark:text-green-400">{activityLabel}</span>
            {lastActionAt ? (
              <div className="text-[11px] text-muted-foreground">{lastActionAt}</div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{activityLabel}</span>
            {lastActionAt ? (
              <div className="text-[11px] text-muted-foreground">{lastActionAt}</div>
            ) : null}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 align-top text-right">
        <div className="flex flex-wrap justify-end gap-1">
          {component.available_actions.map(action => {
            const loadingKey = `${component.component_key}:${action}`
            const isThisLoading = actionLoading === loadingKey
            return (
              <Button
                key={action}
                variant="outline"
                size="sm"
                disabled={inProgress || isThisLoading}
                onClick={() => void onAction(component.component_key, action)}
                className="h-7 px-2 text-xs capitalize"
              >
                {isThisLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {action}
              </Button>
            )
          })}
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ServerSoftwarePanel({ serverId }: { serverId: string }) {
  const [components, setComponents] = useState<SoftwareComponentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  const prerequisiteComponents = components.filter(isPrerequisiteComponent)
  const addonComponents = components.filter(component => !isPrerequisiteComponent(component))

  const loadComponents = useCallback(async () => {
    if (!serverId) return
    setLoading(true)
    setLoadError('')
    try {
      const items = await listSoftwareComponents(serverId)
      setComponents(items)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load software components')
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    void loadComponents()
  }, [loadComponents])

  const handleAction = useCallback(
    async (componentKey: string, action: SoftwareActionType) => {
      setActionLoading(`${componentKey}:${action}`)
      setActionError('')
      setActionMessage('')
      try {
        const response = await invokeSoftwareAction(serverId, componentKey, action, {
          apposBaseUrl:
            typeof window !== 'undefined' && window.location?.origin
              ? window.location.origin
              : undefined,
        })
        setActionMessage(
          response.operation_id
            ? `${action} accepted for ${componentKey} (${response.operation_id})`
            : `${action} accepted for ${componentKey}`
        )
        await loadComponents()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `${action} failed`)
      } finally {
        setActionLoading(null)
      }
    },
    [serverId, loadComponents]
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Software</h3>
          <p className="text-sm text-muted-foreground">
            Server-scoped software readiness and lifecycle actions from the managed delivery
            catalog.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void loadComponents()}
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <section className="space-y-3" aria-label="Prerequisites section">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-foreground">Prerequisites</h4>
          <p className="text-sm text-muted-foreground">
            Platform baseline checks required before managed delivery can proceed. First rollout
            only includes Docker.
          </p>
        </div>

        {prerequisiteComponents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
            {loading
              ? 'Loading prerequisites...'
              : 'No prerequisite components are defined for this server.'}
          </div>
        ) : (
          <div className="space-y-3">
            {prerequisiteComponents.map(component => {
              const readinessIssues = component.preflight?.issues ?? []
              const installSource = installSourceSummary(component)
              const primaryAction = primaryPrerequisiteAction(component)
              const loadingKey = primaryAction
                ? `${component.component_key}:${primaryAction}`
                : null
              const isPrimaryLoading = loadingKey !== null && actionLoading === loadingKey
              const disabled =
                isInProgress(component.last_operation) || !primaryAction || isPrimaryLoading

              return (
                <div
                  key={component.component_key}
                  className="rounded-lg border border-border/60 bg-card px-4 py-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-foreground">{component.label}</div>
                        <Badge variant={statusTone(component)} className="text-xs">
                          {statusLabel(component)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{prerequisiteRole(component)}</p>
                      <p className="text-sm text-muted-foreground">
                        {prerequisiteImpact(component)}
                      </p>
                      {installSource ? (
                        <div className={`text-xs ${installSourceTone(component)}`}>
                          {installSource}
                        </div>
                      ) : null}
                      {readinessIssues.length > 0 ? (
                        <div className="text-xs text-amber-700 dark:text-amber-400">
                          {readinessIssues.join(' | ')}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {primaryAction ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disabled}
                          onClick={() => void handleAction(component.component_key, primaryAction)}
                          className="capitalize"
                        >
                          {isPrimaryLoading ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : null}
                          {primaryAction}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No corrective action available
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-label="Addons list section">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-foreground">Addons list</h4>
          <p className="text-sm text-muted-foreground">
            Remaining managed server software available for inspection and lifecycle actions.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Component</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last Activity</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {addonComponents.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  {loading
                    ? 'Loading addons list...'
                    : 'No addon components found for this server.'}
                </TableCell>
              </TableRow>
            ) : (
              addonComponents.map(component => (
                <ComponentRow
                  key={component.component_key}
                  component={component}
                  onAction={handleAction}
                  actionLoading={actionLoading}
                />
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
