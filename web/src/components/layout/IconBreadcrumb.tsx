import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function IconBreadcrumb({
  icon,
  parentLabel,
  parentHref,
  currentPage,
  className,
}: {
  icon: ReactNode
  parentLabel: string
  parentHref: string
  currentPage: string
  className?: string
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex min-w-0 items-center gap-1 text-sm text-muted-foreground', className)}
    >
      <Link
        to={parentHref as never}
        className="inline-flex min-w-0 items-center gap-1.5 truncate transition-colors hover:text-foreground"
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{parentLabel}</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-medium text-foreground">{currentPage}</span>
    </nav>
  )
}
