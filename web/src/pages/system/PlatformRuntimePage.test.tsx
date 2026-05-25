import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
          version: '28.x',
          available: true,
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

  it('renders grouped runtime metadata and visibility-split services', async () => {
    mockPlatformRuntimeResponses()

    render(<PlatformRuntimePage />)

    expect(await screen.findByText('Runtime Summary')).toBeInTheDocument()
    expect(screen.getByText('Platform Runtime')).toBeInTheDocument()
    expect(screen.getAllByText('Built-in Components').length).toBeGreaterThan(0)
    expect(screen.getByText('Active Services')).toBeInTheDocument()
    expect(screen.getAllByText('Diagnostic Services').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Docker').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tool').length).toBeGreaterThan(0)
    expect(screen.getByText('container cli')).toBeInTheDocument()
    expect(screen.getByText('Capability: container operations')).toBeInTheDocument()
    expect(screen.getByText('Diagnostic')).toBeInTheDocument()
    expect(screen.getAllByText('Always on').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Refresh built-in components' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh active services' })).toBeInTheDocument()
    expect(screen.getAllByTitle('View Logs').length).toBeGreaterThan(0)
  })

  it('refreshes built-in components from the page title row', async () => {
    mockPlatformRuntimeResponses()

    render(<PlatformRuntimePage />)

    expect(await screen.findByRole('button', { name: 'Refresh built-in components' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh built-in components' }))

    expect(sendMock).toHaveBeenCalledWith('/api/software/local?force=1', { method: 'GET' })
  })
})
