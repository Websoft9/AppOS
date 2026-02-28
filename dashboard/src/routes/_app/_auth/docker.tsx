import { Suspense, lazy } from "react"
import { createFileRoute } from "@tanstack/react-router"
const LazyDockerPage = lazy(() => import('@/pages/docker/DockerPage').then((m) => ({ default: m.DockerPage })))

function DockerRoutePage() {
  const { server: serverFromUrl } = Route.useSearch()
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Docker...</div>}>
      <LazyDockerPage serverFromUrl={serverFromUrl} />
    </Suspense>
  )
}

export const Route = createFileRoute("/_app/_auth/docker")({
  component: DockerRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    server: typeof search.server === 'string' ? search.server : undefined,
  }),
})
