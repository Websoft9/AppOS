import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const invokeSoftwareActionMock = vi.fn()

vi.mock('@/lib/software-api', () => ({
  listSoftwareComponents: (...args: unknown[]) => listSoftwareComponentsMock(...args),
  getSoftwareComponent: (...args: unknown[]) => getSoftwareComponentMock(...args),
  getSoftwareOperation: (...args: unknown[]) => getSoftwareOperationMock(...args),
  invokeSoftwareAction: (...args: unknown[]) => invokeSoftwareActionMock(...args),
}))

afterEach(() => {
  cleanup()
})

describe('ServerComponentsPanel', () => {
  beforeEach(() => {
    listSoftwareComponentsMock.mockReset()
    getSoftwareComponentMock.mockReset()
    getSoftwareOperationMock.mockReset()
    invokeSoftwareActionMock.mockReset()

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
    expect(within(prerequisitesSection).getByRole('button', { name: 'Prerequisites help' })).toBeInTheDocument()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' })).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Verified')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Checks passed')).toBeInTheDocument()

    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' }))

    expect(within(prerequisitesSection).getByText('Install source: Managed (apt:docker-ce)')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Status:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getAllByText('Verified').length).toBeGreaterThan(0)
    expect(within(prerequisitesSection).getByText('Version:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('27.0.1')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Docker Compose:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('2.27.0')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Docker Engine installed')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Docker Compose available')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('OS Support confirmed')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Privileged Access confirmed')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Verification Checklist')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Recheck' })).toBeInTheDocument()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Upgrade/Fix' })).toBeEnabled()
    expect(within(prerequisitesSection).queryByRole('button', { name: 'Install' })).toBeNull()
    expect(within(prerequisitesSection).queryByText('No corrective action available')).toBeNull()
    expect(within(prerequisitesSection).queryByText('Container runtime required for platform-managed workloads.')).toBeNull()

    const addonsSection = screen.getByRole('region', { name: 'Addons section' })
    expect(within(addonsSection).queryByText('Docker Engine')).toBeNull()
    expect(within(addonsSection).getByText('Reverse Proxy')).toBeInTheDocument()
    expect(within(addonsSection).getByRole('button', { name: 'Addons help' })).toBeInTheDocument()

    const inventory = within(addonsSection).getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = within(addonsSection).getByRole('region', { name: 'Selected Addon' })
    expect(within(selectedAddon).getByText('dependency_not_ready: docker is not ready')).toBeInTheDocument()
    expect(within(selectedAddon).getByRole('button', { name: 'verify' })).toBeInTheDocument()
  })

  it('invokes component actions and surfaces the accepted operation message', async () => {
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Addon inventory' })
    fireEvent.click(within(inventory).getByRole('button', { name: 'Reverse Proxy' }))

    const selectedAddon = screen.getByRole('region', { name: 'Selected Addon' })
    fireEvent.click(within(selectedAddon).getByRole('button', { name: 'verify' }))

    await waitFor(() => {
      expect(invokeSoftwareActionMock).toHaveBeenCalledWith('server-1', 'reverse-proxy', 'verify', {
        apposBaseUrl: window.location.origin,
      })
    })
    expect(await screen.findByText('verify accepted for reverse-proxy (op-123)')).toBeInTheDocument()
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

    const prerequisitesSection = await screen.findByRole('region', { name: 'Prerequisites section' })
    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' }))

    expect(within(prerequisitesSection).getByText('2.27.0')).toBeInTheDocument()
    expect(getSoftwareComponentMock).toHaveBeenCalledWith('server-1', 'docker')
  })

  it('switches the prerequisite checklist box into an action log when a prerequisite action starts', async () => {
    render(<ServerComponentsPanel serverId="server-1" />)

    const prerequisitesSection = await screen.findByRole('region', { name: 'Prerequisites section' })
    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' }))

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
    expect(within(prerequisitesSection).getByText(/Recheck: Succeeded/)).toBeInTheDocument()
    expect(
      within(prerequisitesSection).getByLabelText('Prerequisite action log entries')
    ).toHaveClass('max-h-72', 'overflow-y-auto')
  })

  it('shows the blocking issue beside the log title and keeps recheck clickable while in progress', async () => {
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
            phase: 'running',
            terminal_status: 'running',
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

    const prerequisitesSection = await screen.findByRole('region', { name: 'Prerequisites section' })
    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' }))

    const checklistTitle = within(prerequisitesSection).getByText('Verification Checklist')
    const titleRow = checklistTitle.parentElement
    expect(titleRow).not.toBeNull()
    expect(within(titleRow as HTMLElement).getByText(/Blocking issue:/)).toBeInTheDocument()

    const recheckButton = within(prerequisitesSection).getByRole('button', { name: 'Recheck' })
    expect(recheckButton).toBeEnabled()
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

    const prerequisitesSection = await screen.findByRole('region', { name: 'Prerequisites section' })
    fireEvent.click(within(prerequisitesSection).getByRole('button', { name: 'Docker Engine details' }))

    expect(within(prerequisitesSection).queryByText(/Blocking issue:/)).toBeNull()
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