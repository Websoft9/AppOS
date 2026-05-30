import { cleanup, render, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectServerPage } from './ConnectServerPage'
import { TooltipProvider } from '@/components/ui/tooltip'

const navigateMock = vi.fn()
const listServersMock = vi.fn()
const listAssetsMock = vi.fn()
const getAssetContentMock = vi.fn()
const getConnectTerminalSettingsMock = vi.fn()
const terminalPanelMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/lib/connect-api', () => ({
  listServers: (...args: unknown[]) => listServersMock(...args),
  checkServerStatus: vi.fn(),
  listSystemdServices: vi.fn(),
  getSystemdStatus: vi.fn(),
  getSystemdLogs: vi.fn(),
  getSystemdContent: vi.fn(),
  getSystemdUnit: vi.fn(),
  updateSystemdUnit: vi.fn(),
  verifySystemdUnit: vi.fn(),
  applySystemdUnit: vi.fn(),
  controlSystemdService: vi.fn(),
  getConnectTerminalSettings: (...args: unknown[]) => getConnectTerminalSettingsMock(...args),
}))

vi.mock('@/lib/assets-api', () => ({
  listAssets: (...args: unknown[]) => listAssetsMock(...args),
  getAssetContent: (...args: unknown[]) => getAssetContentMock(...args),
}))

vi.mock('@/components/connect/TerminalPanel', () => ({
  TerminalPanel: (props: unknown) => {
    terminalPanelMock(props)
    return <div data-testid="terminal-panel" />
  },
}))

vi.mock('@/components/connect/FileManagerPanel', () => ({
  FileManagerPanel: () => <div data-testid="file-manager-panel" />,
}))

describe('ConnectServerPage', () => {
  function renderPage(node: ReactNode) {
    return render(<TooltipProvider>{node}</TooltipProvider>)
  }

  beforeEach(() => {
    navigateMock.mockReset()
    listServersMock.mockReset()
    listAssetsMock.mockReset()
    getAssetContentMock.mockReset()
    getConnectTerminalSettingsMock.mockReset()
    terminalPanelMock.mockReset()
    localStorage.clear()

    listServersMock.mockResolvedValue([{ id: 'srv-1', name: 'Alpha', host: '10.0.0.1' }])
    listAssetsMock.mockResolvedValue([])
    getAssetContentMock.mockResolvedValue({
      id: 'asset-1',
      storage_kind: 'file',
      path: 'main.sh',
      entrypoint: 'main.sh',
      content: 'echo hello',
    })
    getConnectTerminalSettingsMock.mockResolvedValue({
      idleTimeoutSeconds: 1800,
      maxConnections: 0,
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('clears the persisted connect session when the page unmounts', () => {
    localStorage.setItem(
      'connect.session.v1',
      JSON.stringify({
        tabs: [{ id: 'tab-1', serverId: 'srv-1', title: 'Alpha', reconnectNonce: 0 }],
        activeTabId: 'tab-1',
        updatedAt: Date.now(),
      })
    )

    const view = renderPage(<ConnectServerPage serverId="srv-1" />)

    expect(localStorage.getItem('connect.session.v1')).not.toBeNull()

    view.unmount()

    expect(localStorage.getItem('connect.session.v1')).toBeNull()
  })

  it('prefers the route session id when restoring a saved tab for the same server', () => {
    localStorage.setItem(
      'connect.session.v1',
      JSON.stringify({
        tabs: [{ id: 'tab-1', serverId: 'srv-1', title: 'Alpha', reconnectNonce: 0 }],
        activeTabId: 'tab-1',
        updatedAt: Date.now(),
      })
    )

    renderPage(<ConnectServerPage serverId="srv-1" initialSessionId="resume-1" />)

    expect(terminalPanelMock).toHaveBeenCalled()
    expect(terminalPanelMock.mock.calls[0][0]).toMatchObject({
      serverId: 'srv-1',
      sessionId: 'resume-1',
    })
  })

  it('initializes multiple terminal tabs from restore workspace seeds', async () => {
    listServersMock.mockResolvedValue([
      { id: 'srv-1', name: 'Alpha', host: '10.0.0.1' },
      { id: 'srv-2', name: 'Beta', host: '10.0.0.2' },
    ])

    renderPage(
      <ConnectServerPage
        serverId="srv-2"
        initialRestoreSessions={[
          {
            sessionId: 'resume-1',
            serverId: 'srv-1',
            title: 'Alpha',
            panel: 'files',
            path: '/var/log',
            lockedRoot: '/var',
            split: 0.4,
          },
          {
            sessionId: 'resume-2',
            serverId: 'srv-2',
            title: 'Beta',
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(terminalPanelMock.mock.calls).toEqual(
        expect.arrayContaining([
          [expect.objectContaining({ serverId: 'srv-1', sessionId: 'resume-1', isActive: false })],
          [expect.objectContaining({ serverId: 'srv-2', sessionId: 'resume-2', isActive: true })],
        ])
      )
    })
  })

  it('prefers the requested active restore session when initializing restored tabs', async () => {
    listServersMock.mockResolvedValue([
      { id: 'srv-1', name: 'Alpha', host: '10.0.0.1' },
      { id: 'srv-2', name: 'Beta', host: '10.0.0.2' },
    ])

    renderPage(
      <ConnectServerPage
        serverId="srv-2"
        initialActiveRestoreSessionId="resume-1"
        initialRestoreSessions={[
          {
            sessionId: 'resume-1',
            serverId: 'srv-1',
            title: 'Alpha',
          },
          {
            sessionId: 'resume-2',
            serverId: 'srv-2',
            title: 'Beta',
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(terminalPanelMock.mock.calls).toEqual(
        expect.arrayContaining([
          [expect.objectContaining({ serverId: 'srv-1', sessionId: 'resume-1', isActive: true })],
          [expect.objectContaining({ serverId: 'srv-2', sessionId: 'resume-2', isActive: false })],
        ])
      )
    })
  })
})