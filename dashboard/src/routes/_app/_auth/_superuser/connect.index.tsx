import { createFileRoute } from '@tanstack/react-router'
import { ServerSelector } from '@/components/connect/ServerSelector'

function ConnectIndexPage() {
  return (
    <div className="h-full flex items-center justify-center p-4">
      <ServerSelector />
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/connect/')({
  component: ConnectIndexPage,
})
