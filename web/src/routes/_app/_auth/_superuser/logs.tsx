import { createFileRoute } from '@tanstack/react-router'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ─── Types ───────────────────────────────────────────────

interface LogEntry {
  id: string
  created: string
  level: number
  message: string
  data: Record<string, unknown> | null
}

interface LogsResponse {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: LogEntry[]
}

type StatusFilter = 'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'none'
type SortField = 'created' | 'execTime'
type SortDir = 'asc' | 'desc'

// ─── Constants ───────────────────────────────────────────

// slog levels: DEBUG=-4, INFO=0, WARN=4, ERROR=8
const LEVEL_OPTIONS = [
  { label: 'All levels', value: '' },
  { label: 'DEBUG', value: '-4' },
  { label: 'INFO', value: '0' },
  { label: 'WARN', value: '4' },
  { label: 'ERROR', value: '8' },
]

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All status', value: 'all' },
  { label: '2xx', value: '2xx' },
  { label: '3xx', value: '3xx' },
  { label: '4xx', value: '4xx' },
  { label: '5xx', value: '5xx' },
  { label: 'No status', value: 'none' },
]

// ─── Helpers ─────────────────────────────────────────────

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function levelBadge(level: number) {
  if (level <= -4) {
    return (
      <Badge variant="outline" className="text-xs font-mono">
        DEBUG
      </Badge>
    )
  }
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

function buildFilter(level: string, search: string): string {
  const parts: string[] = []
  if (level !== '') parts.push(`level = ${level}`)
  if (search.trim()) {
    const q = search.trim().replace(/"/g, '\\"')
    parts.push(`(message ~ "${q}" || data.url ~ "${q}" || data.error ~ "${q}")`)
  }
  return parts.join(' && ')
}

function getStatusCode(log: LogEntry): number | null {
  const status = log.data?.status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

function getExecTime(log: LogEntry): number | null {
  const execTime = log.data?.execTime
  return typeof execTime === 'number' && Number.isFinite(execTime) ? execTime : null
}

function matchesStatusFilter(log: LogEntry, filter: StatusFilter): boolean {
  const status = getStatusCode(log)
  if (filter === 'all') return true
  if (filter === 'none') return status === null
  if (status === null) return false
  if (filter === '2xx') return status >= 200 && status < 300
  if (filter === '3xx') return status >= 300 && status < 400
  if (filter === '4xx') return status >= 400 && status < 500
  return status >= 500 && status < 600
}

function SortableHeader({
  label,
  field,
  sortField,
  sortDir,
  onToggle,
  className = '',
}: {
  label: string
  field: SortField
  sortField: SortField
  sortDir: SortDir
  onToggle: (field: SortField) => void
  className?: string
}) {
  const active = sortField === field

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 hover:text-foreground ${className}`.trim()}
      onClick={() => onToggle(field)}
    >
      <span>{label}</span>
      {active ? (
        sortDir === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />
      )}
    </button>
  )
}

// ─── Component ───────────────────────────────────────────

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filterLevel, setFilterLevel] = useState('')
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(20)
  const [sortField, setSortField] = useState<SortField>('created')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const fetchLogs = useCallback(
    async (p: number, level: string, search: string, perPage: number) => {
      setLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({
          page: String(p),
          perPage: String(perPage),
          sort: '-created',
          skipTotal: '0',
        })
        const filter = buildFilter(level, search)
        if (filter) query.set('filter', filter)

        const result = (await pb.send(`/api/logs?${query.toString()}`, {
          method: 'GET',
        })) as LogsResponse

        setLogs(result.items ?? [])
        setTotalPages(result.totalPages ?? 1)
      } catch (err: unknown) {
        console.error('logs fetch error:', err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchLogs(page, filterLevel, searchInput, pageSize)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [page, filterLevel, searchInput, pageSize, fetchLogs])

  const visibleLogs = useMemo(() => {
    const filtered = logs.filter(log => matchesStatusFilter(log, filterStatus))
    return [...filtered].sort((left, right) => {
      if (sortField === 'created') {
        const leftTime = new Date(left.created).getTime()
        const rightTime = new Date(right.created).getTime()
        return sortDir === 'asc' ? leftTime - rightTime : rightTime - leftTime
      }

      const leftExec = getExecTime(left)
      const rightExec = getExecTime(right)
      const normalizedLeft = leftExec ?? (sortDir === 'asc' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY)
      const normalizedRight = rightExec ?? (sortDir === 'asc' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY)
      return sortDir === 'asc' ? normalizedLeft - normalizedRight : normalizedRight - normalizedLeft
    })
  }, [filterStatus, logs, sortDir, sortField])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDir(field === 'created' ? 'desc' : 'asc')
  }

  const selectClass =
    'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Logs</h2>
          <p className="mt-1 text-sm text-muted-foreground">Browse runtime and request logs.</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          title="Refresh"
          aria-label="Refresh logs"
          onClick={() => fetchLogs(page, filterLevel, searchInput, pageSize)}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          className={selectClass}
          value={filterLevel}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setFilterLevel(e.target.value)
            setPage(1)
          }}
        >
          {LEVEL_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          value={filterStatus}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setFilterStatus(e.target.value as StatusFilter)
            setPage(1)
          }}
        >
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search logs"
          value={searchInput}
          className={`${selectClass} min-w-64`}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setSearchInput(e.target.value)
            setPage(1)
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 pr-0 pl-3" />
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  label="Time"
                  field="created"
                  sortField={sortField}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
              </TableHead>
              <TableHead className="w-24">Level</TableHead>
              <TableHead>Message / URL</TableHead>
              <TableHead className="w-20 text-right">Status</TableHead>
              <TableHead className="w-24 text-right">
                <SortableHeader
                  label="Exec"
                  field="execTime"
                  sortField={sortField}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="justify-end"
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleLogs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {loading ? 'Loading…' : 'No log entries found.'}
                </TableCell>
              </TableRow>
            )}
            {visibleLogs.map(log => {
              const isRequest = log.data?.type === 'request'
              const hasData = log.data && Object.keys(log.data).length > 0
              const url = log.data?.url as string | undefined
              const method = log.data?.method as string | undefined
              const status = getStatusCode(log)
              const execTime = getExecTime(log)
              const primaryText = isRequest && url ? `${method ?? ''} ${url}` : log.message || '—'

              return (
                <React.Fragment key={log.id}>
                  <TableRow
                    className={hasData ? 'cursor-pointer hover:bg-muted/50' : undefined}
                    onClick={() => {
                      if (hasData) setExpandedId(expandedId === log.id ? null : log.id)
                    }}
                  >
                    <TableCell className="w-8 pr-0 pl-3">
                      {hasData &&
                        (expandedId === log.id ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ))}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(log.created)}
                    </TableCell>
                    <TableCell>{levelBadge(log.level)}</TableCell>
                    <TableCell className="font-mono text-xs max-w-md truncate" title={primaryText}>
                      {primaryText}
                    </TableCell>
                    <TableCell className="text-right">
                      {status != null ? (
                        <span
                          className={`font-mono text-xs ${status >= 400 ? 'text-destructive' : 'text-muted-foreground'}`}
                        >
                          {status}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {execTime != null ? execTime.toFixed(2) : '—'}
                    </TableCell>
                  </TableRow>
                  {expandedId === log.id && hasData && (
                    <TableRow key={`${log.id}-detail`}>
                      <TableCell colSpan={6} className="bg-muted/30 px-8 py-3">
                        {log.message && isRequest && (
                          <div className="text-xs text-muted-foreground mb-2">
                            <span className="font-semibold">message:</span> {log.message}
                          </div>
                        )}
                        <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words font-mono">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <select
            className={selectClass}
            value={pageSize}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
          >
            {PAGE_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/logs')({
  component: LogsPage,
})
