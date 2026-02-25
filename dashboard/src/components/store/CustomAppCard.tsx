import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppIcon } from './AppIcon'
import type { CustomApp } from '@/lib/store-custom-api'
import { getCreatorName } from '@/lib/store-custom-api'

interface CustomAppCardProps {
  app: CustomApp
  currentUserId: string
  onOpenDetail: (app: CustomApp) => void
}

export function CustomAppCard({
  app,
  currentUserId,
  onOpenDetail,
}: CustomAppCardProps) {
  const { t } = useTranslation('store')

  return (
    <div
      className="relative bg-card text-card-foreground rounded-lg border p-4 flex flex-col gap-3 h-full hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
      onClick={() => onOpenDetail(app)}
      role="article"
      aria-label={app.trademark}
    >
      <div className="flex items-start gap-3">
        <AppIcon appKey={app.key} trademark={app.trademark} logoUrl={app.logo_url ?? undefined} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors">
            {app.trademark}
          </h3>
          <Badge variant="outline" className="mt-1 text-xs text-muted-foreground">
            {t('customApp.badge')}
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2.5rem]">
        {app.overview}
      </p>

      {/* Creator name for shared apps */}
      {app.visibility === 'shared' && (
        <p className="text-xs text-muted-foreground">
          {t('customApp.createdBy', { name: getCreatorName(app, currentUserId, t) })}
        </p>
      )}

      {/* Action row */}
      <div className="flex gap-2 mt-auto" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => onOpenDetail(app)}
        >
          {t('card.view')}
        </Button>
      </div>
    </div>
  )
}
