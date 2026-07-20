import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCatalogAllApps } from './catalog-api'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useCatalogAllApps', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps fetching pages until the full official seed is loaded', async () => {
    sendMock.mockImplementation((url: string) => {
      const search = new URL(url, 'http://localhost').searchParams
      const offset = Number(search.get('offset') ?? '0')

      if (offset === 0) {
        return Promise.resolve({
          items: [
            {
              key: 'clickhouse',
              title: 'ClickHouse',
              overview: 'Overview 1',
              source: 'official',
              visibility: 'public',
              primaryCategory: null,
              secondaryCategories: [],
              badges: [],
              template: { key: 'clickhouse', source: 'official', available: true },
              personalization: { isFavorite: false, hasNote: false },
            },
            {
              key: 'nocodb',
              title: 'NocoDB',
              overview: 'Overview 2',
              source: 'official',
              visibility: 'public',
              primaryCategory: null,
              secondaryCategories: [],
              badges: [],
              template: { key: 'nocodb', source: 'official', available: true },
              personalization: { isFavorite: false, hasNote: false },
            },
          ],
          page: { limit: 2, offset: 0, total: 3, hasMore: true },
          meta: { locale: 'en', sourceVersion: 'test' },
        })
      }

      return Promise.resolve({
        items: [
          {
            key: 'wordpress',
            title: 'WordPress',
            overview: 'Overview 3',
            source: 'official',
            visibility: 'public',
            primaryCategory: null,
            secondaryCategories: [],
            badges: [],
            template: { key: 'wordpress', source: 'official', available: true },
            personalization: { isFavorite: false, hasNote: false },
          },
        ],
        page: { limit: 2, offset: 2, total: 3, hasMore: false },
        meta: { locale: 'en', sourceVersion: 'test' },
      })
    })

    const { result } = renderHook(
      () =>
        useCatalogAllApps({
          locale: 'en',
          source: 'official',
          limit: 2,
          offset: 0,
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.data?.items).toHaveLength(3)
    })

    expect(result.current.data?.items.map(item => item.key)).toEqual([
      'clickhouse',
      'nocodb',
      'wordpress',
    ])
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock).toHaveBeenNthCalledWith(
      1,
      '/api/catalog/apps?locale=en&source=official&limit=2&offset=0',
      { method: 'GET' }
    )
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      '/api/catalog/apps?locale=en&source=official&limit=2&offset=2',
      { method: 'GET' }
    )
  })
})
