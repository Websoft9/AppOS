import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsEntryPath } from '@/lib/settings-api'
import { SecretsPage } from './secrets'

const sendMock = vi.fn()
const getFullListMock = vi.fn()
const navigateMock = vi.fn()
let searchState: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => searchState,
    useNavigate: () => navigateMock,
  }),
  useNavigate: () => navigateMock,
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      getFullList: (...args: unknown[]) => getFullListMock(...args),
    }),
  },
}))

describe('SecretsPage policy loading', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getFullListMock.mockReset()
    navigateMock.mockReset()
    searchState = {}

    getFullListMock.mockResolvedValue([])
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/secrets/templates') {
        return Promise.resolve([])
      }
      if (path === settingsEntryPath('secrets-policy')) {
        return Promise.resolve({ value: {} })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads secrets policy using the shared API path constant', async () => {
    render(<SecretsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('secrets-policy'), { method: 'GET' })
    })
  })

  it('clears the edit query param after auto-opening the edit dialog', async () => {
    searchState = { id: 'secret-1', edit: 'secret-1' }
    getFullListMock.mockResolvedValue([
      {
        id: 'secret-1',
        name: 'db-password',
        template_id: 'single_value',
        scope: 'global',
        access_mode: 'mask',
        status: 'active',
      },
    ])
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Secret Value',
            fields: [{ key: 'value', label: 'Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === settingsEntryPath('secrets-policy')) {
        return Promise.resolve({ value: {} })
      }
      return Promise.resolve({})
    })

    render(<SecretsPage />)

    await screen.findByText('Edit Secret')

    expect(navigateMock).toHaveBeenCalledWith({
      to: '.',
      search: expect.any(Function),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '.',
        search: expect.any(Function),
      })
    })
  })

  it('does not render a disclosure chevron in the Name header', async () => {
    getFullListMock.mockResolvedValue([
      {
        id: 'secret-1',
        name: 'db-password',
        template_id: 'single_value',
        scope: 'global',
        access_mode: 'mask',
        status: 'active',
      },
    ])

    render(<SecretsPage />)

    const nameHeader = await screen.findByRole('button', { name: 'Name' })

    expect(nameHeader.querySelector('svg.lucide-chevron-right')).toBeNull()
  })
})
