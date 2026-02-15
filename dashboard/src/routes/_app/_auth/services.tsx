import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Square, RotateCw, FileText, Loader2 } from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

// ─── Types ───────────────────────────────────────────────

interface ProcessInfo {
  name: string
  group: string
  state: number
  stateName: string
  pid: number
  uptime: number
  description: string
  cpu: number
  memory: number
  spawnErr?: string
}

interface Summary {
  total: number
  running: number
  stopped: number
  error: number
  totalCPU: number
  totalMemory: number
}

interface ServiceListResponse {
  processes: ProcessInfo[]
  summary: Summary
}

// ─── Helpers ─────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatMemory(bytes: number): string {
  if (bytes <= 0) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function stateColor(stateName: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (stateName) {
    case 'RUNNING':
      return 'default'
    case 'STOPPED':
      return 'secondary'
    case 'FATAL':
    case 'EXITED':
    case 'UNKNOWN':
      return 'destructive'
    default:
      return 'outline'
  }
}

function stateIndicator(stateName: string): string {
  switch (stateName) {
    case 'RUNNING':
      return '●'
    case 'STOPPED':
      return '○'
    case 'FATAL':
    case 'EXITED':
      return '✕'
    default:
      return '◌'
  }
}

// ─── Services Page ───────────────────────────────────────

function ServicesPage() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notification, setNotification] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    name: string
    action: 'stop' | 'restart'
  } | null>(null)
  const [logDialog, setLogDialog] = useState<{
    name: string
    type: 'stdout' | 'stderr'
    content: string
    loading: boolean
  } | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Data Fetching ───────────────────────────────────

  const fetchServices = useCallback(async () => {
    try {
      const data = await pb.send<ServiceListResponse>('/api/ext/services', {})
      setProcesses(data.processes || [])
      setSummary(data.summary || null)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch services')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchServices()
    intervalRef.current = setInterval(fetchServices, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchServices])

  // ─── Service Actions ─────────────────────────────────

  const showNotification = useCallback(
    (type: 'success' | 'error', message: string) => {
      setNotification({ type, message })
      setTimeout(() => setNotification(null), 3000)
    },
    [],
  )

  const executeAction = useCallback(
    async (name: string, action: 'start' | 'stop' | 'restart') => {
      setActionLoading(`${name}:${action}`)
      try {
        await pb.send(`/api/ext/services/${name}/${action}`, { method: 'POST' })
        showNotification('success', `${name} ${action}ed successfully`)
        // Refresh immediately after action
        await fetchServices()
      } catch (err) {
        showNotification(
          'error',
          err instanceof Error ? err.message : `Failed to ${action} ${name}`,
        )
      } finally {
        setActionLoading(null)
      }
    },
    [fetchServices, showNotification],
  )

  const handleAction = useCallback(
    (name: string, action: 'start' | 'stop' | 'restart') => {
      if (action === 'stop' || action === 'restart') {
        setConfirmAction({ name, action })
      } else {
        executeAction(name, action)
      }
    },
    [executeAction],
  )

  // ─── Log Viewer ──────────────────────────────────────

  const openLogs = useCallback(
    async (name: string, type: 'stdout' | 'stderr' = 'stdout') => {
      setLogDialog({ name, type, content: '', loading: true })
      try {
        const data = await pb.send<{ content: string }>(
          `/api/ext/services/${name}/logs?type=${type}&length=65536`,
          {},
        )
        setLogDialog((prev) =>
          prev ? { ...prev, content: data.content, loading: false } : null,
        )
      } catch (err) {
        setLogDialog((prev) =>
          prev
            ? {
                ...prev,
                content: `Error: ${err instanceof Error ? err.message : 'Failed to load logs'}`,
                loading: false,
              }
            : null,
        )
      }
    },
    [],
  )

  const switchLogType = useCallback(
    (type: 'stdout' | 'stderr') => {
      if (logDialog) {
        openLogs(logDialog.name, type)
      }
    },
    [logDialog, openLogs],
  )

  // ─── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error && processes.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-destructive text-lg mb-4">{error}</p>
        <Button onClick={fetchServices}>Retry</Button>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Services</h2>
        <Button variant="outline" size="sm" onClick={fetchServices}>
          ↻ Refresh
        </Button>
      </div>

      {/* Notification */}
      {notification && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            notification.type === 'success'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          }`}
        >
          {notification.message}
        </div>
      )}

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{summary.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Running</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {summary.running}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Stopped</p>
              <p className="text-2xl font-bold text-muted-foreground">
                {summary.stopped}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Error</p>
              <p className="text-2xl font-bold text-destructive">
                {summary.error}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">CPU</p>
              <p className="text-2xl font-bold">{summary.totalCPU.toFixed(1)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Memory</p>
              <p className="text-2xl font-bold">
                {formatMemory(summary.totalMemory)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {processes.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          No services configured
        </div>
      ) : (
        /* Service Table */
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">PID</TableHead>
                <TableHead className="hidden md:table-cell">CPU</TableHead>
                <TableHead className="hidden md:table-cell">Memory</TableHead>
                <TableHead className="hidden lg:table-cell">Uptime</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processes.map((p) => {
                const isRunning = p.stateName === 'RUNNING'
                const isStopped =
                  p.stateName === 'STOPPED' || p.stateName === 'EXITED'
                const isTransition =
                  p.stateName === 'STARTING' ||
                  p.stateName === 'STOPPING' ||
                  p.stateName === 'BACKOFF'
                const loadingKey = actionLoading?.startsWith(p.name + ':')

                return (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant={stateColor(p.stateName)}>
                        {stateIndicator(p.stateName)} {p.stateName}
                      </Badge>
                      {p.spawnErr && (
                        <p className="text-xs text-destructive mt-1">
                          {p.spawnErr}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell tabular-nums">
                      {p.pid > 0 ? p.pid : '-'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell tabular-nums">
                      {isRunning ? `${p.cpu.toFixed(1)}%` : '-'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell tabular-nums">
                      {isRunning ? formatMemory(p.memory) : '-'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums">
                      {formatUptime(p.uptime)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Start */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={isRunning || isTransition || !!loadingKey}
                          onClick={() => handleAction(p.name, 'start')}
                          title="Start"
                        >
                          {actionLoading === `${p.name}:start` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </Button>
                        {/* Stop */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={isStopped || isTransition || !!loadingKey}
                          onClick={() => handleAction(p.name, 'stop')}
                          title="Stop"
                        >
                          {actionLoading === `${p.name}:stop` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                        </Button>
                        {/* Restart */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={isStopped || isTransition || !!loadingKey}
                          onClick={() => handleAction(p.name, 'restart')}
                          title="Restart"
                        >
                          {actionLoading === `${p.name}:restart` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                        </Button>
                        {/* Logs */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openLogs(p.name)}
                          title="View Logs"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Confirm Dialog */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.action === 'stop' ? 'Stop' : 'Restart'} Service?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {confirmAction?.action}{' '}
              <span className="font-semibold">{confirmAction?.name}</span>? This
              may cause brief downtime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAction) {
                  executeAction(confirmAction.name, confirmAction.action)
                  setConfirmAction(null)
                }
              }}
            >
              {confirmAction?.action === 'stop' ? 'Stop' : 'Restart'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Log Viewer Dialog */}
      <Dialog
        open={!!logDialog}
        onOpenChange={(open) => !open && setLogDialog(null)}
      >
        <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Logs: {logDialog?.name}</DialogTitle>
            <DialogDescription>
              Viewing {logDialog?.type} log output
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mb-2">
            <Button
              variant={logDialog?.type === 'stdout' ? 'default' : 'outline'}
              size="sm"
              onClick={() => switchLogType('stdout')}
            >
              stdout
            </Button>
            <Button
              variant={logDialog?.type === 'stderr' ? 'default' : 'outline'}
              size="sm"
              onClick={() => switchLogType('stderr')}
            >
              stderr
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                logDialog && openLogs(logDialog.name, logDialog.type)
              }
            >
              ↻ Refresh
            </Button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {logDialog?.loading ? (
              <div className="flex items-center justify-center py-10">
                <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (
              <pre className="bg-muted p-4 rounded-lg text-xs font-mono whitespace-pre-wrap break-all overflow-auto max-h-[65vh]">
                {logDialog?.content || 'No log content'}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogDialog(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/services')({
  component: ServicesPage,
})
