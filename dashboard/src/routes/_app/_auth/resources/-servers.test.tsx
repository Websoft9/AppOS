import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersPage } from './servers'

const navigateMock = vi.fn()
const getFullListMock = vi.fn()
let searchState: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => searchState,
    useNavigate: () => navigateMock,
  }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    collection: (name: string) => {
      if (name === 'servers') {
        return {
          getFullList: (...args: unknown[]) => getFullListMock(...args),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        }
      }

      return {
        getFullList: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }
    },
  },
}))

vi.mock('@/lib/connect-api', () => ({
  checkServerStatus: vi.fn(),
  serverPower: vi.fn(),
}))

describe('ServersPage layout', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    getFullListMock.mockReset()
    searchState = {}
    getFullListMock.mockResolvedValue([
      {
        id: 'server-1',
        name: 'alpha',
        connect_type: 'direct',
        host: '10.0.0.1',
        port: 22,
        user: 'root',
      },
    ])
  })

  it('uses the updated page header controls', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Servers' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('link', { name: 'Resources' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add Server' })).toBeInTheDocument()
  })

  it('places favorite below shutdown in the actions menu', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'More actions' })[0])

    const menuText = (await screen.findByText('Restart')).parentElement?.parentElement?.textContent ?? ''
    expect(menuText.indexOf('Restart')).toBeLessThan(menuText.indexOf('Shutdown'))
    expect(menuText.indexOf('Shutdown')).toBeLessThan(menuText.indexOf('Add Favorite'))
  })
})