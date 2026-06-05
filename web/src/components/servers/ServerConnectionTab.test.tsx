import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ServerConnectionActionId,
  ServerConnectionPresentationSpec,
  ServerDetailTab,
} from './server-connection-presentation'
import { ServerConnectionTab } from './ServerConnectionTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'servers.connectionTab.state.connected': 'Connected',
        'servers.connectionTab.state.connecting': 'Connecting',
        'servers.connectionTab.state.needsAttention': 'Needs Attention',
        'servers.connectionTab.reason.tunnelActive': 'Tunnel session is active.',
        'servers.connectionTab.reason.sshVerified': 'SSH access is reachable.',
        'servers.connectionTab.fields.connectionStatus': 'Connection Status',
        'servers.connectionTab.fields.mode': 'Mode',
        'servers.connectionTab.fields.interactiveSession': 'Interactive Session',
        'servers.connectionTab.fields.lastActivity': 'Last Activity',
        'servers.connectionTab.fields.recommendedAction': 'Recommended Action',
        'servers.connectionTab.modeSummary.tunnelRelay': 'Tunnel relay',
        'servers.connectionTab.modeSummary.directSsh': 'Direct SSH',
        'servers.connectionTab.sessions.none': 'None',
        'servers.connectionTab.sessions.oneActive': '1 active session',
        'servers.connectionTab.hero.tunnelLive': 'Connected',
        'servers.connectionTab.hero.directReady': 'Connected',
        'servers.connectionTab.hero.waitingFirstTunnelCallback': 'Connecting',
        'servers.connectionTab.hero.setupInProgress': 'Connecting',
        'servers.connectionTab.hero.tunnelNeedsAttention': 'Needs Attention',
        'servers.connectionTab.hero.connectionNeedsAttention': 'Needs Attention',
        'servers.connectionTab.subline.remoteAccessAvailable':
          'The tunnel is healthy and ready for workspace access.',
        'servers.connectionTab.subline.serverReachable':
          'The tunnel is healthy and ready for workspace access.',
        'servers.connectionTab.subline.restoreAccess':
          'SSH access needs recovery before workspace access is available.',
        'servers.connectionTab.activityLog.title': 'Activity Log',
        'servers.connectionTab.activityLog.empty': 'No recent activity yet.',
        'servers.connectionTab.activityLog.mostRecent': 'Most recent',
        'servers.connectionTab.activity.heartbeatReceived': 'Heartbeat received',
        'servers.connectionTab.activity.connected': 'Connected',
      }
      if (key === 'servers.connectionTab.reason.lastHeartbeat') {
        return `Last heartbeat ${String(options?.time ?? '')}`
      }
      if (key === 'servers.connectionTab.sessions.manyActive') {
        return `${String(options?.count ?? '')} active sessions`
      }
      return labels[key] ?? key
    },
  }),
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const baseItem = {
  id: 'server-1',
  host: '10.0.0.1',
  port: 22,
  user: 'root',
}

const basePresentation: ServerConnectionPresentationSpec = {
  state: 'online',
  stateLabel: 'Online',
  reason: 'Tunnel session is active.',
  modeLabel: 'Tunnel',
  accessStatus: 'online',
  tunnelState: 'ready',
  endpointSummary: 'ssh://alpha.example:2201',
  identitySummary: 'alpha',
  lastActivityLabel: new Date('2026-04-16T01:00:00Z').toLocaleString(),
  lastActivityAt: '2026-04-16T01:00:00Z',
  primaryAction: { id: 'open_terminal', label: 'Open Terminal' },
  primaryActionDescription: 'The tunnel is healthy and ready for workspace access.',
  secondaryActions: [{ id: 'view_details', label: 'View Details', tab: 'overview' }],
  stateActions: [],
  toolActions: [],
  diagnostics: {
    latestCheckResult: 'Online',
    evidenceSource: 'tunnel_runtime',
    latestFailureReason: '—',
    latestTunnelCallbackOrHeartbeat: new Date('2026-04-16T01:01:00Z').toLocaleString(),
    pauseUntil: '—',
    currentReason: 'Tunnel session is active.',
  },
  timeline: [{ label: 'last healthy seen', at: new Date('2026-04-16T01:01:00Z').toLocaleString() }],
}

describe('ServerConnectionTab', () => {
  it('renders the minimal tunnel connection layout and triggers the primary action', () => {
    const executePrimaryAction =
      vi.fn<(item: Record<string, unknown>, actionId: ServerConnectionActionId) => void>()
    const openTab = vi.fn<(item: Record<string, unknown>, tab?: ServerDetailTab) => void>()

    render(
      <ServerConnectionTab
        item={baseItem}
        presentation={basePresentation}
        isTunnel={true}
        tunnelState="ready"
        tunnel={{ last_seen: '2026-04-16T01:01:00Z', reason: '' }}
        services={[{ service_name: 'ssh', tunnel_port: 2201 }]}
        onExecutePrimaryAction={executePrimaryAction}
        onOpenTab={openTab}
      />
    )

    const heartbeatLabel = new Date('2026-04-16T01:01:00Z').toLocaleString()

    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
    expect(screen.getByText('Connection Status')).toBeInTheDocument()
    expect(screen.getByText('Interactive Session')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.getByText(`Last heartbeat ${heartbeatLabel}`)).toBeInTheDocument()
    expect(screen.getByText('Activity Log')).toBeInTheDocument()
    expect(screen.getByText('Heartbeat received')).toBeInTheDocument()
    expect(screen.queryByText('Connection Summary')).toBeNull()
    expect(screen.queryByText('Diagnostics')).toBeNull()
    expect(screen.queryByText('Tunnel Services')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }))
    expect(executePrimaryAction).toHaveBeenCalledWith(baseItem, 'open_terminal')
    expect(openTab).not.toHaveBeenCalled()
  })

  it('renders direct-ssh recovery in the same minimal layout', () => {
    render(
      <ServerConnectionTab
        item={baseItem}
        presentation={{
          ...basePresentation,
          state: 'needs_attention',
          stateLabel: 'Needs Attention',
          reason: 'SSH access is failing.',
          modeLabel: 'Direct SSH',
          primaryActionDescription:
            'SSH access needs recovery before workspace access is available.',
          diagnostics: {
            ...basePresentation.diagnostics,
            evidenceSource: 'ssh_probe',
            latestFailureReason: 'connection refused',
            currentReason: 'SSH access is failing.',
          },
        }}
        isTunnel={false}
        tunnelState="none"
        tunnel={null}
        services={[]}
        onExecutePrimaryAction={vi.fn()}
        onOpenTab={vi.fn()}
      />
    )

    expect(screen.getAllByText('Needs Attention').length).toBeGreaterThan(0)
    expect(screen.getByText('SSH access is failing.')).toBeInTheDocument()
    expect(screen.getByText('Activity Log')).toBeInTheDocument()
    expect(screen.queryByText('Configuration')).toBeNull()
    expect(screen.queryByText('Tunnel Services')).toBeNull()
  })

  it('shows active interactive sessions from saved terminal state', () => {
    window.localStorage.setItem(
      'connect.session.v1',
      JSON.stringify({
        tabs: [{ id: 'tab-1', serverId: 'server-1', title: 'root@server', reconnectNonce: 1 }],
        activeTabId: 'tab-1',
        updatedAt: Date.now(),
      })
    )

    render(
      <ServerConnectionTab
        item={baseItem}
        presentation={basePresentation}
        isTunnel={true}
        tunnelState="ready"
        tunnel={{ last_seen: '2026-04-16T01:01:00Z', reason: '' }}
        services={[]}
        onExecutePrimaryAction={vi.fn()}
        onOpenTab={vi.fn()}
      />
    )

    expect(screen.getByText('1 active session')).toBeInTheDocument()
  })
})
