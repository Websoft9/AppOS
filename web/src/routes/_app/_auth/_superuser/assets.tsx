import { createFileRoute } from '@tanstack/react-router'
import { AssetsHub } from '@/components/assets/AssetsHub'

function AssetsPage() {
  return <AssetsHub />
}

export const Route = createFileRoute('/_app/_auth/_superuser/assets')({
  component: AssetsPage,
})