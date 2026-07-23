import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

const LazyCreateDeploymentPage = lazy(() =>
  import('@/pages/deploy/CreateDeploymentPage').then(module => ({
    default: module.CreateDeploymentPage,
  }))
)

function DeployCreateRoutePage() {
  const { t } = useTranslation('common')
  const search = Route.useSearch()
  const entryMode =
    search.entry === 'compose' ||
    search.entry === 'git-compose' ||
    search.entry === 'template' ||
    search.entry === 'docker-command' ||
    search.entry === 'install-script'
      ? search.entry
      : undefined
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          {t('loadingPage', { page: t('pages.createDeployment') })}
        </div>
      }
    >
      <LazyCreateDeploymentPage
        prefillMode={search.prefillMode}
        prefillSource={search.prefillSource}
        prefillAppId={search.prefillAppId}
        prefillAppKey={search.prefillAppKey}
        prefillAppName={search.prefillAppName}
        prefillServerId={search.prefillServerId}
        entryMode={entryMode}
      />
    </Suspense>
  )
}

export const Route = createFileRoute('/_app/_auth/deploy/create')({
  component: DeployCreateRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    entry:
      search.entry === 'compose' ||
      search.entry === 'git-compose' ||
      search.entry === 'template' ||
      search.entry === 'docker-command' ||
      search.entry === 'install-script'
        ? search.entry
        : undefined,
    prefillMode: typeof search.prefillMode === 'string' ? search.prefillMode : undefined,
    prefillSource: typeof search.prefillSource === 'string' ? search.prefillSource : undefined,
    prefillAppId: typeof search.prefillAppId === 'string' ? search.prefillAppId : undefined,
    prefillAppKey: typeof search.prefillAppKey === 'string' ? search.prefillAppKey : undefined,
    prefillAppName: typeof search.prefillAppName === 'string' ? search.prefillAppName : undefined,
    prefillServerId:
      typeof search.prefillServerId === 'string' ? search.prefillServerId : undefined,
  }),
})
