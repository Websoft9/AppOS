import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { Logo } from "./Logo"
import { useLayout } from "@/contexts/LayoutContext"
import { cn } from "@/lib/utils"

interface HeaderProps {
  /** Right-side slot, e.g. UserMenu from Epic 3 */
  actions?: React.ReactNode
  /** Optional page title override */
  title?: string
}

export function Header({ actions, title }: HeaderProps) {
  const { isDesktop, toggleSidebar } = useLayout()

  return (
    <header
      className={cn(
        "flex items-center gap-3 border-b bg-background px-4",
        isDesktop ? "h-[var(--header-height)]" : "h-[var(--header-height-mobile)]",
      )}
      style={{ gridArea: "header" }}
    >
      {/* Left: hamburger (mobile/tablet) + logo */}
      <div className="flex items-center gap-3">
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

      {/* Center: page title */}
      {title && (
        <div className="hidden md:flex flex-1 items-center ml-4">
          <h1 className="text-sm font-medium text-muted-foreground truncate">
            {title}
          </h1>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: actions */}
      <div className="flex items-center gap-1.5">
        <ModeToggle />
        {actions}
      </div>
    </header>
  )
}
