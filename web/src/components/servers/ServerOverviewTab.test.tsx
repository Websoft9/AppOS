import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServerOverviewTab } from './ServerOverviewTab'
import { type ServerFactsView } from './server-detail-shared'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
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

describe('ServerOverviewTab', () => {
  it('renders server metadata and collected system facts', () => {
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
      />
    )

    expect(screen.getByText('Server Metadata')).toBeInTheDocument()
    expect(screen.getByText('System Information')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Direct')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('secret-1')).toBeInTheDocument()
    expect(screen.getByText('Primary app host')).toBeInTheDocument()
    expect(screen.getByText('ubuntu 24.04')).toBeInTheDocument()
    expect(screen.getByText('6.8.0')).toBeInTheDocument()
    expect(screen.getByText('amd64')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('8.0 GiB')).toBeInTheDocument()
    expect(screen.getByText(facts.observedAt)).toBeInTheDocument()
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
    expect(screen.getByText('No host facts have been collected for this server yet.')).toBeInTheDocument()
  })
})