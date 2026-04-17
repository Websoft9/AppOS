import { Suspense, lazy } from 'react'
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'

const LazyAppsPage = lazy(() =>
  import('@/pages/apps/AppsPage').then(module => ({ default: module.AppsPage }))
)

function AppsRoutePage() {
  const location = useLocation()
  const isListRoute = location.pathname === '/apps' || location.pathname === '/apps/'
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Apps...</div>}>
      {isListRoute ? <LazyAppsPage /> : <Outlet />}
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/apps')({
  component: AppsRoutePage,
})
