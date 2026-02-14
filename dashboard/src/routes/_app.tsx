import { createFileRoute, Outlet } from '@tanstack/react-router'

function AppLayout() {
  return <Outlet />
}

export const Route = createFileRoute('/_app')({
  component: AppLayout,
})
