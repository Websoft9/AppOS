import { useMemo, useState, type RefObject } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, CircleX, Copy, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { parseActionSourceBuildAttribution } from '@/pages/apps/app-detail-utils'
import { formatDurationCompact } from '@/pages/deploy/actions/action-utils'
import type { ActionRecord } from '@/pages/deploy/actions/action-types'

type ActionDetailDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  operation: ActionRecord | null
  loading: boolean
  streamStatus: 'idle' | 'connecting' | 'live' | 'closed'
  logText: string
  logUpdatedAt: string
  logTruncated: boolean
  logViewportRef: RefObject<HTMLDivElement | null>
  onLogScroll: (event: React.UIEvent<HTMLDivElement>) => void
  autoScrollEnabled?: boolean
  onAutoScrollChange?: (enabled: boolean) => void
  getUserLabel: (item: ActionRecord) => string
  getServerLabel: (item: ActionRecord) => string
  getServerHost: (item: ActionRecord) => string
  formatTime: (value?: string) => string
  onRefresh?: () => void
}

type ActionDetailContentProps = Omit<ActionDetailDialogProps, 'open' | 'onOpenChange'>

type LogPanelMode = 'error' | 'all' | null

function stageMarker(status: string) {
  if (status === 'success') {
    return <span className="h-3 w-3 rounded-full border-2 border-emerald-500 bg-background" />
  }
  if (status === 'failed') {
    return <CircleX className="h-4 w-4 text-rose-500" />
  }
  if (status === 'running') {
    return <span className="h-3 w-3 rounded-full border-2 border-sky-500 bg-background" />
  }
  return <span className="h-3 w-3 rounded-full border-2 border-slate-300 bg-background dark:border-slate-600" />
}

function statusHeadline(status: string): { label: string; tone: string } {
  switch (status) {
    case 'success':
      return { label: 'Success', tone: 'text-emerald-700 dark:text-emerald-300' }
    case 'failed':
    case 'timeout':
    case 'cancelled':
    case 'manual_intervention_required':
    case 'rolled_back':
      return { label: 'Failed', tone: 'text-rose-700 dark:text-rose-300' }
    case 'running':
    case 'preparing':
    case 'validating':
    case 'verifying':
    case 'rolling_back':
      return { label: 'Running', tone: 'text-sky-700 dark:text-sky-300' }
    default:
      return { label: status || 'Pending', tone: 'text-foreground' }
  }
}

function OverviewCollapsiblePanel({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border bg-muted/20 px-3 py-3">
        <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
          <span className="text-xs font-medium text-foreground">{title}</span>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">{children}</CollapsibleContent>
      </div>
    </Collapsible>
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

export function ActionDetailContent({
  operation,
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
  onRefresh,
}: ActionDetailContentProps) {
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')
  const [expandedStageKey, setExpandedStageKey] = useState<string | null>(null)
  const [logPanelMode, setLogPanelMode] = useState<LogPanelMode>(null)

  const serverTarget = operation
    ? getServerHost(operation) && getServerHost(operation) !== '-'
      ? `${getServerLabel(operation)} · ${getServerHost(operation)}`
      : getServerLabel(operation)
    : '-'

  const stageItems = operation?.steps || []
  const failedStage = stageItems.find(step => step.status === 'failed') || null
  const overviewDuration = operation
    ? formatDurationCompact(operation.pipeline?.started_at || operation.started_at, operation.pipeline?.finished_at || operation.finished_at)
    : '-'
  const headline = statusHeadline(operation?.status || '')
  const sourceBuildAttribution = useMemo(() => parseActionSourceBuildAttribution(operation), [operation])
  const stageFallbackLogs = useMemo(() => {
    const result = new Map<string, string[]>()
    if (!logText || stageItems.length === 0) return result

    const labelToKey = new Map(stageItems.map(step => [step.label.trim().toLowerCase(), step.key]))
    let activeKey: string | null = null

    logText.split('\n').forEach(line => {
      const started = line.match(/step started:\s*(.+)$/i)
      if (started) {
        const matchedKey = labelToKey.get(started[1].trim().toLowerCase()) || null
        activeKey = matchedKey
        if (matchedKey) {
          result.set(matchedKey, [...(result.get(matchedKey) || []), line])
        }
        return
      }

      if (activeKey) {
        result.set(activeKey, [...(result.get(activeKey) || []), line])
      }

      const completed = line.match(/step completed:\s*(.+)$/i)
      if (completed) {
        const matchedKey = labelToKey.get(completed[1].trim().toLowerCase()) || null
        if (matchedKey && matchedKey === activeKey) {
          activeKey = null
        }
      }
    })

    return result
  }, [logText, stageItems])
  const timeWindowLogs = useMemo(() => {
    const result = new Map<string, string[]>()
    if (!logText || stageItems.length === 0) return result

    const parsedLines = logText.split('\n').map(line => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+(.*)$/)
      if (!match) return { line, ts: null as number | null }
      const ts = new Date(match[1]).getTime()
      return { line, ts: Number.isNaN(ts) ? null : ts }
    })

    stageItems.forEach(step => {
      if (!step.started_at) return
      const startTs = new Date(step.started_at).getTime()
      const endTs = step.finished_at ? new Date(step.finished_at).getTime() : Number.POSITIVE_INFINITY
      if (Number.isNaN(startTs)) return
      const lines = parsedLines
        .filter(item => item.ts !== null && item.ts >= startTs && item.ts <= endTs)
        .map(item => item.line)
      if (lines.length > 0) result.set(step.key, lines)
    })

    return result
  }, [logText, stageItems])
  const errorLogText = useMemo(() => {
    const lines = logText.split('\n').filter(line => /error|failed|panic|fatal|exception|denied/i.test(line))
    return lines.join('\n')
  }, [logText])
  const activePanelLogText = logPanelMode === 'error' ? errorLogText : logText
  const activePanelTitle = logPanelMode === 'error' ? 'Error Log' : 'All Logs'
  const activePanelEmpty = logPanelMode === 'error'
    ? 'No error lines matched the current log.'
    : 'No execution log yet.'

  async function copyLogs() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(activePanelLogText || '')
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
        <div className="py-6 text-sm text-muted-foreground">Loading execution detail...</div>
      ) : operation ? (
        <div className="space-y-3">
          <Card>
            <CardContent className="space-y-6 pt-6">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                  <div className={cn('text-lg font-semibold', headline.tone)}>
                    {headline.label}
                    <span className="ml-3 text-sm font-medium text-muted-foreground">Total duration {overviewDuration}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">{operation.compose_project_name || operation.id}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => {
                    setLogPanelMode('error')
                    if (failedStage) setExpandedStageKey(failedStage.key)
                  }}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Explain error
                  </Button>
                  <Button variant="outline" size="icon" aria-label="Refresh stages" title="Refresh stages" onClick={() => onRefresh?.()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <OverviewCollapsiblePanel title="More metadata">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <OverviewField label="Application" value={<span className="font-medium">{operation.compose_project_name || '-'}</span>} />
                    <OverviewField label="User" value={getUserLabel(operation)} />
                    <OverviewField label="Created" value={formatTime(operation.created)} />
                    <OverviewField label="Operation ID" value={<span className="font-mono text-xs break-all">{operation.id}</span>} />
                    <OverviewField label="Project Directory" value={<span className="break-all">{operation.project_dir || '-'}</span>} className="sm:col-span-2" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <OverviewField label="Server Target" value={<span className="font-medium">{serverTarget}</span>} className="sm:col-span-2" />
                    <OverviewField label="Connection" value={getServerHost(operation) === 'local' ? 'Local runtime' : 'Remote host'} />
                    <OverviewField label="Log Stream" value={streamStatus} />
                    <OverviewField label="Pipeline Family" value={operation.pipeline_family || operation.pipeline?.family || '-'} />
                    <OverviewField label="Pipeline Definition" value={<span className="font-mono text-xs break-all">{operation.pipeline_definition_key || operation.pipeline?.definition_key || '-'}</span>} />
                    <OverviewField label="Pipeline Phase" value={operation.pipeline?.current_phase || '-'} />
                    <OverviewField label="Pipeline Status" value={operation.pipeline?.status || '-'} />
                  </div>
                </div>
              </OverviewCollapsiblePanel>

              {failedStage || operation.error_summary ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200">
                  <div className="font-medium">Quick error view</div>
                  <div className="mt-1">{failedStage?.detail || operation.error_summary || 'A failed stage is available for inspection.'}</div>
                </div>
              ) : null}

              {sourceBuildAttribution ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 dark:border-sky-900/60 dark:bg-sky-950/20">
                  <div className="text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">Source Build</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <OverviewField label="Source Kind" value={sourceBuildAttribution.sourceKind || '-'} />
                    <OverviewField label="Builder" value={sourceBuildAttribution.builderStrategy || '-'} />
                    <OverviewField label="Publication Mode" value={sourceBuildAttribution.publicationMode || '-'} />
                    <OverviewField label="Source Ref" value={<span className="break-all">{sourceBuildAttribution.sourceRef || '-'}</span>} className="sm:col-span-2 xl:col-span-3" />
                    <OverviewField label="Local Image" value={<span className="break-all">{sourceBuildAttribution.localImageRef || '-'}</span>} className="sm:col-span-2" />
                    <OverviewField label="Target Service" value={sourceBuildAttribution.targetService || '-'} />
                    {sourceBuildAttribution.targetRef ? (
                      <OverviewField label="Publish Target" value={<span className="break-all">{sourceBuildAttribution.targetRef}</span>} className="sm:col-span-2 xl:col-span-3" />
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className={cn('grid gap-6', logPanelMode ? 'xl:grid-cols-[minmax(0,1fr)_420px]' : 'grid-cols-1')}>
                <div>
                  {stageItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No execution stage details available yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {stageItems.map((step, index) => {
                        const expanded = expandedStageKey === step.key
                        const stageLog = step.execution_log || stageFallbackLogs.get(step.key)?.join('\n') || timeWindowLogs.get(step.key)?.join('\n') || ''

                        return (
                          <div key={`${step.key}-detail`} className="flex gap-3">
                            <div className="flex w-6 flex-col items-center pt-2">
                              {stageMarker(step.status)}
                              {index < stageItems.length - 1 ? <span className="mt-1 h-full w-px bg-border" /> : null}
                            </div>
                            <div className={cn('flex-1 rounded-xl border px-4 py-3', step.status === 'failed' ? 'border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/20' : step.status === 'pending' ? 'border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400' : 'bg-muted/20')}>
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex flex-1 items-center gap-2 text-left">
                                  <button
                                    type="button"
                                    className={cn('flex min-w-0 items-center gap-2 text-sm font-medium', step.status === 'success' ? 'text-emerald-700 dark:text-emerald-300' : step.status === 'failed' ? 'text-rose-700 dark:text-rose-300' : step.status === 'running' ? 'text-sky-700 dark:text-sky-300' : 'text-foreground')}
                                    onClick={() => setExpandedStageKey(current => current === step.key ? null : step.key)}
                                  >
                                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                    <span className="truncate">{step.label}</span>
                                  </button>
                                </div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button type="button" className="shrink-0 rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:border-border hover:text-foreground">
                                      Duration {formatDurationCompact(step.started_at, step.finished_at)}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={8}>
                                    <div className="space-y-1">
                                      <div>Started {formatTime(step.started_at)}</div>
                                      <div>Finished {formatTime(step.finished_at)}</div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              {expanded ? (
                                <div className="mt-3 space-y-2 border-t pt-3">
                                  {step.detail ? (
                                    <div className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">{step.detail}</div>
                                  ) : null}
                                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>Node execution log</span>
                                    {step.execution_log_truncated ? <span>truncated</span> : null}
                                  </div>
                                  <div className="max-h-[280px] overflow-auto rounded-xl bg-black px-3 py-2 font-mono text-[11px] leading-5 text-slate-100">
                                    <pre className={cn('whitespace-pre-wrap break-words', !stageLog && 'text-slate-500')}>{stageLog || 'No node log captured yet. Existing actions fall back to stage slices from the full execution log when possible.'}</pre>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {logPanelMode ? (
                  <div className="rounded-xl border bg-muted/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{activePanelTitle}</div>
                        <div className="text-xs text-muted-foreground">{logTruncated ? 'truncated · ' : ''}{logUpdatedAt ? `updated ${formatTime(logUpdatedAt)}` : 'waiting for logs'}</div>
                      </div>
                      <Button variant="ghost" size="icon" aria-label="Close log panel" onClick={() => setLogPanelMode(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <Button variant="outline" size="sm" onClick={() => void copyLogs()}>
                        <Copy className="h-3.5 w-3.5" />
                        {copyState === 'done' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy logs'}
                      </Button>
                      <Button variant={autoScrollEnabled ? 'default' : 'outline'} size="sm" onClick={() => onAutoScrollChange?.(!autoScrollEnabled)}>
                        Auto-scroll {autoScrollEnabled ? 'On' : 'Off'}
                      </Button>
                      <Button variant={logPanelMode === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setLogPanelMode('all')}>
                        Show all logs
                      </Button>
                      <Button variant={logPanelMode === 'error' ? 'destructive' : 'outline'} size="sm" onClick={() => setLogPanelMode('error')}>
                        Show error logs
                      </Button>
                    </div>
                    <div ref={logViewportRef} className="mt-3 h-[520px] overflow-auto rounded-xl bg-black px-3 py-2 font-mono text-[11px] leading-5 text-slate-100" onScroll={onLogScroll}>
                      <pre className={cn('whitespace-pre-wrap break-words', !activePanelLogText && 'text-slate-500')}>{activePanelLogText || activePanelEmpty}</pre>
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  )
}

export function ActionDetailDialog({
  open,
  onOpenChange,
  ...contentProps
}: ActionDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{contentProps.operation?.compose_project_name || 'Execution Detail'}</DialogTitle>
          <DialogDescription>Execution summary, metadata, stage status, and logs are now combined into one detail surface.</DialogDescription>
        </DialogHeader>
        <ActionDetailContent {...contentProps} />
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
