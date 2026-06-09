import { useEffect, useMemo, useState, type RefObject } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronDown, ChevronRight, CircleX, Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { parseActionSourceBuildAttribution } from '@/pages/apps/app-detail-utils'
import { actionStatusLabel, formatDurationCompact } from '@/pages/deploy/actions/action-utils'
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
}

type ActionDetailContentProps = Omit<ActionDetailDialogProps, 'open' | 'onOpenChange' | 'onRefresh'>

type PullLayerState = {
  id: string
  status: string
  detail: string
  updatedAt?: string
}

type PullImageState = {
  name: string
  status: string
  updatedAt?: string
}

type PullProgressSnapshot = {
  images: PullImageState[]
  layers: PullLayerState[]
  activeLayerCount: number
  completedLayerCount: number
  totalLayerCount: number
  recentEvents: string[]
}

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
  return (
    <span className="h-3 w-3 rounded-full border-2 border-slate-300 bg-background dark:border-slate-600" />
  )
}

function statusHeadline(status: string): { label: string; tone: string } {
  switch (status) {
    case 'success':
      return { label: actionStatusLabel(status), tone: 'text-emerald-700 dark:text-emerald-300' }
    case 'failed':
    case 'timeout':
    case 'cancelled':
    case 'manual_intervention_required':
    case 'rolled_back':
      return { label: actionStatusLabel(status), tone: 'text-rose-700 dark:text-rose-300' }
    case 'running':
    case 'preparing':
    case 'validating':
    case 'verifying':
    case 'rolling_back':
      return { label: actionStatusLabel(status), tone: 'text-sky-700 dark:text-sky-300' }
    default:
      return { label: actionStatusLabel(status), tone: 'text-foreground' }
  }
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

function stageKeyToAutoExpand(stageItems: ActionRecord['steps'] | undefined): string | null {
  if (!stageItems || stageItems.length === 0) return null
  const running = stageItems.find(step => step.status === 'running')
  if (running) return running.key
  const failed = stageItems.find(step => step.status === 'failed')
  if (failed) return failed.key
  for (let index = stageItems.length - 1; index >= 0; index -= 1) {
    if (stageItems[index].status !== 'pending') return stageItems[index].key
  }
  return stageItems[0].key
}

function parsePullProgressSnapshot(logText: string): PullProgressSnapshot | null {
  if (!/docker runtime pull:/i.test(logText)) return null

  const imageMap = new Map<string, PullImageState>()
  const layerMap = new Map<string, PullLayerState>()
  const recentEvents: string[] = []

  for (const rawLine of logText.split('\n')) {
    const line = rawLine.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\s+/, '').trim()
    const match = line.match(/^docker runtime pull:\s+(.*)$/i)
    if (!match) continue
    const body = match[1].trim()
    if (!body) continue

    recentEvents.push(body)
    if (recentEvents.length > 8) recentEvents.shift()

    const imageMatch = body.match(
      /^Image\s+(.+?)\s+(Pulling|Pulled|Already exists|Waiting|Skipped|Error.*)$/i
    )
    if (imageMatch) {
      imageMap.set(imageMatch[1], {
        name: imageMatch[1],
        status: imageMatch[2],
      })
      continue
    }

    const layerMatch = body.match(/^([a-f0-9]{8,})\s+(.+)$/i)
    if (!layerMatch) continue

    const layerId = layerMatch[1]
    const remainder = layerMatch[2].trim()
    let status = remainder
    let detail = ''
    const detailMatch = remainder.match(
      /^(Pulling fs layer|Downloading|Download complete|Pull complete|Extracting|Waiting|Verifying Checksum|Already exists)(?:\s+(.*))?$/i
    )
    if (detailMatch) {
      status = detailMatch[1]
      detail = detailMatch[2]?.trim() || ''
    }

    layerMap.set(layerId, {
      id: layerId,
      status,
      detail,
    })
  }

  if (imageMap.size === 0 && layerMap.size === 0) return null

  const layers = Array.from(layerMap.values())
  const completedLayerCount = layers.filter(layer =>
    /pull complete|already exists/i.test(layer.status)
  ).length
  const activeLayerCount = layers.filter(
    layer => !/pull complete|already exists/i.test(layer.status)
  ).length

  return {
    images: Array.from(imageMap.values()),
    layers,
    activeLayerCount,
    completedLayerCount,
    totalLayerCount: layers.length,
    recentEvents: recentEvents.slice().reverse(),
  }
}

function pullStatusTone(status: string): 'default' | 'secondary' | 'outline' {
  if (/pull complete|already exists|pulled/i.test(status)) return 'secondary'
  if (/downloading|extracting|pulling|verifying|waiting/i.test(status)) return 'default'
  return 'outline'
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
}: ActionDetailContentProps) {
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')
  const [expandedStageKey, setExpandedStageKey] = useState<string | null>(null)
  const [tab, setTab] = useState<'steps' | 'logs'>('steps')

  const serverTarget = operation
    ? getServerHost(operation) && getServerHost(operation) !== '-'
      ? `${getServerLabel(operation)} · ${getServerHost(operation)}`
      : getServerLabel(operation)
    : '-'

  const stageItems = operation?.steps || []
  const failedStage = stageItems.find(step => step.status === 'failed') || null
  const overviewDuration = operation
    ? formatDurationCompact(
        operation.pipeline?.started_at || operation.started_at,
        operation.pipeline?.finished_at || operation.finished_at
      )
    : '-'
  const headline = statusHeadline(operation?.status || '')
  const sourceBuildAttribution = useMemo(
    () => parseActionSourceBuildAttribution(operation),
    [operation]
  )
  const hasError = !!(failedStage || operation?.error_summary)
  const [metadataOpen, setMetadataOpen] = useState(false)
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
      const endTs = step.finished_at
        ? new Date(step.finished_at).getTime()
        : Number.POSITIVE_INFINITY
      if (Number.isNaN(startTs)) return
      const lines = parsedLines
        .filter(item => item.ts !== null && item.ts >= startTs && item.ts <= endTs)
        .map(item => item.line)
      if (lines.length > 0) result.set(step.key, lines)
    })

    return result
  }, [logText, stageItems])

  useEffect(() => {
    const nextKey = stageKeyToAutoExpand(stageItems)
    if (!nextKey) return
    setExpandedStageKey(current => (current === nextKey ? current : nextKey))
  }, [stageItems])

  function explainError() {
    setTab('steps')
    if (failedStage) setExpandedStageKey(failedStage.key)
  }

  async function copyLogs() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(logText || '')
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
          {/* ── Metadata ── */}
          <Card className="border-border/70 shadow-none">
            <CardContent className="space-y-4 pt-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className={cn('text-lg font-semibold', headline.tone)}>
                  {headline.label}
                  <span className="ml-3 text-sm font-medium text-muted-foreground">
                    Total duration {overviewDuration}
                  </span>
                </div>
                {hasError ? (
                  <Button variant="destructive" size="sm" onClick={explainError}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Explain error
                  </Button>
                ) : null}
              </div>

              <button
                type="button"
                className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setMetadataOpen(v => !v)}
              >
                {metadataOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                More metadata
              </button>
              {metadataOpen ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <OverviewField
                    label="Application"
                    value={
                      operation.app_id ? (
                        <Link
                          to="/apps/$appId"
                          params={{ appId: operation.app_id } as never}
                          search={{} as never}
                          className="font-medium text-foreground hover:underline"
                        >
                          {operation.compose_project_name || operation.app_id}
                        </Link>
                      ) : (
                        <span className="font-medium">{operation.compose_project_name || '-'}</span>
                      )
                    }
                  />
                  <OverviewField label="User" value={getUserLabel(operation)} />
                  <OverviewField label="Created" value={formatTime(operation.created)} />
                  <OverviewField
                    label="Operation ID"
                    value={<span className="font-mono text-xs break-all">{operation.id}</span>}
                  />
                  <OverviewField label="Log Stream" value={streamStatus} />
                  <OverviewField
                    label="Server Target"
                    value={
                      operation.server_id && operation.server_id !== 'local' ? (
                        <Link
                          to="/resources/servers"
                          search={{ server: operation.server_id } as never}
                          className="font-medium text-foreground hover:underline"
                        >
                          {serverTarget}
                        </Link>
                      ) : (
                        <span className="font-medium">{serverTarget}</span>
                      )
                    }
                  />
                  <OverviewField
                    label="Connection"
                    value={getServerHost(operation) === 'local' ? 'Local runtime' : 'Remote host'}
                  />
                  <OverviewField
                    label="Pipeline Family"
                    value={operation.pipeline_family || operation.pipeline?.family || '-'}
                  />
                  <OverviewField
                    label="Pipeline Definition"
                    value={
                      <span className="font-mono text-xs break-all">
                        {operation.pipeline_definition_key ||
                          operation.pipeline?.definition_key ||
                          '-'}
                      </span>
                    }
                  />
                  <OverviewField
                    label="Pipeline Phase"
                    value={operation.pipeline?.current_phase || '-'}
                  />
                  <OverviewField
                    label="Pipeline Status"
                    value={operation.pipeline?.status || '-'}
                  />
                  <OverviewField
                    label="Project Directory"
                    value={<span className="break-all">{operation.project_dir || '-'}</span>}
                    className="xl:col-span-2"
                  />
                </div>
              ) : null}

              {hasError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200">
                  <div className="font-medium">Error summary</div>
                  <div className="mt-1">
                    {failedStage?.detail ||
                      operation.error_summary ||
                      'A failed stage is available for inspection.'}
                  </div>
                </div>
              ) : null}

              {sourceBuildAttribution ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 dark:border-sky-900/60 dark:bg-sky-950/20">
                  <div className="text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    Source Build
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <OverviewField label="Source Kind" value={sourceBuildAttribution.sourceKind || '-'} />
                    <OverviewField label="Builder" value={sourceBuildAttribution.builderStrategy || '-'} />
                    <OverviewField label="Publication Mode" value={sourceBuildAttribution.publicationMode || '-'} />
                    <OverviewField
                      label="Source Ref"
                      value={<span className="break-all">{sourceBuildAttribution.sourceRef || '-'}</span>}
                      className="sm:col-span-2 xl:col-span-3"
                    />
                    <OverviewField
                      label="Local Image"
                      value={<span className="break-all">{sourceBuildAttribution.localImageRef || '-'}</span>}
                      className="sm:col-span-2"
                    />
                    <OverviewField label="Target Service" value={sourceBuildAttribution.targetService || '-'} />
                    {sourceBuildAttribution.targetRef ? (
                      <OverviewField
                        label="Publish Target"
                        value={<span className="break-all">{sourceBuildAttribution.targetRef}</span>}
                        className="sm:col-span-2 xl:col-span-3"
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Steps / All Logs ── */}
          <Tabs value={tab} onValueChange={v => setTab(v as 'steps' | 'logs')} className="my-6">
            <div className="border-b">
              <TabsList variant="line" className="rounded-none bg-transparent">
                <TabsTrigger value="steps" className="flex-none">Steps</TabsTrigger>
                <TabsTrigger value="logs" className="flex-none">All Logs</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="steps" className="mt-4">
              <Card className="border-border/70 shadow-none">
                <CardContent className="pt-4">
                  {stageItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No execution stage details available yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {stageItems.map((step, index) => {
                        const expanded = expandedStageKey === step.key
                        const stageLog =
                          step.execution_log ||
                          stageFallbackLogs.get(step.key)?.join('\n') ||
                          timeWindowLogs.get(step.key)?.join('\n') ||
                          ''
                        const pullProgress = parsePullProgressSnapshot(stageLog)
                        const progressPercent =
                          pullProgress && pullProgress.totalLayerCount > 0
                            ? Math.round((pullProgress.completedLayerCount / pullProgress.totalLayerCount) * 100)
                            : 0

                        return (
                          <div key={`${step.key}-detail`} className="flex gap-3">
                            <div className="flex w-6 flex-col items-center pt-2">
                              {stageMarker(step.status)}
                              {index < stageItems.length - 1 ? <span className="mt-1 h-full w-px bg-border" /> : null}
                            </div>
                            <div
                              className={cn(
                                'flex-1 rounded-xl border px-4 py-3',
                                step.status === 'failed'
                                  ? 'border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/20'
                                  : step.status === 'pending'
                                    ? 'border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400'
                                    : 'bg-muted/20'
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex flex-1 items-center gap-2 text-left">
                                  <button
                                    type="button"
                                    className={cn(
                                      'flex min-w-0 items-center gap-2 text-sm font-medium',
                                      step.status === 'success'
                                        ? 'text-emerald-700 dark:text-emerald-300'
                                        : step.status === 'failed'
                                          ? 'text-rose-700 dark:text-rose-300'
                                          : step.status === 'running'
                                            ? 'text-sky-700 dark:text-sky-300'
                                            : 'text-foreground'
                                    )}
                                    onClick={() => setExpandedStageKey(current => (current === step.key ? null : step.key))}
                                  >
                                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                    <span className="truncate">{step.label}</span>
                                  </button>
                                </div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="shrink-0 rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:border-border hover:text-foreground"
                                    >
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
                                    <div className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                                      {step.detail}
                                    </div>
                                  ) : null}
                                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>Node execution log</span>
                                    {step.execution_log_truncated ? <span>truncated</span> : null}
                                  </div>
                                  {pullProgress ? (
                                    <div className="rounded-xl border bg-muted/30 p-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-medium text-foreground">Pull progress</span>
                                        <Badge variant="outline">{pullProgress.completedLayerCount}/{pullProgress.totalLayerCount} layers complete</Badge>
                                        <Badge variant="outline">{pullProgress.activeLayerCount} active</Badge>
                                      </div>
                                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                                        <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${progressPercent}%` }} />
                                      </div>
                                      {pullProgress.images.length > 0 ? (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {pullProgress.images.map(image => (
                                            <Badge key={image.name} variant={pullStatusTone(image.status)}>{image.name}: {image.status}</Badge>
                                          ))}
                                        </div>
                                      ) : null}
                                      {pullProgress.layers.length > 0 ? (
                                        <div className="mt-3 space-y-2">
                                          {pullProgress.layers.slice(-6).reverse().map(layer => (
                                            <div key={layer.id} className="flex items-center justify-between gap-3 rounded-lg border bg-background/70 px-3 py-2">
                                              <div className="min-w-0">
                                                <div className="font-mono text-xs text-foreground">{layer.id}</div>
                                                <div className="text-xs text-muted-foreground">{layer.detail || 'waiting for next progress update'}</div>
                                              </div>
                                              <Badge variant={pullStatusTone(layer.status)}>{layer.status}</Badge>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                      {pullProgress.recentEvents.length > 0 ? (
                                        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                                          {pullProgress.recentEvents.slice(0, 4).map(event => (
                                            <div key={event} className="truncate">{event}</div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  <div className="max-h-[280px] overflow-auto rounded-xl bg-black px-3 py-2 font-mono text-[11px] leading-5 text-slate-100">
                                    <pre className={cn('whitespace-pre-wrap break-words', !stageLog && 'text-slate-500')}>
                                      {stageLog || 'No node log captured yet.'}
                                    </pre>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="logs" className="mt-4">
              <Card className="border-border/70 shadow-none">
                <CardContent className="pt-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="text-muted-foreground">
                        {logTruncated ? 'truncated · ' : ''}
                        {logUpdatedAt ? `updated ${formatTime(logUpdatedAt)}` : 'waiting for logs'}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => void copyLogs()}>
                          <Copy className="h-3.5 w-3.5" />
                          {copyState === 'done' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy logs'}
                        </Button>
                        <Button
                          variant={autoScrollEnabled ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => onAutoScrollChange?.(!autoScrollEnabled)}
                        >
                          Auto-scroll {autoScrollEnabled ? 'On' : 'Off'}
                        </Button>
                      </div>
                    </div>
                    <div
                      ref={logViewportRef}
                      className="max-h-[600px] overflow-auto rounded-xl bg-black px-3 py-2 font-mono text-[11px] leading-5 text-slate-100"
                      onScroll={onLogScroll}
                    >
                      {logText ? (
                        <div className="whitespace-pre-wrap break-words">
                          {logText.split('\n').map((line, i) => (
                            <div
                              key={i}
                              className={/error|failed|panic|fatal|exception|denied/i.test(line) ? 'bg-rose-950/60 text-rose-200' : ''}
                            >
                              {line || '\u00A0'}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-slate-500">No execution log yet.</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
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
          <DialogTitle>
            {contentProps.operation?.compose_project_name || 'Execution Detail'}
          </DialogTitle>
          <DialogDescription>
            Execution summary, metadata, stage status, and logs are now combined into one detail
            surface.
          </DialogDescription>
        </DialogHeader>
        <ActionDetailContent {...contentProps} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
