import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import {
  ExternalLink,
  Github,
  BookOpen,
  Cpu,
  MemoryStick,
  HardDrive,
  Heart,
  Pencil,
  Trash2,
  Code,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AppIcon } from './AppIcon'
import { ScreenshotCarousel } from './ScreenshotCarousel'
import { NoteEditor } from './NoteEditor'
import { getDocUrl, getGithubUrl } from '@/lib/store-api'
import type { CatalogAppDetail } from '@/lib/catalog-api'
import type { ProductWithCategories, PrimaryCategory, Locale, Screenshot } from '@/lib/store-types'
import type { UserApp } from '@/lib/store-user-api'

interface AppDetailModalProps {
  product: ProductWithCategories | null
  primaryCategories: PrimaryCategory[]
  locale: Locale
  open: boolean
  onClose: () => void
  onSelectCategory?: (primary: string | null, secondary?: string | null) => void
  userApps?: UserApp[]
  onToggleFavorite?: (appKey: string) => void
  onSaveNote?: (appKey: string, note: string | null) => void
  isSavingNote?: boolean
  showDeploy?: boolean
  onDeploy?: () => void
  fallbackScreenshots?: Screenshot[]
  detail?: CatalogAppDetail | null
  detailLoading?: boolean
  /** Custom app actions — show edit/delete in the action bar when provided */
  onEdit?: () => void
  onDelete?: () => void
  /** Path for IAC editor link, e.g. "templates/apps/myapp" */
  iacEditPath?: string
}

export function AppDetailModal({
  product,
  primaryCategories,
  locale,
  open,
  onClose,
  onSelectCategory,
  userApps = [],
  onToggleFavorite,
  onSaveNote,
  isSavingNote,
  showDeploy = true,
  onDeploy,
  fallbackScreenshots = [],
  detail,
  detailLoading = false,
  onEdit,
  onDelete,
  iacEditPath,
}: AppDetailModalProps) {
  const { t } = useTranslation('store')
  const [confirmUnfavorite, setConfirmUnfavorite] = useState(false)

  if (!product) return null

  const isFavorite = userApps.find(a => a.app_key === product.key)?.is_favorite ?? false
  const primaryCat = detail?.categories.primary
    ? { key: detail.categories.primary.key, title: detail.categories.primary.title }
    : primaryCategories.find(c => c.key === product.primaryCategoryKey)
  const docUrl = detail?.links.docs || getDocUrl(product.key, locale)
  const githubUrl = detail?.links.github || getGithubUrl(product.key)
  const websiteUrl = detail?.links.website || product.websiteurl
  const title = detail?.title || product.trademark
  const overview = detail?.overview || product.overview
  const description = detail?.description || product.description
  const iconUrl = detail?.iconUrl || product.logo?.imageurl
  const screenshots =
    detail?.screenshots?.map(shot => ({
      id: shot.key,
      key: shot.key,
      value: shot.url,
    })) || product.screenshots
  const requirementVCpu = detail?.requirements.vcpu || product.vcpu
  const requirementMemory = detail?.requirements.memoryGb || product.memory
  const requirementStorage = detail?.requirements.storageGb || product.storage
  const secondaryCategories =
    detail?.categories.secondary.map(item => ({ key: item.key, title: item.title })) ||
    product.catalogCollection.items.map(item => ({ key: item.key, title: item.title }))

  const handleFavoriteClick = () => {
    if (!onToggleFavorite) return
    if (isFavorite) {
      setConfirmUnfavorite(true)
    } else {
      onToggleFavorite(product.key)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) {
          setConfirmUnfavorite(false)
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <AppIcon appKey={product.key} trademark={title} logoUrl={iconUrl} size="xl" />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{overview}</p>
              {detailLoading && (
                <p className="text-xs text-muted-foreground mt-2">{t('loading')}</p>
              )}

              {/* Links */}
              <div className="flex flex-wrap gap-2 mt-3">
                {websiteUrl && (
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t('detail.website')}
                  </a>
                )}
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Github className="w-3 h-3" />
                  {t('detail.github')}
                </a>
                <a
                  href={docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <BookOpen className="w-3 h-3" />
                  {t('detail.docs')}
                </a>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* ── Action bar: Deploy + Favorite — prominent, near the top ── */}
        {(showDeploy || onToggleFavorite || onEdit || onDelete) && (
          <div className="flex items-center gap-3 mt-1">
            {showDeploy && (
              <Button className="flex-1" size="lg" onClick={onDeploy}>
                {t('detail.deploy')}
              </Button>
            )}
            {onToggleFavorite && !confirmUnfavorite && (
              <Button
                variant={isFavorite ? 'secondary' : 'outline'}
                size="lg"
                className="flex items-center gap-2"
                onClick={handleFavoriteClick}
              >
                <Heart className={isFavorite ? 'h-4 w-4 fill-red-500 text-red-500' : 'h-4 w-4'} />
                {isFavorite ? t('detail.unfavorite') : t('detail.favorite')}
              </Button>
            )}
            {onToggleFavorite && confirmUnfavorite && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('detail.unfavoriteConfirm')}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    onToggleFavorite(product.key)
                    setConfirmUnfavorite(false)
                  }}
                >
                  {t('detail.unfavoriteYes')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmUnfavorite(false)}>
                  {t('note.cancel')}
                </Button>
              </div>
            )}
            {onEdit && (
              <Button variant="outline" size="lg" onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-1.5" />
                {t('customApp.edit')}
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                size="lg"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm(t('customApp.deleteConfirm'))) {
                    onDelete()
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {t('customApp.delete')}
              </Button>
            )}
            {iacEditPath && (
              <Button variant="outline" size="lg" asChild>
                <Link to="/iac" search={{ root: iacEditPath }} onClick={onClose}>
                  <Code className="h-4 w-4 mr-1.5" />
                  {t('customApp.editIac')}
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="space-y-4 mt-2">
          {/* Categories */}
          {(primaryCat || secondaryCategories.length > 0) && (
            <div>
              <h4 className="text-sm font-semibold mb-2">{t('detail.categories')}</h4>
              <div className="flex flex-wrap gap-2">
                {primaryCat && (
                  <Badge
                    variant="default"
                    className="cursor-pointer hover:opacity-80"
                    onClick={() => {
                      onSelectCategory?.(product.primaryCategoryKey, null)
                      onClose()
                    }}
                  >
                    {primaryCat.title}
                  </Badge>
                )}
                {secondaryCategories.map(item => (
                  <Badge
                    key={item.key}
                    variant="secondary"
                    className="cursor-pointer hover:opacity-80"
                    onClick={() => {
                      onSelectCategory?.(product.primaryCategoryKey, item.key)
                      onClose()
                    }}
                  >
                    {item.title}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* System Requirements */}
          {(requirementVCpu || requirementMemory || requirementStorage) && (
            <div>
              <h4 className="text-sm font-semibold mb-2">{t('detail.systemRequirements')}</h4>
              <div className="grid grid-cols-3 gap-3">
                {requirementVCpu && (
                  <div className="bg-muted rounded-md p-3 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">{t('detail.vcpu')}</div>
                      <div className="text-sm font-medium">{requirementVCpu}</div>
                    </div>
                  </div>
                )}
                {requirementMemory && (
                  <div className="bg-muted rounded-md p-3 flex items-center gap-2">
                    <MemoryStick className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">{t('detail.memory')}</div>
                      <div className="text-sm font-medium">{requirementMemory} GB</div>
                    </div>
                  </div>
                )}
                {requirementStorage && (
                  <div className="bg-muted rounded-md p-3 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">{t('detail.storage')}</div>
                      <div className="text-sm font-medium">{requirementStorage} GB</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Screenshots Carousel */}
          {screenshots && screenshots.length > 0 && (
            <ScreenshotCarousel
              screenshots={screenshots}
              fallbackScreenshots={fallbackScreenshots}
              label={t('detail.screenshots')}
            />
          )}

          {/* Description (Markdown) */}
          {description && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-2">{t('detail.description')}</h4>
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground">
                  <ReactMarkdown>{description}</ReactMarkdown>
                </div>
              </div>
            </>
          )}

          {/* Note */}
          {onSaveNote && (
            <>
              <Separator />
              <NoteEditor
                appKey={product.key}
                userApps={userApps}
                onSave={onSaveNote}
                isSaving={isSavingNote}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
