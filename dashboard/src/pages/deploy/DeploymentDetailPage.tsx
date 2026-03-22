import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DeploymentDetailContent } from '@/pages/deploy/DeploymentDetailDialog'
import { buildDeploymentListHref, formatTime, statusVariant } from '@/pages/deploy/deploy-utils'
import { useDeploymentDetailController } from '@/pages/deploy/useDeploymentDetailController'

function getUserLabel(item: { user_email?: string; user_id?: string }): string {
  return item.user_email || item.user_id || '-'
}

function getServerLabel(item: { server_label?: string; server_id: string }): string {
  return item.server_label || item.server_id || 'local'
}

function getServerHost(item: { server_host?: string; server_id: string }): string {
  return item.server_host || (item.server_id === 'local' || !item.server_id ? 'local' : '-')
}

export function DeploymentDetailPage({ deploymentId }: { deploymentId: string }) {
  const backHref = typeof window === 'undefined'
    ? '/deployments'
    : buildDeploymentListHref(Object.fromEntries(new URLSearchParams(window.location.search).entries()))
  const {
    deployment,
    loading,
    logText,
    logUpdatedAt,
    logTruncated,
    streamStatus,
    error,
    logViewportRef,
    handleLogScroll,
    refresh,
  } = useDeploymentDetailController(deploymentId)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" className="w-fit px-0 text-muted-foreground" asChild>
            <a href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Deployments
            </a>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{deployment?.compose_project_name || 'Deployment Detail'}</h1>
            <p className="text-sm text-muted-foreground">The page keeps browser navigation natural, so users can return to the list with either the back button or the explicit list link.</p>
          </div>
        </div>
        <Button variant="outline" size="icon" title="Refresh" aria-label="Refresh" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DeploymentDetailContent
        deployment={deployment}
        loading={loading}
        streamStatus={streamStatus}
        logText={logText}
        logUpdatedAt={logUpdatedAt}
        logTruncated={logTruncated}
        logViewportRef={logViewportRef}
        onLogScroll={handleLogScroll}
        getUserLabel={getUserLabel}
        getServerLabel={getServerLabel}
        getServerHost={getServerHost}
        formatTime={formatTime}
        statusVariant={statusVariant}
      />
    </div>
  )
}