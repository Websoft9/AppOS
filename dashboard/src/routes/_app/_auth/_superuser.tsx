import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { pb } from '@/lib/pb'

export const Route = createFileRoute('/_app/_auth/_superuser')({
  component: () => <Outlet />,
  beforeLoad: async () => {
    if (pb.authStore.record?.collectionName !== '_superusers') {
      throw redirect({ to: '/' })
    }
  },
})
