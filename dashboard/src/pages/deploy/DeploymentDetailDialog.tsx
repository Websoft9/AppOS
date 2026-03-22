import type { RefObject } from 'react'
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
  getUserLabel: (item: DeploymentRecord) => string
  getServerLabel: (item: DeploymentRecord) => string
  getServerHost: (item: DeploymentRecord) => string
  formatTime: (value?: string) => string
  statusVariant: (status: string) => 'default' | 'secondary' | 'destructive' | 'outline'
}

type DeploymentDetailContentProps = Omit<DeploymentDetailDialogProps, 'open' | 'onOpenChange'>

export function DeploymentDetailContent({
  deployment,
  loading,
  streamStatus,
  logText,
  logUpdatedAt,
  logTruncated,
  logViewportRef,
  onLogScroll,
  getUserLabel,
  getServerLabel,
  getServerHost,
  formatTime,
  statusVariant,
}: DeploymentDetailContentProps) {
  return (
    <>
      {loading ? (
        <div className="py-6 text-sm text-muted-foreground">Loading deployment detail...</div>
      ) : deployment ? (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Metadata</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
              <div><span className="text-muted-foreground">Deployment:</span> {deployment.compose_project_name}</div>
              <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusVariant(deployment.status)}>{deployment.status}</Badge></div>
              <div><span className="text-muted-foreground">Stream:</span> {streamStatus}</div>
              <div><span className="text-muted-foreground">Deployment ID:</span> <span className="font-mono text-xs">{deployment.id}</span></div>
              <div><span className="text-muted-foreground">User:</span> {getUserLabel(deployment)}</div>
              <div><span className="text-muted-foreground">Server:</span> {getServerLabel(deployment)}</div>
              <div><span className="text-muted-foreground">Server Host:</span> {getServerHost(deployment)}</div>
              <div><span className="text-muted-foreground">Project Dir:</span> <span className="break-all">{deployment.project_dir || '-'}</span></div>
              <div><span className="text-muted-foreground">Created:</span> {formatTime(deployment.created)}</div>
              <div><span className="text-muted-foreground">Started:</span> {formatTime(deployment.started_at)}</div>
              <div><span className="text-muted-foreground">Finished:</span> {formatTime(deployment.finished_at)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Lifecycle Timeline</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(deployment.lifecycle || []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No lifecycle timeline available yet.</div>
              ) : (
                <>
                  <div className="overflow-x-auto pb-1">
                    <div className="flex min-w-max items-center gap-2">
                      {(deployment.lifecycle || []).map((step, index, list) => (
                        <div key={step.key} className="flex items-center gap-2">
                          <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap', stepTone(step.status))}>
                            <span className={cn('h-2.5 w-2.5 rounded-full', step.status === 'completed' ? 'bg-emerald-500' : step.status === 'terminal' ? 'bg-rose-500' : step.status === 'active' ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600')} />
                            <span className="font-medium">{step.label}</span>
                          </div>
                          {index < list.length - 1 ? <div className={cn('h-px w-8', stepConnectorTone(step.status))} /> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {(deployment.lifecycle || []).filter(step => step.status !== 'pending').map(step => (
                      <div key={`${step.key}-meta`} className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground dark:border-slate-800 dark:bg-slate-900/50">
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
            <CardHeader><CardTitle className="text-sm">Execution Stage Details</CardTitle></CardHeader>
            <CardContent className="grid gap-2 lg:grid-cols-2">
              {(deployment.steps || []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No execution stage details available yet.</div>
              ) : (deployment.steps || []).map(step => (
                <div key={`${step.key}-detail`} className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground dark:border-slate-800 dark:bg-slate-900/50">
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">Execution Log</CardTitle><div className="text-xs text-muted-foreground">{logTruncated ? 'truncated · ' : ''}{logUpdatedAt ? `updated ${formatTime(logUpdatedAt)}` : 'waiting for logs'}</div></CardHeader>
            <CardContent>
              <div ref={logViewportRef} className="h-[520px] overflow-auto rounded-xl bg-black px-4 py-3 font-mono text-[11px] leading-5 text-slate-100" onScroll={onLogScroll}>
                <pre className={cn('whitespace-pre-wrap break-words', !logText && 'text-slate-500')}>{logText || 'No execution log yet.'}</pre>
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
