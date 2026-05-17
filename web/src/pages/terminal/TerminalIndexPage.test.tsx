import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalIndexPage } from './TerminalIndexPage'
import { TooltipProvider } from '@/components/ui/tooltip'

const navigateMock = vi.fn()
const listServersMock = vi.fn()
const checkServerStatusMock = vi.fn()
const getConnectTerminalSettingsMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/lib/connect-api', () => ({
  listServers: (...args: unknown[]) => listServersMock(...args),
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
    checkServerStatusMock.mockReset()
    getConnectTerminalSettingsMock.mockReset()
    localStorage.clear()

    listServersMock.mockResolvedValue([
      { id: 'srv-1', name: 'Alpha', host: '10.0.0.1' },
      { id: 'srv-2', name: 'Beta', host: '10.0.0.2' },
    ])
    checkServerStatusMock.mockResolvedValue({ status: 'online' })
    getConnectTerminalSettingsMock.mockResolvedValue({
      idleTimeoutSeconds: 60,
      maxConnections: 0,
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows idle and multi-session badges for saved terminal sessions', async () => {
    localStorage.setItem(
      'connect.session.v1',
      JSON.stringify({
        tabs: [
          { id: 'tab-1', serverId: 'srv-1', title: 'Alpha', reconnectNonce: 0 },
          { id: 'tab-2', serverId: 'srv-1', title: 'Alpha', reconnectNonce: 0 },
        ],
        activeTabId: 'tab-1',
        updatedAt: Date.now() - 5 * 60 * 1000,
      })
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Connected Resources')).toBeInTheDocument()
      expect(screen.getAllByText('Idle').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('2 sessions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Idle session').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Last active/i).length).toBeGreaterThan(0)
  })

  it('refreshes the hub when a saved connect session appears after focus returns', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No active connections')).toBeInTheDocument()
    })

    localStorage.setItem(
      'connect.session.v1',
      JSON.stringify({
        tabs: [{ id: 'tab-1', serverId: 'srv-2', title: 'Beta', reconnectNonce: 0 }],
        activeTabId: 'tab-1',
        updatedAt: Date.now(),
      })
    )

    fireEvent(window, new Event('focus'))

    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeInTheDocument()
      expect(screen.getByText('Connected')).toBeInTheDocument()
      expect(screen.getByText('1 active session')).toBeInTheDocument()
    })
  })

  it('keeps the resume action working for connected servers', async () => {
    localStorage.setItem(
      'connect.session.v1',
      JSON.stringify({
        tabs: [{ id: 'tab-1', serverId: 'srv-1', title: 'Alpha', reconnectNonce: 0 }],
        activeTabId: 'tab-1',
        updatedAt: Date.now(),
      })
    )

    renderPage()

    const resumeButton = await screen.findByRole('button', { name: /resume/i })
    fireEvent.click(resumeButton)

    await waitFor(() => {
      expect(checkServerStatusMock).toHaveBeenCalled()
    })

    await new Promise(resolve => setTimeout(resolve, 2100))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/terminal/server/$serverId',
        params: { serverId: 'srv-1' },
        search: {},
      })
    })
  })
})