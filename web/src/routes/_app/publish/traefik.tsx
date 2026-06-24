import { createFileRoute } from '@tanstack/react-router'
import { EmbeddedIframePage, type EmbeddedIframePageDefinition } from '@/components/iframe-page/EmbeddedIframePage'

const TRAEFIK_DASHBOARD_PAGE: EmbeddedIframePageDefinition = {
  id: 'traefik-dashboard',
  title: 'Traefik Dashboard',
  routePath: '/publish/traefik',
  proxyPath: '/api/settings/public/traefik/dashboard/',
  parentLabel: 'iframe page',
  accessMode: 'proxied',
  authStrategy: 'none',
  description: 'Embedded infrastructure console rendered through an AppOS-owned same-origin proxy route.',
  fallbackBehavior: 'open in new window',
}

function TraefikPublishPage() {
  return <EmbeddedIframePage page={TRAEFIK_DASHBOARD_PAGE} />
}

export const Route = createFileRoute('/_app/publish/traefik' as never)({
  component: TraefikPublishPage,
})