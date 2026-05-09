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
const invokeSoftwareActionMock = vi.fn()

vi.mock('@/lib/software-api', () => ({
  listSoftwareComponents: (...args: unknown[]) => listSoftwareComponentsMock(...args),
  getSoftwareComponent: (...args: unknown[]) => getSoftwareComponentMock(...args),
  invokeSoftwareAction: (...args: unknown[]) => invokeSoftwareActionMock(...args),
}))

afterEach(() => {
  cleanup()
})

describe('ServerComponentsPanel', () => {
  beforeEach(() => {
    listSoftwareComponentsMock.mockReset()
    getSoftwareComponentMock.mockReset()
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
    expect(screen.getByText('Install source: Managed (apt:docker-ce)')).toBeInTheDocument()
    expect(screen.getByText('Reverse Proxy')).toBeInTheDocument()
    expect(screen.getByText('reverse-proxy')).toBeInTheDocument()
    expect(screen.getByText('dependency_not_ready: docker is not ready')).toBeInTheDocument()

    const prerequisitesSection = screen.getByRole('region', { name: 'Prerequisites section' })
    expect(within(prerequisitesSection).getByText('Docker Engine')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Version:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('27.0.1')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Docker Compose:')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('2.27.0')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Docker Engine installed')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Docker Compose available')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('OS Support confirmed')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByText('Privileged Access confirmed')).toBeInTheDocument()
    expect(within(prerequisitesSection).getByRole('button', { name: 'Prerequisites help' })).toBeInTheDocument()
    expect(within(prerequisitesSection).queryByText('No corrective action available')).toBeNull()
    expect(within(prerequisitesSection).queryByText('Container runtime required for platform-managed workloads.')).toBeNull()

    const addonsSection = screen.getByRole('region', { name: 'Addons section' })
    expect(within(addonsSection).queryByText('Docker Engine')).toBeNull()
    expect(within(addonsSection).getByText('Reverse Proxy')).toBeInTheDocument()
    expect(within(addonsSection).getByRole('button', { name: 'Addons help' })).toBeInTheDocument()
  })

  it('invokes component actions and surfaces the accepted operation message', async () => {
    render(<ServerComponentsPanel serverId="server-1" />)

    expect(await screen.findByRole('heading', { name: 'Addons' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'verify' }))

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

    expect(await screen.findByText('2.27.0')).toBeInTheDocument()
    expect(getSoftwareComponentMock).toHaveBeenCalledWith('server-1', 'docker')
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