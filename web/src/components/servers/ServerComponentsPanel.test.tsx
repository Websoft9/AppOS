import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerComponentsPanel } from './ServerComponentsPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const listSoftwareComponentsMock = vi.fn()
const getSoftwareComponentMock = vi.fn()
const getSoftwareOperationMock = vi.fn()
const listSoftwareOperationsMock = vi.fn()
const deleteSoftwareOperationMock = vi.fn()
const invokeSoftwareActionMock = vi.fn()
const getConfiguredAppURLMock = vi.fn()

vi.mock('@/lib/software-api', () => ({
  listSoftwareComponents: (...args: unknown[]) => listSoftwareComponentsMock(...args),
  getSoftwareComponent: (...args: unknown[]) => getSoftwareComponentMock(...args),
  getSoftwareOperation: (...args: unknown[]) => getSoftwareOperationMock(...args),
  listSoftwareOperations: (...args: unknown[]) => listSoftwareOperationsMock(...args),
  deleteSoftwareOperation: (...args: unknown[]) => deleteSoftwareOperationMock(...args),
  invokeSoftwareAction: (...args: unknown[]) => invokeSoftwareActionMock(...args),
  getConfiguredAppURL: (...args: unknown[]) => getConfiguredAppURLMock(...args),
}))

afterEach(() => {
  cleanup()
})

describe('ServerComponentsPanel', () => {
  beforeEach(() => {
    listSoftwareComponentsMock.mockReset()
    getSoftwareComponentMock.mockReset()
    getSoftwareOperationMock.mockReset()
    listSoftwareOperationsMock.mockReset()
    deleteSoftwareOperationMock.mockReset()
    invokeSoftwareActionMock.mockReset()
    getConfiguredAppURLMock.mockReset()

    listSoftwareOperationsMock.mockResolvedValue([])
    deleteSoftwareOperationMock.mockResolvedValue(undefined)
    getConfiguredAppURLMock.mockResolvedValue('')

    listSoftwareComponentsMock.mockResolvedValue([
      {
        component_key: 'docker',
        label: 'Docker Engine',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '27.0.1',
        install_source: 'managed',
        source_evidence: 'apt:docker-ce',
        verification_state: 'healthy',
        verification: {
          state: 'healthy',
          checked_at: '2026-04-16T02:03:04Z',
          details: {
            engine_version: '27.0.1',
            compose_available: true,
            compose_version: '2.27.0',
          },
        },
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'upgrade'],
      },
      {
        component_key: 'reverse-proxy',
        label: 'Reverse Proxy',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '1.27.0',
        packaged_version: '1.27.1',
        verification_state: 'degraded',
        preflight: {
          ok: false,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: false,
          issues: ['dependency_not_ready: docker is not ready'],
        },
        last_action: { action: 'verify', result: 'failed', at: '2026-04-16T02:03:04Z' },
        available_actions: ['verify', 'reinstall', 'uninstall'],
      },
    ])

    invokeSoftwareActionMock.mockResolvedValue({
      accepted: true,
      operation_id: 'op-123',
    })
    getSoftwareOperationMock.mockResolvedValue({
      id: 'op-123',
      server_id: 'server-1',
      component_key: 'docker',
      action: 'verify',
      phase: 'succeeded',
      terminal_status: 'success',
      failure_reason: '',
      event_log:
        '2026-04-16T02:03:04Z · Accepted verify request for docker.\n2026-04-16T02:03:10Z · Verification passed.',
      created: '2026-04-16T02:03:04Z',
      updated: '2026-04-16T02:03:10Z',
    })
    getSoftwareComponentMock.mockResolvedValue({
      component_key: 'docker',
      label: 'Docker Engine',
      target_type: 'server',
      template_kind: 'package',
      installed_state: 'installed',
      detected_version: '27.0.1',
      install_source: 'managed',
      source_evidence: 'apt:docker-ce',
      verification_state: 'healthy',
      preflight: {
        ok: true,
        os_supported: true,
        privilege_ok: true,
        network_ok: true,
        dependency_ready: true,
      },
      verification: {
        state: 'healthy',
        checked_at: '2026-04-16T02:03:04Z',
        details: {
          engine_version: '27.0.1',
          compose_available: true,
          compose_version: '2.27.0',
        },
      },
      available_actions: ['verify', 'upgrade'],
    })
  })

  it('splits server components into prerequisites and addons', async () => {
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Prerequisites' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()
    expect(screen.getByText('Reverse Proxy')).toBeInTheDocument()
    expect(screen.getByText('reverse-proxy')).toBeInTheDocument()

    const prerequisitesSection = screen.getByRole('region', { name: 'Prerequisites section' })
    expect(
      within(prerequisitesSection).getByRole('button', { name: 'Prerequisites help' })
    ).toBeInTheDocument()
    expect(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    ).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Verified')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Checks passed')).toBeInTheDocument()

    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    expect(
      within(prerequisitesSection).getByText('Install source: Managed (apt:docker-ce)')
    ).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Status:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getAllByText('Verified').length).toBeGreaterThan(0)
    expect(within(prerequisitesSection).getByText('Version:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('27.0.1')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Docker Compose:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('2.27.0')).toBeInTheDocument()
    expect(
      within(prerequisitesSection).getByText('Check Docker Engine installation')
    ).toBeInTheDocument()
    expect(
      within(prerequisitesSection).getByText('Check Docker Compose availability')
    ).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Check OS Support')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Check Privileged Access')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Verification Checklist')).toBeInTheDocument()
    expect(
      within(prerequisitesSection).getByRole('button', { name: 'Recheck' })
    ).toBeInTheDocument()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Upgrade/Fix' })).toBeEnabled()
    expect(within(prerequisitesSection).queryByRole('button', { name: 'Install' })).toBeNull()
    expect(within(prerequisitesSection).queryByText('No corrective action available')).toBeNull()

    expect(
      within(prerequisitesSection).queryByText(
        'Container runtime required for platform-managed workloads.'
      )
    ).toBeNull()

    const addonsSection = screen.getByRole('region', { name: 'Addons section' })
    expect(within(addonsSection).queryByText('Docker Engine')).toBeNull()
    expect(within(addonsSection).getByText('Reverse Proxy')).toBeInTheDocument()
    expect(within(addonsSection).getByRole('button', { name: 'Addons help' })).toBeInTheDocument()
    expect(within(addonsSection).getByText('Artifact')).toBeInTheDocument()
    expect(within(addonsSection).queryByText('Package Type')).toBeNull()

    const inventory = within(addonsSection).getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = within(addonsSection).getByRole('region', { name: 'Selected Addon' })
    expect(
      within(selectedAddon).getByText('dependency_not_ready: docker is not ready')
    ).toBeInTheDocument()
    expect(within(selectedAddon).getByRole('button', { name: 'Repair' })).toBeInTheDocument()
    expect(within(selectedAddon).getByRole('button', { name: 'More actions' })).toBeInTheDocument()
  })

  it('selects the addon details when an inventory action is clicked', async () => {
    const user = userEvent.setup()
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    await user.click(within(inventory).getByRole('button', { name: 'Repair' }))

    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith('server-1', 'reverse-proxy', 'reinstall', {
        apposBaseUrl: window.location.origin,
      })
    })

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    expect(within(selectedAddon).getByText('Reverse Proxy')).toBeInTheDocument()
    expect(within(selectedAddon).getByRole('button', { name: 'Live Log' })).toBeInTheDocument()
  })

  it('shows service status and AppOS connection for reporting-aware addons', async () => {
    listSoftwareComponentsMock.mockResolvedValue([
      {
        component_key: 'docker',
        label: 'Docker Engine',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '27.0.1',
        verification_state: 'healthy',
        service_status: 'running',
        appos_connection: 'not_applicable',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify'],
      },
      {
        component_key: 'appos-monitor-collector',
        label: 'Netdata Agent',
        target_type: 'server',
        template_kind: 'script',
        installed_state: 'installed',
        detected_version: '2.10.3',
        packaged_version: '2.10.3',
        verification_state: 'healthy',
        service_status: 'running',
        appos_connection: 'connected',
        health_reasons: ['verification_state:healthy', 'metrics_freshness:fresh'],
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'restart', 'stop'],
      },
    ])

    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()
    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    expect(within(inventory).getByText('Service: Running')).toBeInTheDocument()
    expect(within(inventory).getByText('AppOS: Connected')).toBeInTheDocument()

    fireEvent.click(within(inventory).getByRole('button', { name: 'Netdata Agent' }))

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    expect(within(selectedAddon).getByText('Service Status:')).toBeInTheDocument()
    expect(within(selectedAddon).getByText('Running')).toBeInTheDocument()
    expect(within(selectedAddon).getByText('AppOS Connection:')).toBeInTheDocument()
    expect(within(selectedAddon).getByText('Connected')).toBeInTheDocument()
    expect(
      within(selectedAddon).getByText('verification_state:healthy | metrics_freshness:fresh')
    ).toBeInTheDocument()
  })

  it('selects the addon details when Check is clicked from the inventory action menu', async () => {
    const user = userEvent.setup()
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    await user.click(within(inventory).getByRole('button', { name: 'More actions for Reverse Proxy' }))
    await user.click(screen.getByRole('menuitem', { name: 'Check' }))

    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith('server-1', 'reverse-proxy', 'verify', {
        apposBaseUrl: window.location.origin,
      })
    })

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    expect(within(selectedAddon).getByText('Reverse Proxy')).toBeInTheDocument()
    expect(within(selectedAddon).getByText('Operation History')).toBeInTheDocument()
  })

  it('shows complete grouped addon action menu with locked unavailable actions', async () => {
    const user = userEvent.setup()
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    await user.click(within(inventory).getByRole('button', { name: 'More actions for Reverse Proxy' }))

    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText('Secondary')).toBeInTheDocument()
    expect(screen.getByText('Dangerous')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'InstallLocked' })).toHaveAttribute(
      'data-disabled'
    )
    expect(screen.getByRole('menuitem', { name: 'Check' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'StartLocked' })).toHaveAttribute(
      'data-disabled'
    )
    expect(screen.getByRole('menuitem', { name: 'RestartLocked' })).toHaveAttribute(
      'data-disabled'
    )
    expect(screen.getByRole('menuitem', { name: 'StopLocked' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument()
  })

  it('prefers start or restart over stop as the primary addon action', async () => {
    listSoftwareComponentsMock.mockResolvedValue([
      {
        component_key: 'caddy',
        label: 'Caddy',
        target_type: 'server',
        template_kind: 'binary',
        installed_state: 'installed',
        detected_version: '2.9.0',
        verification_state: 'healthy',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'restart', 'stop'],
      },
      {
        component_key: 'web-cache',
        label: 'Web Cache',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '1.0.0',
        verification_state: 'degraded',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'start', 'restart', 'stop'],
      },
    ])

    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    expect(within(inventory).getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(within(inventory).queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('distinguishes stopped addons from other attention states', async () => {
    listSoftwareComponentsMock.mockResolvedValue([
      {
        component_key: 'web-cache',
        label: 'Web Cache',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '1.0.0',
        verification_state: 'degraded',
        verification: {
          state: 'degraded',
          checked_at: '2026-04-16T02:03:04Z',
          reason: 'service is inactive',
        },
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'start', 'restart', 'stop'],
      },
      {
        component_key: 'reverse-proxy',
        label: 'Reverse Proxy',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '1.27.0',
        verification_state: 'degraded',
        verification: {
          state: 'degraded',
          checked_at: '2026-04-16T02:03:04Z',
          reason: 'config validation failed',
        },
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'reinstall'],
      },
    ])

    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()
    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    expect(within(inventory).getByText('Service: Stopped')).toBeInTheDocument()
    expect(within(inventory).getByText('Service: Needs Attention')).toBeInTheDocument()
  })

  it('shows addon live log after an addon action starts', async () => {
    const user = userEvent.setup()
    getSoftwareOperationMock.mockResolvedValue({
      id: 'op-123',
      server_id: 'server-1',
      component_key: 'reverse-proxy',
      action: 'reinstall',
      phase: 'executing',
      terminal_status: 'none',
      failure_reason: '',
      event_log: '2026-04-16T02:03:04Z · Repair is running.',
      created: '2026-04-16T02:03:04Z',
      updated: '2026-04-16T02:03:10Z',
    })
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    await user.click(within(selectedAddon).getByRole('button', { name: 'Repair' }))

    expect(within(selectedAddon).getByRole('button', { name: 'Live Log' })).toBeInTheDocument()
    expect(within(selectedAddon).getByText('Repair requested...')).toBeInTheDocument()
    expect(within(selectedAddon).getByText('Repair accepted (op-123)')).toBeInTheDocument()
  })

  it('keeps the addon live log tab available with an empty-state hint', async () => {
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    fireEvent.click(within(selectedAddon).getByRole('button', { name: 'Live Log' }))

    expect(
      within(selectedAddon).getByText('No live log yet. Run an action to stream updates here.')
    ).toBeInTheDocument()
  })

  it('switches addon live log back to history after the operation completes', async () => {
    const user = userEvent.setup()
    getSoftwareOperationMock.mockResolvedValue({
      id: 'op-123',
      server_id: 'server-1',
      component_key: 'reverse-proxy',
      action: 'reinstall',
      phase: 'succeeded',
      terminal_status: 'success',
      failure_reason: '',
      event_log: '2026-04-16T02:03:10Z · Repair completed.',
      created: '2026-04-16T02:03:04Z',
      updated: '2026-04-16T02:03:10Z',
    })

    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    await user.click(within(selectedAddon).getByRole('button', { name: 'Repair' }))

    await within(selectedAddon).findByText('No operation history yet.')
  })

  it('invokes component actions and surfaces the accepted operation message', async () => {
    const user = userEvent.setup()
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    await user.click(within(selectedAddon).getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Check' }))

    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith('server-1', 'reverse-proxy', 'verify', {
        apposBaseUrl: window.location.origin,
      })
    })
    expect(
      await screen.findByText('verify accepted for reverse-proxy (op-123)')
    ).toBeInTheDocument()
  })

  it('renders addon load errors inside the addon inventory', async () => {
    listSoftwareComponentsMock.mockRejectedValue(new Error('ssh failed'))

    render(<ServerComponentsPanel serverId="server-1" />)

    const inventory = await screen.findByRole('region', { name: 'Addon inventory' })
    expect(await within(inventory).findByText('ssh failed')).toBeInTheDocument()

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    expect(within(selectedAddon).queryByText('ssh failed')).toBeNull()
  })

  it('executes an external monitor-agent addon action intent', async () => {
    listSoftwareComponentsMock.mockResolvedValue([
      {
        component_key: 'appos-monitor-collector',
        label: 'Netdata Agent',
        target_type: 'server',
        template_kind: 'script-systemd',
        installed_state: 'not_installed',
        verification_state: 'unknown',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['install', 'verify'],
      },
    ])

    render(
      <ServerComponentsPanel
        serverId="server-1"
        actionIntent={{
          serverId: 'server-1',
          componentKey: 'appos-monitor-collector',
          action: 'install',
          nonce: 101,
        }}
      />
    )

    await waitFor(() => {
      expect(screen.getAllByText('Netdata Agent').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith(
        'server-1',
        'appos-monitor-collector',
        'install',
        {
          apposBaseUrl: window.location.origin,
        }
      )
    })
    expect(
      await screen.findByText('install accepted for appos-monitor-collector (op-123)')
    ).toBeInTheDocument()
  })

  it('asks which callback address to use when monitor-agent detected URL differs from App URL', async () => {
    getConfiguredAppURLMock.mockResolvedValue('https://appos.example.com')
    listSoftwareComponentsMock.mockResolvedValue([
      {
        component_key: 'appos-monitor-collector',
        label: 'Netdata Agent',
        target_type: 'server',
        template_kind: 'script-systemd',
        installed_state: 'not_installed',
        verification_state: 'unknown',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['install', 'verify'],
      },
    ])

    render(
      <ServerComponentsPanel
        serverId="server-1"
        actionIntent={{
          serverId: 'server-1',
          componentKey: 'appos-monitor-collector',
          action: 'install',
          nonce: 102,
        }}
      />
    )

    expect(await screen.findByText('Choose monitor callback address')).toBeInTheDocument()
    expect(screen.getByText(window.location.origin)).toBeInTheDocument()
    expect(screen.getByText('https://appos.example.com')).toBeInTheDocument()
    expect(invokeSoftwareActionMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use App URL' }))

    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith(
        'server-1',
        'appos-monitor-collector',
        'install',
        {
          apposBaseUrl: 'https://appos.example.com',
        }
      )
    })
  })

  it('shows prerequisite SSH failures in addon inventory instead of cached addon rows', async () => {
    getSoftwareComponentMock.mockRejectedValue(new Error('ssh connection failed'))

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    expect(
      await within(prerequisitesSection).findByText('ssh connection failed')
    ).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    expect(within(inventory).getByText('ssh connection failed')).toBeInTheDocument()
    expect(within(inventory).queryByRole('button', { name: 'Reverse Proxy' })).toBeNull()
    expect(listSoftwareComponentsMock).not.toHaveBeenCalled()
  })

  it('shows prerequisite privilege errors in addon inventory even when prerequisite fetch succeeds', async () => {
    getSoftwareComponentMock.mockResolvedValue({
      component_key: 'docker',
      label: 'Docker Engine',
      target_type: 'server',
      template_kind: 'package',
      installed_state: 'installed',
      detected_version: '27.0.1',
      verification_state: 'degraded',
      verification: {
        state: 'degraded',
        reason: 'sudo check failed: permission denied',
        details: {
          engine_version: '27.0.1',
          compose_available: true,
          compose_version: '2.27.0',
        },
      },
      preflight: {
        ok: false,
        os_supported: true,
        privilege_ok: false,
        network_ok: true,
        dependency_ready: true,
        issues: ['privilege_required: neither root nor passwordless sudo available'],
      },
      available_actions: ['verify'],
    })

    render(<ServerComponentsPanel serverId="server-1" />)

    const inventory = await screen.findByRole('region', { name: 'Addon inventory' })
    expect(
      await within(inventory).findByText(
        'privilege_required: neither root nor passwordless sudo available'
      )
    ).toBeInTheDocument()
    expect(within(inventory).queryByRole('button', { name: 'Reverse Proxy' })).toBeNull()
    expect(listSoftwareComponentsMock).not.toHaveBeenCalled()
  })

  it('loads docker detail only when compose verification is missing from the list response', async () => {
    listSoftwareComponentsMock.mockResolvedValueOnce([
      {
        component_key: 'docker',
        label: 'Docker Engine',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '27.0.1',
        verification_state: 'healthy',
        verification: {
          state: 'healthy',
          checked_at: '2026-04-16T02:03:04Z',
          details: {
            engine_version: '27.0.1',
          },
        },
      },
    ])

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    expect(within(prerequisitesSection).getByText('2.27.0')).toBeInTheDocument()
    expect(getSoftwareComponentMock).toHaveBeenCalledWith('server-1', 'docker')
  })

  it('switches the prerequisite checklist box into an action log when a prerequisite action starts', async () => {
    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Recheck' }))

    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith('server-1', 'docker', 'verify', {
        apposBaseUrl: window.location.origin,
      })
    })

    expect(within(prerequisitesSection).getByText('Recheck Log')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Recheck requested...')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Recheck accepted (op-123)')).toBeInTheDocument()

    await waitFor(() => {
      expect(getSoftwareOperationMock).toHaveBeenCalledWith('server-1', 'op-123')
    })
    expect(
      within(prerequisitesSection).getByText(
        '2026-04-16T02:03:04Z · Accepted verify request for docker.'
      )
    ).toBeInTheDocument()
    expect(
      within(prerequisitesSection).getByText('2026-04-16T02:03:10Z · Verification passed.')
    ).toBeInTheDocument()
    expect(
      within(prerequisitesSection).getByLabelText('Prerequisite action log entries')
    ).toHaveClass('max-h-72', 'overflow-y-auto')
  })

  it('asks for confirmation before running upgrade fix', async () => {
    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Upgrade/Fix' }))

    expect(await screen.findByText('Confirm Upgrade/Fix')).toBeInTheDocument()
    expect(invokeSoftwareActionMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith('server-1', 'docker', 'upgrade', {
        apposBaseUrl: window.location.origin,
      })
    })
  })

  it('does not replace the current live log when a prerequisite action is rejected', async () => {
    invokeSoftwareActionMock
      .mockResolvedValueOnce({ accepted: true, operation_id: 'op-123' })
      .mockRejectedValueOnce(new Error('software operation already in flight'))

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Recheck' }))
    expect(
      await within(prerequisitesSection).findByText('Recheck accepted (op-123)')
    ).toBeInTheDocument()

    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Recheck' }))
    expect(await screen.findByText('software operation already in flight')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Recheck accepted (op-123)')).toBeInTheDocument()
    expect(within(prerequisitesSection).queryByText('Recheck requested...')).toBeInTheDocument()
  })

  it('keeps action buttons disabled while the live log operation is still running', async () => {
    const pendingOperation = deferred<{
      id: string
      server_id: string
      component_key: string
      action: string
      phase: string
      terminal_status: string
      failure_reason: string
      event_log: string
      created: string
      updated: string
    }>()
    getSoftwareOperationMock.mockReturnValue(pendingOperation.promise)

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Recheck' }))
    expect(
      await within(prerequisitesSection).findByText('Recheck accepted (op-123)')
    ).toBeInTheDocument()

    expect(within(prerequisitesSection).getByRole('button', { name: 'Recheck' })).toBeDisabled()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Upgrade/Fix' })).toBeDisabled()

    pendingOperation.resolve({
      id: 'op-123',
      server_id: 'server-1',
      component_key: 'docker',
      action: 'verify',
      phase: 'succeeded',
      terminal_status: 'success',
      failure_reason: '',
      event_log:
        '2026-04-16T02:03:04Z · Accepted verify request for docker.\n2026-04-16T02:03:10Z · Verification passed.',
      created: '2026-04-16T02:03:04Z',
      updated: '2026-04-16T02:03:10Z',
    })
  })

  it('does not show a live log error or unlock actions when polling fails but history is still running', async () => {
    getSoftwareOperationMock.mockRejectedValueOnce(new Error('Something went wrong.'))
    getSoftwareComponentMock
      .mockResolvedValueOnce({
        component_key: 'docker',
        label: 'Docker Engine',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '27.0.1',
        install_source: 'managed',
        source_evidence: 'apt:docker-ce',
        verification_state: 'healthy',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        verification: {
          state: 'healthy',
          checked_at: '2026-04-16T02:03:04Z',
          details: {
            engine_version: '27.0.1',
            compose_available: true,
            compose_version: '2.27.0',
          },
        },
        available_actions: ['verify', 'upgrade'],
      })
      .mockResolvedValueOnce({
        component_key: 'docker',
        label: 'Docker Engine',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '27.0.1',
        install_source: 'managed',
        source_evidence: 'apt:docker-ce',
        verification_state: 'healthy',
        last_operation: {
          action: 'reinstall',
          phase: 'executing',
          terminal_status: 'none',
          updated_at: '2026-05-13T09:15:02Z',
        },
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        verification: {
          state: 'healthy',
          checked_at: '2026-04-16T02:03:04Z',
          details: {
            engine_version: '27.0.1',
            compose_available: true,
            compose_version: '2.27.0',
          },
        },
        available_actions: ['verify', 'upgrade'],
      })

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Recheck' }))
    expect(
      await within(prerequisitesSection).findByText('Recheck accepted (op-123)')
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(getSoftwareOperationMock).toHaveBeenCalledWith('server-1', 'op-123')
    })

    expect(within(prerequisitesSection).queryByText('Something went wrong.')).toBeNull()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Recheck' })).toBeDisabled()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Upgrade/Fix' })).toBeDisabled()
  })

  it('deletes a prerequisite operation history record without confirmation', async () => {
    listSoftwareOperationsMock.mockResolvedValue([
      {
        id: 'op-delete-1',
        server_id: 'server-1',
        component_key: 'docker',
        action: 'verify',
        phase: 'failed',
        terminal_status: 'failed',
        failure_reason: 'previous check failed',
        created: '2026-05-13T01:00:00Z',
        updated: '2026-05-13T01:01:00Z',
      },
    ])

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )
    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'History' }))

    expect(
      await within(prerequisitesSection).findByText('Operation History (1)')
    ).toBeInTheDocument()
    expect(
      await within(prerequisitesSection).findByText('previous check failed')
    ).toBeInTheDocument()
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', {
        name: 'Delete verify operation history record',
      })
    )

    await waitFor(() => {
      expect(deleteSoftwareOperationMock).toHaveBeenCalledWith('server-1', 'op-delete-1')
    })
    await waitFor(() => {
      expect(within(prerequisitesSection).queryByText('previous check failed')).toBeNull()
    })
  })

  it('keeps blocking issue out of the checklist title row and shows mode tabs', async () => {
    getSoftwareComponentMock.mockReset()
    getSoftwareComponentMock.mockImplementation(async (_serverId: string, componentKey: string) => {
      if (componentKey === 'docker') {
        return {
          component_key: 'docker',
          label: 'Docker Engine',
          target_type: 'server',
          template_kind: 'package',
          installed_state: 'installed',
          detected_version: '27.0.1',
          install_source: 'managed',
          source_evidence: 'apt:docker-ce',
          verification_state: 'degraded',
          last_operation: {
            action: 'verify',
            phase: 'executing',
            terminal_status: 'none',
            updated_at: '2026-04-16T02:03:10Z',
          },
          verification: {
            state: 'degraded',
            checked_at: '2026-04-16T02:03:04Z',
            details: {
              engine_version: '27.0.1',
              compose_available: false,
              compose_version: '',
            },
          },
          preflight: {
            ok: false,
            os_supported: true,
            privilege_ok: true,
            network_ok: true,
            dependency_ready: false,
            issues: ['dependency_not_ready: docker compose is missing'],
          },
          available_actions: ['verify', 'install', 'upgrade'],
        }
      }

      return {
        component_key: componentKey,
        label: componentKey,
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'not_installed',
        verification_state: 'unknown',
        preflight: {
          ok: false,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'install'],
      }
    })

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    expect(
      within(prerequisitesSection).queryByText('dependency_not_ready: docker compose is missing')
    ).toBeNull()
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    const checklistTitle = within(prerequisitesSection).getByText('Verification Checklist')
    const titleRow = checklistTitle.parentElement
    expect(titleRow).not.toBeNull()
    expect(
      within(titleRow as HTMLElement).queryByText('dependency_not_ready: docker compose is missing')
    ).toBeNull()
    expect(
      within(titleRow as HTMLElement).getByRole('button', { name: 'Checklist' })
    ).toBeInTheDocument()
    expect(
      within(titleRow as HTMLElement).getByRole('button', { name: 'History' })
    ).toBeInTheDocument()

    const recheckButton = within(prerequisitesSection).getByRole('button', { name: 'Recheck' })
    expect(recheckButton).toBeDisabled()

    const upgradeButton = within(prerequisitesSection).getByRole('button', { name: 'Upgrade/Fix' })
    expect(upgradeButton).toBeDisabled()
  })

  it('locks addon action buttons while a prerequisite operation is still in progress', async () => {
    getSoftwareComponentMock.mockReset()
    getSoftwareComponentMock.mockImplementation(async (_serverId: string, componentKey: string) => {
      if (componentKey === 'docker') {
        return {
          component_key: 'docker',
          label: 'Docker Engine',
          target_type: 'server',
          template_kind: 'package',
          installed_state: 'installed',
          detected_version: '27.0.1',
          install_source: 'managed',
          source_evidence: 'apt:docker-ce',
          verification_state: 'healthy',
          last_operation: {
            action: 'verify',
            phase: 'executing',
            terminal_status: 'none',
            updated_at: '2026-04-16T02:03:10Z',
          },
          verification: {
            state: 'healthy',
            checked_at: '2026-04-16T02:03:04Z',
            details: {
              engine_version: '27.0.1',
              compose_available: true,
              compose_version: '2.27.0',
            },
          },
          preflight: {
            ok: true,
            os_supported: true,
            privilege_ok: true,
            network_ok: true,
            dependency_ready: true,
          },
          available_actions: ['verify', 'upgrade'],
        }
      }

      return {
        component_key: componentKey,
        label: componentKey,
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'not_installed',
        verification_state: 'unknown',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['verify', 'install'],
      }
    })

    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    expect(within(selectedAddon).getByRole('button', { name: 'Repair' })).toBeDisabled()
    expect(within(selectedAddon).getByRole('button', { name: 'More actions' })).toBeDisabled()
  })

  it('does not surface a network probe issue as a blocking issue', async () => {
    getSoftwareComponentMock.mockReset()
    getSoftwareComponentMock.mockImplementation(async (_serverId: string, componentKey: string) => {
      if (componentKey === 'docker') {
        return {
          component_key: 'docker',
          label: 'Docker Engine',
          target_type: 'server',
          template_kind: 'package',
          installed_state: 'not_installed',
          verification_state: 'unknown',
          verification: {
            state: 'unknown',
            checked_at: '2026-04-16T02:03:04Z',
            details: {
              engine_version: '',
              compose_available: false,
              compose_version: '',
            },
          },
          preflight: {
            ok: true,
            os_supported: true,
            privilege_ok: true,
            network_ok: false,
            dependency_ready: true,
            issues: ['network_required: no outbound internet connectivity'],
          },
          available_actions: ['install', 'verify'],
        }
      }

      return {
        component_key: componentKey,
        label: componentKey,
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'not_installed',
        verification_state: 'unknown',
        preflight: {
          ok: true,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: true,
        },
        available_actions: ['install', 'verify'],
      }
    })

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    fireEvent.click(
      within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })
    )

    expect(within(prerequisitesSection).queryByText(/dependency_not_ready:/)).toBeNull()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Install' })).toBeEnabled()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Recheck' })).toBeEnabled()
  })

  it('does not crash when a component omits available actions', async () => {
    listSoftwareComponentsMock.mockResolvedValueOnce([
      {
        component_key: 'docker',
        label: 'Docker Engine',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '27.0.1',
        verification_state: 'healthy',
        verification: {
          state: 'healthy',
          checked_at: '2026-04-16T02:03:04Z',
          details: {
            engine_version: '27.0.1',
            compose_available: true,
            compose_version: '2.27.0',
          },
        },
      },
    ])

    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByText('Docker Engine')).toBeInTheDocument()
  })

  it('renders prerequisites before the addon list finishes loading', async () => {
    const addonsDeferred = deferred<
      Array<{
        component_key: string
        label: string
        target_type: 'server'
        template_kind: 'package'
        installed_state: 'installed'
        detected_version: string
        packaged_version: string
        verification_state: 'degraded'
        preflight: {
          ok: false
          os_supported: true
          privilege_ok: true
          network_ok: true
          dependency_ready: false
          issues: string[]
        }
        last_action: { action: string; result: string; at: string }
        available_actions: Array<'verify' | 'reinstall' | 'uninstall'>
      }>
    >()

    listSoftwareComponentsMock.mockReturnValueOnce(addonsDeferred.promise)

    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', {
      name: 'Prerequisites section',
    })
    expect(within(prerequisitesSection).getByText('Docker Engine')).toBeInTheDocument()

    const addonsSection = screen.getByRole('region', { name: 'Addons section' })
    expect(within(addonsSection).getByText('Loading addons...')).toBeInTheDocument()
    expect(within(addonsSection).queryByText('Reverse Proxy')).toBeNull()

    addonsDeferred.resolve([
      {
        component_key: 'reverse-proxy',
        label: 'Reverse Proxy',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '1.27.0',
        packaged_version: '1.27.1',
        verification_state: 'degraded',
        preflight: {
          ok: false,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: false,
          issues: ['dependency_not_ready: docker is not ready'],
        },
        last_action: { action: 'verify', result: 'failed', at: '2026-04-16T02:03:04Z' },
        available_actions: ['verify', 'reinstall', 'uninstall'],
      },
    ])

    expect(await screen.findByText('Reverse Proxy')).toBeInTheDocument()
  })

  it('waits for prerequisites before starting the addon list request', async () => {
    const prerequisiteDeferred = deferred<{
      component_key: string
      label: string
      target_type: 'server'
      template_kind: 'package'
      installed_state: 'installed'
      detected_version: string
      install_source: 'managed'
      source_evidence: string
      verification_state: 'healthy'
      preflight: {
        ok: true
        os_supported: true
        privilege_ok: true
        network_ok: true
        dependency_ready: true
      }
      verification: {
        state: 'healthy'
        checked_at: string
        details: {
          engine_version: string
          compose_available: true
          compose_version: string
        }
      }
      available_actions: Array<'verify' | 'upgrade'>
    }>()

    getSoftwareComponentMock.mockReturnValueOnce(prerequisiteDeferred.promise)
    listSoftwareComponentsMock.mockResolvedValueOnce([
      {
        component_key: 'reverse-proxy',
        label: 'Reverse Proxy',
        target_type: 'server',
        template_kind: 'package',
        installed_state: 'installed',
        detected_version: '1.27.0',
        packaged_version: '1.27.1',
        verification_state: 'degraded',
        preflight: {
          ok: false,
          os_supported: true,
          privilege_ok: true,
          network_ok: true,
          dependency_ready: false,
          issues: ['dependency_not_ready: docker is not ready'],
        },
        last_action: { action: 'verify', result: 'failed', at: '2026-04-16T02:03:04Z' },
        available_actions: ['verify', 'reinstall', 'uninstall'],
      },
    ])

    render(<ServerComponentsPanel serverId="server-1" />)

    expect(getSoftwareComponentMock).toHaveBeenCalledWith('server-1', 'docker')
    expect(listSoftwareComponentsMock).not.toHaveBeenCalled()

    prerequisiteDeferred.resolve({
      component_key: 'docker',
      label: 'Docker Engine',
      target_type: 'server',
      template_kind: 'package',
      installed_state: 'installed',
      detected_version: '27.0.1',
      install_source: 'managed',
      source_evidence: 'apt:docker-ce',
      verification_state: 'healthy',
      preflight: {
        ok: true,
        os_supported: true,
        privilege_ok: true,
        network_ok: true,
        dependency_ready: true,
      },
      verification: {
        state: 'healthy',
        checked_at: '2026-04-16T02:03:04Z',
        details: {
          engine_version: '27.0.1',
          compose_available: true,
          compose_version: '2.27.0',
        },
      },
      available_actions: ['verify', 'upgrade'],
    })

    await waitFor(() => {
      expect(listSoftwareComponentsMock).toHaveBeenCalledWith('server-1')
    })
  })
})
