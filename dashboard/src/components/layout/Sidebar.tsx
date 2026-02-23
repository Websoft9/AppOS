import { useState, useCallback, useMemo } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  LayoutDashboard,
  Store,
  Settings,
  Container,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  LayoutGrid,
  FolderOpen,
  Users,
  ScrollText,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useLayout } from "@/contexts/LayoutContext"
import { useAuth } from "@/contexts/AuthContext"
import { Logo } from "./Logo"
import { cn } from "@/lib/utils"

// ─── Types ───────────────────────────────────────────────

export interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  href: string
  badge?: number | string
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

// ─── Default navigation groups ───────────────────────────

const workspaceGroup: NavGroup = {
  id: "workspace",
  label: "Workspace",
  items: [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-5 w-5" />, href: "/dashboard" },
    { id: "store", label: "App Store", icon: <Store className="h-5 w-5" />, href: "/store" },
    { id: "resources", label: "Resources", icon: <LayoutGrid className="h-5 w-5" />, href: "/resources" },
    { id: "files", label: "Files", icon: <FolderOpen className="h-5 w-5" />, href: "/files" },
  ],
}

const baseAdminItems: NavItem[] = [
  { id: "docker", label: "Docker", icon: <Container className="h-5 w-5" />, href: "/docker" },
  { id: "services", label: "Services", icon: <Settings className="h-5 w-5" />, href: "/services" },
  { id: "audit", label: "Audit", icon: <ScrollText className="h-5 w-5" />, href: "/audit" },
]

const usersNavItem: NavItem = {
  id: "users",
  label: "Users",
  icon: <Users className="h-5 w-5" />,
  href: "/users",
}

function buildNavGroups(isSuperuser: boolean): NavGroup[] {
  return [
    workspaceGroup,
    {
      id: "admin",
      label: "Admin",
      items: isSuperuser
        ? [...baseAdminItems, usersNavItem]
        : baseAdminItems,
    },
  ]
}

interface SidebarProps {
  groups?: NavGroup[]
}

// ─── Storage helpers for group collapse state ────────────

const GROUP_STORAGE_KEY = "sidebar-groups"

function loadGroupState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUP_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveGroupState(state: Record<string, boolean>) {
  localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(state))
}

// ─── NavLink ─────────────────────────────────────────────

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

// ─── NavGroupSection (collapsible) ───────────────────────

function NavGroupSection({
  group,
  collapsed: sidebarCollapsed,
  open,
  onToggle,
  onNavigate,
}: {
  group: NavGroup
  collapsed: boolean
  open: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  // When sidebar is collapsed, show only icons (no group headers)
  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col gap-1 px-2">
        {group.items.map((item) => (
          <NavLink key={item.id} item={item} collapsed onNavigate={onNavigate} />
        ))}
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex items-center w-full px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <nav className="flex flex-col gap-1 px-2 pb-1" aria-label={`${group.label} navigation`}>
          {group.items.map((item) => (
            <NavLink key={item.id} item={item} collapsed={false} onNavigate={onNavigate} />
          ))}
        </nav>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ─── SidebarNav ──────────────────────────────────────────

function SidebarNav({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[]
  collapsed: boolean
  onNavigate?: () => void
}) {
  const [groupState, setGroupState] = useState<Record<string, boolean>>(loadGroupState)

  const toggleGroup = useCallback((groupId: string) => {
    setGroupState((prev) => {
      const next = { ...prev, [groupId]: !(prev[groupId] ?? true) }
      saveGroupState(next)
      return next
    })
  }, [])

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <NavGroupSection
          key={group.id}
          group={group}
          collapsed={collapsed}
          open={groupState[group.id] ?? true}
          onToggle={() => toggleGroup(group.id)}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────

export function Sidebar({ groups }: SidebarProps) {
  const {
    sidebarCollapsed,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    isDesktop,
  } = useLayout()
  const { user } = useAuth()
  const isSuperuser = user?.collectionName === '_superusers'
  const resolvedGroups = useMemo(() => groups ?? buildNavGroups(isSuperuser), [groups, isSuperuser])

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
            <SidebarNav groups={resolvedGroups} collapsed={false} onNavigate={() => setSidebarOpen(false)} />
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
      {/* Nav groups */}
      <div className="flex-1 py-3 overflow-y-auto">
        <SidebarNav groups={resolvedGroups} collapsed={sidebarCollapsed} />
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
