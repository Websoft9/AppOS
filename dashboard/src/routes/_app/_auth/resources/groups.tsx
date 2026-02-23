import { createFileRoute, Outlet } from "@tanstack/react-router"

function GroupsLayout() {
  return <Outlet />
}

export const Route = createFileRoute("/_app/_auth/resources/groups")({
  component: GroupsLayout,
})
