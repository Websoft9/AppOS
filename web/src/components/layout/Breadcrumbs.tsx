import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const { t } = useTranslation('navigation')

  if (items.length === 0) return null

  return (
    <nav
      aria-label={t('shell.breadcrumb')}
      className={cn('flex items-center gap-1 text-sm text-muted-foreground', className)}
    >
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {item.href ? (
            <Link
              to={item.href as never}
              className="hover:text-foreground transition-colors truncate"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
