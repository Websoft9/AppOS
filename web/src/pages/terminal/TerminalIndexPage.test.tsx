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
      { id: 'srv-1', name: 'Alpha', host: '10.0.0.1' },
      { id: 'srv-2', name: 'Beta', host: '10.0.0.2' },
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
      expect(screen.getByText('Connected Resources')).toBeInTheDocument()
      expect(screen.getAllByText('Idle').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('2 sessions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Idle session').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Last active/i).length).toBeGreaterThan(0)
  })

  it('refreshes the hub when a backend terminal session appears after focus returns', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No active connections')).toBeInTheDocument()
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
      expect(screen.getByText('Beta')).toBeInTheDocument()
      expect(screen.getByText('Connected')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument()
    })
  })

  it('routes add server actions through SPA navigation', async () => {
    listServersMock.mockResolvedValue([])

    renderPage()

    const buttons = await screen.findAllByRole('button')
    fireEvent.click(buttons[2])
    fireEvent.click(await screen.findByRole('button', { name: 'Servers' }))

    const addServerButtons = await screen.findAllByRole('button', { name: 'Add Server' })
    fireEvent.click(addServerButtons[0])

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/resources/servers',
      search: { create: '1' },
    })
  })

  it('keeps the resume action working for connected servers', async () => {
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

    const resumeButton = await screen.findByRole('button', { name: /resume/i })
    fireEvent.click(resumeButton)

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