import { createFileRoute } from '@tanstack/react-router'
import { PublishPage } from '@/pages/publish/PublishPage'

export const Route = createFileRoute('/_app/_auth/publish' as never)({
  component: PublishPage,
})