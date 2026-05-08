import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerMonitorTab } from './ServerMonitorTab'

const getSystemdStatusMock = vi.fn()
const installMonitorAgentMock = vi.fn()
const updateMonitorAgentMock = vi.fn()

vi.mock('@/lib/connect-api', () => ({
  getSystemdStatus: (...args: unknown[]) => getSystemdStatusMock(...args),
  installMonitorAgent: (...args: unknown[]) => installMonitorAgentMock(...args),
  updateMonitorAgent: (...args: unknown[]) => updateMonitorAgentMock(...args),
}))

vi.mock('@/components/monitor/MonitorTargetPanel', () => ({
  MonitorTargetPanel: ({ targetId, emptyMessage }: { targetId: string; emptyMessage: string }) => (
    <div>
      <div>Monitor panel for {targetId}</div>
      <div>{emptyMessage}</div>
    </div>
  ),
}))

afterEach(() => {
  cleanup()
})

describe('ServerMonitorTab', () => {
  beforeEach(() => {
    getSystemdStatusMock.mockReset()
    installMonitorAgentMock.mockReset()
    updateMonitorAgentMock.mockReset()
    getSystemdStatusMock.mockResolvedValue({
      server_id: 'server-1',
      service: 'netdata',
      status: {
        ActiveState: 'active',
        SubState: 'running',
        UnitFileState: 'enabled',
      },
      status_text: 'netdata.service - Netdata',
    })
    installMonitorAgentMock.mockResolvedValue({
      packaged_version: '1.45.0',
      systemd: { ActiveState: 'active', SubState: 'running', UnitFileState: 'enabled' },
      status_text: 'netdata.service - Netdata',
    })
    updateMonitorAgentMock.mockResolvedValue({
      packaged_version: '1.45.1',
      systemd: { ActiveState: 'active', SubState: 'running', UnitFileState: 'enabled' },
      status_text: 'netdata.service - Netdata',
    })
  })

  it('renders the monitor tab with netdata status and monitor panel empty message', async () => {
    render(
      <ServerMonitorTab
        serverId="server-1"
        serverName="alpha"
        connectionStatus="online"
      />
    )

    expect(await screen.findByText('Netdata Agent')).toBeInTheDocument()
    expect(getSystemdStatusMock).toHaveBeenCalledWith('server-1', 'netdata')
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('enabled')).toBeInTheDocument()
    expect(screen.getByText('Monitor panel for server-1')).toBeInTheDocument()
    expect(
      screen.getByText('No monitoring data available yet for alpha. Current connectivity status is online.')
    ).toBeInTheDocument()
  })

  it('runs install action and shows the completion message', async () => {
    render(
      <ServerMonitorTab
        serverId="server-1"
        serverName="alpha"
        connectionStatus="online"
      />
    )

    expect(await screen.findByText('Netdata Agent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install Netdata' }))

    await waitFor(() => {
      expect(installMonitorAgentMock).toHaveBeenCalledWith('server-1', {
        apposBaseUrl: window.location.origin,
      })
    })
    expect(
      await screen.findByText('Install completed for alpha. Netdata version: 1.45.0.')
    ).toBeInTheDocument()
  })
})