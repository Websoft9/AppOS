import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformRuntimePage } from './PlatformRuntimePage'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

function mockPlatformRuntimeResponses() {
  sendMock.mockImplementation((path: string) => {
    if (path === '/api/system/runtime') {
      return Promise.resolve({
        summary: {
          runningComponents: 0,
          degradedComponents: 0,
          checkingComponents: 1,
          runtimeShape: 'single-container appos with embedded control-plane services',
        },
        components: [
          {
            id: 'docker',
            name: 'Docker',
            criticality: 'important',
            runtime_kind: 'tool',
            role: 'container cli',
            owned_capability: 'container operations',
            version: 'unknown',
            available: false,
            probe_pending: true,
            updated_at: '2026-04-21T14:00:00Z',
          },
        ],
        processes: [
          {
            name: 'appos-core',
            lifecycle: 'always_on',
            visibility: 'default',
            state: 'running',
            pid: 101,
            uptime: 7200,
            cpu: 4.1,
            memory: 104857600,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
          {
            name: 'victoriametrics',
            lifecycle: 'always_on',
            visibility: 'diagnostic',
            state: 'running',
            pid: 111,
            uptime: 7200,
            cpu: 1.1,
            memory: 52428800,
            last_detected_at: '2026-04-21T14:20:00Z',
            log_available: true,
          },
        ],
        host_kernel_facts: {
          kernel_release: '6.8.0-test',
          architecture: 'x86_64',
          cpu_topology_visible: {
            model_name: 'Test CPU',
            online_cpu_count: 4,
          },
        },
        runtime_limits: {
          cpuset_effective: '0-3',
          cpu_quota: {
            status: 'constrained',
            quota_us: 50000,
            period_us: 100000,
            cores_equivalent: 0.5,
          },
          memory_limit_bytes: 536870912,
        },
      })
    }

    if (path.startsWith('/api/software/local/services/') && path.includes('/logs?')) {
      return Promise.resolve({
        name: 'appos-core',
        stream: 'stdout',
        content: 'ready',
        truncated: false,
        last_detected_at: '2026-04-21T14:20:00Z',
      })
    }

    return Promise.resolve([])
  })
}

describe('PlatformRuntimePage', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('auto refreshes pending built-in components until probe results are ready', async () => {
    let runtimeCalls = 0
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/system/runtime') {
        runtimeCalls += 1
        if (runtimeCalls === 1) {
          return Promise.resolve({
            summary: {
              runningComponents: 0,
              degradedComponents: 0,
              checkingComponents: 1,
              runtimeShape: 'single-container appos with embedded control-plane services',
            },
            components: [
              {
                id: 'docker',
                name: 'Docker',
                criticality: 'important',
                runtime_kind: 'tool',
                role: 'container cli',
                owned_capability: 'container operations',
                version: 'unknown',
                available: false,
                probe_pending: true,
                updated_at: '2026-04-21T14:00:00Z',
              },
            ],
            processes: [],
            host_kernel_facts: {
              kernel_release: '6.8.0-test',
              architecture: 'x86_64',
              cpu_topology_visible: { model_name: 'Test CPU', online_cpu_count: 4 },
            },
            runtime_limits: {
              cpuset_effective: '0-3',
              cpu_quota: {
                status: 'unknown',
                quota_us: null,
                period_us: 100000,
                cores_equivalent: null,
              },
              memory_limit_bytes: null,
            },
          })
        }
        return Promise.resolve({
          summary: {
            runningComponents: 1,
            degradedComponents: 0,
            checkingComponents: 0,
            runtimeShape: 'single-container appos with embedded control-plane services',
          },
          components: [
            {
              id: 'docker',
              name: 'Docker',
              criticality: 'important',
              runtime_kind: 'tool',
              role: 'container cli',
              owned_capability: 'container operations',
              version: '28.x',
              available: true,
              probe_pending: false,
              updated_at: '2026-04-21T14:00:00Z',
            },
          ],
          processes: [],
          host_kernel_facts: {
            kernel_release: '6.8.0-test',
            architecture: 'x86_64',
            cpu_topology_visible: { model_name: 'Test CPU', online_cpu_count: 4 },
          },
          runtime_limits: {
            cpuset_effective: '0-3',
            cpu_quota: {
              status: 'constrained',
              quota_us: 50000,
              period_us: 100000,
              cores_equivalent: 0.5,
            },
            memory_limit_bytes: null,
          },
        })
      }

      return Promise.resolve([])
    })

    render(<PlatformRuntimePage />)

    await waitFor(() => {
      expect(screen.getAllByText('Checking...').length).toBeGreaterThan(0)
    })

    await waitFor(
      () => {
        expect(runtimeCalls).toBeGreaterThanOrEqual(2)
        expect(screen.getByText('28.x')).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

  it('renders a minimal built-in components list and a merged active services table', async () => {
    mockPlatformRuntimeResponses()

    render(<PlatformRuntimePage />)

    expect(await screen.findByText('Runtime Summary')).toBeInTheDocument()
    expect(screen.getByText('Platform Runtime')).toBeInTheDocument()
    expect(screen.getAllByText('Built-in Components').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active Services').length).toBeGreaterThan(0)
    expect(screen.getByText('Host/Kernel Facts')).toBeInTheDocument()
    expect(screen.getByText('6.8.0-test')).toBeInTheDocument()
    expect(screen.getByText('x86_64')).toBeInTheDocument()
    expect(screen.getByText('Test CPU (4 online)')).toBeInTheDocument()
    expect(screen.getByText('0-3')).toBeInTheDocument()
    expect(screen.getByText('0.50 CPU')).toBeInTheDocument()
    expect(screen.getByText('512 MB')).toBeInTheDocument()
    expect(screen.getAllByText('Docker').length).toBeGreaterThan(0)
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
    expect(screen.getByText('Updated at')).toBeInTheDocument()
    expect(screen.getAllByText('Checking...').length).toBeGreaterThan(0)
    expect(screen.queryByText('Diagnostic Services')).not.toBeInTheDocument()
    expect(screen.getByText('Diagnostic')).toBeInTheDocument()
    expect(screen.getAllByText('Always on').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Refresh runtime' })).toBeInTheDocument()
    expect(screen.getByText(/^Updated at /)).toBeInTheDocument()
    expect(screen.getAllByTitle('View Logs').length).toBeGreaterThan(0)
  })

  it('orders OS first and AppOS second in built-in components', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/system/runtime') {
        return Promise.resolve({
          summary: {
            runningComponents: 3,
            degradedComponents: 0,
            checkingComponents: 0,
            runtimeShape: 'single-container appos with embedded control-plane services',
          },
          components: [
            {
              id: 'docker',
              name: 'Docker',
              runtime_kind: 'tool',
              version: '28.x',
              available: true,
              updated_at: '2026-04-21T14:00:00Z',
            },
            {
              id: 'appos',
              name: 'AppOS',
              runtime_kind: 'service',
              version: '1.0.0',
              available: true,
              updated_at: '2026-04-21T14:00:00Z',
            },
            {
              id: 'os',
              name: 'OS',
              runtime_kind: 'os',
              version: 'Ubuntu',
              available: true,
              updated_at: '2026-04-21T14:00:00Z',
            },
          ],
          processes: [],
          host_kernel_facts: {
            kernel_release: '6.8.0-test',
            architecture: 'x86_64',
            cpu_topology_visible: { model_name: 'Test CPU', online_cpu_count: 4 },
          },
          runtime_limits: {
            cpuset_effective: '0-3',
            cpu_quota: {
              status: 'unrestricted',
              quota_us: null,
              period_us: 100000,
              cores_equivalent: null,
            },
            memory_limit_bytes: null,
          },
        })
      }

      return Promise.resolve([])
    })

    render(<PlatformRuntimePage />)

    await screen.findByText('OS')

    const componentNames = screen
      .getAllByRole('cell')
      .map(cell => cell.textContent?.trim() || '')
      .filter(Boolean)
      .filter(value => ['OS', 'AppOS', 'Docker'].includes(value))

    expect(componentNames.slice(0, 3)).toEqual(['OS', 'AppOS', 'Docker'])
  })

  it('refreshes runtime data from the page title row', async () => {
    mockPlatformRuntimeResponses()

    render(<PlatformRuntimePage />)

    expect(await screen.findByRole('button', { name: 'Refresh runtime' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh runtime' }))

    expect(sendMock).toHaveBeenCalledWith('/api/system/runtime', {
      method: 'GET',
      requestKey: null,
    })
  })
})
