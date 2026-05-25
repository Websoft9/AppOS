import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalIndexPage } from './TerminalIndexPage'
import { TooltipProvider } from '@/components/ui/tooltip'

const navigateMock = vi.fn()
const listServersMock = vi.fn()
const listTerminalSessionsMock = vi.fn()
const checkServerStatusMock = vi.fn()
const getConnectTerminalSettingsMock = vi.fn()
const deleteTerminalSessionMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/lib/connect-api', () => ({
  listServers: (...args: unknown[]) => listServersMock(...args),
  listTerminalSessions: (...args: unknown[]) => listTerminalSessionsMock(...args),
  deleteTerminalSession: (...args: unknown[]) => deleteTerminalSessionMock(...args),
  checkServerStatus: (...args: unknown[]) => checkServerStatusMock(...args),
  getConnectTerminalSettings: (...args: unknown[]) => getConnectTerminalSettingsMock(...args),
}))

describe('TerminalIndexPage', () => {
  function getButtonByText(label: string) {
    const match = screen
      .getAllByRole('button')
      .find(button => button.textContent?.trim() === label)

    if (!match) {
      throw new Error(`Button not found: ${label}`)
    }

    return match
  }

  function renderPage() {
    return render(
      <TooltipProvider>
        <TerminalIndexPage />
      </TooltipProvider>
    )
  }

  beforeEach(() => {
    navigateMock.mockReset()
    listServersMock.mockReset()
    listTerminalSessionsMock.mockReset()
    deleteTerminalSessionMock.mockReset()
    checkServerStatusMock.mockReset()
    getConnectTerminalSettingsMock.mockReset()

    listServersMock.mockResolvedValue([
      { id: 'srv-1', name: 'Alpha', host: '10.0.0.1', access_status: 'available' },
      { id: 'srv-2', name: 'Beta', host: '10.0.0.2', access_status: 'available' },
    ])
    listTerminalSessionsMock.mockResolvedValue([])
    checkServerStatusMock.mockResolvedValue({ status: 'online' })
    deleteTerminalSessionMock.mockResolvedValue(undefined)
    getConnectTerminalSettingsMock.mockResolvedValue({
      idleTimeoutSeconds: 60,
      maxConnections: 0,
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows idle and multi-session badges for active backend terminal sessions', async () => {
    listTerminalSessionsMock.mockResolvedValue([
      {
        id: 'tab-1',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-1',
        session_type: 'ssh',
        state: 'detached',
        started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        last_active_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        workspace: {},
      },
      {
        id: 'tab-2',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-1',
        session_type: 'ssh',
        state: 'attached',
        started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        last_active_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
        workspace: {},
      },
    ])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Active Sessions')).toBeInTheDocument()
      expect(screen.getAllByText('Idle').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('2 sessions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Idle session').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Last active/i).length).toBeGreaterThan(0)
  })

  it('refreshes the hub when a backend terminal session appears after focus returns', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No active sessions')).toBeInTheDocument()
    })

    listTerminalSessionsMock.mockResolvedValue([
      {
        id: 'tab-1',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-2',
        session_type: 'ssh',
        state: 'attached',
        started_at: new Date(Date.now() - 60 * 1000).toISOString(),
        last_active_at: new Date().toISOString(),
        workspace: {},
      },
    ])

    fireEvent(window, new Event('focus'))

    await waitFor(() => {
      expect(screen.getAllByText('Beta').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
      expect(getButtonByText('Open Terminal')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument()
    })
  })

  it('routes add server actions through SPA navigation', async () => {
    listServersMock.mockResolvedValue([])

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/resources/servers',
      search: { create: '1' },
    })
  })

  it('keeps the active-session resume action working for connected servers', async () => {
    listTerminalSessionsMock.mockResolvedValue([
      {
        id: 'tab-1',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-1',
        session_type: 'ssh',
        state: 'detached',
        started_at: new Date(Date.now() - 60 * 1000).toISOString(),
        last_active_at: new Date().toISOString(),
        workspace: {
          side_panel: 'files',
          file_path: '/var/log',
          locked_root: '/var',
          split_ratio: 0.4,
        },
      },
    ])

    renderPage()

    await screen.findByText('Active Sessions')
    const resumeButtons = screen.getAllByRole('button', { name: 'Resume' })
    fireEvent.click(resumeButtons[0])

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/terminal/server/$serverId',
        params: { serverId: 'srv-1' },
        search: {
          sessionId: 'tab-1',
          panel: 'files',
          path: '/var/log',
          lockedRoot: '/var',
          split: 0.4,
        },
      })
    })

    expect(checkServerStatusMock).not.toHaveBeenCalled()
  })

  it('restores all active sessions into a workspace from the active sessions header', async () => {
    listTerminalSessionsMock.mockResolvedValue([
      {
        id: 'tab-older',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-1',
        session_type: 'ssh',
        state: 'detached',
        started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        last_active_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        workspace: {
          side_panel: 'files',
          file_path: '/var/log',
          locked_root: '/var',
          split_ratio: 0.35,
        },
      },
      {
        id: 'tab-newer',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-2',
        session_type: 'ssh',
        state: 'attached',
        started_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        last_active_at: new Date(Date.now() - 60 * 1000).toISOString(),
        workspace: {},
      },
    ])

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Restore Workspace' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/terminal/server/$serverId',
        params: { serverId: 'srv-2' },
        search: {
          activeSessionId: 'tab-newer',
          restoreSessions: [
            {
              sessionId: 'tab-newer',
              serverId: 'srv-2',
              title: 'Beta',
              panel: undefined,
              path: undefined,
              lockedRoot: undefined,
              split: undefined,
            },
            {
              sessionId: 'tab-older',
              serverId: 'srv-1',
              title: 'Alpha',
              panel: 'files',
              path: '/var/log',
              lockedRoot: '/var',
              split: 0.35,
            },
          ],
        },
      })
    })
  })

  it('prefers saved workspace tab order and active session when restoring all sessions', async () => {
    localStorage.setItem(
      'connect.workspace.v1',
      JSON.stringify({
        tabs: [
          { sessionId: 'tab-older', serverId: 'srv-1', title: 'Alpha saved' },
          { sessionId: 'tab-newer', serverId: 'srv-2', title: 'Beta saved' },
        ],
        activeSessionId: 'tab-older',
        workspaceBySessionId: {
          'tab-older': {
            panel: 'files',
            path: '/srv/app',
            lockedRoot: '/srv',
            split: 0.42,
          },
        },
        updatedAt: Date.now(),
      })
    )

    listTerminalSessionsMock.mockResolvedValue([
      {
        id: 'tab-newer',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-2',
        session_type: 'ssh',
        state: 'attached',
        started_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        last_active_at: new Date(Date.now() - 60 * 1000).toISOString(),
        workspace: {},
      },
      {
        id: 'tab-older',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-1',
        session_type: 'ssh',
        state: 'detached',
        started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        last_active_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        workspace: {},
      },
    ])

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Restore Workspace' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/terminal/server/$serverId',
        params: { serverId: 'srv-1' },
        search: {
          activeSessionId: 'tab-older',
          restoreSessions: [
            {
              sessionId: 'tab-older',
              serverId: 'srv-1',
              title: 'Alpha saved',
              panel: 'files',
              path: '/srv/app',
              lockedRoot: '/srv',
              split: 0.42,
            },
            {
              sessionId: 'tab-newer',
              serverId: 'srv-2',
              title: 'Beta saved',
              panel: undefined,
              path: undefined,
              lockedRoot: undefined,
              split: undefined,
            },
          ],
        },
      })
    })
  })

  it('opens a connected server from the left list as a fresh terminal entry', async () => {
    listTerminalSessionsMock.mockResolvedValue([
      {
        id: 'tab-1',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-1',
        session_type: 'ssh',
        state: 'attached',
        started_at: new Date(Date.now() - 60 * 1000).toISOString(),
        last_active_at: new Date().toISOString(),
        workspace: {},
      },
    ])

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Open Terminal' }).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Terminal' })[0])

    await waitFor(
      () => {
        expect(checkServerStatusMock).toHaveBeenCalled()
        expect(navigateMock).toHaveBeenCalledWith({
          to: '/terminal/server/$serverId',
          params: { serverId: 'srv-1' },
          search: {},
        })
      },
      { timeout: 3000 }
    )
  })

  it('shows the Server Terminal header and no deprecated capability tabs', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Server Terminal' })).toBeInTheDocument()
    })

    expect(
      screen.getByText('Open, resume, and manage server terminals with shell and files.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Servers')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cloud' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Databases' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'APIs' })).not.toBeInTheDocument()
  })

  it('shows connected servers in the left list and filters offline servers out', async () => {
    listServersMock.mockResolvedValue([
      { id: 'srv-1', name: 'Alpha', host: '10.0.0.1', access_status: 'available' },
      { id: 'srv-2', name: 'Beta', host: '10.0.0.2', access_status: 'unavailable' },
    ])
    listTerminalSessionsMock.mockResolvedValue([
      {
        id: 'tab-1',
        user_id: 'user-1',
        resource_type: 'server',
        resource_id: 'srv-1',
        session_type: 'ssh',
        state: 'attached',
        started_at: new Date(Date.now() - 60 * 1000).toISOString(),
        last_active_at: new Date().toISOString(),
        workspace: {},
      },
    ])

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
      expect(getButtonByText('Open Terminal')).toBeInTheDocument()
    })

    expect(screen.queryAllByText('Beta')).toHaveLength(0)
  })

  it('refreshes servers and sessions from the header refresh action', async () => {
    renderPage()

    await screen.findByRole('heading', { name: 'Server Terminal' })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(listServersMock).toHaveBeenCalledTimes(2)
      expect(listTerminalSessionsMock).toHaveBeenCalledTimes(2)
    })
  })

  it('allows explicitly exiting an active terminal session from the list', async () => {
    listTerminalSessionsMock
      .mockResolvedValueOnce([
        {
          id: 'tab-1',
          user_id: 'user-1',
          resource_type: 'server',
          resource_id: 'srv-1',
          session_type: 'ssh',
          state: 'attached',
          started_at: new Date(Date.now() - 60 * 1000).toISOString(),
          last_active_at: new Date().toISOString(),
          workspace: {},
        },
      ])
      .mockResolvedValueOnce([])

    renderPage()

    const exitButtons = await screen.findAllByRole('button', { name: /exit/i })
    fireEvent.click(exitButtons[0])

    await waitFor(() => {
      expect(deleteTerminalSessionMock).toHaveBeenCalledWith('tab-1')
      expect(listTerminalSessionsMock).toHaveBeenCalledTimes(2)
    })
  })
})