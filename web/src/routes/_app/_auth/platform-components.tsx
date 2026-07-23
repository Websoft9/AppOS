import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

const LazyPlatformComponentsPage = lazy(() =>
  import('@/pages/platform-components/PlatformComponentsPage').then(module => ({
    default: module.PlatformComponentsPage,
  }))
)

function PlatformComponentsRoutePage() {
  const { t } = useTranslation('common')
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          {t('loadingPage', { page: t('pages.platformComponents') })}
        </div>
      }
    >
      <LazyPlatformComponentsPage />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/platform-components')({
  component: PlatformComponentsRoutePage,
})
