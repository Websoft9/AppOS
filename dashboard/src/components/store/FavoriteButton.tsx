import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { UserApp } from '@/lib/store-user-api'

interface FavoriteButtonProps {
  appKey: string
  userApps: UserApp[]
  onToggle: (appKey: string) => void
  className?: string
}

export function FavoriteButton({ appKey, userApps, onToggle, className }: FavoriteButtonProps) {
  const isFavorite = userApps.find((a) => a.app_key === appKey)?.is_favorite ?? false

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7', className)}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(appKey)
      }}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Heart className={cn('h-4 w-4', isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground')} />
    </Button>
  )
}
