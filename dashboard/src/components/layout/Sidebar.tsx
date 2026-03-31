import { useState, useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'
import {
  LayoutDashboard,
  Layers,
  Settings,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  LayoutGrid,
  FolderOpen,
  Users,
  Cog,
  TerminalSquare,
  KeyRound,
  MessageSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useLayout } from '@/contexts/LayoutContext'
import { useAuth } from '@/contexts/AuthContext'
import { Logo } from './Logo'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────

export interface NavItem {
  id: string
  label: string
  icon?: React.ReactNode
  href: string
  badge?: number | string
  children?: NavItem[]
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

// ─── Default navigation groups ───────────────────────────

const workspaceGroup: NavGroup = {
  id: 'workspace',
  label: 'Workspace',
  items: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard className="h-5 w-5" />,
      href: '/dashboard',
    },
    {
      id: 'applications',
      label: 'Applications',
      icon: <Layers className="h-5 w-5" />,
      href: '/store',
      children: [
        { id: 'store', label: 'App Store', href: '/store' },
        { id: 'deploy', label: 'Deploy', href: '/deploy' },
        { id: 'actions', label: 'Actions', href: '/actions' },
        { id: 'installed', label: 'My Apps', href: '/apps' },
      ],
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: <TerminalSquare className="h-5 w-5" />,
      href: '/terminal',
    },
    {
      id: 'collaboration',
      label: 'Collaboration',
      icon: <MessageSquare className="h-5 w-5" />,
      href: '/groups',
      children: [
        { id: 'groups', label: 'Groups', href: '/groups' },
        { id: 'topics', label: 'Topics', href: '/topics' },
      ],
    },
    { id: 'space', label: 'Space', icon: <FolderOpen className="h-5 w-5" />, href: '/space' },
  ],
}

const resourcesNavItem: NavItem = {
  id: 'resources',
  label: 'Resources',
  icon: <LayoutGrid className="h-5 w-5" />,
  href: '/resources',
}

const systemNavItem: NavItem = {
  id: 'system',
  label: 'System',
  icon: <Settings className="h-5 w-5" />,
  href: '/status',
  children: [
    { id: 'status', label: 'Status', href: '/status' },
    { id: 'tunnels', label: 'Tunnels', href: '/tunnels' },
    { id: 'logs', label: 'Logs', href: '/logs' },
    { id: 'audit', label: 'Audit', href: '/audit' },
    { id: 'iac', label: 'IaC Browser', href: '/iac' },
  ],
}

const systemNavItemBasic: NavItem = {
  id: 'system',
  label: 'System',
  icon: <Settings className="h-5 w-5" />,
  href: '/components',
  children: [
    { id: 'components', label: 'Components', href: '/components' },
    { id: 'tunnels', label: 'Tunnels', href: '/tunnels' },
    { id: 'audit', label: 'Audit', href: '/audit' },
  ],
}

const usersNavItem: NavItem = {
  id: 'users',
  label: 'Users',
  icon: <Users className="h-5 w-5" />,
  href: '/users',
}

const settingsNavItem: NavItem = {
  id: 'settings',
  label: 'Settings',
  icon: <Cog className="h-5 w-5" />,
  href: '/settings',
}

const credentialsNavItem: NavItem = {
  id: 'credentials',
  label: 'Credentials',
  icon: <KeyRound className="h-5 w-5" />,
  href: '/secrets',
  children: [
    {
      id: 'credentials-secrets',
      label: 'Secrets',
      href: '/secrets',
    },
    {
      id: 'credentials-certificates',
      label: 'Certificates',
      href: '/certificates',
    },
    {
      id: 'credentials-shared-envs',
      label: 'Shared Envs',
      href: '/shared-envs',
    },
  ],
}

function buildNavGroups(isSuperuser: boolean): NavGroup[] {
  return [
    workspaceGroup,
    {
      id: 'admin',
      label: 'Admin',
      items: isSuperuser
        ? [systemNavItem, resourcesNavItem, credentialsNavItem, usersNavItem, settingsNavItem]
        : [systemNavItemBasic, resourcesNavItem],
    },
  ]
}

interface SidebarProps {
  groups?: NavGroup[]
}



// ─── NavLink ─────────────────────────────────────────────

function NavLink({
  item,
  collapsed,
  onNavigate,
  depth = 0,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate?: () => void
  depth?: number
}) {
  const router = useRouterState()
  const hasChildren = !!(item.children && item.children.length > 0)
  const isChildActive = hasChildren && item.children!.some(
    child => router.location.pathname === child.href || router.location.pathname.startsWith(child.href)
  )
  const [childrenOpen, setChildrenOpen] = useState(isChildActive)
  const isActive =
    router.location.pathname === item.href ||
    (item.href !== '/dashboard' && router.location.pathname.startsWith(item.href))

  if (hasChildren && !collapsed) {
    return (
      <Collapsible open={childrenOpen} onOpenChange={setChildrenOpen}>
        <CollapsibleTrigger
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            isChildActive ? 'text-accent-foreground' : 'text-muted-foreground'
          )}
        >
          {item.icon}
          <span className="truncate flex-1 text-left">{item.label}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !childrenOpen && '-rotate-90')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 flex flex-col gap-1">
            {item.children!.map(child => (
              <NavLink
                key={child.id}
                item={child}
                collapsed={false}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  const link = (
    <a
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'flex items-center justify-start gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
        depth > 0 && 'py-1.5 pl-11 text-xs font-normal',
        collapsed && 'justify-center px-2'
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      {item.icon}
      {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
      {!collapsed && item.badge != null && (
        <span className="ml-auto text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
          {item.badge}
        </span>
      )}
    </a>
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
  onNavigate,
}: {
  group: NavGroup
  collapsed: boolean
  onNavigate?: () => void
}) {
  // When sidebar is collapsed, show only icons (no group headers)
  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col gap-1 px-2">
        {group.items.map(item => (
          <NavLink key={item.id} item={item} collapsed onNavigate={onNavigate} />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground">
        {group.label}
      </div>
      <nav className="flex flex-col gap-1 px-2 pb-1" aria-label={`${group.label} navigation`}>
        {group.items.map(item => (
          <NavLink key={item.id} item={item} collapsed={false} onNavigate={onNavigate} />
        ))}
      </nav>
    </div>
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
  return (
    <div className="flex flex-col gap-2">
      {groups.map(group => (
        <NavGroupSection
          key={group.id}
          group={group}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────

export function Sidebar({ groups }: SidebarProps) {
  const { sidebarCollapsed, sidebarOpen, setSidebarOpen, toggleSidebar, isDesktop } = useLayout()
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
            <SidebarNav
              groups={resolvedGroups}
              collapsed={false}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop: persistent sidebar
  return (
    <aside
      className={cn(
        'flex flex-col border-r bg-background transition-[width] duration-200 ease-out overflow-hidden',
        sidebarCollapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width)]'
      )}
      style={{ gridArea: 'sidebar' }}
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
          className={cn('w-full', sidebarCollapsed ? 'justify-center' : 'justify-start')}
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4 mr-2" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  )
}
