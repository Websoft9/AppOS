import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

function EnvVarsPlaceholderPage() {
  const { t } = useTranslation('common')

  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold">{t('pages.environment')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('placeholders.futureEpic')}</p>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/admin/credentials/env-vars')({
  component: EnvVarsPlaceholderPage,
})
