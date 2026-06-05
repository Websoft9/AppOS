import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServerOverviewTab } from './ServerOverviewTab'
import { type ServerFactsView } from './server-detail-shared'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'servers.overview.sections.metadata': 'Server Metadata',
        'servers.overview.sections.cloudProvider': 'Cloud Provider',
        'servers.overview.sections.systemInformation': 'System Information',
        'servers.overview.actions.refresh': 'Refresh overview data',
        'servers.overview.actions.edit': 'Edit',
        'servers.overview.fields.id': 'ID',
        'servers.overview.fields.name': 'Name',
        'servers.overview.fields.connectionType': 'Connection Type',
        'servers.overview.fields.host': 'Host',
        'servers.overview.fields.port': 'Port',
        'servers.overview.fields.user': 'User',
        'servers.overview.fields.access': 'Access',
        'servers.overview.fields.tunnelState': 'Tunnel State',
        'servers.overview.fields.credentialType': 'Credential type',
        'servers.overview.fields.createdBy': 'Created By',
        'servers.overview.fields.description': 'Description',
        'servers.overview.fields.created': 'Created',
        'servers.overview.fields.updated': 'Updated',
        'servers.overview.fields.operatingSystem': 'Operating System',
        'servers.overview.fields.kernel': 'Kernel',
        'servers.overview.fields.architecture': 'Architecture',
        'servers.overview.fields.cpuCores': 'CPU Cores',
        'servers.overview.fields.memory': 'Memory',
        'servers.overview.fields.factsObserved': 'Facts Observed',
        'servers.overview.fields.provider': 'Provider',
        'servers.overview.fields.region': 'Region',
        'servers.overview.fields.zone': 'Zone',
        'servers.overview.fields.source': 'Source',
        'servers.overview.connection.direct': 'Direct',
        'servers.connection.tunnelShort': 'Tunnel',
        'servers.overview.credentialTypes.password': 'Password',
        'servers.overview.credentialTypes.sshKey': 'SSH key',
        'servers.overview.fallback.unavailable': 'Unavailable',
        'servers.overview.empty.noFacts': 'No host facts have been collected for this server yet.',
        'servers.overview.cloudSources.cloudInit': 'Cloud-init',
        'servers.overview.cloudSources.metadata': 'Metadata',
        'servers.overview.cloudSources.manual': 'Manual',
      }
      return labels[key] ?? key
    },
  }),
}))

afterEach(() => {
  cleanup()
})

const baseItem = {
  id: 'server-1',
  name: 'alpha',
  host: '10.0.0.1',
  port: 22,
  user: 'root',
  created: '2026-04-16T00:00:00Z',
  updated: '2026-04-16T01:00:00Z',
  description: 'Primary app host',
}

const facts: ServerFactsView = {
  operatingSystem: 'ubuntu 24.04',
  kernelRelease: '6.8.0',
  architecture: 'amd64',
  cpuCores: '4',
  memoryTotal: '8.0 GiB',
  observedAt: new Date('2026-04-16T01:02:03Z').toLocaleString(),
  hasFacts: true,
}

const createdAtLabel = new Date(baseItem.created).toLocaleString()
const updatedAtLabel = new Date(baseItem.updated).toLocaleString()

describe('ServerOverviewTab', () => {
  it('renders server metadata and collected system facts', () => {
    const onEditServer = vi.fn()
    const onRefresh = vi.fn()
    render(
      <ServerOverviewTab
        item={baseItem}
        serverId="server-1"
        facts={facts}
        status="online"
        tunnelState="ready"
        isTunnel={false}
        credentialType="Password"
        credentialId="secret-1"
        createdBy="owner@example.com"
        onEditServer={onEditServer}
        onRefresh={onRefresh}
      />
    )

    expect(screen.getByText('Server Metadata')).toBeInTheDocument()
    expect(screen.getByText('Cloud Provider')).toBeInTheDocument()
    expect(screen.getByText('System Information')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Direct')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('Credential type')).toBeInTheDocument()
    expect(screen.getByText('Password')).toBeInTheDocument()
    expect(screen.queryByText('secret-1')).not.toBeInTheDocument()
    expect(screen.getByText('Primary app host')).toBeInTheDocument()
    expect(screen.getByText('ubuntu 24.04')).toBeInTheDocument()
    expect(screen.getByText('6.8.0')).toBeInTheDocument()
    expect(screen.getByText('amd64')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('8.0 GiB')).toBeInTheDocument()
    expect(screen.getByText(facts.observedAt)).toBeInTheDocument()
    expect(screen.getByText(createdAtLabel)).toBeInTheDocument()
    expect(screen.getByText(updatedAtLabel)).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview data' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEditServer).toHaveBeenCalledTimes(1)
  })

  it('shows a loading refresh button state when overview refresh is in progress', () => {
    render(
      <ServerOverviewTab
        item={baseItem}
        serverId="server-1"
        facts={facts}
        status="online"
        tunnelState="ready"
        isTunnel={false}
        credentialType="Password"
        credentialId="secret-1"
        createdBy="owner@example.com"
        onRefresh={() => {}}
        refreshLoading={true}
      />
    )

    expect(screen.getByRole('button', { name: 'Refresh overview data' })).toBeDisabled()
  })

  it('places ID, Name, and Connection Type first, and Created and Updated last in server metadata', () => {
    const { container } = render(
      <ServerOverviewTab
        item={baseItem}
        serverId="server-1"
        facts={facts}
        status="online"
        tunnelState="ready"
        isTunnel={false}
        credentialType="Password"
        credentialId="secret-1"
        createdBy="owner@example.com"
      />
    )

    const metadataSection = screen.getByText('Server Metadata').closest('section')
    const labels = Array.from(metadataSection?.querySelectorAll('dt') ?? []).map(node =>
      node.textContent?.trim()
    )

    expect(labels.slice(0, 3)).toEqual(['ID', 'Name', 'Connection Type'])
    expect(labels.slice(-2)).toEqual(['Created', 'Updated'])
    expect(container.querySelector('a[href*="secret-1"]')).toBeNull()
  })

  it('normalizes SSH credentials to the SSH key label', () => {
    render(
      <ServerOverviewTab
        item={baseItem}
        serverId="server-1"
        facts={facts}
        status="online"
        tunnelState="ready"
        isTunnel={false}
        credentialType="Private Key"
        credentialId="secret-2"
        createdBy="owner@example.com"
      />
    )

    expect(screen.getByText('SSH key')).toBeInTheDocument()
    expect(screen.queryByText('secret-2')).not.toBeInTheDocument()
  })

  it('shows tunnel metadata and empty facts state when host facts are missing', () => {
    render(
      <ServerOverviewTab
        item={baseItem}
        serverId="server-1"
        facts={{ ...facts, hasFacts: false }}
        status="unknown"
        tunnelState="paused"
        isTunnel={true}
        credentialType="—"
        credentialId=""
        createdBy="owner@example.com"
      />
    )

    expect(screen.getByText('Tunnel')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(
      screen.getByText('No host facts have been collected for this server yet.')
    ).toBeInTheDocument()
  })

  it('renders provider name and region when server metadata includes cloud fields', () => {
    render(
      <ServerOverviewTab
        item={{
          ...baseItem,
          cloud_provider_name: 'AWS',
          cloud_region: 'ap-southeast-1',
          cloud_zone: 'ap-southeast-1a',
          cloud_provider_source: 'cloud-init',
        }}
        serverId="server-1"
        facts={facts}
        status="online"
        tunnelState="ready"
        isTunnel={false}
        credentialType="Password"
        credentialId="secret-1"
        createdBy="owner@example.com"
      />
    )

    expect(screen.getByText('AWS')).toBeInTheDocument()
    expect(screen.getByText('ap-southeast-1')).toBeInTheDocument()
    expect(screen.getByText('ap-southeast-1a')).toBeInTheDocument()
    expect(screen.getByText('Cloud-init')).toBeInTheDocument()
  })
})
