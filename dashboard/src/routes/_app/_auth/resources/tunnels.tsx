import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/_auth/resources/tunnels')({
  beforeLoad: () => {
    throw redirect({
      to: '/tunnels',
      search: {
        q: '',
        status: 'all',
        sort: 'connected_at',
        dir: 'desc',
        page: 1,
        pageSize: 15,
      },
    })
  },
})