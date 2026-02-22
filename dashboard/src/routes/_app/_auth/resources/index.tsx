import { createFileRoute } from "@tanstack/react-router"
import { ResourceHub } from "@/components/resources/ResourceHub"

function ResourcesPage() {
  return <ResourceHub />
}

export const Route = createFileRoute("/_app/_auth/resources/")({ component: ResourcesPage })
