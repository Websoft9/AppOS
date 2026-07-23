import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslation } from 'react-i18next'

type NetworkPlaceholderPageProps = {
  title: string
  description: string
  emptyTitle: string
  emptyDescription: string
}

export function NetworkPlaceholderPage({
  title,
  description,
  emptyTitle,
  emptyDescription,
}: NetworkPlaceholderPageProps) {
  const { t } = useTranslation('system')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{emptyTitle}</CardTitle>
          <CardDescription>{emptyDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed px-4 py-10 text-sm text-muted-foreground">
            {t('networkPlaceholder.empty', 'No content is available yet.')}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
