import { createFileRoute } from '@tanstack/react-router'

import { SupportedSoftwarePage } from '@/components/software/SupportedSoftwarePage'

export const Route = createFileRoute('/_app/_auth/resources/supported-software' as never)({
  component: SupportedSoftwarePage,
})
