import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, List, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { ActionDetailContent } from '@/pages/deploy/actions/ActionDetailDialog'
import { buildActionListSearch, formatTime } from '@/pages/deploy/actions/action-utils'
import type { ActionDetailSearch } from '@/pages/deploy/actions/action-types'
import { useActionDetailController } from '@/pages/deploy/actions/useActionDetailController'

function getUserLabel(item: { user_email?: string; user_id?: string }): string {
  return item.user_email || item.user_id || '-'
}

function getServerLabel(item: { server_name?: string; server_label?: string; server_id: string }): string {
  return item.server_name || item.server_label || item.server_id || 'local'
}

function getServerHost(item: { server_host?: string; server_id: string }): string {
  return item.server_host || (item.server_id === 'local' || !item.server_id ? 'local' : '-')
}

export function ActionDetailPage({
  actionId,
  search,
}: {
  actionId: string
  search?: ActionDetailSearch
}) {
  const backSearch = buildActionListSearch(search)
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
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

  const appName = operation?.compose_project_name || actionId
  const appId = operation?.app_id

  const breadcrumb = (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
    >
      <Link
        to="/activity"
        params={{} as never}
        search={(backSearch ?? {}) as never}
        className="inline-flex min-w-0 items-center gap-1.5 truncate transition-colors hover:text-foreground"
      >
        <List className="h-4 w-4 shrink-0" />
        <span className="truncate">Activity</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      {appId ? (
        <Link
          to="/apps/$appId"
          params={{ appId } as never}
          search={{} as never}
          className="truncate font-medium text-foreground transition-colors hover:underline"
        >
          {appName}
        </Link>
      ) : (
        <span className="truncate font-medium text-foreground">{appName}</span>
      )}
    </nav>
  )

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(breadcrumb)
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent, backSearch, appName, appId])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          {!setHeaderRightStartContent ? breadcrumb : null}
          <h1 className="text-2xl font-bold">Execution Detail: {appName}</h1>
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
      />
    </div>
  )
}