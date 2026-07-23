import { Suspense, lazy } from 'react'
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

const LazyAppsPage = lazy(() =>
  import('@/pages/apps/AppsPage').then(module => ({ default: module.AppsPage }))
)

function AppsRoutePage() {
  const { t } = useTranslation('common')
  const location = useLocation()
  const search = Route.useSearch()
  const isListRoute = location.pathname === '/apps' || location.pathname === '/apps/'
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          {t('loadingPage', { page: t('pages.apps') })}
        </div>
      }
    >
      {isListRoute ? <LazyAppsPage catalogAppKey={search.catalogAppKey} /> : <Outlet />}
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/apps')({
  component: AppsRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    catalogAppKey:
      typeof search.catalogAppKey === 'string' && search.catalogAppKey.trim()
        ? search.catalogAppKey
        : undefined,
  }),
})
