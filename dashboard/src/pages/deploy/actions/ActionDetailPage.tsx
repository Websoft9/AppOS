import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ActionDetailContent } from '@/pages/deploy/actions/ActionDetailDialog'
import { buildActionListHref, formatTime } from '@/pages/deploy/actions/action-utils'
import { useActionDetailController } from '@/pages/deploy/actions/useActionDetailController'

function getUserLabel(item: { user_email?: string; user_id?: string }): string {
  return item.user_email || item.user_id || '-'
}

function getServerLabel(item: { server_label?: string; server_id: string }): string {
  return item.server_label || item.server_id || 'local'
}

function getServerHost(item: { server_host?: string; server_id: string }): string {
  return item.server_host || (item.server_id === 'local' || !item.server_id ? 'local' : '-')
}

export function ActionDetailPage({ actionId }: { actionId: string }) {
  const backHref =
    typeof window === 'undefined'
      ? '/actions'
      : buildActionListHref(
          Object.fromEntries(new URLSearchParams(window.location.search).entries())
        )
  const {
    operation,
    loading,
    logText,
    logUpdatedAt,
    logTruncated,
    streamStatus,
    error,
    autoScrollEnabled,
    setAutoScrollEnabled,
    logViewportRef,
    handleLogScroll,
    refresh,
  } = useActionDetailController(actionId)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" className="w-fit px-0 text-muted-foreground" asChild>
            <a href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Actions
            </a>
          </Button>
          <h1 className="text-2xl font-bold">
            Execution Detail: {operation?.compose_project_name || actionId}
          </h1>
        </div>
        <Button
          variant="outline"
          size="icon"
          title="Refresh"
          aria-label="Refresh"
          onClick={() => void refresh()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ActionDetailContent
        operation={operation}
        loading={loading}
        streamStatus={streamStatus}
        logText={logText}
        logUpdatedAt={logUpdatedAt}
        logTruncated={logTruncated}
        logViewportRef={logViewportRef}
        onLogScroll={handleLogScroll}
        autoScrollEnabled={autoScrollEnabled}
        onAutoScrollChange={setAutoScrollEnabled}
        getUserLabel={getUserLabel}
        getServerLabel={getServerLabel}
        getServerHost={getServerHost}
        formatTime={formatTime}
        onRefresh={() => void refresh()}
      />
    </div>
  )
}
