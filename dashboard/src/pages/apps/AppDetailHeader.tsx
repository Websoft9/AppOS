import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { runtimeVariant } from '@/pages/apps/types'
import type { AppInstance } from '@/pages/apps/types'

type AppDetailHeaderProps = {
  app: AppInstance | null
  refreshing: boolean
  refreshDisabled?: boolean
  onRefresh: () => void
  actionMenu: ReactNode
}

export function AppDetailHeader({ app, refreshing, refreshDisabled = false, onRefresh, actionMenu }: AppDetailHeaderProps) {
  return (
    <div className="space-y-3">
      <Button variant="ghost" className="w-fit px-0 text-muted-foreground" asChild>
        <Link to="/apps">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to My Apps
        </Link>
      </Button>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{app?.name || 'App Detail'}</h1>
            {app ? (
              <>
                <Badge variant="outline">{app.status}</Badge>
                <Badge variant={runtimeVariant(app.runtime_status)}>{app.runtime_status}</Badge>
              </>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">Application detail</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:self-start">
          <Button variant="outline" onClick={onRefresh} disabled={refreshing || refreshDisabled}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
          {actionMenu}
        </div>
      </div>
    </div>
  )
}