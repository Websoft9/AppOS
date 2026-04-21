import { createFileRoute } from '@tanstack/react-router'
import { PlatformStatusPage } from '@/pages/system/PlatformStatusPage'

function StatusPage() {
  return <PlatformStatusPage />
}

export const Route = createFileRoute('/_app/_auth/_superuser/status')({
  component: StatusPage,
})
