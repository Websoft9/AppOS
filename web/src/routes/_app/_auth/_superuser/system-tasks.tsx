import { createFileRoute } from '@tanstack/react-router'
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
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

// ─── Helpers ─────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function levelBadge(level: number) {
  if (level <= 0) {
    return (
      <Badge variant="secondary" className="text-xs font-mono text-blue-600">
        INFO
      </Badge>
    )
  }
  if (level <= 4) {
    return (
      <Badge variant="outline" className="text-xs font-mono text-yellow-600 border-yellow-400">
        WARN
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="text-xs font-mono">
      ERROR
    </Badge>
  )
}

function phaseBadge(phase: CronLogItem['phase']) {
  if (phase === 'success') {
    return (
      <Badge variant="default" className="text-xs gap-1">
        <CheckCircle2 className="h-3 w-3" />
        success
      </Badge>
    )
  }
  if (phase === 'error') {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <XCircle className="h-3 w-3" />
        error
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-xs gap-1">
      <Clock className="h-3 w-3" />
      start
    </Badge>
  )
}

function lastStatusBadge(status: CronLogsResponse['lastStatus']) {
  if (status === 'success') return <Badge variant="default">Success</Badge>
  if (status === 'error') return <Badge variant="destructive">Error</Badge>
  return <Badge variant="outline">—</Badge>
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
                Cron Logs
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
                Refresh
              </Button>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
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
                Last Status
              </p>
              <div>{lastStatusBadge(data.lastStatus)}</div>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">
                Last Run
              </p>
              <p className="font-medium break-words">{formatDate(data.lastRun)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">
                Duration
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
              Loading logs…
            </div>
          )}

          {error && (
            <div className={cn('py-4 text-sm text-destructive', cronDrawerGutter)}>
              Failed to load logs: {error}
            </div>
          )}

          {!loading && !error && data && items.length === 0 && (
            <div
              className={cn(
                'my-6 flex flex-col items-center justify-center rounded-md border py-12 text-center',
                cronDrawerGutter
              )}
            >
              <p className="text-muted-foreground">No execution logs found for this job.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Logs are only available for cron handlers registered with
                <code className="mx-1 font-mono text-xs">cronutil.Wrap()</code>
                in the backend. Native PocketBase cron jobs do not produce structured logs.
              </p>
            </div>
          )}

          {!error && items.length > 0 && (
            <ScrollArea className="h-full">
              <Table className="[&_th:first-child]:pl-4 [&_td:first-child]:pl-4 sm:[&_th:first-child]:pl-6 sm:[&_td:first-child]:pl-6 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4 sm:[&_th:last-child]:pr-6 sm:[&_td:last-child]:pr-6">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Time</TableHead>
                    <TableHead className="w-[64px]">Level</TableHead>
                    <TableHead className="w-[90px]">Phase</TableHead>
                    <TableHead className="w-[90px]">Trigger</TableHead>
                    <TableHead>Message</TableHead>
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
                          <TableCell>{levelBadge(item.level)}</TableCell>
                          <TableCell>{phaseBadge(item.phase)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.trigger || '—'}
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
                                    <span className="text-muted-foreground">run_id: </span>
                                    {item.runId}
                                  </p>
                                )}
                                {item.error != null && (
                                  <p>
                                    <span className="text-muted-foreground">error: </span>
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
      setSuccess(`Job ${jobId} triggered.`)
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
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 mb-3">
        <Button
          variant="outline"
          size="icon"
          title="Refresh"
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
              <AlertTitle className="text-emerald-900">Success</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900"
              onClick={() => setSuccess(null)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Dismiss success message</span>
            </Button>
          </div>
        </Alert>
      )}

      {/* Loading skeleton */}
      {loading && jobs.length === 0 && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tasks…
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">No cron jobs registered.</p>
        </div>
      )}

      {/* Table */}
      {jobs.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortBtn
                  label="Job ID"
                  field="id"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortBtn
                  label="Schedule"
                  field="expression"
                  sort={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="w-[100px]">Last Status</TableHead>
              <TableHead className="w-[150px] hidden md:table-cell">Last Run</TableHead>
              <TableHead className="w-[60px]">Action</TableHead>
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
                  {(() => {
                    const s = logSummaries.get(job.id)
                    if (!s) return <span className="text-xs text-muted-foreground">—</span>
                    return lastStatusBadge(s.lastStatus)
                  })()}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {logSummaries.get(job.id)?.lastRun
                    ? formatDate(logSummaries.get(job.id)!.lastRun)
                    : '—'}
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
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">System Crons</h1>
        <p className="text-muted-foreground mt-1">
          Native cron jobs registered in PocketBase. Manage schedules via PocketBase Admin.
        </p>
      </div>
      <SystemCronsContent />
    </div>
  )
}
