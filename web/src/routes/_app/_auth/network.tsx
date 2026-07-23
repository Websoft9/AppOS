import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { NetworkPlaceholderPage } from '@/pages/system/NetworkPlaceholderPage'

function NetworkPage() {
  const { t } = useTranslation('system')

  return (
    <NetworkPlaceholderPage
      title={t('networkPage.title', 'Network')}
      description={t(
        'networkPage.description',
        'Manage network-facing services, tunnels, and traffic visibility from one place.'
      )}
      emptyTitle={t('networkPage.emptyTitle', 'Network dashboard')}
      emptyDescription={t(
        'networkPage.emptyDescription',
        'This landing page is reserved for future network summaries and traffic monitors.'
      )}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/network' as never)({
  component: NetworkPage,
})
