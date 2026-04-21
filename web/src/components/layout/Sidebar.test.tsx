import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SidebarModule from './Sidebar'

let pathname = '/apps'
let isDesktop = true
let sidebarOpen = false
const assignMock = vi.fn()
const setSidebarOpenMock = vi.fn()

vi.mock('./sidebar-navigation', () => ({
  navigateSidebarHref: (...args: unknown[]) => assignMock(...args),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouterState: () => ({
    location: { pathname },
  }),
}))

vi.mock('@/contexts/LayoutContext', () => ({
  useLayout: () => ({
    sidebarCollapsed: false,
    sidebarOpen,
    setSidebarOpen: setSidebarOpenMock,
    toggleSidebar: vi.fn(),
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

    expect(assignMock).toHaveBeenCalledWith('/apps')
  })

  it('opens Collaboration and navigates to Groups when clicked from a collapsed state', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const workspaceNav = screen.getAllByLabelText('Workspace navigation')[0]
    const collaborationTrigger = within(workspaceNav).getByText('Collaboration').closest('button')

    expect(collaborationTrigger).not.toBeNull()

    fireEvent.click(collaborationTrigger as HTMLButtonElement)

    expect(assignMock).toHaveBeenCalledWith('/groups')
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

  it('opens Credentials and navigates to Secrets when clicked from a collapsed state', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const adminNav = screen.getAllByLabelText('Platform navigation')[0]
    const credentialsTrigger = within(adminNav).getByText('Credentials').closest('button')

    expect(credentialsTrigger).not.toBeNull()

    fireEvent.click(credentialsTrigger as HTMLButtonElement)

    expect(assignMock).toHaveBeenCalledWith('/secrets')
  })

  it('does not show Shared Envs under Credentials', () => {
    pathname = '/secrets'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const platformNav = screen.getAllByLabelText('Platform navigation')[0]
    expect(within(platformNav).queryByRole('link', { name: 'Shared Envs' })).toBeNull()
  })

  it('opens System and navigates to Status when clicked from a collapsed state', () => {
    pathname = '/overview'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const adminNav = screen.getAllByLabelText('Platform navigation')[0]
    const systemTrigger = within(adminNav).getByText('System').closest('button')

    expect(systemTrigger).not.toBeNull()

    fireEvent.click(systemTrigger as HTMLButtonElement)

    expect(assignMock).toHaveBeenCalledWith('/status')
  })

  it('shows Audit before Logs and Orchestration Files after System Crons under the System section for superusers', () => {
    pathname = '/status'
    assignMock.mockReset()

    render(<SidebarModule.Sidebar groups={SidebarModule.buildNavGroups(true)} />)

    const adminNav = screen.getAllByLabelText('Platform navigation')[0]
    const links = within(adminNav)
      .getAllByRole('link')
      .map(link => link.textContent?.trim())
      .filter((label): label is string => Boolean(label))

    expect(within(adminNav).getByRole('link', { name: 'System Crons' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Orchestration Files' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Audit' })).toBeInTheDocument()
    expect(within(adminNav).getByRole('link', { name: 'Logs' })).toBeInTheDocument()
    expect(links.indexOf('Audit')).toBeLessThan(links.indexOf('Logs'))
    expect(links.indexOf('System Crons')).toBeLessThan(links.indexOf('Orchestration Files'))
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
})
