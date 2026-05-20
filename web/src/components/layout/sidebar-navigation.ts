import type { useNavigate } from '@tanstack/react-router'

type SidebarNavigate = ReturnType<typeof useNavigate>

export function navigateSidebarHref(navigate: SidebarNavigate, href: string) {
  navigate({ to: href as never })
}
