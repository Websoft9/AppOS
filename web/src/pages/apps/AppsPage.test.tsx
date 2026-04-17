import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppsPage } from './AppsPage'

const sendMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('AppsPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    sendMock.mockReset()
    navigateMock.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/apps' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'app-1',
            name: 'Demo App',
            server_id: 'local',
            project_dir: '/tmp/demo-app',
            source: 'manualops',
            status: 'installed',
            runtime_status: 'running',
            created: '2026-03-30T10:00:00Z',
            updated: '2026-03-30T10:10:00Z',
            last_operation: 'op-last',
          },
        ])
      }
      if (path === '/api/apps/app-1/start' && options?.method === 'POST') {
        return Promise.resolve({ id: 'op-start-1' })
      }
      if (path === '/api/apps/app-1' && options?.method === 'DELETE') {
        return Promise.resolve({ id: 'op-uninstall-1' })
      }
      return Promise.resolve({})
    })
  })

  it('navigates to action detail after start is requested from the action menu', async () => {
    render(<AppsPage />)

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open actions for Demo App' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Start' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1/start', { method: 'POST' })
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/actions/$actionId',
        params: { actionId: 'op-start-1' },
        search: { returnTo: 'list' },
      })
    })
  })

  it('navigates to action detail after uninstall is confirmed from the action menu', async () => {
    render(<AppsPage />)

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open actions for Demo App' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Uninstall' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Uninstall' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/apps/app-1', { method: 'DELETE' })
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/actions/$actionId',
        params: { actionId: 'op-uninstall-1' },
        search: { returnTo: 'list' },
      })
    })
  })
})
