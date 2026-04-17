import { createFileRoute } from '@tanstack/react-router'

function EnvVarsPlaceholderPage() {
  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold">Environment</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Placeholder entry. This page is managed by a future epic.
      </p>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/admin/credentials/env-vars')({
  component: EnvVarsPlaceholderPage,
})
