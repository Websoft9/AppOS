import { AppWindow, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function IframePageBreadcrumb({
  parentLabel,
  currentPage,
  className,
}: {
  parentLabel: string
  currentPage: string
  className?: string
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex min-w-0 items-center gap-1 text-sm text-muted-foreground', className)}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
        <AppWindow className="h-4 w-4 shrink-0" />
        <span className="truncate">{parentLabel}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-medium text-foreground">{currentPage}</span>
    </nav>
  )
}