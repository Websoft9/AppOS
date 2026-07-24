import { createFileRoute } from '@tanstack/react-router'
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  RefreshCw,
  Loader2,
  MoreVertical,
  FileText,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { settingsEntryPath, type SettingsEntryResponse } from '@/lib/settings-api'
import { cn } from '@/lib/utils'

// ─── Route ───────────────────────────────────────────────

export const Route = createFileRoute('/_app/_auth/_superuser/system-tasks')({
  component: SystemCronsPage,
})

// ─── Types ───────────────────────────────────────────────

interface CronJob {
  id: string
  expression: string
}

interface CronLogItem {
  created: string
  level: number
  message: string
  runId: string
  phase: 'start' | 'success' | 'error'
  trigger: string
  durationMs: number | null
  error: unknown
}

interface CronLogsResponse {
  jobId: string
  lastRun: string | null
  lastStatus: 'success' | 'error' | null
  lastDurationMs: number | null
  items: CronLogItem[]
}

type CronJobType = 'Core' | 'Platform'

type MonitorSchedulingGroup = {
  reachabilityIntervalMinutes: number
  metricsFreshnessIntervalMinutes: number
  controlReachabilityIntervalMinutes: number
  runtimeSnapshotIntervalMinutes: number
  credentialSweepIntervalMinutes: number
  appHealthIntervalMinutes: number
  factsPullIntervalMinutes: number
}

function coerceIntervalValue(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// ─── Helpers ─────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function getCronJobType(jobId: string): CronJobType {
  return jobId.startsWith('__pb') ? 'Core' : 'Platform'
}

function getMonitorCronSettingMinutes(
  jobId: string,
  settings: MonitorSchedulingGroup | null
): number | null {
  if (!settings) return null
  switch (jobId) {
    case 'monitor_instance_reachability_checks':
    case 'monitor_ai_provider_reachability_checks':
    case 'monitor_connector_reachability_checks':
      return settings.reachabilityIntervalMinutes
    case 'monitor_server_reachability_checks':
      return settings.controlReachabilityIntervalMinutes
    case 'monitor_metrics_freshness':
      return settings.metricsFreshnessIntervalMinutes
    case 'monitor_runtime_snapshot_pull':
      return settings.runtimeSnapshotIntervalMinutes
    case 'monitor_credential_checks':
      return settings.credentialSweepIntervalMinutes
    case 'monitor_app_health_checks':
      return settings.appHealthIntervalMinutes
    case 'monitor_facts_pull':
      return settings.factsPullIntervalMinutes
    default:
      return null
  }
}

function formatCronExpressionAsInterval(expression: string) {
  const everyMinutesMatch = expression.match(/^\*\/(\d+) \* \* \* \*$/)
  if (everyMinutesMatch) {
    return `${everyMinutesMatch[1]} min`
  }

  const hourlyMatch = expression.match(/^0 \* \* \* \*$/)
  if (hourlyMatch) {
    return '60 min'
  }

  const everyHoursMatch = expression.match(/^0 \*\/(\d+) \* \* \*$/)
  if (everyHoursMatch) {
    return `${Number(everyHoursMatch[1]) * 60} min`
  }

  return expression
}

function getEffectiveIntervalLabel(job: CronJob, settings: MonitorSchedulingGroup | null) {
  const minutes = getMonitorCronSettingMinutes(job.id, settings)
  if (minutes != null && Number.isFinite(minutes)) {
    return `${minutes} min`
  }
  return formatCronExpressionAsInterval(job.expression)
}

function levelBadge(level: number, t: TFunction) {
  if (level <= 0) {
    return (
      <Badge variant="secondary" className="text-xs font-mono text-blue-600">
        {t('crons.status.info')}
      </Badge>
    )
  }
  if (level <= 4) {
    return (
      <Badge variant="outline" className="text-xs font-mono text-yellow-600 border-yellow-400">
        {t('crons.status.warn')}
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="text-xs font-mono">
      {t('crons.status.errorLevel')}
    </Badge>
  )
}

function phaseBadge(phase: CronLogItem['phase'], t: TFunction) {
  if (phase === 'success') {
    return (
      <Badge variant="default" className="text-xs gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {t('crons.status.phaseSuccess')}
      </Badge>
    )
  }
  if (phase === 'error') {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <XCircle className="h-3 w-3" />
        {t('crons.status.phaseError')}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-xs gap-1">
      <Clock className="h-3 w-3" />
      {t('crons.status.phaseStart')}
    </Badge>
  )
}

function lastStatusBadge(status: CronLogsResponse['lastStatus'], t: TFunction) {
  if (status === 'success') return <Badge variant="default">{t('crons.status.success')}</Badge>
  if (status === 'error') return <Badge variant="destructive">{t('crons.status.error')}</Badge>
  return <Badge variant="outline">{t('crons.status.none')}</Badge>
}

const cronDrawerGutter = 'px-4 sm:px-6'

// ─── Sortable header helper ───────────────────────────────

function SortBtn<K extends string>({
  label,
  field,
  sort,
  dir,
  onSort,
}: {
  label: string
  field: K
  sort: K
  dir: 'asc' | 'desc'
  onSort: (f: K) => void
}) {
  const active = sort === field
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )
}

// ─── Log Drawer ───────────────────────────────────────────

interface CronLogDrawerProps {
  jobId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSummaryLoaded?: (
    jobId: string,
    summary: { lastStatus: 'success' | 'error' | null; lastRun: string | null }
  ) => void
}

function CronLogDrawer({ jobId, open, onOpenChange, onSummaryLoaded }: CronLogDrawerProps) {
  const { t } = useTranslation('system')
  const [data, setData] = useState<CronLogsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    setError(null)
    try {
      const result = (await pb.send(`/api/crons/${encodeURIComponent(jobId)}/logs`, {
        method: 'GET',
      })) as CronLogsResponse
      setData(result)
      onSummaryLoaded?.(jobId, { lastStatus: result.lastStatus, lastRun: result.lastRun })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [jobId, onSummaryLoaded])

  useEffect(() => {
    if (open && jobId) {
      setData(null)
      setExpandedRunId(null)
      fetchLogs()
    }
  }, [open, jobId, fetchLogs])

  const items = data?.items ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        {/* Drawer header */}
        <SheetHeader className={cn('border-b pt-5 pb-4 pr-3 shrink-0', cronDrawerGutter)}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {t('crons.logs.title')}
              </p>
              <SheetTitle className="mt-1 text-base font-semibold leading-tight">
                <span className="block max-w-full overflow-hidden font-mono text-[15px] break-words [overflow-wrap:anywhere]">
                  {jobId}
                </span>
              </SheetTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                )}
                {t('crons.logs.refresh')}
              </Button>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <X className="h-4 w-4" />
                  <span className="sr-only">{t('crons.logs.close')}</span>
                </Button>
              </SheetClose>
            </div>
          </div>
        </SheetHeader>

        {/* Summary bar */}
        {data && (
          <div
            className={cn(
              'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.5fr)_minmax(0,0.85fr)] gap-4 py-3 border-b bg-muted/40 shrink-0 text-sm',
              cronDrawerGutter
            )}
          >
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">
                {t('crons.logs.lastStatus')}
              </p>
              <div>{lastStatusBadge(data.lastStatus, t)}</div>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">
                {t('crons.logs.lastRun')}
              </p>
              <p className="font-medium break-words">{formatDate(data.lastRun)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">
                {t('crons.logs.duration')}
              </p>
              <p className="font-medium whitespace-nowrap">
                {data.lastDurationMs != null ? `${data.lastDurationMs} ms` : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {loading && !data && (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {t('crons.logs.loading')}
            </div>
          )}

          {error && (
            <div className={cn('py-4 text-sm text-destructive', cronDrawerGutter)}>
              {t('crons.logs.loadError', { error })}
            </div>
          )}

          {!loading && !error && data && items.length === 0 && (
            <div
              className={cn(
                'my-6 flex flex-col items-center justify-center rounded-md border py-12 text-center',
                cronDrawerGutter
              )}
            >
              <p className="text-muted-foreground">{t('crons.logs.empty')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('crons.logs.emptyHint')}</p>
            </div>
          )}

          {!error && items.length > 0 && (
            <ScrollArea className="h-full">
              <Table className="[&_th:first-child]:pl-4 [&_td:first-child]:pl-4 sm:[&_th:first-child]:pl-6 sm:[&_td:first-child]:pl-6 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4 sm:[&_th:last-child]:pr-6 sm:[&_td:last-child]:pr-6">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">{t('crons.logs.table.time')}</TableHead>
                    <TableHead className="w-[64px]">{t('crons.logs.table.level')}</TableHead>
                    <TableHead className="w-[90px]">{t('crons.logs.table.phase')}</TableHead>
                    <TableHead className="w-[90px]">{t('crons.logs.table.trigger')}</TableHead>
                    <TableHead>{t('crons.logs.table.message')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => {
                    const rowKey = `${item.runId}-${item.phase}-${idx}`
                    const isExpanded = expandedRunId === rowKey
                    const hasDetail = item.phase === 'error' && item.error != null
                    return (
                      <React.Fragment key={rowKey}>
                        <TableRow
                          className={cn(
                            'cursor-pointer',
                            item.phase === 'error' && 'bg-destructive/5 hover:bg-destructive/10'
                          )}
                          onClick={() =>
                            hasDetail ? setExpandedRunId(isExpanded ? null : rowKey) : undefined
                          }
                        >
                          <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                            {formatDate(item.created)}
                          </TableCell>
                          <TableCell>{levelBadge(item.level, t)}</TableCell>
                          <TableCell>{phaseBadge(item.phase, t)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.trigger || t('crons.status.none')}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[200px]">
                            <div className="flex items-center gap-1">
                              {hasDetail && (
                                <ChevronRight
                                  className={cn(
                                    'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                                    isExpanded && 'rotate-90'
                                  )}
                                />
                              )}
                              {item.message}
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <TableRow className="bg-muted/50">
                            <TableCell colSpan={5} className="py-2 px-4">
                              <div className="text-xs space-y-1 font-mono">
                                {item.runId && (
                                  <p>
                                    <span className="text-muted-foreground">
                                      {t('crons.logs.table.runId')}{' '}
                                    </span>
                                    {item.runId}
                                  </p>
                                )}
                                {item.error != null && (
                                  <p>
                                    <span className="text-muted-foreground">
                                      {t('crons.logs.table.error')}
                                    </span>
                                    <span className="text-destructive">{String(item.error)}</span>
                                  </p>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Main Page ────────────────────────────────────────────

type CronSortKey = 'id' | 'expression'

export function SystemCronsContent() {
  const { t } = useTranslation('system')
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set())
  const [logSummaries, setLogSummaries] = useState<
    Map<string, { lastStatus: 'success' | 'error' | null; lastRun: string | null }>
  >(new Map())
  const [monitorScheduling, setMonitorScheduling] = useState<MonitorSchedulingGroup | null>(null)
  const [sortKey, setSortKey] = useState<CronSortKey>('id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const runningJobsRef = useRef<Set<string>>(new Set())

  const handleSummaryLoaded = useCallback(
    (
      jobId: string,
      summary: { lastStatus: 'success' | 'error' | null; lastRun: string | null }
    ) => {
      setLogSummaries(prev => new Map(prev).set(jobId, summary))
    },
    []
  )

  const handleSort = (key: CronSortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const av = sortKey === 'id' ? a.id : a.expression
      const bv = sortKey === 'id' ? b.id : b.expression
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [jobs, sortKey, sortDir])

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = (await pb.send('/api/crons', { method: 'GET' })) as CronJob[]
      setJobs(Array.isArray(result) ? result : [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    let cancelled = false

    async function loadMonitorScheduling() {
      try {
        const result = (await pb.send(settingsEntryPath('monitor-scheduling'), {
          method: 'GET',
        })) as SettingsEntryResponse<Partial<MonitorSchedulingGroup>>
        if (cancelled) return
        const value = result.value
        if (!value) return
        setMonitorScheduling({
          reachabilityIntervalMinutes: coerceIntervalValue(value.reachabilityIntervalMinutes, 60),
          metricsFreshnessIntervalMinutes: coerceIntervalValue(
            value.metricsFreshnessIntervalMinutes,
            1
          ),
          controlReachabilityIntervalMinutes: coerceIntervalValue(
            value.controlReachabilityIntervalMinutes,
            1
          ),
          runtimeSnapshotIntervalMinutes: coerceIntervalValue(
            value.runtimeSnapshotIntervalMinutes,
            1
          ),
          credentialSweepIntervalMinutes: coerceIntervalValue(
            value.credentialSweepIntervalMinutes,
            5
          ),
          appHealthIntervalMinutes: coerceIntervalValue(value.appHealthIntervalMinutes, 1),
          factsPullIntervalMinutes: coerceIntervalValue(value.factsPullIntervalMinutes, 15),
        })
      } catch {
        if (!cancelled) {
          setMonitorScheduling(null)
        }
      }
    }

    loadMonitorScheduling()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (jobs.length === 0) return

    let cancelled = false
    const platformJobs = jobs.filter(job => getCronJobType(job.id) === 'Platform')
    const missingJobs = platformJobs.filter(job => !logSummaries.has(job.id))
    if (missingJobs.length === 0) return

    async function preloadSummaries() {
      const results = await Promise.allSettled(
        missingJobs.map(async job => {
          const result = (await pb.send(`/api/crons/${encodeURIComponent(job.id)}/logs`, {
            method: 'GET',
          })) as CronLogsResponse
          return {
            jobId: job.id,
            summary: { lastStatus: result.lastStatus, lastRun: result.lastRun },
          }
        })
      )
      if (cancelled) return

      setLogSummaries(prev => {
        const next = new Map(prev)
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            next.set(result.value.jobId, result.value.summary)
          }
        })
        return next
      })
    }

    preloadSummaries()

    return () => {
      cancelled = true
    }
  }, [jobs, logSummaries])

  const openLogs = (jobId: string) => {
    setDrawerJobId(jobId)
    setDrawerOpen(true)
  }

  const runJob = async (jobId: string) => {
    if (runningJobsRef.current.has(jobId)) return
    const nextRunningJobs = new Set(runningJobsRef.current)
    nextRunningJobs.add(jobId)
    runningJobsRef.current = nextRunningJobs
    setRunningJobs(nextRunningJobs)
    setError(null)
    setSuccess(null)
    try {
      await pb.send(`/api/crons/${encodeURIComponent(jobId)}`, { method: 'POST' })
      // Fetch updated log summary for this job after run
      try {
        const result = (await pb.send(`/api/crons/${encodeURIComponent(jobId)}/logs`, {
          method: 'GET',
        })) as CronLogsResponse
        handleSummaryLoaded(jobId, { lastStatus: result.lastStatus, lastRun: result.lastRun })
      } catch {
        /* ignore summary refresh failure */
      }
      setSuccess(t('crons.triggered', { jobId }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      const next = new Set(runningJobsRef.current)
      next.delete(jobId)
      runningJobsRef.current = next
      setRunningJobs(next)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('crons.title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('crons.description')}</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('crons.refreshAria')}
          title={t('common:refresh')}
          onClick={fetchJobs}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <AlertTitle className="text-emerald-900">{t('crons.success')}</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900"
              onClick={() => setSuccess(null)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">{t('crons.dismissSuccess')}</span>
            </Button>
          </div>
        </Alert>
      )}

      {/* Loading skeleton */}
      {loading && jobs.length === 0 && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('crons.loading')}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">{t('crons.empty')}</p>
        </div>
      )}

      {/* Table */}
      {jobs.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortBtn
                  label={t('crons.table.jobId')}
                  field="id"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortBtn
                  label={t('crons.table.schedule')}
                  field="expression"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="w-[110px]">{t('crons.table.type')}</TableHead>
              <TableHead className="w-[110px]">{t('crons.table.effectiveInterval')}</TableHead>
              <TableHead className="w-[100px]">{t('crons.table.lastStatus')}</TableHead>
              <TableHead className="w-[150px] hidden md:table-cell">
                {t('crons.table.lastRun')}
              </TableHead>
              <TableHead className="w-[60px]">{t('crons.table.action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedJobs.map(job => (
              <TableRow key={job.id}>
                <TableCell>
                  <span className="font-mono text-sm font-medium">{job.id}</span>
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {job.expression}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {getCronJobType(job.id) === 'Core'
                      ? t('crons.type.core')
                      : t('crons.type.platform')}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {getEffectiveIntervalLabel(job, monitorScheduling)}
                </TableCell>
                <TableCell>
                  {(() => {
                    const s = logSummaries.get(job.id)
                    if (!s)
                      return (
                        <span className="text-xs text-muted-foreground">
                          {t('crons.status.none')}
                        </span>
                      )
                    return lastStatusBadge(s.lastStatus, t)
                  })()}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {logSummaries.get(job.id)?.lastRun
                    ? formatDate(logSummaries.get(job.id)!.lastRun)
                    : t('crons.status.none')}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreVertical className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => runJob(job.id)}
                        disabled={runningJobs.has(job.id)}
                      >
                        {runningJobs.has(job.id) ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Run
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openLogs(job.id)}>
                        <FileText className="h-4 w-4 mr-2" />
                        View Logs
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Log drawer */}
      <CronLogDrawer
        jobId={drawerJobId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSummaryLoaded={handleSummaryLoaded}
      />
    </div>
  )
}

function SystemCronsPage() {
  return <SystemCronsContent />
}
