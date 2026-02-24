import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppIcon } from './AppIcon'
import type { ProductWithCategories, PrimaryCategory } from '@/lib/store-types'
import type { UserApp } from '@/lib/store-user-api'

interface AppCardProps {
  product: ProductWithCategories
  primaryCategories: PrimaryCategory[]
  onSelectApp: (product: ProductWithCategories) => void
  userApps?: UserApp[]
}

export function AppCard({ product, primaryCategories, onSelectApp, userApps = [] }: AppCardProps) {
  const { t } = useTranslation('store')

  const primaryCat = primaryCategories.find(
    (c) => c.key === product.primaryCategoryKey,
  )
  const isFavorite = userApps.find((a) => a.app_key === product.key)?.is_favorite ?? false

  return (
    <div
      className="relative bg-card text-card-foreground rounded-lg border p-4 flex flex-col gap-3 h-full hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
      onClick={() => onSelectApp(product)}
      role="article"
      aria-label={product.trademark}
    >
      {/* Favorite indicator — shown only if already favorited */}
      {isFavorite && (
        <div className="absolute top-2 right-2 pointer-events-none">
          <Heart className="h-4 w-4 fill-red-500 text-red-500" />
        </div>
      )}

      <div className="flex items-start gap-3">
        <AppIcon appKey={product.key} trademark={product.trademark} logoUrl={product.logo?.imageurl} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors">
            {product.trademark}
          </h3>
          {primaryCat && (
            <Badge variant="secondary" className="mt-1 text-xs">
              {primaryCat.title}
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2.5rem]">
        {product.summary ?? product.overview}
      </p>

      <Button
        size="sm"
        variant="outline"
        className="w-full mt-auto"
        onClick={(e) => {
          e.stopPropagation()
          onSelectApp(product)
        }}
      >
        {t('card.deploy')}
      </Button>
    </div>
  )
}
