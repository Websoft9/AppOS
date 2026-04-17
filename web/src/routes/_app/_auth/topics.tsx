import { createFileRoute, Outlet } from '@tanstack/react-router'

function TopicsLayout() {
  return <Outlet />
}

export const Route = createFileRoute('/_app/_auth/topics')({
  component: TopicsLayout,
})
