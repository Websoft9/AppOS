import { useState, useMemo } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Layers,
  Network,
  Settings,
  FileCode2,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  LayoutGrid,
  FolderOpen,
  Users,
  Cog,
  TerminalSquare,
  KeyRound,
  Rss,
  Shapes,
  Puzzle,
  BotMessageSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useLayout } from '@/contexts/LayoutContext'
import { useAuth } from '@/contexts/AuthContext'
import { Logo } from './Logo'
import { navigateSidebarHref } from './sidebar-navigation'
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

type NavLabels = {
  groups: {
    workspace: string
    platform: string
  }
  items: {
    overview: string
    applications: string
    myApps: string
    appStore: string
    deploy: string
    publish: string
    actions: string
    groups: string
    feed: string
    terminal: string
    aiCopilot: string
    topics: string
    feeds: string
    assets: string
    space: string
    resources: string
    network: string
    gateway: string
    traffic: string
    extensions: string
    system: string
    status: string
    platformRuntime: string
    tunnels: string
    audit: string
    logs: string
    platformCrons: string
    sharedEnvs: string
    orchestrationFiles: string
    platformComponents: string
    users: string
    settings: string
    credentials: string
    secrets: string
    certificates: string
  }
  mobileDescription: string
}

const DEFAULT_NAV_LABELS: NavLabels = {
  groups: {
    workspace: 'Workspace',
    platform: 'Platform',
  },
  items: {
    overview: 'Overview',
    applications: 'Applications',
    myApps: 'My Apps',
    appStore: 'App Store',
    deploy: 'Deploy',
    publish: 'Publish',
    actions: 'Activity',
    groups: 'Groups',
    feed: 'Feed',
    terminal: 'Terminal',
    aiCopilot: 'AI Copilot',
    topics: 'Topics',
    feeds: 'Feeds',
    assets: 'Assets',
    space: 'Space',
    resources: 'Resources',
    network: 'Network',
    gateway: 'Gateway',
    traffic: 'Traffic',
    extensions: 'Extensions',
    system: 'System',
    status: 'Status',
    platformRuntime: 'Platform Runtime',
    tunnels: 'Tunnels',
    audit: 'Audit',
    logs: 'Logs',
    platformCrons: 'Platform Crons',
    sharedEnvs: 'Shared Envs',
    orchestrationFiles: 'Orchestration Files',
    platformComponents: 'Platform Components',
    users: 'Users',
    settings: 'Settings',
    credentials: 'Credentials',
    secrets: 'Secrets',
    certificates: 'Certificates',
  },
  mobileDescription: 'Navigate between workspace, application, and admin sections.',
}

// ─── Default navigation groups ───────────────────────────

function buildWorkspaceGroup(labels: NavLabels): NavGroup {
  return {
    id: 'workspace',
    label: labels.groups.workspace,
    items: [
      {
        id: 'overview',
        label: labels.items.overview,
        icon: <LayoutDashboard className="h-5 w-5" />,
        href: '/overview',
      },
      {
        id: 'applications',
        label: labels.items.applications,
        icon: <Layers className="h-5 w-5" />,
        href: '/store',
        children: [
          { id: 'installed', label: labels.items.myApps, href: '/apps' },
          { id: 'store', label: labels.items.appStore, href: '/store' },
          { id: 'deploy', label: labels.items.deploy, href: '/deploy' },
          { id: 'publish', label: labels.items.publish, href: '/publish' },
          { id: 'actions', label: labels.items.actions, href: '/activity' },
        ],
      },
      {
        id: 'groups',
        label: labels.items.groups,
        icon: <Shapes className="h-5 w-5" />,
        href: '/groups',
      },
      {
        id: 'terminal',
        label: labels.items.terminal,
        icon: <TerminalSquare className="h-5 w-5" />,
        href: '/terminal',
      },
      {
        id: 'ai-copilot',
        label: labels.items.aiCopilot,
        icon: <BotMessageSquare className="h-5 w-5" />,
        href: '/ai-copilot',
      },
      {
        id: 'feed',
        label: labels.items.feed,
        icon: <Rss className="h-5 w-5" />,
        href: '/feeds',
        children: [
          { id: 'feeds', label: labels.items.feeds, href: '/feeds' },
          { id: 'topics', label: labels.items.topics, href: '/topics' },
        ],
      },
      {
        id: 'assets',
        label: labels.items.assets,
        icon: <FileCode2 className="h-5 w-5" />,
        href: '/ai-assets',
      },
      {
        id: 'space',
        label: labels.items.space,
        icon: <FolderOpen className="h-5 w-5" />,
        href: '/space',
      },
    ],
  }
}

function buildPlatformGroup(isSuperuser: boolean, labels: NavLabels): NavGroup {
  const resourcesNavItem: NavItem = {
    id: 'resources',
    label: labels.items.resources,
    icon: <LayoutGrid className="h-5 w-5" />,
    href: '/resources',
  }

  const extensionsNavItem: NavItem = {
    id: 'extensions',
    label: labels.items.extensions,
    icon: <Puzzle className="h-5 w-5" />,
    href: '/extensions',
  }

  const networkNavItem: NavItem = {
    id: 'network',
    label: labels.items.network,
    icon: <Network className="h-5 w-5" />,
    href: '/network',
    children: [
      { id: 'gateway', label: labels.items.gateway, href: '/gateway' },
      { id: 'tunnels', label: labels.items.tunnels, href: '/tunnels' },
      { id: 'traffic', label: labels.items.traffic, href: '/traffic' },
    ],
  }

  const systemNavItem: NavItem = {
    id: 'system',
    label: labels.items.system,
    icon: <Settings className="h-5 w-5" />,
    href: '/status',
    children: [
      { id: 'status', label: labels.items.status, href: '/status' },
      { id: 'platform-runtime', label: labels.items.platformRuntime, href: '/platform-runtime' },
      { id: 'audit', label: labels.items.audit, href: '/audit' },
      { id: 'logs', label: labels.items.logs, href: '/logs' },
      { id: 'system-tasks', label: labels.items.platformCrons, href: '/system-tasks' },
      { id: 'shared-envs', label: labels.items.sharedEnvs, href: '/shared-envs' },
      { id: 'iac', label: labels.items.orchestrationFiles, href: '/iac' },
    ],
  }

  const systemNavItemBasic: NavItem = {
    id: 'system',
    label: labels.items.system,
    icon: <Settings className="h-5 w-5" />,
    href: '/platform-components',
    children: [
      {
        id: 'platform-components',
        label: labels.items.platformComponents,
        href: '/platform-components',
      },
      { id: 'audit', label: labels.items.audit, href: '/audit' },
    ],
  }

  const usersNavItem: NavItem = {
    id: 'users',
    label: labels.items.users,
    icon: <Users className="h-5 w-5" />,
    href: '/users',
  }

  const settingsNavItem: NavItem = {
    id: 'settings',
    label: labels.items.settings,
    icon: <Cog className="h-5 w-5" />,
    href: '/settings',
  }

  const credentialsNavItem: NavItem = {
    id: 'credentials',
    label: labels.items.credentials,
    icon: <KeyRound className="h-5 w-5" />,
    href: '/secrets',
    children: [
      {
        id: 'credentials-secrets',
        label: labels.items.secrets,
        href: '/secrets',
      },
      {
        id: 'credentials-certificates',
        label: labels.items.certificates,
        href: '/certificates',
      },
    ],
  }

  return {
    id: 'admin',
    label: labels.groups.platform,
    items: isSuperuser
      ? [
          systemNavItem,
          resourcesNavItem,
          networkNavItem,
          extensionsNavItem,
          credentialsNavItem,
          usersNavItem,
          settingsNavItem,
        ]
      : [systemNavItemBasic, resourcesNavItem, networkNavItem, extensionsNavItem],
  }
}

export function buildNavGroups(isSuperuser: boolean, labels?: NavLabels): NavGroup[] {
  const resolvedLabels = labels ?? DEFAULT_NAV_LABELS
  return [buildWorkspaceGroup(resolvedLabels), buildPlatformGroup(isSuperuser, resolvedLabels)]
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
  navigate,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate?: () => void
  depth?: number
  navigate: ReturnType<typeof useNavigate>
}) {
  const router = useRouterState()
  const hasChildren = !!(item.children && item.children.length > 0)
  const isChildActive =
    hasChildren &&
    item.children!.some(
      child =>
        router.location.pathname === child.href || router.location.pathname.startsWith(child.href)
    )
  const [childrenOpen, setChildrenOpen] = useState(isChildActive)
  const isActive =
    router.location.pathname === item.href ||
    (item.href !== '/overview' && router.location.pathname.startsWith(item.href))

  const handleParentClick = () => {
    if (!hasChildren || collapsed || childrenOpen) {
      return
    }
    const firstChild = item.children?.[0]
    if (!firstChild) {
      return
    }
    // A collapsed parent acts like a shortcut into its first child route.
    onNavigate?.()
    navigateSidebarHref(navigate, firstChild.href)
  }

  if (hasChildren && !collapsed) {
    return (
      <Collapsible open={childrenOpen} onOpenChange={setChildrenOpen}>
        <CollapsibleTrigger
          onClick={handleParentClick}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            isChildActive ? 'text-accent-foreground' : 'text-muted-foreground'
          )}
        >
          {item.icon}
          <span className="truncate flex-1 text-left">{item.label}</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', !childrenOpen && '-rotate-90')}
          />
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
                navigate={navigate}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  const link = (
    <Link
      to={item.href as never}
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
  onNavigate,
}: {
  group: NavGroup
  collapsed: boolean
  onNavigate?: () => void
}) {
  const navigate = useNavigate()

  // When sidebar is collapsed, show only icons (no group headers)
  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col gap-1 px-2">
        {group.items.map(item => (
          <NavLink
            key={item.id}
            item={item}
            collapsed
            onNavigate={onNavigate}
            navigate={navigate}
          />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</div>
      <nav className="flex flex-col gap-1 px-2 pb-1" aria-label={`${group.label} navigation`}>
        {group.items.map(item => (
          <NavLink
            key={item.id}
            item={item}
            collapsed={false}
            onNavigate={onNavigate}
            navigate={navigate}
          />
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
  const { t } = useTranslation('navigation')
  const isSuperuser = user?.collectionName === '_superusers'
  const labels = useMemo<NavLabels>(
    () => ({
      groups: {
        workspace: t('groups.workspace'),
        platform: t('groups.platform'),
      },
      items: {
        overview: t('items.overview'),
        applications: t('items.applications'),
        myApps: t('items.myApps'),
        appStore: t('items.appStore'),
        deploy: t('items.deploy'),
        publish: t('items.publish'),
        actions: t('items.actions'),
        groups: t('items.groups'),
        feed: t('items.feed'),
        terminal: t('items.terminal'),
        aiCopilot: t('items.aiCopilot'),
        topics: t('items.topics'),
        feeds: t('items.feeds'),
        assets: t('items.assets'),
        space: t('items.space'),
        resources: t('items.resources'),
        network: t('items.network'),
        gateway: t('items.gateway'),
        traffic: t('items.traffic'),
        extensions: t('items.extensions'),
        system: t('items.system'),
        status: t('items.status'),
        platformRuntime: t('items.platformRuntime'),
        tunnels: t('items.tunnels'),
        audit: t('items.audit'),
        logs: t('items.logs'),
        platformCrons: t('items.platformCrons'),
        sharedEnvs: t('items.sharedEnvs'),
        orchestrationFiles: t('items.orchestrationFiles'),
        platformComponents: t('items.platformComponents'),
        users: t('items.users'),
        settings: t('items.settings'),
        credentials: t('items.credentials'),
        secrets: t('items.secrets'),
        certificates: t('items.certificates'),
      },
      mobileDescription: t('mobile.description'),
    }),
    [t]
  )
  const resolvedGroups = useMemo(
    () => groups ?? buildNavGroups(isSuperuser, labels),
    [groups, isSuperuser, labels]
  )

  const handleBackgroundClick = () => {
    toggleSidebar()
  }

  // Mobile/Tablet: Sheet drawer
  if (!isDesktop) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle>
              <Logo />
            </SheetTitle>
            <SheetDescription>{labels.mobileDescription}</SheetDescription>
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
      data-testid="app-sidebar"
    >
      {/* Nav groups */}
      <div className="flex-1 overflow-y-auto py-3">
        <div className="flex min-h-full flex-col">
          <SidebarNav groups={resolvedGroups} collapsed={sidebarCollapsed} />
          <div
            className="min-h-6 flex-1 cursor-pointer"
            onClick={handleBackgroundClick}
            data-testid="sidebar-blank-area"
          />
        </div>
      </div>

      {/* Collapse toggle at bottom */}
      <Separator />
      <div className="p-2">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 w-full px-3',
                sidebarCollapsed ? 'justify-center px-2' : 'justify-start'
              )}
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}
