import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './feeds'

const sendMock = vi.fn()

vi.mock('qrcode', () => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr-code'),
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr-code'),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    authStore: { token: 'test-token' },
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'su-1', email: 'root@example.com', collectionName: '_superusers' },
  }),
}))

afterEach(() => {
  cleanup()
})

describe('FeedsPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    let bookmarkRecords: Array<{
      id: string
      origin_type: 'bookmark'
      external_id: string
      title: string
      link: string
      favicon_url: string
      summary: string
      read_state: 'unread' | 'read'
      is_starred: boolean
    }> = []
    let feedRecords: Array<{
      id: string
      source_id: string
      origin_type: 'feed'
      external_id: string
      title: string
      link: string
      published_at: string
      summary: string
      content_raw: string
      tags_json: string[]
      read_state: 'unread' | 'read'
      is_starred: boolean
      expand: {
        source_id: {
          id: string
          name: string
          url: string
          favicon_url: string
          format: string
          status: string
        }
      }
    }> = [
      {
        id: 'item-1',
        source_id: 'feed-1',
        origin_type: 'feed' as const,
        external_id: 'release-1',
        title: 'Security Release 1',
        link: 'https://example.com/releases/1',
        published_at: '2026-05-27T08:00:00Z',
        summary: 'Patch maintenance update with CVE fixes.',
        content_raw:
          '<p>Patch maintenance update with <strong>CVE</strong> fixes.</p><p>Includes service restart guidance.</p>',
        tags_json: ['security', 'maintenance'],
        read_state: 'unread' as const,
        is_starred: false,
        expand: {
          source_id: {
            id: 'feed-1',
            name: 'Vendor Releases',
            url: 'https://example.com/releases.xml',
            favicon_url: 'https://example.com/favicon.ico',
            format: 'rss',
            status: 'active',
          },
        },
      },
    ]
    sendMock.mockImplementation(
      (path: string, options?: { body?: Record<string, unknown>; method?: string }) => {
        if (path === '/api/feeds/sources') {
          if (options?.method === 'POST') {
            return Promise.resolve({
              id: 'feed-2',
              name: 'Example Releases',
              url: 'https://example.com/feed.xml',
              favicon_url: 'https://example.com/favicon.ico',
              format: 'rss',
              status: 'active',
            })
          }
          return Promise.resolve({
            items: [
              {
                id: 'feed-1',
                name: 'Vendor Releases',
                url: 'https://example.com/releases.xml',
                favicon_url: 'https://example.com/favicon.ico',
                format: 'rss',
                status: 'active',
                last_fetched_at: '2026-05-27T08:00:00Z',
                last_success_at: '2026-05-27T08:00:00Z',
                last_error: '',
              },
            ],
          })
        }
        if (path === '/api/feeds/summary') {
          return Promise.resolve({
            totalItems: feedRecords.length,
            starredItems: feedRecords.filter(item => item.is_starred).length,
            sourceCounts: [{ sourceId: 'feed-1', count: feedRecords.length }],
          })
        }
        if (path.startsWith('/api/feeds/items?')) {
          const parsed = new URL(path, 'https://appos.local')
          const page = Number(parsed.searchParams.get('page') || '1') || 1
          const perPage = Number(parsed.searchParams.get('perPage') || '20') || 20
          const q = parsed.searchParams.get('q')?.trim().toLowerCase() || ''
          const sourceId = parsed.searchParams.get('sourceId')?.trim() || ''
          const starred = parsed.searchParams.get('starred') === 'true'
          const filteredItems = feedRecords.filter(item => {
            if (sourceId && item.source_id !== sourceId) return false
            if (starred && !item.is_starred) return false
            if (!q) return true
            return [item.title, item.summary, item.link, item.expand?.source_id?.name]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(q)
          })
          const start = (page - 1) * perPage
          return Promise.resolve({
            items: filteredItems.slice(start, start + perPage),
            page,
            perPage,
            totalItems: filteredItems.length,
          })
        }
        if (path.startsWith('/api/feeds/bookmarks?')) {
          const parsed = new URL(path, 'https://appos.local')
          const q = parsed.searchParams.get('q')?.trim().toLowerCase() || ''
          const page = Number(parsed.searchParams.get('page') || '1') || 1
          const perPage = Number(parsed.searchParams.get('perPage') || '10') || 10
          const filtered = bookmarkRecords.filter(item => {
            if (!q) return true
            return [item.title, item.summary, item.link]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(q)
          })
          const start = (page - 1) * perPage
          return Promise.resolve({
            items: filtered.slice(start, start + perPage),
            page,
            perPage,
            totalItems: filtered.length,
            totalBookmarks: bookmarkRecords.length,
          })
        }
        if (path === '/api/feeds/bookmarks/analyze') {
          return Promise.resolve({
            title: 'Saved Link',
            description: 'Vendor docs portal',
            favicon_url: 'https://example.com/favicon.ico',
            resolved_url: 'https://example.com/saved-link',
          })
        }
        if (path === '/api/feeds/bookmarks') {
          const created = {
            id:
              options?.body?.url === 'https://example.com/saved-link' ? 'bookmark-2' : 'bookmark-3',
            origin_type: 'bookmark',
            external_id: 'bookmark',
            title: (options?.body?.title as string | undefined) || 'Saved Link',
            link: (options?.body?.url as string | undefined) || 'https://example.com/saved-link',
            favicon_url: (options?.body?.favicon_url as string | undefined) || '',
            summary: (options?.body?.summary as string | undefined) || '',
            read_state: 'unread',
            is_starred: false,
          } as const
          bookmarkRecords = [created, ...bookmarkRecords.filter(item => item.id !== created.id)]
          return Promise.resolve(created)
        }
        if (path.startsWith('/api/feeds/bookmarks/')) {
          const id = path.split('/').pop()
          if ((options as { method?: string } | undefined)?.method === 'PATCH') {
            bookmarkRecords = bookmarkRecords.map(item =>
              item.id === id
                ? {
                    ...item,
                    title: (options?.body?.title as string | undefined) || item.title,
                    link: (options?.body?.url as string | undefined) || item.link,
                    summary: (options?.body?.summary as string | undefined) || item.summary,
                    favicon_url:
                      (options?.body?.favicon_url as string | undefined) || item.favicon_url,
                  }
                : item
            )
            return Promise.resolve(bookmarkRecords.find(item => item.id === id) ?? {})
          }
          bookmarkRecords = bookmarkRecords.filter(item => item.id !== id)
          return Promise.resolve({})
        }
        if (path === '/api/feeds/poll') {
          return Promise.resolve({
            summary: {
              ProcessedSources: 1,
              DueSources: 1,
              FailedSources: 0,
              CreatedItems: 2,
              UpdatedItems: 1,
            },
          })
        }
        if (path === '/api/feeds/sources/feed-1/poll') {
          return Promise.resolve({
            summary: {
              ProcessedSources: 1,
              DueSources: 1,
              FailedSources: 0,
              CreatedItems: 1,
              UpdatedItems: 0,
            },
          })
        }
        if (path.startsWith('/api/feeds/items/') && path.endsWith('/state')) {
          const itemID = path.split('/')[4]
          feedRecords = feedRecords.map(item =>
            item.id === itemID
              ? {
                  ...item,
                  read_state:
                    (options?.body?.read_state as 'unread' | 'read' | undefined) ?? item.read_state,
                  is_starred: (options?.body?.is_starred as boolean | undefined) ?? item.is_starred,
                }
              : item
          )
          const updatedItem = feedRecords.find(item => item.id === itemID)
          return Promise.resolve({
            id: itemID,
            read_state: updatedItem?.read_state ?? 'read',
            is_starred: updatedItem?.is_starred ?? false,
          })
        }
        if (path === '/api/feeds/items/item-1/bookmark') {
          const converted = {
            id: 'item-1',
            origin_type: 'bookmark',
            external_id: 'example.com/releases/1',
            title: 'Security Release 1',
            link: 'https://example.com/releases/1',
            favicon_url: 'https://example.com/favicon.ico',
            summary: 'Patch maintenance update with CVE fixes.',
            read_state: 'read',
            is_starred: false,
          } as const
          feedRecords = feedRecords.filter(item => item.id !== converted.id)
          bookmarkRecords = [converted, ...bookmarkRecords.filter(item => item.id !== converted.id)]
          return Promise.resolve(converted)
        }
        if (path === '/api/feeds/analyze') {
          return Promise.resolve({
            name: 'Example Releases',
            feed_url: 'https://example.com/feed.xml',
            site_url: 'https://example.com',
            site_title: 'Example.com',
            favicon_url: 'https://example.com/favicon.ico',
            format: 'rss',
          })
        }
        if (path === '/api/feeds/sources/feed-2/poll') {
          return Promise.resolve({
            summary: {
              ProcessedSources: 1,
              DueSources: 1,
              FailedSources: 0,
              CreatedItems: 8,
              UpdatedItems: 0,
            },
          })
        }
        if (path === '/api/feeds/sources/feed-1') {
          if (options?.method === 'DELETE') {
            return Promise.resolve({})
          }
          return Promise.resolve({
            id: 'feed-1',
            ...(options?.body ?? {}),
          })
        }
        return Promise.resolve({})
      }
    )
  })

  it('removes the legacy global cleanup action from the feeds page', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/feeds/sources') {
        return Promise.resolve({
          items: [
            {
              id: 'feed-1',
              name: 'Vendor Releases',
              url: 'https://example.com/releases.xml',
              favicon_url: 'https://example.com/favicon.ico',
              format: 'rss',
              status: 'active',
              last_fetched_at: '2026-05-27T08:00:00Z',
              last_success_at: '2026-05-27T08:00:00Z',
              last_error: '',
            },
          ],
        })
      }
      if (path === '/api/feeds/summary') {
        return Promise.resolve({
          totalItems: 5,
          starredItems: 1,
          sourceCounts: [{ sourceId: 'feed-1', count: 5 }],
        })
      }
      if (path.startsWith('/api/feeds/items?')) {
        return Promise.resolve({
          items: [],
          page: 1,
          perPage: 20,
          totalItems: 5,
        })
      }
      if (path.startsWith('/api/feeds/bookmarks?')) {
        return Promise.resolve({
          items: [],
          page: 1,
          perPage: 10,
          totalItems: 0,
          totalBookmarks: 0,
        })
      }
      return Promise.resolve({})
    })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: 'Cleanup' })).not.toBeInTheDocument()
  })

  it('deletes the oldest articles for the selected source without deleting the source', async () => {
    let sourceItems = [
      {
        id: 'item-1',
        source_id: 'feed-1',
        origin_type: 'feed' as const,
        external_id: 'release-1',
        title: 'Security Release 1',
        link: 'https://example.com/releases/1',
        published_at: '2026-05-27T08:00:00Z',
        summary: 'Patch maintenance update with CVE fixes.',
        content_raw: 'body',
        tags_json: ['security'],
        read_state: 'unread' as const,
        is_starred: false,
        expand: {
          source_id: {
            id: 'feed-1',
            name: 'Vendor Releases',
            url: 'https://example.com/releases.xml',
            favicon_url: 'https://example.com/favicon.ico',
            format: 'rss',
            status: 'active',
          },
        },
      },
      {
        id: 'item-2',
        source_id: 'feed-1',
        origin_type: 'feed' as const,
        external_id: 'release-2',
        title: 'Security Release 2',
        link: 'https://example.com/releases/2',
        published_at: '2026-05-27T09:00:00Z',
        summary: 'Second update.',
        content_raw: 'body',
        tags_json: ['security'],
        read_state: 'unread' as const,
        is_starred: false,
        expand: {
          source_id: {
            id: 'feed-1',
            name: 'Vendor Releases',
            url: 'https://example.com/releases.xml',
            favicon_url: 'https://example.com/favicon.ico',
            format: 'rss',
            status: 'active',
          },
        },
      },
    ]
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/feeds/sources') {
        return Promise.resolve({
          items: [
            {
              id: 'feed-1',
              name: 'Vendor Releases',
              url: 'https://example.com/releases.xml',
              favicon_url: 'https://example.com/favicon.ico',
              format: 'rss',
              status: 'active',
              item_count: sourceItems.length,
              last_fetched_at: '2026-05-27T08:00:00Z',
              last_success_at: '2026-05-27T08:00:00Z',
              last_error: '',
            },
          ],
        })
      }
      if (path === '/api/feeds/summary') {
        return Promise.resolve({
          totalItems: sourceItems.length,
          starredItems: 0,
          sourceCounts: [{ sourceId: 'feed-1', count: sourceItems.length }],
        })
      }
      if (path.startsWith('/api/feeds/items?')) {
        return Promise.resolve({
          items: sourceItems,
          page: 1,
          perPage: 20,
          totalItems: sourceItems.length,
        })
      }
      if (path.startsWith('/api/feeds/bookmarks?')) {
        return Promise.resolve({
          items: [],
          page: 1,
          perPage: 10,
          totalItems: 0,
          totalBookmarks: 0,
        })
      }
      if (path === '/api/feeds/sources/feed-1/delete') {
        sourceItems = sourceItems.slice(1)
        return Promise.resolve({ source_id: 'feed-1', deleted_count: 1, remaining_count: 1 })
      }
      return Promise.resolve({})
    })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Vendor Releases/ }).length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getAllByRole('button', { name: /Vendor Releases/ })[0])

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Delete selected source articles' })
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected source articles' }))

    await waitFor(() => {
      expect(screen.getByText('Delete Feed Articles')).toBeInTheDocument()
    })
    expect(
      screen.getByText(
        'Delete up to 2 pulled articles from Vendor Releases. If you choose fewer than the total, the oldest articles will be deleted first.'
      )
    ).toBeInTheDocument()
    const countInput = screen.getByLabelText('Article count')
    fireEvent.change(countInput, { target: { value: '1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Delete oldest articles' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/sources/feed-1/delete', {
        method: 'POST',
        body: { count: 1 },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Deleted 1 oldest article from Vendor Releases.')).toBeInTheDocument()
    })
  })

  it('loads feed sources, shows items, and persists reader actions', async () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Feeds' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open bookmarks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Source' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open article search' })).toBeInTheDocument()
    expect(
      screen.getByText('Unified hub for RSS feeds, web content and bookmarks.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bookmark/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Starred/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Vendor Releases/ }).length).toBeGreaterThan(0)
    expect(screen.getByText('Security Release 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'All' })).toBeInTheDocument()
    expect(screen.getAllByText(/Vendor Releases/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('img')).toHaveLength(2)
    const articleRow = screen
      .getByText('Security Release 1')
      .closest('div.rounded-lg.border.bg-card.px-4.py-3')
    expect(articleRow).not.toBeNull()
    expect(
      within(articleRow as HTMLElement).getByAltText('Vendor Releases favicon')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open article search' }))
    expect(screen.getByRole('textbox', { name: 'Search articles' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search articles' }), {
      target: { value: 'Security Release 1' },
    })
    await waitFor(() => {
      expect(screen.getByText('Security Release 1')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search articles' }), {
      target: { value: 'missing phrase' },
    })
    await waitFor(() => {
      expect(screen.queryByText('Security Release 1')).not.toBeInTheDocument()
      expect(screen.getByText('No feed items for this source.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(screen.queryByRole('textbox', { name: 'Search articles' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Security Release 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: /Vendor Releases/ })[0])
    expect(screen.getByRole('heading', { name: 'Vendor Releases' })).toBeInTheDocument()
    expect(screen.getByText(/Last pull succeeded/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pull selected source now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit selected source' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Security Release 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pull selected source now' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/sources/feed-1/poll', {
        method: 'POST',
      })
    })

    fireEvent.click(screen.getByText('Security Release 1'))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/items/item-1/state', {
        method: 'PATCH',
        body: { read_state: 'read' },
      })
    })
    expect(screen.queryByText('Article Details')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'Patch maintenance update with CVE fixes.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Includes service restart guidance.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep Unread' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bookmark' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Link' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Security Release 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    const shareDialog = screen.getByRole('dialog')
    expect(within(shareDialog).getByRole('heading', { name: 'Share' })).toBeInTheDocument()
    expect(within(shareDialog).getByRole('textbox', { name: 'Share URL' })).toHaveValue(
      'https://example.com/releases/1?from=appos'
    )
    await waitFor(() => {
      expect(
        within(shareDialog).getByRole('img', { name: 'QR code for Security Release 1' })
      ).toHaveAttribute('src', 'data:image/png;base64,qr-code')
    })
    fireEvent.click(within(shareDialog).getByRole('button', { name: 'Copy URL' }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://example.com/releases/1?from=appos'
      )
    })
    expect(within(shareDialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    fireEvent.click(within(shareDialog).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Share' })).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Star' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/items/item-1/state', {
        method: 'PATCH',
        body: { is_starred: true },
      })
    })
    expect(screen.getAllByRole('button', { name: /Starred/ }).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: /Starred/ })[0])
    expect(screen.getByRole('heading', { name: 'Starred' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Security Release 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open bookmarks' }))
    expect(screen.getByRole('heading', { name: 'Bookmark' })).toBeInTheDocument()
    expect(
      screen.getByText('Centralize AppOS-related resources and personal favorite links here.')
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search bookmarks' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open article search' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Bookmark' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous bookmark page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next bookmark page' })).toBeDisabled()
    await waitFor(() => {
      expect(screen.getByText('Total: 0')).toBeInTheDocument()
      expect(screen.getByText('1/1')).toBeInTheDocument()
    })
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Domain')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('No bookmarks saved yet.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Add Bookmark/ }))
    fireEvent.change(screen.getByLabelText('Bookmark URL'), {
      target: { value: 'https://example.com/saved-link' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch Details' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks/analyze', {
        method: 'POST',
        body: { url: 'https://example.com/saved-link' },
      })
    })
    expect(screen.getByDisplayValue('Saved Link')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Vendor docs portal')).toBeInTheDocument()
    expect(screen.getByText('Detected favicon')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/favicon.ico')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save Bookmark' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks', {
        method: 'POST',
        body: {
          url: 'https://example.com/saved-link',
          title: 'Saved Link',
          summary: 'Vendor docs portal',
          favicon_url: 'https://example.com/favicon.ico',
        },
      })
    })

    const bookmarksList = screen.getByRole('list', { name: 'Bookmarks list' })
    expect(within(bookmarksList).getAllByRole('listitem')).toHaveLength(1)
    const savedLink = within(bookmarksList).getByRole('link', { name: 'Saved Link' })
    expect(savedLink).toBeInTheDocument()
    expect(savedLink).toHaveAttribute('title', 'Vendor docs portal')
    expect(savedLink).toHaveAttribute('href', 'https://example.com/saved-link')
    expect(within(bookmarksList).getByText('example.com')).toBeInTheDocument()
    const copyButton = within(bookmarksList).getByRole('button', {
      name: 'Copy bookmark URL Saved Link',
    })
    expect(copyButton).toBeInTheDocument()
    fireEvent.click(copyButton)
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/saved-link')
    })
    expect(within(bookmarksList).getByText('Copied')).toBeInTheDocument()
    expect(screen.queryByText('Copied link for Saved Link.')).not.toBeInTheDocument()
    expect(
      within(bookmarksList).getByRole('button', { name: 'Edit bookmark Saved Link' })
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search bookmarks' }), {
      target: { value: 'saved link' },
    })
    expect(within(bookmarksList).getAllByRole('listitem')).toHaveLength(1)
    expect(within(bookmarksList).getByRole('link', { name: 'Saved Link' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit bookmark Saved Link' }))
    expect(screen.getByRole('heading', { name: 'Edit Bookmark' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Saved Link Updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks/bookmark-2', {
        method: 'PATCH',
        body: {
          url: 'https://example.com/saved-link',
          title: 'Saved Link Updated',
          summary: 'Vendor docs portal',
          favicon_url: 'https://example.com/favicon.ico',
        },
      })
    })
    expect(
      within(bookmarksList).getByRole('link', { name: 'Saved Link Updated' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark Saved Link Updated' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks/bookmark-2', {
        method: 'DELETE',
      })
    })
    expect(screen.getByText('Removed Saved Link Updated from bookmarks.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks', {
        method: 'POST',
        body: {
          url: 'https://example.com/saved-link',
          title: 'Saved Link Updated',
          summary: 'Vendor docs portal',
          favicon_url: 'https://example.com/favicon.ico',
        },
      })
    })
    expect(screen.getByText('Restored Saved Link Updated.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/sources', {})
    })
    expect(sendMock).not.toHaveBeenCalledWith('/api/feeds/poll', {
      method: 'POST',
    })
  }, 20000)

  it('converts an article into a bookmark from article actions', async () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('Security Release 1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Security Release 1'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bookmark' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/items/item-1/bookmark', {
        method: 'POST',
      })
    })
    expect(screen.getByRole('heading', { name: 'Bookmark' })).toBeInTheDocument()
    expect(screen.getByText('Moved Security Release 1 to bookmarks.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Security Release 1' })).toHaveAttribute(
      'href',
      'https://example.com/releases/1'
    )
  })

  it('shows bookmark title hover description, domain-only URL, and late-loading favicon from bookmark metadata', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/feeds/sources') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/feeds/summary') {
        return Promise.resolve({ totalItems: 0, starredItems: 0, sourceCounts: [] })
      }
      if (path.startsWith('/api/feeds/items?')) {
        return Promise.resolve({ items: [], page: 1, perPage: 20, totalItems: 0 })
      }
      if (path.startsWith('/api/feeds/bookmarks?')) {
        return Promise.resolve({
          items: [
            {
              id: 'bookmark-1',
              origin_type: 'bookmark',
              external_id: 'bookmark-1',
              title: 'Websoft9 | 开源应用聚合与托管运维平台/服务器面板/云应用部署',
              link: 'https://www.websoft9.com/',
              favicon_url:
                'https://www.websoft9.com/favicon-32x32.png?v=0c3567d01883fb100f92704d2a7c1f24',
              summary: 'Websoft9（微聚云） 是一个创新的企业云应用托管平台。',
              read_state: 'unread',
              is_starred: false,
            },
          ],
          page: 1,
          perPage: 10,
          totalItems: 1,
          totalBookmarks: 1,
        })
      }
      return Promise.resolve({})
    })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open bookmarks' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open bookmarks' }))

    const bookmarkRow = await screen.findByRole('listitem', {
      name: /Bookmark Websoft9 \| 开源应用聚合与托管运维平台\/服务器面板\/云应用部署/i,
    })
    const websiteLink = within(bookmarkRow).getByRole('link', { name: /Websoft9/i })
    expect(websiteLink).toHaveAttribute(
      'title',
      'Websoft9（微聚云） 是一个创新的企业云应用托管平台。'
    )
    expect(within(bookmarkRow).getByText('www.websoft9.com')).toBeInTheDocument()
    expect(within(bookmarkRow).queryByText('https://www.websoft9.com')).not.toBeInTheDocument()
    expect(within(bookmarkRow).getByRole('button', { name: /Edit bookmark/i })).toBeInTheDocument()

    const favicon = within(bookmarkRow).getByAltText(/favicon/i) as HTMLImageElement
    expect(favicon.getAttribute('src')).toBe(
      '/api/feeds/favicon?url=https%3A%2F%2Fwww.websoft9.com%2Ffavicon-32x32.png%3Fv%3D0c3567d01883fb100f92704d2a7c1f24&token=test-token'
    )

    await new Promise(resolve => window.setTimeout(resolve, 250))
    expect(within(bookmarkRow).getByAltText(/favicon/i)).toBeInTheDocument()
  })

  it('loads more articles when the browser scroll reaches the page bottom', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 4000,
      configurable: true,
    })
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true,
    })
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      configurable: true,
    })

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/feeds/sources') {
        return Promise.resolve({
          items: [
            {
              id: 'feed-1',
              name: 'Vendor Releases',
              url: 'https://example.com/releases.xml',
              favicon_url: 'https://example.com/favicon.ico',
              format: 'rss',
              status: 'active',
            },
          ],
        })
      }
      if (path === '/api/feeds/summary') {
        return Promise.resolve({
          totalItems: 25,
          starredItems: 0,
          sourceCounts: [{ sourceId: 'feed-1', count: 25 }],
        })
      }
      if (path.startsWith('/api/feeds/items?')) {
        const parsed = new URL(path, 'https://appos.local')
        const page = Number(parsed.searchParams.get('page') || '1') || 1
        const perPage = Number(parsed.searchParams.get('perPage') || '20') || 20
        const allItems = Array.from({ length: 25 }, (_, index) => ({
          id: `item-${index + 1}`,
          source_id: 'feed-1',
          origin_type: 'feed',
          external_id: `release-${index + 1}`,
          title: `Security Release ${index + 1}`,
          link: `https://example.com/releases/${index + 1}`,
          published_at: `2026-05-${String(27 - Math.min(index, 20)).padStart(2, '0')}T08:00:00Z`,
          summary: `Patch maintenance update ${index + 1}.`,
          read_state: 'unread',
          is_starred: false,
          expand: {
            source_id: {
              id: 'feed-1',
              name: 'Vendor Releases',
              url: 'https://example.com/releases.xml',
              favicon_url: 'https://example.com/favicon.ico',
              format: 'rss',
              status: 'active',
            },
          },
        }))
        const start = (page - 1) * perPage
        return Promise.resolve({
          items: allItems.slice(start, start + perPage),
          page,
          perPage,
          totalItems: allItems.length,
        })
      }
      if (path.startsWith('/api/feeds/bookmarks?')) {
        return Promise.resolve({
          items: [],
          page: 1,
          perPage: 10,
          totalItems: 0,
          totalBookmarks: 0,
        })
      }
      return Promise.resolve({})
    })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('Security Release 20')).toBeInTheDocument()
    })
    expect(screen.queryByText('Security Release 21')).not.toBeInTheDocument()

    Object.defineProperty(window, 'scrollY', {
      value: 3200,
      configurable: true,
    })
    fireEvent.scroll(window)

    await waitFor(() => {
      expect(screen.getByText('Security Release 21')).toBeInTheDocument()
    })
  })

  it('analyzes a feed URL before subscribing a new source', async () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Add Source' })[0]).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Source' })[0])
    expect(screen.getAllByText('Analyze Feed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Subscribe').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Step 1 of 2. Enter an RSS or Atom URL to analyze before subscribing.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Paste the feed URL and we will auto-fill the next step.')
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('RSS or Atom URL'), {
      target: { value: 'https://example.com/feed.xml' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Feed' }))
    expect(screen.getByText('Analyzing feed URL')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/analyze', {
        method: 'POST',
        body: { url: 'https://example.com/feed.xml' },
      })
    })

    expect(screen.getByDisplayValue('Example Releases')).toBeInTheDocument()
    expect(screen.getByText('Analysis complete')).toBeInTheDocument()
    expect(screen.getByText('Feed URL')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/feed.xml')).toBeInTheDocument()
    expect(screen.getByText('Website')).toBeInTheDocument()
    expect(screen.getByText('Example.com')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.getByText('Detected favicon')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/favicon.ico')).toBeInTheDocument()
    expect(screen.getByText('RSS')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/sources', {
        method: 'POST',
        body: {
          name: 'Example Releases',
          url: 'https://example.com/feed.xml',
          favicon_url: 'https://example.com/favicon.ico',
          format: 'rss',
          status: 'active',
        },
      })
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/sources/feed-2/poll', {
        method: 'POST',
      })
    })
  })

  it('shows a duplicate-url specific error when source creation conflicts', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { body?: Record<string, unknown>; method?: string }) => {
        if (path === '/api/feeds/sources') {
          if (options?.method === 'POST') {
            return Promise.reject({
              response: {
                data: {
                  code: 'feed_source_exists',
                  message: 'feed source url already exists',
                },
              },
            })
          }
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/feeds/summary') {
          return Promise.resolve({ totalItems: 0, starredItems: 0, sourceCounts: [] })
        }
        if (path.startsWith('/api/feeds/items?')) {
          return Promise.resolve({ items: [], page: 1, perPage: 20, totalItems: 0 })
        }
        if (path.startsWith('/api/feeds/bookmarks?')) {
          return Promise.resolve({
            items: [],
            page: 1,
            perPage: 10,
            totalItems: 0,
            totalBookmarks: 0,
          })
        }
        if (path === '/api/feeds/analyze') {
          return Promise.resolve({
            name: 'Example Releases',
            feed_url: 'https://example.com/feed.xml',
            site_url: 'https://example.com',
            site_title: 'Example.com',
            favicon_url: 'https://example.com/favicon.ico',
            format: 'rss',
          })
        }
        if (path === '/api/feeds/sources/feed-1') {
          return Promise.resolve({ id: 'feed-1', ...(options?.body ?? {}) })
        }
        return Promise.resolve({})
      }
    )

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Add Source' })[0]).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Source' })[0])
    fireEvent.change(screen.getByLabelText('RSS or Atom URL'), {
      target: { value: 'https://example.com/feed.xml' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Feed' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/analyze', {
        method: 'POST',
        body: { url: 'https://example.com/feed.xml' },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))

    await waitFor(() => {
      expect(screen.getByText('This RSS or Atom URL has already been added.')).toBeInTheDocument()
    })
  })

  it('shows a duplicate-url specific error when bookmark creation conflicts', async () => {
    sendMock.mockImplementation((path: string, options?: { body?: Record<string, unknown> }) => {
      if (path === '/api/feeds/sources') {
        return Promise.resolve({
          items: [
            {
              id: 'feed-1',
              name: 'Vendor Releases',
              url: 'https://example.com/releases.xml',
              format: 'rss',
              status: 'active',
            },
          ],
        })
      }
      if (path === '/api/feeds/summary') {
        return Promise.resolve({
          totalItems: 0,
          starredItems: 0,
          sourceCounts: [{ sourceId: 'feed-1', count: 0 }],
        })
      }
      if (path.startsWith('/api/feeds/items?')) {
        return Promise.resolve({ items: [], page: 1, perPage: 20, totalItems: 0 })
      }
      if (path.startsWith('/api/feeds/bookmarks?')) {
        return Promise.resolve({
          items: [],
          page: 1,
          perPage: 10,
          totalItems: 0,
          totalBookmarks: 0,
        })
      }
      if (path === '/api/feeds/bookmarks') {
        return Promise.reject({
          response: {
            data: {
              code: 'bookmark_exists',
              message: 'bookmark already exists',
              existing: {
                id: 'bookmark-1',
                title: 'Saved Link',
                link: options?.body?.url,
              },
            },
          },
        })
      }
      return Promise.resolve({})
    })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Bookmark/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open bookmarks' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Bookmark/ }))
    fireEvent.change(screen.getByLabelText('Bookmark URL'), {
      target: { value: 'https://example.com/saved-link' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Bookmark' }))

    await waitFor(() => {
      expect(screen.getByText('This bookmark already exists.')).toBeInTheDocument()
    })
  })

  it('validates bookmark URLs before analyze and save', async () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Bookmark/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open bookmarks' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Bookmark/ }))
    fireEvent.change(screen.getByLabelText('Bookmark URL'), {
      target: { value: 'example.com/saved-link' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch Details' }))
    expect(screen.getByText('Enter a URL starting with http:// or https://.')).toBeInTheDocument()
    expect(sendMock).not.toHaveBeenCalledWith('/api/feeds/bookmarks/analyze', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Save Bookmark' }))
    expect(screen.getByText('Enter a URL starting with http:// or https://.')).toBeInTheDocument()
    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/feeds/bookmarks',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('falls back to legacy copy when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    })
    const execCommandSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true)

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open bookmarks' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open bookmarks' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Bookmark/ }))
    fireEvent.change(screen.getByLabelText('Bookmark URL'), {
      target: { value: 'https://example.com/saved-link' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Bookmark' }))

    const bookmarksList = await screen.findByRole('list', { name: 'Bookmarks list' })
    fireEvent.click(
      within(bookmarksList).getByRole('button', { name: 'Copy bookmark URL Saved Link' })
    )

    await waitFor(() => {
      expect(execCommandSpy).toHaveBeenCalledWith('copy')
    })
    expect(within(bookmarksList).getByText('Copied')).toBeInTheDocument()
    expect(screen.queryByText('Failed to copy bookmark URL')).not.toBeInTheDocument()

    execCommandSpy.mockRestore()
  })

  it('shows a specific error when bookmark analysis targets a private URL', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/feeds/sources') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/feeds/summary') {
        return Promise.resolve({ totalItems: 0, starredItems: 0, sourceCounts: [] })
      }
      if (path.startsWith('/api/feeds/items?')) {
        return Promise.resolve({ items: [], page: 1, perPage: 20, totalItems: 0 })
      }
      if (path.startsWith('/api/feeds/bookmarks?')) {
        return Promise.resolve({
          items: [],
          page: 1,
          perPage: 10,
          totalItems: 0,
          totalBookmarks: 0,
        })
      }
      if (path === '/api/feeds/bookmarks/analyze') {
        return Promise.reject({
          response: {
            data: {
              message: 'failed to analyze bookmark url',
              error: 'private/loopback URLs are not allowed',
            },
          },
        })
      }
      return Promise.resolve({})
    })

    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Bookmark/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open bookmarks' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Bookmark/ }))
    fireEvent.change(screen.getByLabelText('Bookmark URL'), {
      target: { value: 'http://localhost/internal' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch Details' }))

    await waitFor(() => {
      expect(screen.getByText('Private or local URLs cannot be analyzed.')).toBeInTheDocument()
    })
  })

  it('limits editable fields in edit source dialog', async () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Vendor Releases/ })[0]).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: /Vendor Releases/ })[0])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit selected source' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit selected source' }))

    expect(screen.queryByText('Analyze Feed')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Vendor Releases')).toBeInTheDocument()
    expect(screen.getByText('Feed URL')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/releases.xml')).toBeInTheDocument()
    expect(screen.getByText('Website')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.getByText('Format')).toBeInTheDocument()
    expect(screen.getByText('RSS')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Feed URL and format are immutable identity fields. Create a new source if the upstream feed changes.'
      )
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Vendor Security Releases' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/sources/feed-1', {
        method: 'PATCH',
        body: {
          name: 'Vendor Security Releases',
          favicon_url: 'https://example.com/favicon.ico',
          status: 'active',
        },
      })
    })
  })

  it('deletes a source from the edit dialog after confirming article removal', async () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component
    render(<Component />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Vendor Releases/ })[0]).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: /Vendor Releases/ })[0])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit selected source' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit selected source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Source' }))

    expect(screen.getByRole('heading', { name: 'Delete Feed Source' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Delete Vendor Releases? This will also delete 1 article already pulled from this source.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete source and articles' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/feeds/sources/feed-1', {
        method: 'DELETE',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Deleted source Vendor Releases.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Deleted source Vendor Releases.')).not.toBeInTheDocument()
  })
})
