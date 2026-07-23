import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { NetworkPlaceholderPage } from '@/pages/system/NetworkPlaceholderPage'

function GatewayPage() {
  const { t } = useTranslation('system')

  return (
    <NetworkPlaceholderPage
      title={t('gatewayPage.title', 'Gateway')}
      description={t(
        'gatewayPage.description',
        'Administer ingress, published endpoints, and gateway-facing controls here.'
      )}
      emptyTitle={t('gatewayPage.emptyTitle', 'Gateway console')}
      emptyDescription={t(
        'gatewayPage.emptyDescription',
        'Gateway administration surfaces will be added here in a future slice.'
      )}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/gateway' as never)({
  component: GatewayPage,
})
