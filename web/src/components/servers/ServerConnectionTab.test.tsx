import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ServerConnectionActionId,
  ServerConnectionPresentationSpec,
  ServerDetailTab,
} from './server-connection-presentation'
import { ServerConnectionTab } from './ServerConnectionTab'

afterEach(() => {
  cleanup()
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
  it('renders tunnel-specific sections and triggers callback actions', () => {
    const executePrimaryAction = vi.fn<(item: Record<string, unknown>, actionId: ServerConnectionActionId) => void>()
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

    expect(screen.getByText('Connection Summary')).toBeInTheDocument()
    expect(screen.getByText('Primary Next Step')).toBeInTheDocument()
    expect(screen.getByText('Mode-Specific Setup or Recovery')).toBeInTheDocument()
    expect(screen.getByText('Tunnel Services')).toBeInTheDocument()
    expect(screen.getByText('Port 2201')).toBeInTheDocument()
    expect(screen.getByText('Diagnostics')).toBeInTheDocument()
    expect(screen.getByText('Activity Timeline')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Terminal' })[0])
    expect(executePrimaryAction).toHaveBeenCalledWith(baseItem, 'open_terminal')

    fireEvent.click(screen.getByRole('button', { name: 'View Details' }))
    expect(openTab).toHaveBeenCalledWith(baseItem, 'overview')
  })

  it('renders direct-ssh recovery details without tunnel services', () => {
    render(
      <ServerConnectionTab
        item={baseItem}
        presentation={{
          ...basePresentation,
          state: 'needs_attention',
          stateLabel: 'Needs Attention',
          reason: 'SSH access is failing.',
          modeLabel: 'Direct SSH',
          primaryActionDescription: 'SSH access needs recovery before workspace access is available.',
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

    expect(screen.getByText('Configuration')).toBeInTheDocument()
    expect(screen.getByText('Direct SSH')).toBeInTheDocument()
    expect(screen.getByText(/Host 10.0.0.1/)).toBeInTheDocument()
    expect(screen.getByText(/Source: ssh_probe/)).toBeInTheDocument()
    expect(screen.getAllByText('SSH access is failing.').length).toBeGreaterThan(0)
    expect(screen.queryByText('Tunnel Services')).toBeNull()
  })
})