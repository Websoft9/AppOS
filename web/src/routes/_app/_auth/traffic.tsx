import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { NetworkPlaceholderPage } from '@/pages/system/NetworkPlaceholderPage'

function TrafficPage() {
  const { t } = useTranslation('system')

  return (
    <NetworkPlaceholderPage
      title={t('trafficPage.title', 'Traffic')}
      description={t(
        'trafficPage.description',
        'Monitor HTTP proxy and gateway traffic from a dedicated network operations surface.'
      )}
      emptyTitle={t('trafficPage.emptyTitle', 'Traffic monitor')}
      emptyDescription={t(
        'trafficPage.emptyDescription',
        'Traffic dashboards and flow summaries will be added here in a future slice.'
      )}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/traffic' as never)({
  component: TrafficPage,
})
