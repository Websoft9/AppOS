import type { useNavigate } from '@tanstack/react-router'

type LoginNavigate = ReturnType<typeof useNavigate>

export function resolveLoginRedirectTarget(
  redirect: string | undefined,
  origin: string
): string | null {
  if (!redirect) return null

  try {
    const target = new URL(redirect, origin)
    if (target.origin !== origin) {
      return null
    }
    return `${target.pathname}${target.search}${target.hash}` || '/'
  } catch {
    return null
  }
}

export async function completeLoginRedirect(
  navigate: LoginNavigate,
  redirect: string | undefined,
  origin: string,
  assign: (url: string) => void
) {
  const internalTarget = resolveLoginRedirectTarget(redirect, origin)
  if (internalTarget) {
    await navigate({ to: internalTarget as never })
    return
  }

  if (redirect) {
    assign(redirect)
    return
  }

  await navigate({ to: '/overview' })
}
