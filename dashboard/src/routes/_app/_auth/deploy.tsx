import { createFileRoute, Outlet } from '@tanstack/react-router'

function DeployLayout() {
  return <Outlet />
}

export const Route = createFileRoute('/_app/_auth/deploy')({
  component: DeployLayout,
})