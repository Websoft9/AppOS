import { Menu } from 'lucide-react'
import { useRouterState } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/mode-toggle'
import { Logo } from './Logo'
import { Breadcrumbs, type BreadcrumbItem } from './Breadcrumbs'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useLayout } from '@/contexts/LayoutContext'
import { cn } from '@/lib/utils'

// Map pathname segments to human-readable labels
const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  store: 'App Store',
  connect: 'Connect',
  resources: 'Resources',
  space: 'Space',
  services: 'Services',
  audit: 'Audit',
  users: 'Users',
  settings: 'Settings',
  logs: 'Logs',
  iac: 'IaC Browser',
  profile: 'Profile',
}

function useRouteBreadcrumbs(): BreadcrumbItem[] {
  const router = useRouterState()
  const pathname = router.location.pathname
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return []

  return segments.map((seg, i) => {
    const label = ROUTE_LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1)
    const href = '/' + segments.slice(0, i + 1).join('/')
    const isLast = i === segments.length - 1
    return isLast ? { label } : { label, href }
  })
}

interface HeaderProps {
  /** Right-side slot, e.g. UserMenu from Epic 3 */
  actions?: React.ReactNode
  /** Optional page title override (if not set, auto-breadcrumbs from route) */
  title?: string
}

export function Header({ actions, title }: HeaderProps) {
  const { isDesktop, toggleSidebar } = useLayout()
  const autoBreadcrumbs = useRouteBreadcrumbs()

  return (
    <header
      className={cn(
        'flex items-center gap-3 border-b bg-background px-4',
        isDesktop ? 'h-[var(--header-height)]' : 'h-[var(--header-height-mobile)]'
      )}
      style={{ gridArea: 'header' }}
    >
      {/* Left: hamburger (mobile/tablet) + logo */}
      <div className="flex items-center gap-3 shrink-0">
        {!isDesktop && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label="Toggle navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <Logo />
      </div>

      {/* Center-left: breadcrumbs or title */}
      <div className="flex flex-1 items-center min-w-0 ml-4">
        {title ? (
          <h1 className="text-sm font-medium text-muted-foreground truncate">{title}</h1>
        ) : autoBreadcrumbs.length > 0 ? (
          <Breadcrumbs items={autoBreadcrumbs} className="hidden md:flex" />
        ) : null}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1 shrink-0">
        <LanguageSwitcher />
        <ModeToggle />
        {actions}
      </div>
    </header>
  )
}
