import { Link } from '@tanstack/react-router'
import { ChevronRight, LayoutGrid } from 'lucide-react'

export function ResourcesBreadcrumb({
  parentLabel,
  currentPage,
}: {
  parentLabel: string
  currentPage: string
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
    >
      <Link
        to="/resources"
        className="inline-flex min-w-0 items-center gap-1.5 truncate transition-colors hover:text-foreground"
      >
        <LayoutGrid className="h-4 w-4 shrink-0" />
        <span className="truncate">{parentLabel}</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-medium text-foreground">{currentPage}</span>
    </nav>
  )
}
