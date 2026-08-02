import { createFileRoute, redirect, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { pb } from '@/lib/pb'
import { useAuth } from '@/contexts/AuthContext'
import { AppShell } from '@/components/layout'
import { UserMenu } from '@/components/layout/UserMenu'

export function AuthLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading || isAuthenticated) return
    navigate({
      to: '/login',
      search: { redirect: location.href },
      replace: true,
    })
  }, [isAuthenticated, isLoading, location.href, navigate])

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
