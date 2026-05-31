import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformComponentsPage } from './PlatformComponentsPage'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('PlatformComponentsPage built-in components presentation', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('auto refreshes built-in components while probe results are still pending', async () => {
    let componentCalls = 0
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/software/local') {
        componentCalls += 1
        if (componentCalls === 1) {
          return Promise.resolve({
            items: [
              {
                id: 'c1',
                name: 'Redis',
                criticality: 'important',
                runtime_kind: 'service',
                role: 'cache store',
                owned_capability: 'background state cache',
                version: 'unknown',
                available: false,
                probe_pending: true,
                updated_at: '2026-03-20T09:30:00Z',
              },
            ],
          })
        }
        return Promise.resolve({
          items: [
            {
              id: 'c1',
              name: 'Redis',
              criticality: 'important',
              runtime_kind: 'service',
              role: 'cache store',
              owned_capability: 'background state cache',
              version: '7.2.0',
              available: true,
              probe_pending: false,
              updated_at: '2026-03-20T09:30:00Z',
            },
          ],
        })
      }

      if (path === '/api/software/local/services') {
        return Promise.resolve([])
      }

      return Promise.resolve([])
    })

    render(<PlatformComponentsPage />)

    const componentsTab = await screen.findByRole('tab', { name: 'Built-in Components' })
    fireEvent.mouseDown(componentsTab)
    fireEvent.click(componentsTab)

    expect(await screen.findByText('Version Checking...')).toBeInTheDocument()

    await waitFor(
      () => {
        expect(sendMock).toHaveBeenCalledTimes(3)
        expect(screen.getByText('Version 7.2.0')).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

  it('renders built-in components as read-only text cards in the current responsive grid container', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/software/local') {
        return Promise.resolve({
          items: [
            {
              id: 'c1',
              name: 'Nginx',
              criticality: 'core',
              runtime_kind: 'service',
              role: 'reverse proxy',
              owned_capability: 'web ingress',
              version: '1.27.0',
              available: true,
              updated_at: '2026-03-20T10:00:00Z',
            },
            {
              id: 'c2',
              name: 'Redis',
              criticality: 'important',
              runtime_kind: 'service',
              role: 'cache store',
              owned_capability: 'background state cache',
              version: 'unknown',
              available: false,
              probe_pending: true,
              updated_at: '2026-03-20T09:30:00Z',
            },
          ],
        })
      }

      if (path === '/api/software/local/services') {
        return Promise.resolve([])
      }

      return Promise.resolve([])
    })

    const { container } = render(<PlatformComponentsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/software/local', {
        method: 'GET',
        requestKey: null,
      })
    })

    const componentsTab = await screen.findByRole('tab', { name: 'Built-in Components' })
    fireEvent.mouseDown(componentsTab)
    fireEvent.click(componentsTab)

    await waitFor(() => {
      expect(screen.getByText('Nginx')).toBeInTheDocument()
      expect(screen.getByText('Redis')).toBeInTheDocument()
    })

    expect(
      screen.getByText(
        'Read-only runtime inventory for quick awareness. No actions are required here.'
      )
    ).toBeInTheDocument()
    expect(screen.getAllByText('Service').length).toBeGreaterThan(0)
    expect(screen.getByText('reverse proxy')).toBeInTheDocument()
    expect(screen.getByText('Capability: web ingress')).toBeInTheDocument()
    expect(screen.getByText('cache store')).toBeInTheDocument()
    expect(screen.getByText('Version 1.27.0')).toBeInTheDocument()
    expect(screen.getByText('Version Checking...')).toBeInTheDocument()
    expect(screen.getAllByText(/^Updated /).length).toBe(2)

    const cards = container.querySelectorAll('article')
    expect(cards.length).toBe(2)

    const grid = container.querySelector('div.grid')
    expect(grid).toBeTruthy()
    expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-4', 'xl:grid-cols-6')
  })

  it('groups services by visibility inside the services tab', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/software/local') {
        return Promise.resolve({ items: [] })
      }

      if (path === '/api/software/local/services') {
        return Promise.resolve([
          {
            name: 'appos',
            lifecycle: 'always_on',
            visibility: 'default',
            state: 'running',
            pid: 100,
            uptime: 45,
            cpu: 1.2,
            memory: 10485760,
            last_detected_at: '2026-03-20T10:00:00Z',
            log_available: true,
          },
          {
            name: 'victoriametrics',
            lifecycle: 'always_on',
            visibility: 'diagnostic',
            state: 'running',
            pid: 200,
            uptime: 7200,
            cpu: 0.04,
            memory: 52428800,
            last_detected_at: '2026-03-20T10:00:00Z',
            log_available: true,
          },
        ])
      }

      if (path.startsWith('/api/software/local/services/') && path.includes('/logs?')) {
        return Promise.resolve({
          name: 'appos',
          stream: 'stdout',
          content: 'ready',
          truncated: false,
          last_detected_at: '2026-03-20T10:00:00Z',
        })
      }

      return Promise.resolve([])
    })

    render(<PlatformComponentsPage />)

    const servicesTab = await screen.findByRole('tab', { name: 'Active Services' })
    fireEvent.mouseDown(servicesTab)
    fireEvent.click(servicesTab)

    expect(
      await screen.findByText(
        'Services are grouped by operator visibility so the default surface stays focused while diagnostic dependencies remain accessible.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('Default operator-visible services for the current AppOS instance.')
    ).toBeInTheDocument()
    expect(screen.getByText('Diagnostic Services')).toBeInTheDocument()
    expect(screen.getByText('appos')).toBeInTheDocument()
    expect(screen.getByText('victoriametrics')).toBeInTheDocument()
    expect(screen.getAllByText('Always on').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Diagnostic').length).toBeGreaterThan(0)
    expect(screen.getByText('45s')).toBeInTheDocument()
    expect(screen.getByText(/^Updated at /)).toBeInTheDocument()
    expect(screen.queryByText('Last Detected')).not.toBeInTheDocument()
    expect(screen.getByText('<0.1%')).toBeInTheDocument()
  })
})
