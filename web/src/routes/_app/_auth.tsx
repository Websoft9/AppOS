import { createFileRoute, redirect } from '@tanstack/react-router'
import { pb } from '@/lib/pb'
import { AppShell } from '@/components/layout'
import { UserMenu } from '@/components/layout/UserMenu'

function AuthLayout() {
  return <AppShell headerActions={<UserMenu />} />
}

export const Route = createFileRoute('/_app/_auth')({
  component: AuthLayout,
  beforeLoad: async ({ location }) => {
    if (!pb.authStore.isValid) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
})
