import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SECRETS_SETTINGS_API_PATH } from '@/lib/settings-api'
import { SecretsPage } from './secrets'

const sendMock = vi.fn()
const getFullListMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () =>
    (config: Record<string, unknown>) => ({
      ...config,
      useSearch: () => ({}),
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

    getFullListMock.mockResolvedValue([])
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/secrets/templates') {
        return Promise.resolve([])
      }
      if (path === SECRETS_SETTINGS_API_PATH) {
        return Promise.resolve({ policy: {} })
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
      expect(sendMock).toHaveBeenCalledWith(SECRETS_SETTINGS_API_PATH, { method: 'GET' })
    })

    expect(sendMock).not.toHaveBeenCalledWith('/api/settings/workspace/secrets', {
      method: 'GET',
    })
  })
})