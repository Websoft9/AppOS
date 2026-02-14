import { Link, useRouterState } from "@tanstack/react-router"
import {
  LayoutDashboard,
  Store,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useLayout } from "@/contexts/LayoutContext"
import { Logo } from "./Logo"
import { cn } from "@/lib/utils"

export interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  href: string
  badge?: number | string
}

// Default navigation items — Epic 5/6 will extend this
const defaultNavItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-5 w-5" />, href: "/dashboard" },
  { id: "store", label: "App Store", icon: <Store className="h-5 w-5" />, href: "/store" },
  { id: "services", label: "Services", icon: <Settings className="h-5 w-5" />, href: "/services" },
]

interface SidebarProps {
  items?: NavItem[]
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const router = useRouterState()
  const isActive = router.location.pathname === item.href ||
    (item.href !== "/dashboard" && router.location.pathname.startsWith(item.href))

  const link = (
    <Link
      to={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground",
        collapsed && "justify-center px-2"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {item.icon}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge != null && (
        <span className="ml-auto text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
          {item.badge}
        </span>
      )}
    </Link>
  )

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return link
}

function SidebarNav({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-2" aria-label="Main navigation">
      {items.map((item) => (
        <NavLink key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  )
}

export function Sidebar({ items = defaultNavItems }: SidebarProps) {
  const {
    sidebarCollapsed,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    isDesktop,
  } = useLayout()

  // Mobile/Tablet: Sheet drawer
  if (!isDesktop) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle>
              <Logo />
            </SheetTitle>
          </SheetHeader>
          <Separator />
          <div className="py-3">
            <SidebarNav items={items} collapsed={false} onNavigate={() => setSidebarOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop: persistent sidebar
  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-background transition-[width] duration-200 ease-out overflow-hidden",
        sidebarCollapsed
          ? "w-[var(--sidebar-width-collapsed)]"
          : "w-[var(--sidebar-width)]"
      )}
      style={{ gridArea: "sidebar" }}
    >
      {/* Nav items */}
      <div className="flex-1 py-3 overflow-y-auto">
        <SidebarNav items={items} collapsed={sidebarCollapsed} />
      </div>

      {/* Collapse toggle at bottom */}
      <Separator />
      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn("w-full", sidebarCollapsed ? "justify-center" : "justify-start")}
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed
            ? <PanelLeft className="h-4 w-4" />
            : <>
                <PanelLeftClose className="h-4 w-4 mr-2" />
                <span className="text-xs">Collapse</span>
              </>
          }
        </Button>
      </div>
    </aside>
  )
}
