import { createFileRoute } from '@tanstack/react-router'

import { ExtensionsPage } from '@/components/extensions/ExtensionsPage'

export const Route = createFileRoute('/_app/_auth/extensions' as never)({
  component: ExtensionsPage,
})
