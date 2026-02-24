import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppIcon } from './AppIcon'
import { FavoriteButton } from './FavoriteButton'
import type { UserApp } from '@/lib/store-user-api'
import type { CustomApp } from '@/lib/store-custom-api'
import { getCreatorName } from '@/lib/store-custom-api'

interface CustomAppCardProps {
  app: CustomApp
  currentUserId: string
  userApps?: UserApp[]
  onToggleFavorite?: (appKey: string) => void
  onOpenDetail: (app: CustomApp) => void
  onEdit: (app: CustomApp) => void
  onDelete: (id: string) => void
}

export function CustomAppCard({
  app,
  currentUserId,
  userApps = [],
  onToggleFavorite,
  onOpenDetail,
  onEdit,
  onDelete,
}: CustomAppCardProps) {
  const { t } = useTranslation('store')
  const isOwner = app.created_by === currentUserId

  return (
    <div
      className="relative bg-card text-card-foreground rounded-lg border p-4 flex flex-col gap-3 h-full hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
      onClick={() => onOpenDetail(app)}
      role="article"
      aria-label={app.trademark}
    >
      {/* Favorite button — top-right */}
      {onToggleFavorite && (
        <div className="absolute top-2 right-2">
          <FavoriteButton appKey={app.key} userApps={userApps} onToggle={onToggleFavorite} />
        </div>
      )}

      <div className="flex items-start gap-3">
        <AppIcon appKey={app.key} trademark={app.trademark} logoUrl={app.logo_url ?? undefined} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors pr-7">
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
        {isOwner && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(app)}
              aria-label={t('customApp.edit')}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm(t('customApp.deleteConfirm'))) {
                  onDelete(app.id)
                }
              }}
              aria-label={t('customApp.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
