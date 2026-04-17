import { createFileRoute } from '@tanstack/react-router'
import { TerminalIndexPage } from '@/pages/terminal/TerminalIndexPage'

export const Route = createFileRoute('/_app/_auth/_superuser/terminal/')({
  component: TerminalIndexPage,
})
