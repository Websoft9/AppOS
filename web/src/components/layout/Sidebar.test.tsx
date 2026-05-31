import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SidebarModule from './Sidebar'

let pathname = '/apps'
let isDesktop = true
let sidebarOpen = false
const assignMock = vi.fn()
const setSidebarOpenMock = vi.fn()
const toggleSidebarMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
    onClick,
  }: {
    children: React.ReactNode
    to: string
    className?: string
    onClick?: () => void
  }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  useNavigate: () => assignMock,
  useRouterState: () => ({
    location: { pathname },
  }),
}))

vi.mock('@/contexts/LayoutContext', () => ({
  useLayout: () => ({
    sidebarCollapsed: false,
    sidebarOpen,
    setSidebarOpen: setSidebarOpenMock,
    toggleSidebar: toggleSidebarMock,
    isDesktop,
  }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { collectionName: '_superusers' },
  }),
}))

afterEach(() => {
  cleanup()
  isDesktop = true
  sidebarOpen = false
  setSidebarOpenMock.mockReset()
  toggleSidebarMock.mockReset()
})

describe('Sidebar', () => {
  it('shows Overview as the primary workspace entry label', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    expect(within(workspaceNav).getByText('Overview')).toBeInTheDocument()
    expect(within(workspaceNav).queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('orders Applications children as My Apps, App Store, Deploy, Actions', () => {
    pathname = '/apps'
    assignMock.mockReset()
    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const applicationTrigger = within(workspaceNav).getByText('Applications')
    expect(applicationTrigger).toBeInTheDocument()

    const links = within(workspaceNav).getAllByRole('link')
    const appLinks = links
      .map(link => link.textContent?.trim())
      .filter((label): label is string =>
        ['My Apps', 'App Store', 'Deploy', 'Actions'].includes(label ?? '')
      )

    expect(appLinks).toEqual(['My Apps', 'App Store', 'Deploy', 'Actions'])
  })

  it('toggles Applications children open and closed', () => {
    pathname = '/apps'
    assignMock.mockReset()
    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const applicationTrigger = within(workspaceNav).getByText('Applications')

    expect(within(workspaceNav).getByRole('link', { name: 'My Apps' })).toBeInTheDocument()
    expect(within(workspaceNav).getByRole('link', { name: 'App Store' })).toBeInTheDocument()

    fireEvent.click(applicationTrigger)

    expect(within(workspaceNav).queryByRole('link', { name: 'My Apps' })).not.toBeInTheDocument()
    expect(within(workspaceNav).queryByRole('link', { name: 'App Store' })).not.toBeInTheDocument()

    fireEvent.click(applicationTrigger)

    expect(within(workspaceNav).getByRole('link', { name: 'My Apps' })).toBeInTheDocument()
    expect(within(workspaceNav).getByRole('link', { name: 'App Store' })).toBeInTheDocument()
  })

  it('opens Applications and navigates to My Apps when clicked from a collapsed state', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const applicationTrigger = within(workspaceNav).getByText('Applications').closest('button')

    expect(applicationTrigger).not.toBeNull()

    fireEvent.click(applicationTrigger as HTMLButtonElement)

    expect(assignMock).toHaveBeenCalledWith({ to: '/apps' })
  })

  it('opens Collaboration and navigates to Groups when clicked from a collapsed state', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const collaborationTrigger = within(workspaceNav).getByText('Collaboration').closest('button')

    expect(collaborationTrigger).not.toBeNull()

    fireEvent.click(collaborationTrigger as HTMLButtonElement)

    expect(assignMock).toHaveBeenCalledWith({ to: '/groups' })
  })

  it('does not show Scripts under Collaboration', () => {
    pathname = '/groups'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const collaborationTrigger = within(workspaceNav).getByText('Collaboration')

    expect(collaborationTrigger).toBeInTheDocument()
    expect(within(workspaceNav).queryByRole('link', { name: 'Scripts' })).toBeNull()
  })

  it('shows Feeds under Collaboration after Topics', () => {
    pathname = '/topics'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const links = within(workspaceNav)
      .getAllByRole('link')
      .map(link => link.textContent)
      .filter(Boolean)

    expect(links.indexOf('Topics')).toBeGreaterThanOrEqual(0)
    expect(links.indexOf('Feeds')).toBeGreaterThan(links.indexOf('Topics'))
  })

  it('opens Credentials and navigates to Secrets when clicked from a collapsed state', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const adminNav = screen.getAllByLabelText('Platform navigation')[0]
    const credentialsTrigger = within(adminNav).getByText('Credentials').closest('button')

    expect(credentialsTrigger).not.toBeNull()

    fireEvent.click(credentialsTrigger as HTMLButtonElement)

    expect(assignMock).toHaveBeenCalledWith({ to: '/secrets' })
  })

  it('does not show Shared Envs under Credentials', () => {
    pathname = '/secrets'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const platformNav = screen.getAllByLabelText('Platform navigation')[0]
    expect(within(platformNav).queryByRole('link', { name: 'Shared Envs' })).toBeNull()
  })

  it('shows Assets under Workspace and not under Platform for superusers', () => {
    pathname = '/ai-assets'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const adminNav = screen.getAllByLabelText('Platform navigation')[0]
    const assetsLink = within(workspaceNav).getByRole('link', { name: 'Assets' })
    const spaceLink = within(workspaceNav).getByRole('link', { name: 'Space' })

    expect(assetsLink).toHaveAttribute('href', '/ai-assets')
    expect(within(adminNav).queryByRole('link', { name: 'Assets' })).toBeNull()
    expect(
      assetsLink.compareDocumentPosition(spaceLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('opens System and navigates to Status when clicked from a collapsed state', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const adminNav = screen.getAllByLabelText('Platform navigation')[0]
    const systemTrigger = within(adminNav).getByText('System').closest('button')

    expect(systemTrigger).not.toBeNull()

    fireEvent.click(systemTrigger as HTMLButtonElement)

    expect(assignMock).toHaveBeenCalledWith({ to: '/status' })
  })

  it('shows Platform Runtime after Status and keeps the remaining System order for superusers', () => {
    pathname = '/status'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const adminNav = screen.getAllByLabelText('Platform navigation')[0]
    const links = within(adminNav)
      .getAllByRole('link')
      .map(link => link.textContent?.trim())
      .filter((label): label is string => Boolean(label))

    expect(within(adminNav).getByRole('link', { name: 'Platform Runtime' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Platform Crons' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Shared Envs' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Orchestration Files' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Audit' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Logs' })).toBeInTheDocument()
    expect(links.indexOf('Status')).toBeLessThan(links.indexOf('Platform Runtime'))
    expect(links.indexOf('Platform Runtime')).toBeLessThan(links.indexOf('Tunnels'))
    expect(links.indexOf('Audit')).toBeLessThan(links.indexOf('Logs'))
    expect(links.indexOf('Platform Crons')).toBeLessThan(links.indexOf('Shared Envs'))
    expect(links.indexOf('Shared Envs')).toBeLessThan(links.indexOf('Orchestration Files'))
  })

  it('uses Platform Components as the basic system entry', () => {
    const groups = SidebarModule.buildNavGroups(false)
    const platformGroup = groups.find(group => group.label === 'Platform')
    const systemItem = platformGroup?.items.find(item => item.id === 'system')

    expect(systemItem?.href).toBe('/platform-components')
    expect(systemItem?.children?.[0]?.label).toBe('Platform Components')
    expect(systemItem?.children?.[0]?.href).toBe('/platform-components')
  })

  it('closes the mobile drawer when a child link is clicked', () => {
    pathname = '/apps'
    isDesktop = false
    sidebarOpen = true
    assignMock.mockReset()
    setSidebarOpenMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    fireEvent.click(screen.getByRole('link', { name: 'My Apps' }))

    expect(setSidebarOpenMock).toHaveBeenCalledWith(false)
  })

  it('toggles the desktop sidebar when the blank sidebar area is clicked', () => {
    pathname = '/overview'

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    fireEvent.click(screen.getByTestId('sidebar-blank-area'))

    expect(toggleSidebarMock).toHaveBeenCalledTimes(1)
  })

  it('shows the pointer cursor on the blank sidebar area', () => {
    pathname = '/overview'

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    expect(screen.getByTestId('sidebar-blank-area')).toHaveClass('cursor-pointer')
  })

  it('does not toggle the desktop sidebar when an interactive nav item is double-clicked', () => {
    pathname = '/overview'

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    fireEvent.doubleClick(screen.getByRole('link', { name: 'Overview' }))

    expect(toggleSidebarMock).not.toHaveBeenCalled()
  })
})
