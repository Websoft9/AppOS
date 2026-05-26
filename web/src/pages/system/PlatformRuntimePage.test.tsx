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
    if (path === '/api/software/local/services') {
      return Promise.resolve([
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
      ])
    }

    if (path === '/api/software/local') {
      return Promise.resolve({ items: [
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
      ] })
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
    let componentCalls = 0
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/software/local/services') {
        return Promise.resolve([])
      }

      if (path === '/api/software/local') {
        componentCalls += 1
        if (componentCalls === 1) {
          return Promise.resolve({ items: [
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
          ] })
        }
        return Promise.resolve({ items: [
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
        ] })
      }

      return Promise.resolve([])
    })

    render(<PlatformRuntimePage />)

    await waitFor(() => {
      expect(screen.getAllByText('Checking...').length).toBeGreaterThan(0)
    })

    await waitFor(
      () => {
        expect(sendMock).toHaveBeenCalledTimes(3)
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
    expect(screen.getAllByText('Docker').length).toBeGreaterThan(0)
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
    expect(screen.getByText('Updated at')).toBeInTheDocument()
    expect(screen.getAllByText('Checking...').length).toBeGreaterThan(0)
    expect(screen.queryByText('Diagnostic Services')).not.toBeInTheDocument()
    expect(screen.getByText('Diagnostic')).toBeInTheDocument()
    expect(screen.getAllByText('Always on').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Refresh built-in components' })).toBeInTheDocument()
    expect(screen.getByText(/^Updated at /)).toBeInTheDocument()
    expect(screen.getAllByTitle('View Logs').length).toBeGreaterThan(0)
  })

  it('orders OS first and AppOS second in built-in components', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/software/local/services') {
        return Promise.resolve([])
      }

      if (path === '/api/software/local') {
        return Promise.resolve({ items: [
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
        ] })
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

  it('refreshes built-in components from the page title row', async () => {
    mockPlatformRuntimeResponses()

    render(<PlatformRuntimePage />)

    expect(await screen.findByRole('button', { name: 'Refresh built-in components' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh built-in components' }))

    expect(sendMock).toHaveBeenCalledWith('/api/software/local?force=1', {
      method: 'GET',
      requestKey: null,
    })
  })
})
