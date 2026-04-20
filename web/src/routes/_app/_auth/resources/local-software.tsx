import { createFileRoute } from '@tanstack/react-router'
import { LocalSoftwareInventoryPage } from '@/components/software/LocalSoftwareInventoryPage'

export const Route = createFileRoute('/_app/_auth/resources/local-software' as never)({
  component: LocalSoftwareInventoryPage,
})