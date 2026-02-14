import { createFileRoute, redirect, isRedirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    try {
      const res = await fetch('/api/appos/setup/status')
      const data = await res.json()
      if (data.needsSetup) {
        throw redirect({ to: '/setup' })
      }
    } catch (e) {
      // If the error is a redirect, re-throw it so TanStack Router handles it
      if (isRedirect(e)) throw e
      // Network error → fall through to login
    }
    throw redirect({ to: '/login' })
  },
})
