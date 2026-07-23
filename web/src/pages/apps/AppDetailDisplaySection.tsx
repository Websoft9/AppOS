import { ImageIcon, Tags } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type AppDetailDisplaySectionProps = {
  iconValue: string
  labelValue: string
  tagsValue: string
  tags: string[]
  appName: string
  saving: boolean
  hasChanges: boolean
  onIconChange: (value: string) => void
  onLabelChange: (value: string) => void
  onTagsChange: (value: string) => void
  onSave: () => void
  onReset: () => void
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export function AppDetailDisplaySection({
  iconValue,
  labelValue,
  tagsValue,
  tags,
  appName,
  saving,
  hasChanges,
  onIconChange,
  onLabelChange,
  onTagsChange,
  onSave,
  onReset,
}: AppDetailDisplaySectionProps) {
  const { t } = useTranslation('apps')
  const previewLabel = labelValue.trim() || appName

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <div>
          <CardTitle>{t('detail.settings.displayTitle', { defaultValue: 'Display' })}</CardTitle>
          <CardDescription>
            {t('detail.settings.displayDescription', {
              defaultValue:
                'Lightweight app metadata for icon, label, and tags. Stored locally in this browser for now.',
            })}
          </CardDescription>
        </div>
        <CardAction>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onSave} disabled={!hasChanges || saving}>
              {saving
                ? t('common:save', { defaultValue: 'Save' }) + '...'
                : t('detail.settings.saveDisplay', { defaultValue: 'Save Display' })}
            </Button>
            <Button variant="outline" size="sm" onClick={onReset} disabled={saving}>
              {t('detail.settings.reset', { defaultValue: 'Reset' })}
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/20 p-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-background text-lg font-semibold shadow-sm">
            {iconValue.trim() ? (
              isUrlLike(iconValue) ? (
                <img src={iconValue} alt={previewLabel} className="h-full w-full object-cover" />
              ) : (
                <span>{iconValue}</span>
              )
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{previewLabel}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {tags.length > 0 ? (
                tags.map(tag => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('empty.displayTags', { defaultValue: 'No tags' })}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {t('detail.settings.icon', { defaultValue: 'Icon' })}
            </div>
            <Input
              value={iconValue}
              onChange={event => onIconChange(event.target.value)}
              placeholder={t('detail.settings.iconPlaceholder', {
                defaultValue: 'Emoji or image URL',
              })}
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {t('detail.settings.label', { defaultValue: 'Label' })}
            </div>
            <Input
              value={labelValue}
              onChange={event => onLabelChange(event.target.value)}
              placeholder={t('detail.settings.labelPlaceholder', {
                defaultValue: 'Short display label',
              })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Tags className="h-4 w-4" />
            {t('detail.settings.tags', { defaultValue: 'Tags' })}
          </div>
          <Input
            value={tagsValue}
            onChange={event => onTagsChange(event.target.value)}
            placeholder={t('detail.settings.tagsPlaceholder', {
              defaultValue: 'Comma-separated tags',
            })}
          />
        </div>

        <Alert>
          <AlertDescription>
            {t('detail.settings.displaySavedNotice', {
              defaultValue:
                'Until backend metadata fields exist, this display info is saved in the current browser only.',
            })}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}
