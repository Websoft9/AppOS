import { createFileRoute } from '@tanstack/react-router'
import React, { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, ChevronsUpDown, RefreshCw, Loader2 } from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// ─── Types ───────────────────────────────────────────────

interface AuditLog {
  id: string
  user_id: string
  user_email: string
  action: string
  resource_type: string
  resource_id: string
  resource_name: string
  ip: string
  status: 'pending' | 'success' | 'failed'
  detail: Record<string, unknown> | null
  created: string
}

// ─── Constants ───────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const ACTIONS = [
  'app.deploy', 'app.start', 'app.restart', 'app.stop', 'app.delete', 'app.env_update',
  'backup.create', 'backup.restore',
  'user.create', 'user.update', 'user.delete', 'user.reset_password',
  'login.success', 'login.failed',
]

const STATUSES = ['pending', 'success', 'failed']

// ─── Helpers ─────────────────────────────────────────────

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function statusBadge(status: AuditLog['status']) {
  const variants: Record<string, 'default' | 'destructive' | 'outline' | 'secondary'> = {
    success: 'default',
    failed: 'destructive',
    pending: 'secondary',
  }
  return <Badge variant={variants[status] ?? 'outline'}>{status}</Badge>
}

function buildFilter(action: string, status: string): string | undefined {
  const parts: string[] = []
  if (action) parts.push(`action = "${action}"`)
  if (status) parts.push(`status = "${status}"`)
  return parts.length > 0 ? parts.join(' && ') : undefined
}

// ─── SortHeader ──────────────────────────────────────────

function SortHeader({
  field, label, current, dir, onSort,
}: {
  field: string
  label: string
  current: string
  dir: 'asc' | 'desc'
  onSort: (field: string) => void
}) {
  const active = current === field
  const Icon = active ? (dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      {label}
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  )
}

// ─── Component ───────────────────────────────────────────

function AuditPage() {
  const isSuperuser = pb.authStore.record?.collectionName === '_superusers'

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filterAction, setFilterAction] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sortField, setSortField] = useState('created')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [pageSize, setPageSize] = useState(20)

  const sortParam = sortDir === 'desc' ? `-${sortField}` : sortField

  const handleSort = (field: string) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
    setPage(1)
  }

  const fetchLogs = useCallback(async (
    p: number, action: string, status: string, sort: string, perPage: number,
  ) => {
    setLoading(true)
    setError(null)
    try {
      const result = await pb.collection('audit_logs').getList<AuditLog>(p, perPage, {
        sort,
        filter: buildFilter(action, status),
      })
      setLogs(result.items)
      setTotalPages(result.totalPages)
    } catch (err: unknown) {
      console.error('audit fetch error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs(page, filterAction, filterStatus, sortParam, pageSize)
  }, [page, filterAction, filterStatus, sortParam, pageSize, fetchLogs])

  const selectClass =
    'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Audit Log</h2>
        <Button variant="ghost" size="sm" onClick={() => fetchLogs(page, filterAction, filterStatus, sortParam, pageSize)}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          className={selectClass}
          value={filterAction}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setPage(1)
            setFilterAction(e.target.value)
          }}
        >
          <option value="">All actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <select
          className={selectClass}
          value={filterStatus}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setPage(1)
            setFilterStatus(e.target.value)
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          className={selectClass}
          value={pageSize}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setPageSize(Number(e.target.value))
            setPage(1)
          }}
        >
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="relative rounded-md border">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>
                <SortHeader field="created" label="Time" current={sortField} dir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead>
                <SortHeader field="action" label="Action" current={sortField} dir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>
                <SortHeader field="status" label="Status" current={sortField} dir={sortDir} onSort={handleSort} />
              </TableHead>
              {isSuperuser && (
                <TableHead>
                  <SortHeader field="ip" label="IP" current={sortField} dir={sortDir} onSort={handleSort} />
                </TableHead>
              )}
              {isSuperuser && (
                <TableHead>
                  <SortHeader field="user_email" label="User" current={sortField} dir={sortDir} onSort={handleSort} />
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={isSuperuser ? 7 : 5} className="text-center text-muted-foreground py-8">
                  {loading ? 'Loading…' : 'No records found.'}
                </TableCell>
              </TableRow>
            )}
            {logs.map(log => {
              const hasDetail = log.detail && Object.keys(log.detail).length > 0
              const colSpan = isSuperuser ? 7 : 5
              // Separate UA from the rest of detail for display
              const ua = log.detail?.user_agent as string | undefined
              const detailWithoutUA = log.detail
                ? Object.fromEntries(Object.entries(log.detail).filter(([k]) => k !== 'user_agent'))
                : {}
              const hasDetailWithoutUA = Object.keys(detailWithoutUA).length > 0

              return (
                <React.Fragment key={log.id}>
                  <TableRow
                    className={hasDetail ? 'cursor-pointer hover:bg-muted/50' : undefined}
                    onClick={() => {
                      if (hasDetail) setExpandedId(expandedId === log.id ? null : log.id)
                    }}
                  >
                    <TableCell className="pr-0">
                      {hasDetail && (
                        expandedId === log.id
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(log.created)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{log.action}</TableCell>
                    <TableCell className="max-w-xs truncate">{log.resource_name || log.resource_id || '—'}</TableCell>
                    <TableCell>{statusBadge(log.status)}</TableCell>
                    {isSuperuser && (
                      <TableCell className="font-mono text-xs text-muted-foreground">{log.ip || '—'}</TableCell>
                    )}
                    {isSuperuser && (
                      <TableCell className="text-sm text-muted-foreground">{log.user_email || log.user_id}</TableCell>
                    )}
                  </TableRow>
                  {expandedId === log.id && hasDetail && (
                    <TableRow key={`${log.id}-detail`}>
                      <TableCell colSpan={colSpan} className="bg-muted/30 px-8 py-3 space-y-2">
                        {ua && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-semibold">User-Agent:</span> {ua}
                          </div>
                        )}
                        {hasDetailWithoutUA && (
                          <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words font-mono">
                            {JSON.stringify(detailWithoutUA, null, 2)}
                          </pre>
                        )}
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
        <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/audit')({
  component: AuditPage,
})
