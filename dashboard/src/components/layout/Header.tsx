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
  const { isDesktop, toggleSidebar } = useLayout()

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

      <div className="flex-1" />

      {/* Right: controls */}
      <div className="flex items-center gap-1 shrink-0">
        <LanguageSwitcher />
        <ModeToggle />
        {actions}
      </div>
    </header>
  )
}
