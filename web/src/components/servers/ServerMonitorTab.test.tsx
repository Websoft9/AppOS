import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerMonitorTab } from './ServerMonitorTab'

const getSystemdStatusMock = vi.fn()

vi.mock('@/lib/connect-api', () => ({
  getSystemdStatus: (...args: unknown[]) => getSystemdStatusMock(...args),
}))

vi.mock('@/components/monitor/MonitorTargetPanel', () => ({
  MonitorTargetPanel: ({
    targetId,
    emptyMessage,
    layout,
  }: {
    targetId: string
    emptyMessage: string
    layout?: string
  }) => (
    <div>
      <div>Monitor panel for {targetId}</div>
      <div>Monitor panel layout {layout}</div>
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
  })

  it('renders quiet monitoring state, current/trend panel, and compact conclusions', async () => {
    render(<ServerMonitorTab serverId="server-1" serverName="alpha" connectionStatus="online" />)

    expect(await screen.findByText('Monitor')).toBeInTheDocument()
    expect(getSystemdStatusMock).toHaveBeenCalledWith('server-1', 'netdata')
    expect(
      screen.getByRole('region', { name: 'Monitor current values and trend history' })
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Monitor conclusions' })).toBeInTheDocument()
    expect(screen.getByText('Monitoring active · running')).toBeInTheDocument()
    expect(screen.getAllByText('Control reachable').length).toBeGreaterThan(0)
    expect(screen.getByText('Trend data available')).toBeInTheDocument()
    expect(screen.getByText('Resource pressure')).toBeInTheDocument()
    expect(screen.queryByText('Monitor agent runtime')).toBeNull()
    expect(screen.getByText('Monitor panel for server-1')).toBeInTheDocument()
    expect(screen.getByText('Monitor panel layout detail')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No monitoring data available yet for alpha. Current connectivity status is online.'
      )
    ).toBeInTheDocument()
  })

  it('shows a strong intervention state and opens Components when the agent is missing', async () => {
    getSystemdStatusMock.mockRejectedValueOnce(new Error('unit netdata.service not found'))
    const onMonitorAgentAction = vi.fn()

    render(
      <ServerMonitorTab
        serverId="server-1"
        serverName="alpha"
        connectionStatus="online"
        onMonitorAgentAction={onMonitorAgentAction}
      />
    )

    expect(
      await screen.findByText('Monitoring is not connected on this server.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Install or repair the monitor agent from Components/)
    ).toBeInTheDocument()
    expect(screen.getByText('No conclusions yet.')).toBeInTheDocument()
    expect(screen.queryByText('Monitor agent runtime')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Install monitor agent' }))

    await waitFor(() => {
      expect(onMonitorAgentAction).toHaveBeenCalledWith('install')
    })
  })
})
