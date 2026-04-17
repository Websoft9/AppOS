import { createFileRoute } from '@tanstack/react-router'
import { OverviewPage } from '@/pages/overview/OverviewPage'

export const Route = createFileRoute('/_app/_auth/overview')({
  component: OverviewPage,
})
