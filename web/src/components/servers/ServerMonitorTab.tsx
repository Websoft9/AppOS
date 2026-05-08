import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MonitorTargetPanel } from '@/components/monitor/MonitorTargetPanel'
import {
  getSystemdStatus,
  installMonitorAgent,
  updateMonitorAgent,
} from '@/lib/connect-api'

export function ServerMonitorAgentCard({
  serverId,
  serverName,
}: {
  serverId: string
  serverName: string
}) {
  const [status, setStatus] = useState<Record<string, string> | null>(null)
  const [statusText, setStatusText] = useState('')
  const [statusError, setStatusError] = useState('')
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [actionLoading, setActionLoading] = useState<'install' | 'update' | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')

  const loadStatus = useCallback(async () => {
    if (!serverId) return
    setLoadingStatus(true)
    setStatusError('')
    try {
      const response = await getSystemdStatus(serverId, 'netdata')
      setStatus(response.status)
      setStatusText(response.status_text)
    } catch (error) {
      setStatus(null)
      setStatusText('')
      setStatusError(
        error instanceof Error ? error.message : 'Unable to read Netdata service status'
      )
    } finally {
      setLoadingStatus(false)
    }
  }, [serverId])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const runAction = useCallback(
    async (action: 'install' | 'update') => {
      if (!serverId) return
      setActionLoading(action)
      setActionError('')
      setActionMessage('')
      try {
        const response =
          action === 'install'
            ? await installMonitorAgent(serverId, { apposBaseUrl: window.location.origin })
            : await updateMonitorAgent(serverId, { apposBaseUrl: window.location.origin })
        setActionMessage(
          `${action === 'install' ? 'Install' : 'Update'} completed for ${serverName}.${response.packaged_version ? ` Netdata version: ${response.packaged_version.trim()}.` : ''}`
        )
        if (response.systemd) {
          setStatus(response.systemd)
        }
        if (response.status_text) {
          setStatusText(response.status_text)
        }
        await loadStatus()
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Netdata action failed')
      } finally {
        setActionLoading(null)
      }
    },
    [loadStatus, serverId, serverName]
  )

  const activeState = String(status?.ActiveState || '').toLowerCase()
  const subState = String(status?.SubState || '')
  const unitState = String(status?.UnitFileState || '')
  const isActive = activeState === 'active'

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Netdata Agent</CardTitle>
          <CardDescription>
            Install or update Netdata using the official native-package installer, then confirm the
            remote netdata service state without leaving this tab.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadStatus()}
            disabled={loadingStatus || !!actionLoading}
          >
            {loadingStatus ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh Status
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runAction('update')}
            disabled={!!actionLoading}
          >
            {actionLoading === 'update' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update Netdata
          </Button>
          <Button size="sm" onClick={() => void runAction('install')} disabled={!!actionLoading}>
            {actionLoading === 'install' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Install Netdata
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Active State
            </div>
            <div className="mt-1 font-medium">{loadingStatus ? 'Loading...' : activeState || 'Unknown'}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Sub State</div>
            <div className="mt-1 font-medium">{loadingStatus ? 'Loading...' : subState || '—'}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Unit File</div>
            <div className="mt-1 font-medium">{loadingStatus ? 'Loading...' : unitState || '—'}</div>
          </div>
        </div>

        {statusError ? (
          <Alert>
            <AlertDescription>
              Netdata service is not readable yet. It is usually not installed on {serverName} yet,
              or the remote systemd unit has not been created. {statusError}
            </AlertDescription>
          </Alert>
        ) : null}

        {actionError ? (
          <Alert>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {actionMessage ? (
          <Alert>
            <AlertDescription>{actionMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-md border bg-muted/10 p-3 text-sm text-muted-foreground">
          {isActive
            ? 'Service is active. Netdata is now collecting host metrics on the remote server.'
            : 'Install Netdata downloads the official kickstart installer and forces native package installation. Update Netdata reruns the same installer in reinstall mode and restarts the service.'}
        </div>

        {statusText ? (
          <div className="rounded-md border bg-background p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              systemctl status
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{statusText}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ServerMonitorTab({
  serverId,
  serverName,
  connectionStatus,
}: {
  serverId: string
  serverName: string
  connectionStatus: string
}) {
  return (
    <div className="space-y-4">
      <ServerMonitorAgentCard serverId={serverId} serverName={serverName} />
      <MonitorTargetPanel
        targetType="server"
        targetId={serverId}
        emptyMessage={`No monitoring data available yet for ${serverName}. Current connectivity status is ${connectionStatus}.`}
      />
    </div>
  )
}