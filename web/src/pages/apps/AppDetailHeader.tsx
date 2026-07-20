import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Boxes, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  effectiveInstanceStateVariant,
  formatEffectiveInstanceStateLabel,
  formatInstanceStateLabel,
  formatServerConnectionLabel,
  formatEffectiveRuntimeLabel,
  hasBlockingServerConnectionIssue,
  instanceStateVariant,
  normalizeServerConnectionStatus,
  runtimeVariant,
  serverConnectionVariant,
} from '@/pages/apps/types'
import type { AppInstance } from '@/pages/apps/types'

type AppDetailHeaderProps = {
  app: AppInstance | null
  refreshing: boolean
  refreshDisabled?: boolean
  onRefresh: () => void
  actionMenu: ReactNode
  breadcrumb?: ReactNode
}

export function AppDetailBreadcrumb({ appName }: { appName: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
    >
      <Link
        to="/apps"
        search={{ catalogAppKey: undefined }}
        className="inline-flex min-w-0 items-center gap-1.5 truncate transition-colors hover:text-foreground"
      >
        <Boxes className="h-4 w-4 shrink-0" />
        <span className="truncate">My Apps</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-medium text-foreground">{appName}</span>
    </nav>
  )
}

export function AppDetailHeader({
  app,
  refreshing,
  refreshDisabled = false,
  onRefresh,
  actionMenu,
  breadcrumb,
}: AppDetailHeaderProps) {
  const serverConnectionBlocked = hasBlockingServerConnectionIssue(app)
  const showServerConnectionBadge =
    app?.server_id !== 'local' &&
    normalizeServerConnectionStatus(app?.server_connection_status) !== 'online'

  return (
    <div className="space-y-4">
      {breadcrumb ? breadcrumb : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{app?.name || 'App Detail'}</h1>
            {app ? (
              <>
                <Badge variant="outline">{app.status}</Badge>
                <Badge
                  variant={
                    serverConnectionBlocked
                      ? effectiveInstanceStateVariant(app)
                      : instanceStateVariant(app.instance_state)
                  }
                >
                  {serverConnectionBlocked
                    ? formatEffectiveInstanceStateLabel(app)
                    : formatInstanceStateLabel(app.instance_state)}
                </Badge>
                <Badge
                  variant={serverConnectionBlocked ? 'outline' : runtimeVariant(app.runtime_status)}
                >
                  {formatEffectiveRuntimeLabel(app)}
                </Badge>
                {showServerConnectionBadge ? (
                  <Badge
                    variant={serverConnectionVariant(app?.server_connection_status)}
                    title={app?.server_connection_reason || app?.runtime_reason || undefined}
                  >
                    {formatServerConnectionLabel(app?.server_connection_status)}
                  </Badge>
                ) : null}
              </>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">Application detail</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 md:max-w-[60%]">
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={refreshing || refreshDisabled}
            aria-label="Refresh app detail"
            title="Refresh app detail"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          {actionMenu}
        </div>
      </div>
    </div>
  )
}
