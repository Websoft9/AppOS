import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerMonitorTab } from './ServerMonitorTab'

const getSystemdStatusMock = vi.fn()
const sendMock = vi.fn()

vi.mock('@/lib/connect-api', () => ({
  getSystemdStatus: (...args: unknown[]) => getSystemdStatusMock(...args),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/monitor/MonitorTargetPanel', () => ({
  MonitorTargetPanel: ({
    targetId,
    emptyMessage,
    layout,
    metricsPipelineAction,
  }: {
    targetId: string
    emptyMessage: string
    layout?: string
    metricsPipelineAction?: { label: string; onClick: () => void }
  }) => (
    <div>
      <div>Monitor panel for {targetId}</div>
      <div>Monitor panel layout {layout}</div>
      <div>{emptyMessage}</div>
      {metricsPipelineAction ? (
        <button type="button" onClick={metricsPipelineAction.onClick}>
          {metricsPipelineAction.label}
        </button>
      ) : null}
    </div>
  ),
}))

afterEach(() => {
  cleanup()
})

describe('ServerMonitorTab', () => {
  beforeEach(() => {
    getSystemdStatusMock.mockReset()
    sendMock.mockReset()
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
    sendMock.mockResolvedValue({
      hasData: true,
      targetType: 'server',
      targetId: 'server-1',
      displayName: 'alpha',
      status: 'healthy',
      reason: null,
      signalSource: 'netdata',
      lastTransitionAt: '2026-05-20T06:00:00Z',
      summary: {},
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
    expect(screen.getAllByText(/Updated \d{2}:\d{2}:\d{2}/).length).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: 'Delete conclusion Resource pressure' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Monitor agent runtime')).toBeNull()
    expect(screen.getByText('Monitor panel for server-1')).toBeInTheDocument()
    expect(screen.getByText('Monitor panel layout detail')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No monitoring data available yet for alpha. Current connectivity status is online.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete conclusion Resource pressure' }))
    expect(screen.queryByText('Resource pressure')).toBeNull()
  })

  it('shows a waiting hint while the monitor agent is active but first metrics have not arrived yet', async () => {
    sendMock.mockResolvedValueOnce({
      hasData: false,
      targetType: 'server',
      targetId: 'server-1',
      displayName: 'alpha',
      status: 'unknown',
      reason: 'server monitoring has not collected evidence yet',
      signalSource: 'inventory',
      lastTransitionAt: '2026-05-20T06:00:00Z',
      summary: {
        monitoring_state: 'awaiting_control_plane_pull',
      },
    })

    render(<ServerMonitorTab serverId="server-1" serverName="alpha" connectionStatus="online" />)

    expect(await screen.findByText('Monitoring active · waiting for first sample')).toBeInTheDocument()
  })

  it('routes metrics pipeline repair to monitor-agent reinstall', async () => {
    const onMonitorAgentAction = vi.fn()

    render(
      <ServerMonitorTab
        serverId="server-1"
        serverName="alpha"
        connectionStatus="online"
        onMonitorAgentAction={onMonitorAgentAction}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Repair monitor agent' }))

    expect(onMonitorAgentAction).toHaveBeenCalledWith('reinstall')
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
