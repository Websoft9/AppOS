import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  invokeSoftwareAction,
  listSoftwareComponents,
  type SoftwareActionType,
  type SoftwareComponentSummary,
  type SoftwareLastOperation,
} from '@/lib/software-api'

function templateKindLabel(templateKind: string): string {
  if (templateKind === 'package') return 'Package'
  if (templateKind === 'script') return 'Script'
  if (templateKind === 'binary') return 'Binary'
  return templateKind
}

function phaseLabel(op: SoftwareLastOperation | undefined): string {
  if (!op) return ''
  if (op.terminal_status === 'success') return 'Succeeded'
  if (op.terminal_status === 'failed') return op.failure_reason ? `Failed: ${op.failure_reason}` : 'Failed'
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

function statusTone(component: SoftwareComponentSummary): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (component.verification_state === 'degraded') return 'destructive'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy') return 'default'
  if (component.installed_state === 'not_installed') return 'secondary'
  return 'outline'
}

function statusLabel(component: SoftwareComponentSummary): string {
  if (component.verification_state === 'degraded') return 'Degraded'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy') return 'Installed'
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

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/10 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{component.label}</span>
          <Badge variant="secondary" className="text-xs">
            {templateKindLabel(component.template_kind)}
          </Badge>
          <Badge variant={statusTone(component)} className="text-xs">
            {statusLabel(component)}
          </Badge>
          {component.detected_version && (
            <span className="text-xs text-muted-foreground">{component.detected_version}</span>
          )}
          {inProgress && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {phase}
            </span>
          )}
          {!inProgress && isLastSucceeded && phase && (
            <span className="text-xs text-green-600 dark:text-green-400">{phase}</span>
          )}
          {!inProgress && isLastFailed && (
            <span className="max-w-xs truncate text-xs text-destructive">{phase}</span>
          )}
        </div>
        {readinessIssues.length > 0 && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            {readinessIssues.join(' | ')}
          </div>
        )}
        {component.last_action && !inProgress && (
          <div className="text-xs text-muted-foreground">
            Last action: {component.last_action.action} · {component.last_action.result}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
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
    </div>
  )
}

export function ServerSoftwarePanel({ serverId }: { serverId: string }) {
  const [components, setComponents] = useState<SoftwareComponentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

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
        const response = await invokeSoftwareAction(serverId, componentKey, action)
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
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Software Components</CardTitle>
          <CardDescription>
            Managed server components exposed from the software delivery catalog and live server checks.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void loadComponents()}
          title="Refresh"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        {components.map(component => (
          <ComponentRow
            key={component.component_key}
            component={component}
            onAction={handleAction}
            actionLoading={actionLoading}
          />
        ))}
      </CardContent>
    </Card>
  )
}
