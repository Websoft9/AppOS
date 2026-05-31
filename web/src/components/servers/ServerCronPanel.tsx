import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
} from 'lucide-react'

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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  createServerCronJob,
  deleteServerCronJob,
  disableServerCronJob,
  enableServerCronJob,
  listServerCronJobs,
  testServerCronJob,
  updateServerCronJob,
  type ServerCronJob,
  type ServerCronJobWritePayload,
} from '@/lib/connect-api'
import { getApiErrorMessage, isRequestCancellation } from '@/lib/api-error'
import { cn } from '@/lib/utils'

type CronSortDirection = 'asc' | 'desc'
type EntryDetailTab = 'live-log' | 'logs'

const PAGE_SIZE = 12

type CronBuilderMode = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'custom'

type CronBuilderState = {
  mode: CronBuilderMode
  interval: string
  minute: string
  hour: string
  dayOfMonth: string
  month: string
  dayOfWeek: string[]
}

const weekdayOptions = [
  { value: '0', shortLabel: 'Sun', label: 'Sunday' },
  { value: '1', shortLabel: 'Mon', label: 'Monday' },
  { value: '2', shortLabel: 'Tue', label: 'Tuesday' },
  { value: '3', shortLabel: 'Wed', label: 'Wednesday' },
  { value: '4', shortLabel: 'Thu', label: 'Thursday' },
  { value: '5', shortLabel: 'Fri', label: 'Friday' },
  { value: '6', shortLabel: 'Sat', label: 'Saturday' },
]

const timeOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const minuteOptions = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
const monthDayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1))

const emptyBuilderState: CronBuilderState = {
  mode: 'minute',
  interval: '1',
  minute: '0',
  hour: '0',
  dayOfMonth: '1',
  month: '1',
  dayOfWeek: ['1'],
}

type EditorState = {
  mode: 'create' | 'edit'
  entryId?: string
  name: string
  schedule: string
  command: string
  enabled: boolean
  singleRunOnly: boolean
}

const emptyEditorState: EditorState = {
  mode: 'create',
  name: '',
  schedule: '* * * * *',
  command: '',
  enabled: true,
  singleRunOnly: false,
}

function clampInteger(raw: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(raw.trim(), 10)
  if (Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function stepField(interval: string, max: number) {
  const value = clampInteger(interval, 1, 1, max)
  return value <= 1 ? '*' : `*/${value}`
}

function customField(raw: string) {
  const value = raw.trim()
  return value === '' ? '*' : value
}

function buildCronExpression(state: CronBuilderState) {
  switch (state.mode) {
    case 'minute':
      return `${stepField(state.interval, 59)} * * * *`
    case 'hour':
      return `${clampInteger(state.minute, 0, 0, 59)} ${stepField(state.interval, 23)} * * *`
    case 'day':
      return `${clampInteger(state.minute, 0, 0, 59)} ${clampInteger(state.hour, 0, 0, 23)} ${stepField(state.interval, 31)} * *`
    case 'week':
      return `${clampInteger(state.minute, 0, 0, 59)} ${clampInteger(state.hour, 0, 0, 23)} * * ${state.dayOfWeek.length > 0 ? state.dayOfWeek.join(',') : '1'}`
    case 'month':
      return `${clampInteger(state.minute, 0, 0, 59)} ${clampInteger(state.hour, 0, 0, 23)} ${clampInteger(state.dayOfMonth, 1, 1, 31)} * *`
    case 'custom':
      return [
        customField(state.minute),
        customField(state.hour),
        customField(state.dayOfMonth),
        customField(state.month),
        state.dayOfWeek.length > 0 ? state.dayOfWeek.join(',') : '*',
      ].join(' ')
    default:
      return '* * * * *'
  }
}

function parseStep(value: string) {
  if (value === '*') return '1'
  const match = value.match(/^\*\/(\d+)$/)
  return match?.[1] ?? ''
}

function parseScheduleToBuilder(schedule: string): CronBuilderState {
  const fields = schedule.trim().split(/\s+/)
  if (fields.length !== 5) return emptyBuilderState
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields

  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = parseStep(minute)
    if (interval) {
      return { ...emptyBuilderState, mode: 'minute', interval }
    }
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = parseStep(hour)
    if (interval && /^\d+$/.test(minute)) {
      return { ...emptyBuilderState, mode: 'hour', interval, minute }
    }
  }

  if (month === '*' && dayOfWeek === '*') {
    const interval = parseStep(dayOfMonth)
    if (interval && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
      return { ...emptyBuilderState, mode: 'day', interval, minute, hour }
    }
  }

  if (
    dayOfMonth === '*' &&
    month === '*' &&
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    /^\d+$/.test(dayOfWeek)
  ) {
    return { ...emptyBuilderState, mode: 'week', minute, hour, dayOfWeek: [dayOfWeek] }
  }

  if (
    dayOfMonth === '*' &&
    month === '*' &&
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    /^\d+(,\d+)+$/.test(dayOfWeek)
  ) {
    return { ...emptyBuilderState, mode: 'week', minute, hour, dayOfWeek: dayOfWeek.split(',') }
  }

  if (
    month === '*' &&
    dayOfWeek === '*' &&
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    /^\d+$/.test(dayOfMonth)
  ) {
    return { ...emptyBuilderState, mode: 'month', minute, hour, dayOfMonth }
  }

  return {
    mode: 'custom',
    interval: '1',
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: dayOfWeek === '*' ? [] : dayOfWeek.split(','),
  }
}

function toggleWeekday(current: string[], value: string, checked: boolean) {
  const next = checked ? [...current, value] : current.filter(item => item !== value)
  return [...new Set(next)].sort((left, right) => Number(left) - Number(right))
}

function panelSection(title: string, content: ReactNode, description?: string) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div>{content}</div>
    </section>
  )
}

function validateCronPayload(payload: ServerCronJobWritePayload): string | null {
  if (!payload.name.trim()) return 'Name is required'
  if (payload.schedule.trim().split(/\s+/).length !== 5) {
    return 'Schedule must be a valid five-field cron expression'
  }
  if (!payload.command.trim()) return 'Command is required'
  return null
}

function toPayload(state: EditorState): ServerCronJobWritePayload {
  return {
    name: state.name.trim(),
    schedule: state.schedule.trim().replace(/\s+/g, ' '),
    command: state.command.trim(),
    enabled: state.enabled,
    singleRunOnly: state.singleRunOnly,
  }
}

function statusLabel(job: Pick<ServerCronJob, 'enabled'>) {
  return job.enabled ? 'Yes' : 'No'
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase()
}

function matchesQuery(job: ServerCronJob, query: string) {
  if (!query) return true
  return [job.name, job.schedule, job.command, job.path].some(value =>
    value.toLowerCase().includes(query)
  )
}

function formatOperationLog(message: string) {
  return `[${new Date().toLocaleTimeString()}] ${message}`
}

export function ServerCronPanel({ serverId }: { serverId: string }) {
  const requestSeqRef = useRef(0)
  const [jobs, setJobs] = useState<ServerCronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorState, setEditorState] = useState<EditorState>(emptyEditorState)
  const [builderState, setBuilderState] = useState<CronBuilderState>(emptyBuilderState)
  const [editorError, setEditorError] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ServerCronJob | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [sortDirection, setSortDirection] = useState<CronSortDirection>('asc')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selectedEntryId, setSelectedEntryId] = useState('')
  const [entryDetailTab, setEntryDetailTab] = useState<EntryDetailTab>('live-log')
  const [operationLogs, setOperationLogs] = useState<Record<string, string[]>>({})

  const appendOperationLog = useCallback((entryId: string, message: string) => {
    if (!entryId) return
    setOperationLogs(current => ({
      ...current,
      [entryId]: [...(current[entryId] ?? []), formatOperationLog(message)],
    }))
  }, [])

  const loadJobs = useCallback(async () => {
    if (!serverId) return
    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    setLoading(true)
    setError('')
    try {
      const response = await listServerCronJobs(serverId)
      if (requestSeqRef.current !== requestSeq) return
      setJobs(Array.isArray(response.items) ? response.items : [])
    } catch (loadError) {
      if (requestSeqRef.current !== requestSeq || isRequestCancellation(loadError)) return
      setError(getApiErrorMessage(loadError, 'Failed to load cron entries'))
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setLoading(false)
      }
    }
  }, [serverId])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((left, right) => {
        const result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        return sortDirection === 'desc' ? result * -1 : result
      }),
    [jobs, sortDirection]
  )

  const normalizedQuery = useMemo(() => normalizeQuery(query), [query])

  const filteredJobs = useMemo(
    () => sortedJobs.filter(job => matchesQuery(job, normalizedQuery)),
    [normalizedQuery, sortedJobs]
  )

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredJobs.length / PAGE_SIZE)),
    [filteredJobs.length]
  )
  const currentPage = Math.min(page, totalPages)

  const pagedJobs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredJobs.slice(start, start + PAGE_SIZE)
  }, [currentPage, filteredJobs])

  const selectedJob = useMemo(
    () => filteredJobs.find(job => job.entryId === selectedEntryId) ?? null,
    [filteredJobs, selectedEntryId]
  )

  const selectedJobLogs = useMemo(
    () => (selectedJob ? (operationLogs[selectedJob.entryId] ?? []) : []),
    [operationLogs, selectedJob]
  )

  const toggleNameSort = useCallback(() => {
    setSortDirection(current => (current === 'asc' ? 'desc' : 'asc'))
  }, [])

  const renderNameSortIcon = useCallback(() => {
    if (sortDirection === 'asc') {
      return <ArrowUp className="h-3.5 w-3.5" />
    }
    if (sortDirection === 'desc') {
      return <ArrowDown className="h-3.5 w-3.5" />
    }
    return <ArrowUpDown className="h-3.5 w-3.5" />
  }, [sortDirection])

  const openCreate = useCallback(() => {
    setHint('')
    setEditorError('')
    setEditorState(emptyEditorState)
    setBuilderState(emptyBuilderState)
    setCopyState('idle')
    setEditorOpen(true)
  }, [])

  const openEdit = useCallback((job: ServerCronJob) => {
    setHint('')
    setEditorError('')
    setEditorState({
      mode: 'edit',
      entryId: job.entryId,
      name: job.name,
      schedule: job.schedule,
      command: job.command,
      enabled: job.enabled,
      singleRunOnly: job.singleRunOnly,
    })
    setBuilderState(parseScheduleToBuilder(job.schedule))
    setCopyState('idle')
    setEditorOpen(true)
  }, [])

  const generatedSchedule = useMemo(() => buildCronExpression(builderState), [builderState])

  useEffect(() => {
    setEditorState(current =>
      current.schedule === generatedSchedule ? current : { ...current, schedule: generatedSchedule }
    )
  }, [generatedSchedule])

  const copySchedule = useCallback(async () => {
    if (!navigator?.clipboard) return
    await navigator.clipboard.writeText(generatedSchedule)
    setCopyState('copied')
  }, [generatedSchedule])

  useEffect(() => {
    if (copyState !== 'copied') return
    const handle = window.setTimeout(() => setCopyState('idle'), 1200)
    return () => window.clearTimeout(handle)
  }, [copyState])

  const handleSave = useCallback(async () => {
    const payload = toPayload(editorState)
    const validationError = validateCronPayload(payload)
    if (validationError) {
      setEditorError(validationError)
      return
    }

    setSaving(true)
    setEditorError('')
    try {
      if (editorState.mode === 'edit' && editorState.entryId) {
        appendOperationLog(editorState.entryId, 'Saving entry changes...')
      }
      const saved =
        editorState.mode === 'edit' && editorState.entryId
          ? await updateServerCronJob(serverId, editorState.entryId, payload)
          : await createServerCronJob(serverId, payload)
      setEntryDetailTab('live-log')
      setJobs(current => {
        const next = current.filter(item => item.entryId !== saved.entryId)
        return [...next, saved]
      })
      setSelectedEntryId(saved.entryId)
      appendOperationLog(
        saved.entryId,
        editorState.mode === 'edit' ? 'Entry updated successfully.' : 'Entry created successfully.'
      )
      setHint(editorState.mode === 'edit' ? 'Cron entry updated.' : 'Cron entry created.')
      setEditorOpen(false)
      setEditorState(emptyEditorState)
      setBuilderState(emptyBuilderState)
      setCopyState('idle')
    } catch (saveError) {
      if (isRequestCancellation(saveError)) return
      if (editorState.mode === 'edit' && editorState.entryId) {
        appendOperationLog(
          editorState.entryId,
          `Save failed: ${getApiErrorMessage(saveError, 'Failed to save cron entry')}`
        )
      }
      setEditorError(getApiErrorMessage(saveError, 'Failed to save cron entry'))
    } finally {
      setSaving(false)
    }
  }, [appendOperationLog, editorState, serverId])

  const handleToggle = useCallback(
    async (job: ServerCronJob) => {
      setHint('')
      setError('')
      try {
        appendOperationLog(
          job.entryId,
          job.enabled ? 'Removing effect from entry...' : 'Applying entry to crontab...'
        )
        const nextJob = job.enabled
          ? await disableServerCronJob(serverId, job.entryId)
          : await enableServerCronJob(serverId, job.entryId)
        setEntryDetailTab('live-log')
        setJobs(current => current.map(item => (item.entryId === nextJob.entryId ? nextJob : item)))
        appendOperationLog(
          nextJob.entryId,
          nextJob.enabled ? 'Entry is now effective.' : 'Entry removed from effect.'
        )
        setHint(
          job.enabled ? 'Crontab entry removed from effect.' : 'Crontab entry is now effective.'
        )
      } catch (toggleError) {
        if (isRequestCancellation(toggleError)) return
        appendOperationLog(
          job.entryId,
          `Toggle failed: ${getApiErrorMessage(toggleError, 'Failed to update cron entry')}`
        )
        setError(getApiErrorMessage(toggleError, 'Failed to update cron entry'))
      }
    },
    [appendOperationLog, serverId]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleteSubmitting(true)
    setError('')
    setHint('')
    try {
      appendOperationLog(deleteTarget.entryId, 'Deleting entry...')
      await deleteServerCronJob(serverId, deleteTarget.entryId)
      setJobs(current => current.filter(item => item.entryId !== deleteTarget.entryId))
      setSelectedEntryId(current => (current === deleteTarget.entryId ? '' : current))
      appendOperationLog(deleteTarget.entryId, 'Entry deleted.')
      setHint('Cron entry deleted.')
      setDeleteTarget(null)
    } catch (deleteError) {
      if (isRequestCancellation(deleteError)) return
      appendOperationLog(
        deleteTarget.entryId,
        `Delete failed: ${getApiErrorMessage(deleteError, 'Failed to delete cron entry')}`
      )
      setError(getApiErrorMessage(deleteError, 'Failed to delete cron entry'))
    } finally {
      setDeleteSubmitting(false)
    }
  }, [appendOperationLog, deleteTarget, serverId])

  const handleTest = useCallback(
    async (job: ServerCronJob) => {
      setHint('')
      setError('')
      try {
        setEntryDetailTab('live-log')
        appendOperationLog(job.entryId, 'Running test for entry...')
        const result = await testServerCronJob(serverId, job.entryId)
        appendOperationLog(
          job.entryId,
          result.output ? `Test output:\n${result.output}` : 'Crontab entry tested.'
        )
        setHint(result.output ? `Test output:\n${result.output}` : 'Crontab entry tested.')
      } catch (testError) {
        if (isRequestCancellation(testError)) return
        appendOperationLog(
          job.entryId,
          `Test failed: ${getApiErrorMessage(testError, 'Failed to test crontab entry')}`
        )
        setError(getApiErrorMessage(testError, 'Failed to test crontab entry'))
      }
    },
    [appendOperationLog, serverId]
  )

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  useEffect(() => {
    if (selectedEntryId && !filteredJobs.some(job => job.entryId === selectedEntryId)) {
      setSelectedEntryId('')
    }
  }, [filteredJobs, selectedEntryId])

  useEffect(() => {
    setEntryDetailTab('live-log')
  }, [selectedEntryId])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-border/40 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Crontab</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage AppOS-owned crontab entries for this server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => {
              void loadJobs()
            }}
            disabled={loading}
            aria-label="Refresh crontab entries"
            title="Refresh crontab entries"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Entry
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {hint}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading cron entries...
        </div>
      ) : sortedJobs.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <h4 className="text-base font-medium text-foreground">No managed crontab entries yet</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            This list only shows AppOS-managed crontab entries for this server.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            New Entry
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="space-y-4 rounded-md border p-4" aria-label="Crontab inventory">
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-3 whitespace-nowrap">
                <span className="text-sm text-muted-foreground">
                  Total {filteredJobs.length} entries, 0 failed.
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search"
                    className="h-8 w-[clamp(8ch,18vw,18ch)] min-w-0 rounded-md border bg-background px-2 text-sm"
                  />
                  <div className="flex items-center gap-0.5 text-sm text-muted-foreground">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={currentPage <= 1}
                      aria-label="Previous page"
                      onClick={() => setPage(prev => Math.max(1, prev - 1))}
                    >
                      {'<'}
                    </Button>
                    <span className="px-1 text-center font-medium text-foreground">
                      {currentPage}/{totalPages}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={currentPage >= totalPages}
                      aria-label="Next page"
                      onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                    >
                      {'>'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="align-middle px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={toggleNameSort}
                          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                          aria-label={`Name sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
                        >
                          <span>Name</span>
                          {renderNameSortIcon()}
                        </button>
                      </th>
                      <th className="align-middle px-3 py-2 font-medium">Schedule</th>
                      <th className="align-middle px-3 py-2 font-medium">Path</th>
                      <th className="align-middle px-3 py-2 font-medium">Take Effective</th>
                      <th className="align-middle px-3 py-2 font-medium">Single Run Only</th>
                      <th className="align-middle px-3 py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedJobs.map(job => (
                      <tr
                        key={job.entryId}
                        onClick={() => setSelectedEntryId(job.entryId)}
                        className={cn(
                          'cursor-pointer border-t transition-colors hover:bg-accent/30',
                          selectedEntryId === job.entryId && 'bg-accent/40'
                        )}
                      >
                        <td className="align-middle px-3 py-2 font-medium text-foreground">
                          {job.name}
                        </td>
                        <td className="align-middle px-3 py-2 font-mono text-xs text-muted-foreground">
                          {job.schedule}
                        </td>
                        <td className="max-w-[16rem] align-middle px-3 py-2 font-mono text-xs text-muted-foreground">
                          <div className="truncate" title={job.path}>
                            {job.path}
                          </div>
                        </td>
                        <td className="align-middle px-3 py-2">{statusLabel(job)}</td>
                        <td className="align-middle px-3 py-2">
                          {job.singleRunOnly ? 'Yes' : 'No'}
                        </td>
                        <td
                          className="align-middle px-3 py-2 text-right"
                          onClick={event => event.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Crontab actions for ${job.name}`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(job)}>
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleTest(job)
                                }}
                              >
                                Test
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleToggle(job)
                                }}
                              >
                                {job.enabled ? 'Remove Effect' : 'Take Effective'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDeleteTarget(job)}>
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pagedJobs.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">
                  No crontab entries match the current filters.
                </div>
              ) : null}
            </div>
          </section>

          <section
            className="max-h-[calc(100vh-50px)] self-start space-y-4 overflow-auto rounded-md border p-4"
            aria-labelledby="selected-crontab-heading"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="selected-crontab-heading" className="text-sm font-semibold">
                  Selected Entry
                </h3>
                <p className="text-xs text-muted-foreground">
                  {selectedJob ? selectedJob.name : 'Select one entry from the inventory.'}
                </p>
              </div>
              {selectedJob ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(selectedJob)}
                    disabled={saving}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void handleTest(selectedJob)
                    }}
                  >
                    Test
                  </Button>
                </div>
              ) : null}
            </div>

            {!selectedJob ? (
              <div className="text-sm text-muted-foreground">
                Choose a crontab entry to inspect its schedule, path, and command details.
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Name:</span>
                  <span className="break-words text-muted-foreground">{selectedJob.name}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Schedule:</span>
                  <span className="break-words font-mono text-muted-foreground">
                    {selectedJob.schedule}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Path:</span>
                  <span className="break-all font-mono text-muted-foreground">
                    {selectedJob.path}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Take Effective:</span>
                  <span className="break-words text-muted-foreground">
                    {statusLabel(selectedJob)}
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground">Single Run Only:</span>
                  <span className="break-words text-muted-foreground">
                    {selectedJob.singleRunOnly ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="font-medium text-foreground">Command</div>
                  <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/10 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
                    {selectedJob.command}
                  </pre>
                </div>
                <div className="space-y-3 border-t pt-4">
                  <Tabs
                    value={entryDetailTab}
                    onValueChange={value => setEntryDetailTab(value as EntryDetailTab)}
                    className="gap-3"
                  >
                    <TabsList
                      variant="line"
                      className="h-auto w-full justify-start rounded-none border-b p-0"
                    >
                      <TabsTrigger value="live-log" className="flex-none rounded-none px-3 py-2">
                        Live log
                      </TabsTrigger>
                      <TabsTrigger value="logs" className="flex-none rounded-none px-3 py-2">
                        Logs
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="live-log" className="mt-0">
                      <div className="space-y-2">
                        {selectedJobLogs.length === 0 ? (
                          <div className="rounded-md border border-dashed bg-muted/10 px-3 py-4 text-sm text-muted-foreground">
                            No operation log yet. Trigger Test, Edit, enable/disable, or delete
                            actions to see live updates here.
                          </div>
                        ) : (
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/10 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
                            {selectedJobLogs.join('\n\n')}
                          </pre>
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="logs" className="mt-0">
                      <div className="rounded-md border border-dashed bg-muted/10 px-3 py-4 text-sm text-muted-foreground">
                        Entry historical logs are reserved here. Backend log API is not available
                        yet.
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={open => {
          setEditorOpen(open)
          if (!open) {
            setEditorError('')
            setCopyState('idle')
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editorState.mode === 'edit' ? 'Edit Entry' : 'New Entry'}</DialogTitle>
            <DialogDescription>
              Generate a five-field cron schedule with frequency-specific controls.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {panelSection(
              'Name',
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="cron-name" className="sr-only">
                    Name
                  </label>
                  <input
                    id="cron-name"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    value={editorState.name}
                    onChange={event =>
                      setEditorState(current => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Name"
                  />
                </div>
              </div>
            )}

            {panelSection(
              'Command',
              <div className="space-y-2">
                <label htmlFor="cron-command" className="sr-only">
                  Command
                </label>
                <textarea
                  id="cron-command"
                  className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editorState.command}
                  onChange={event =>
                    setEditorState(current => ({ ...current, command: event.target.value }))
                  }
                  placeholder="Command"
                />
              </div>
            )}

            {panelSection(
              'Optional',
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-3 text-sm text-foreground">
                  <Checkbox
                    checked={editorState.enabled}
                    onCheckedChange={checked =>
                      setEditorState(current => ({ ...current, enabled: checked === true }))
                    }
                    aria-label="Take Effective"
                  />
                  <span>Take Effective</span>
                </label>
                <label className="flex items-center gap-3 text-sm text-foreground">
                  <Checkbox
                    checked={editorState.singleRunOnly}
                    onCheckedChange={checked =>
                      setEditorState(current => ({ ...current, singleRunOnly: checked === true }))
                    }
                    aria-label="Single Run Only"
                  />
                  <span>Single Run Only</span>
                </label>
              </div>
            )}

            {panelSection(
              'Frequency Set',
              <div className="space-y-4">
                <div
                  className={
                    builderState.mode === 'minute' || builderState.mode === 'hour'
                      ? 'grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-start'
                      : 'grid gap-4 md:grid-cols-2 md:items-start'
                  }
                >
                  <div className="space-y-2">
                    <label htmlFor="cron-frequency" className="text-sm font-medium text-foreground">
                      Frequency
                    </label>
                    <select
                      id="cron-frequency"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      value={builderState.mode}
                      onChange={event =>
                        setBuilderState(current => ({
                          ...current,
                          mode: event.target.value as CronBuilderMode,
                        }))
                      }
                    >
                      <option value="minute">Every minute</option>
                      <option value="hour">Every hour</option>
                      <option value="day">Every day</option>
                      <option value="week">Every week</option>
                      <option value="month">Every month</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  {builderState.mode === 'minute' || builderState.mode === 'hour' ? (
                    <div className="space-y-2">
                      <label
                        htmlFor="cron-interval"
                        className="text-sm font-medium text-foreground"
                      >
                        Every
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          id="cron-interval"
                          type="number"
                          min={1}
                          className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.interval}
                          onChange={event =>
                            setBuilderState(current => ({
                              ...current,
                              interval: event.target.value,
                            }))
                          }
                        />
                        <span className="text-sm text-muted-foreground">
                          {builderState.mode === 'minute' ? 'minute(s)' : 'hour(s)'}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {builderState.mode === 'day' ||
                  builderState.mode === 'week' ||
                  builderState.mode === 'month' ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium leading-5 text-foreground">At time</div>
                      <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                        <select
                          aria-label="Hour"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.hour.padStart(2, '0')}
                          onChange={event =>
                            setBuilderState(current => ({
                              ...current,
                              hour: String(Number.parseInt(event.target.value, 10)),
                            }))
                          }
                        >
                          {timeOptions.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <span className="text-sm text-muted-foreground">:</span>
                        <select
                          aria-label="Minute"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.minute.padStart(2, '0')}
                          onChange={event =>
                            setBuilderState(current => ({
                              ...current,
                              minute: String(Number.parseInt(event.target.value, 10)),
                            }))
                          }
                        >
                          {minuteOptions.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}
                </div>

                {builderState.mode === 'week' ? (
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Days of week</div>
                    <div className="flex flex-wrap gap-2">
                      {weekdayOptions.map(option => {
                        const checked = builderState.dayOfWeek.includes(option.value)
                        return (
                          <label
                            key={option.value}
                            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${checked ? 'border-foreground/30 bg-muted/60 text-foreground' : 'border-border/60 text-muted-foreground'}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={nextChecked =>
                                setBuilderState(current => ({
                                  ...current,
                                  dayOfWeek: toggleWeekday(
                                    current.dayOfWeek,
                                    option.value,
                                    nextChecked === true
                                  ),
                                }))
                              }
                              aria-label={option.label}
                            />
                            <span>{option.shortLabel}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {builderState.mode === 'month' ? (
                  <div className="space-y-2 md:max-w-xs">
                    <label htmlFor="cron-month-day" className="text-sm font-medium text-foreground">
                      Day of month
                    </label>
                    <select
                      id="cron-month-day"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      value={builderState.dayOfMonth}
                      onChange={event =>
                        setBuilderState(current => ({ ...current, dayOfMonth: event.target.value }))
                      }
                    >
                      {monthDayOptions.map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {builderState.mode === 'custom' ? (
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">Custom cron fields</div>
                    <div className="grid gap-3 md:grid-cols-5">
                      <div className="space-y-2">
                        <label
                          htmlFor="cron-custom-minute"
                          className="text-xs text-muted-foreground"
                        >
                          Minute
                        </label>
                        <input
                          id="cron-custom-minute"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.minute}
                          onChange={event =>
                            setBuilderState(current => ({ ...current, minute: event.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="cron-custom-hour" className="text-xs text-muted-foreground">
                          Hour
                        </label>
                        <input
                          id="cron-custom-hour"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.hour}
                          onChange={event =>
                            setBuilderState(current => ({ ...current, hour: event.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="cron-custom-dom" className="text-xs text-muted-foreground">
                          Day (M)
                        </label>
                        <input
                          id="cron-custom-dom"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.dayOfMonth}
                          onChange={event =>
                            setBuilderState(current => ({
                              ...current,
                              dayOfMonth: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor="cron-custom-month"
                          className="text-xs text-muted-foreground"
                        >
                          Month
                        </label>
                        <input
                          id="cron-custom-month"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.month}
                          onChange={event =>
                            setBuilderState(current => ({ ...current, month: event.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="cron-custom-dow" className="text-xs text-muted-foreground">
                          Day (W)
                        </label>
                        <input
                          id="cron-custom-dow"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          value={builderState.dayOfWeek.join(',')}
                          onChange={event =>
                            setBuilderState(current => ({
                              ...current,
                              dayOfWeek:
                                event.target.value.trim() === ''
                                  ? []
                                  : event.target.value
                                      .split(',')
                                      .map(item => item.trim())
                                      .filter(Boolean),
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {panelSection(
              'Cron Expression',
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="cron-schedule" className="text-sm font-medium text-foreground">
                    Your cron expression
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void copySchedule()
                    }}
                  >
                    {copyState === 'copied' ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <input
                  id="cron-schedule"
                  readOnly
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none"
                  value={editorState.schedule}
                />
              </div>
            )}

            {editorError ? <div className="text-sm text-destructive">{editorError}</div> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleSave()
              }}
              disabled={saving}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={open => {
          if (!open && !deleteSubmitting) {
            setDeleteTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cron Entry</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Entry: ${deleteTarget.name}. This permanently removes the managed cron row.`
                : 'Confirm deletion.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault()
                void handleDelete()
              }}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
