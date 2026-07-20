import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/mode-toggle'
import { Logo } from './Logo'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useLayout } from '@/contexts/LayoutContext'
import { cn } from '@/lib/utils'

interface HeaderProps {
  /** Right-side slot, e.g. UserMenu from Epic 3 */
  actions?: React.ReactNode
}

export function Header({ actions }: HeaderProps) {
  const { isDesktop, toggleSidebar, sidebarCollapsed, headerRightStartContent } = useLayout()

  return (
    <header
      className={cn(
        'flex items-center gap-3 border-b bg-background',
        isDesktop ? 'h-[var(--header-height)]' : 'h-[var(--header-height-mobile)]'
      )}
      style={{ gridArea: 'header' }}
    >
      {/* Left box: fixed to sidebar width so divider aligns with sidebar */}
      <div
        className={cn(
          'flex items-stretch h-full gap-3 shrink-0 border-r',
          isDesktop
            ? sidebarCollapsed
              ? 'w-[var(--sidebar-width-collapsed)]'
              : 'w-[var(--sidebar-width)]'
            : 'w-full'
        )}
      >
        <div className="pl-4 flex items-center h-full gap-3">
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
      </div>

      {/* Right section: page slot starts at the left edge of the header-right area */}
      <div className="flex min-w-0 flex-1 items-center pr-4">
        <div
          className={cn(
            'ml-4 flex w-full min-w-0 items-center',
            headerRightStartContent ? 'justify-between gap-4' : 'justify-end'
          )}
        >
          {headerRightStartContent ? (
            <div className="min-w-0 max-w-[min(44rem,62%)] pr-1">{headerRightStartContent}</div>
          ) : null}
          <div
            className={cn('flex items-center gap-1 shrink-0', headerRightStartContent && 'pl-3')}
          >
            <LanguageSwitcher />
            <ModeToggle />
            {actions}
          </div>
        </div>
      </div>
    </header>
  )
}
