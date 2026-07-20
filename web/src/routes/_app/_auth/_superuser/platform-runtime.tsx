import { createFileRoute } from '@tanstack/react-router'
import { PlatformRuntimePage } from '@/pages/system/PlatformRuntimePage'

function PlatformRuntimeRoute() {
  return <PlatformRuntimePage />
}

export const Route = createFileRoute('/_app/_auth/_superuser/platform-runtime')({
  component: PlatformRuntimeRoute,
})
