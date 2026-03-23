import { useMemo, useState, type RefObject } from 'react'
import { AlertTriangle, Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { DeploymentRecord } from '@/pages/deploy/deploy-types'

function stepTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
    case 'terminal':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
    case 'active':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
  }
}

function stepConnectorTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-300 dark:bg-emerald-700'
    case 'terminal':
      return 'bg-rose-300 dark:bg-rose-700'
    case 'active':
      return 'bg-sky-300 dark:bg-sky-700'
    default:
      return 'bg-slate-200 dark:bg-slate-700'
  }
}

type DeploymentDetailDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  deployment: DeploymentRecord | null
  loading: boolean
  streamStatus: 'idle' | 'connecting' | 'live' | 'closed'
  logText: string
  logUpdatedAt: string
  logTruncated: boolean
  logViewportRef: RefObject<HTMLDivElement | null>
  onLogScroll: (event: React.UIEvent<HTMLDivElement>) => void
  autoScrollEnabled?: boolean
  onAutoScrollChange?: (enabled: boolean) => void
  getUserLabel: (item: DeploymentRecord) => string
  getServerLabel: (item: DeploymentRecord) => string
  getServerHost: (item: DeploymentRecord) => string
  formatTime: (value?: string) => string
  statusVariant: (status: string) => 'default' | 'secondary' | 'destructive' | 'outline'
}

type DeploymentDetailContentProps = Omit<DeploymentDetailDialogProps, 'open' | 'onOpenChange'>

function OverviewMetric({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: React.ReactNode
  valueClassName?: string
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-sm font-medium text-foreground', valueClassName)}>{value}</div>
    </div>
  )
}

function OverviewPanel({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border bg-muted/20 px-3 py-3', className)}>
      <div className="text-xs font-medium text-foreground">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function OverviewField({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  )
}

export function DeploymentDetailContent({
  deployment,
  loading,
  streamStatus,
  logText,
  logUpdatedAt,
  logTruncated,
  logViewportRef,
  onLogScroll,
  autoScrollEnabled = true,
  onAutoScrollChange,
  getUserLabel,
  getServerLabel,
  getServerHost,
  formatTime,
  statusVariant,
}: DeploymentDetailContentProps) {
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')

  const serverTarget = deployment
    ? getServerHost(deployment) && getServerHost(deployment) !== '-'
      ? `${getServerLabel(deployment)} · ${getServerHost(deployment)}`
      : getServerLabel(deployment)
    : '-'

  const visibleLogText = useMemo(() => {
    if (!errorsOnly) return logText
    const lines = logText.split('\n').filter(line => /error|failed|panic|fatal|exception|denied/i.test(line))
    return lines.join('\n')
  }, [errorsOnly, logText])

  async function copyLogs() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(visibleLogText || '')
        setCopyState('done')
      } else {
        setCopyState('failed')
      }
    } catch {
      setCopyState('failed')
    } finally {
      window.setTimeout(() => setCopyState('idle'), 1600)
    }
  }

  return (
    <>
      {loading ? (
        <div className="py-6 text-sm text-muted-foreground">Loading deployment detail...</div>
      ) : deployment ? (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Overview</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <OverviewMetric
                  label="Status"
                  value={<Badge variant={statusVariant(deployment.status)}>{deployment.status}</Badge>}
                  valueClassName="text-xs"
                />
                <OverviewMetric label="Stream" value={streamStatus} />
                <OverviewMetric label="Started" value={formatTime(deployment.started_at)} />
                <OverviewMetric label="Finished" value={formatTime(deployment.finished_at)} />
              </div>
              <div className="grid gap-2 xl:grid-cols-2">
                <OverviewPanel title="Identity">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <OverviewField label="Application" value={<span className="font-medium">{deployment.compose_project_name || '-'}</span>} />
                    <OverviewField label="User" value={getUserLabel(deployment)} />
                    <OverviewField label="Created" value={formatTime(deployment.created)} />
                    <OverviewField label="Deployment ID" value={<span className="font-mono text-xs break-all">{deployment.id}</span>} />
                    <OverviewField label="Project Directory" value={<span className="break-all">{deployment.project_dir || '-'}</span>} className="sm:col-span-2" />
                  </div>
                </OverviewPanel>
                <OverviewPanel title="Execution Context">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <OverviewField label="Server Target" value={<span className="font-medium">{serverTarget}</span>} className="sm:col-span-2" />
                    <OverviewField label="Connection" value={getServerHost(deployment) === 'local' ? 'Local runtime' : 'Remote host'} />
                    <OverviewField label="Log Stream" value={streamStatus} />
                  </div>
                </OverviewPanel>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Lifecycle Timeline</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(deployment.lifecycle || []).length === 0 ? (
                <div className="text-xs text-muted-foreground">No lifecycle timeline available yet.</div>
              ) : (
                <>
                  <div className="overflow-x-auto pb-1">
                    <div className="flex min-w-max items-center gap-2">
                      {(deployment.lifecycle || []).map((step, index, list) => (
                        <div key={step.key} className="flex items-center gap-2">
                          <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs whitespace-nowrap', stepTone(step.status))}>
                            <span className={cn('h-2.5 w-2.5 rounded-full', step.status === 'completed' ? 'bg-emerald-500' : step.status === 'terminal' ? 'bg-rose-500' : step.status === 'active' ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600')} />
                            <span className="font-medium">{step.label}</span>
                          </div>
                          {index < list.length - 1 ? <div className={cn('h-px w-8', stepConnectorTone(step.status))} /> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                    {(deployment.lifecycle || []).filter(step => step.status !== 'pending').map(step => (
                      <div key={`${step.key}-meta`} className={cn('rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground dark:border-slate-800 dark:bg-slate-900/50', step.status === 'terminal' && 'border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/30')}>
                        <div className={cn('font-medium', step.status === 'completed' ? 'text-emerald-700 dark:text-emerald-300' : step.status === 'terminal' ? 'text-rose-700 dark:text-rose-300' : step.status === 'active' ? 'text-sky-700 dark:text-sky-300' : 'text-slate-500 dark:text-slate-400')}>
                          {step.label} · {step.status}
                        </div>
                        {step.detail ? <div className="mt-1 line-clamp-2">{step.detail}</div> : null}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Execution Stages</CardTitle></CardHeader>
            <CardContent className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
              {(deployment.steps || []).length === 0 ? (
                <div className="text-xs text-muted-foreground">No execution stage details available yet.</div>
              ) : (deployment.steps || []).map(step => (
                <div key={`${step.key}-detail`} className={cn('rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground dark:border-slate-800 dark:bg-slate-900/50', step.status === 'failed' && 'border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/30')}>
                  <div className={cn('font-medium', step.status === 'success' ? 'text-emerald-700 dark:text-emerald-300' : step.status === 'failed' ? 'text-rose-700 dark:text-rose-300' : step.status === 'running' ? 'text-sky-700 dark:text-sky-300' : 'text-slate-500 dark:text-slate-400')}>
                    {step.label} · {step.status}
                  </div>
                  <div className="mt-1">Started: {formatTime(step.started_at)} · Finished: {formatTime(step.finished_at)}</div>
                  {step.detail ? <div className="mt-1 line-clamp-2">{step.detail}</div> : null}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="space-y-3 pb-3">
              <div className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Execution Log</CardTitle>
                <div className="text-xs text-muted-foreground">{logTruncated ? 'truncated · ' : ''}{logUpdatedAt ? `updated ${formatTime(logUpdatedAt)}` : 'waiting for logs'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Button variant="outline" size="sm" onClick={() => void copyLogs()}>
                  <Copy className="h-3.5 w-3.5" />
                  {copyState === 'done' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy logs'}
                </Button>
                <Button variant={autoScrollEnabled ? 'default' : 'outline'} size="sm" onClick={() => onAutoScrollChange?.(!autoScrollEnabled)}>
                  Auto-scroll {autoScrollEnabled ? 'On' : 'Off'}
                </Button>
                <Button variant={errorsOnly ? 'destructive' : 'outline'} size="sm" onClick={() => setErrorsOnly(current => !current)}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Errors only {errorsOnly ? 'On' : 'Off'}
                </Button>
                {errorsOnly ? <span className="text-muted-foreground">Showing lines containing error/fail/fatal keywords.</span> : null}
              </div>
            </CardHeader>
            <CardContent>
              <div ref={logViewportRef} className="h-[480px] overflow-auto rounded-xl bg-black px-3 py-2 font-mono text-[11px] leading-5 text-slate-100" onScroll={onLogScroll}>
                <pre className={cn('whitespace-pre-wrap break-words', !visibleLogText && 'text-slate-500')}>{visibleLogText || (errorsOnly ? 'No error lines matched the current filter.' : 'No execution log yet.')}</pre>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  )
}

export function DeploymentDetailDialog({
  open,
  onOpenChange,
  ...contentProps
}: DeploymentDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{contentProps.deployment?.compose_project_name || 'Deployment Detail'}</DialogTitle>
          <DialogDescription>Metadata, step timeline, and logs are stacked vertically to keep the reading flow stable.</DialogDescription>
        </DialogHeader>
        <DeploymentDetailContent {...contentProps} />
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
