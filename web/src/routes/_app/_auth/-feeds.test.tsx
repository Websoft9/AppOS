import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './feeds'

const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('@/lib/pb', () => ({
	pb: {
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
		sendMock.mockImplementation((path: string, options?: { body?: Record<string, unknown> }) => {
			if (path === '/api/collections/feed_sources/records?perPage=500&sort=-updated') {
				return Promise.resolve({
					items: [
						{
							id: 'feed-1',
							name: 'Vendor Releases',
							url: 'https://example.com/releases.xml',
							format: 'rss',
							status: 'active',
							poll_interval_minutes: 60,
							last_fetched_at: '2026-05-27T08:00:00Z',
							last_success_at: '2026-05-27T08:00:00Z',
							last_error: '',
						},
					],
				})
			}
			if (path === '/api/collections/feed_items/records?perPage=200&sort=-published_at,-created&expand=source_id') {
				return Promise.resolve({
					items: [
						{
							id: 'item-1',
							source_id: 'feed-1',
							origin_type: 'feed',
							external_id: 'release-1',
							title: 'Security Release 1',
							link: 'https://example.com/releases/1',
							published_at: '2026-05-27T08:00:00Z',
							summary: 'Patch maintenance update with CVE fixes.',
							tags_json: ['security', 'maintenance'],
							read_state: 'unread',
							is_starred: false,
							expand: {
								source_id: {
									id: 'feed-1',
									name: 'Vendor Releases',
									url: 'https://example.com/releases.xml',
									format: 'rss',
									status: 'active',
									poll_interval_minutes: 60,
								},
							},
						},
					],
				})
			}
			if (path === '/api/feeds/bookmarks') {
				return Promise.resolve({
					id: options?.body?.url === 'https://example.com/saved-link' ? 'bookmark-2' : 'bookmark-3',
					origin_type: 'bookmark',
					title: (options?.body?.title as string | undefined) || 'Saved Link',
					link: (options?.body?.url as string | undefined) || 'https://example.com/saved-link',
					summary: (options?.body?.summary as string | undefined) || '',
					read_state: 'unread',
					is_starred: false,
				})
			}
			if (path.startsWith('/api/feeds/bookmarks/')) {
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
				return Promise.resolve({
					id: itemID,
					read_state: (options?.body?.read_state as string | undefined) ?? 'read',
					is_starred: (options?.body?.is_starred as boolean | undefined) ?? false,
				})
			}
			if (path === '/api/feeds/analyze') {
				return Promise.resolve({
					name: 'Example Releases',
					feed_url: 'https://example.com/feed.xml',
					site_url: 'https://example.com',
					site_title: 'Example.com',
					format: 'rss',
				})
			}
			if (path === '/api/collections/feed_sources/records') {
				return Promise.resolve({
					id: 'feed-2',
					name: 'Example Releases',
					url: 'https://example.com/feed.xml',
					format: 'rss',
					status: 'active',
					poll_interval_minutes: 60,
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
			if (path === '/api/collections/feed_sources/records/feed-1') {
				if ((options as { method?: string } | undefined)?.method === 'DELETE') {
					return Promise.resolve({})
				}
				return Promise.resolve({
					id: 'feed-1',
					...(options?.body ?? {}),
				})
			}
			return Promise.resolve({})
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
		expect(screen.getByText('Track RSS and Atom updates.')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /All/ })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Bookmark/ })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Starred/ })).toBeInTheDocument()
		expect(screen.getAllByRole('button', { name: /Vendor Releases/ }).length).toBeGreaterThan(0)
		expect(screen.getByText('(1)')).toBeInTheDocument()
		expect(screen.getByText('Security Release 1')).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'All' })).toBeInTheDocument()
		expect(screen.getAllByText(/Vendor Releases/).length).toBeGreaterThan(0)
		expect(screen.getAllByRole('img')).toHaveLength(2)

		fireEvent.click(screen.getByRole('button', { name: 'Open article search' }))
		expect(screen.getByRole('textbox', { name: 'Search articles' })).toBeInTheDocument()
		fireEvent.change(screen.getByRole('textbox', { name: 'Search articles' }), {
			target: { value: 'Security Release 1' },
		})
		expect(screen.getByText('Security Release 1')).toBeInTheDocument()
		fireEvent.change(screen.getByRole('textbox', { name: 'Search articles' }), {
			target: { value: 'missing phrase' },
		})
		expect(screen.queryByText('Security Release 1')).not.toBeInTheDocument()
		expect(screen.getByText('No feed items for this source.')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
		expect(screen.queryByRole('textbox', { name: 'Search articles' })).not.toBeInTheDocument()
		expect(screen.getByText('Security Release 1')).toBeInTheDocument()

		fireEvent.click(screen.getAllByRole('button', { name: /Vendor Releases/ })[0])
		expect(screen.getByRole('heading', { name: 'Vendor Releases' })).toBeInTheDocument()
		expect(screen.getByText(/Last pull succeeded/i)).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Pull selected source now' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Edit selected source' })).toBeInTheDocument()
		expect(screen.getByText('Security Release 1')).toBeInTheDocument()

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
		expect(screen.getByText('Article Details')).toBeInTheDocument()
		expect(screen.getByText('Patch maintenance update with CVE fixes.')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Keep Unread' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Open Link' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Open Security Release 1' })).toBeInTheDocument()
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
		expect(screen.getByText('Security Release 1')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Open bookmarks' }))
		expect(screen.getByRole('heading', { name: 'Bookmark' })).toBeInTheDocument()
		expect(screen.getByText('Keep quick-access links here without turning them into polling feed sources.')).toBeInTheDocument()
		expect(screen.getByRole('textbox', { name: 'Search bookmarks' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Open article search' })).not.toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Add Bookmark' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Previous bookmark page' })).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Next bookmark page' })).toBeDisabled()
		expect(screen.getByText('Bookmarks: 0')).toBeInTheDocument()
		expect(screen.getByText('1/1')).toBeInTheDocument()
		expect(screen.getByText('No bookmarks saved yet.')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /Add Bookmark/ }))
		fireEvent.change(screen.getByLabelText('Bookmark URL'), {
			target: { value: 'https://example.com/saved-link' },
		})
		fireEvent.change(screen.getByLabelText('Title'), {
			target: { value: 'Saved Link' },
		})
		fireEvent.change(screen.getByLabelText('Description'), {
			target: { value: 'Vendor docs portal' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Save Bookmark' }))
		await waitFor(() => {
			expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks', {
				method: 'POST',
				body: {
					url: 'https://example.com/saved-link',
					title: 'Saved Link',
					summary: 'Vendor docs portal',
				},
			})
		})

		const bookmarksList = screen.getByRole('list', { name: 'Bookmarks list' })
		expect(within(bookmarksList).getAllByRole('listitem')).toHaveLength(1)
		expect(within(bookmarksList).getByText('Saved Link')).toBeInTheDocument()
		expect(within(bookmarksList).getByText('Vendor docs portal')).toBeInTheDocument()
		expect(within(bookmarksList).getByText('https://example.com/saved-link')).toBeInTheDocument()
		expect(within(bookmarksList).getByRole('button', { name: 'Copy bookmark URL Saved Link' })).toBeInTheDocument()
		fireEvent.change(screen.getByRole('textbox', { name: 'Search bookmarks' }), {
			target: { value: 'saved link' },
		})
		expect(within(bookmarksList).getAllByRole('listitem')).toHaveLength(1)
		expect(within(bookmarksList).getByText('Saved Link')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark Saved Link' }))
		await waitFor(() => {
			expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks/bookmark-2', {
				method: 'DELETE',
			})
		})
		expect(screen.getByText('Removed Saved Link from bookmarks.')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
		await waitFor(() => {
			expect(sendMock).toHaveBeenCalledWith('/api/feeds/bookmarks', {
				method: 'POST',
				body: {
					url: 'https://example.com/saved-link',
					title: 'Saved Link',
					summary: 'Vendor docs portal',
				},
			})
		})
		expect(screen.getByText('Restored Saved Link.')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
		await waitFor(() => {
			expect(sendMock).toHaveBeenCalledWith('/api/feeds/poll', {
				method: 'POST',
			})
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
		expect(screen.getByText('Step 1 of 2. Enter an RSS or Atom URL to analyze before subscribing.')).toBeInTheDocument()
		expect(screen.getByText('Paste the feed URL and we will auto-fill the next step.')).toBeInTheDocument()

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
		expect(screen.getByText('RSS')).toBeInTheDocument()
		expect(screen.getByText('active')).toBeInTheDocument()
		expect(screen.getByText('60 min')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))

		await waitFor(() => {
			expect(sendMock).toHaveBeenCalledWith('/api/collections/feed_sources/records', {
				method: 'POST',
				body: {
					name: 'Example Releases',
					url: 'https://example.com/feed.xml',
					format: 'rss',
					status: 'active',
					poll_interval_minutes: 60,
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
		sendMock.mockImplementation((path: string, options?: { body?: Record<string, unknown> }) => {
			if (path === '/api/collections/feed_sources/records?perPage=500&sort=-updated') {
				return Promise.resolve({ items: [] })
			}
			if (path === '/api/collections/feed_items/records?perPage=200&sort=-published_at,-created&expand=source_id') {
				return Promise.resolve({ items: [] })
			}
			if (path === '/api/feeds/analyze') {
				return Promise.resolve({
					name: 'Example Releases',
					feed_url: 'https://example.com/feed.xml',
					site_url: 'https://example.com',
					site_title: 'Example.com',
					format: 'rss',
				})
			}
			if (path === '/api/collections/feed_sources/records') {
				return Promise.reject({
					response: {
						data: {
							message: 'Failed to create record.',
							error: 'SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: feed_sources.url',
						},
					},
				})
			}
			if (path === '/api/collections/feed_sources/records/feed-1') {
				return Promise.resolve({ id: 'feed-1', ...(options?.body ?? {}) })
			}
			return Promise.resolve({})
		})

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
			if (path === '/api/collections/feed_sources/records?perPage=500&sort=-updated') {
				return Promise.resolve({
					items: [
						{
							id: 'feed-1',
							name: 'Vendor Releases',
							url: 'https://example.com/releases.xml',
							format: 'rss',
							status: 'active',
							poll_interval_minutes: 60,
						},
					],
				})
			}
			if (path === '/api/collections/feed_items/records?perPage=200&sort=-published_at,-created&expand=source_id') {
				return Promise.resolve({ items: [] })
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
		expect(screen.getByText('Poll Interval')).toBeInTheDocument()
		expect(screen.getByText('60 min')).toBeInTheDocument()

		fireEvent.change(screen.getByLabelText('Name'), {
			target: { value: 'Vendor Security Releases' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

		await waitFor(() => {
			expect(sendMock).toHaveBeenCalledWith('/api/collections/feed_sources/records/feed-1', {
				method: 'PATCH',
				body: {
					name: 'Vendor Security Releases',
					url: 'https://example.com/releases.xml',
					format: 'rss',
					status: 'active',
					poll_interval_minutes: 60,
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
			screen.getByText('Delete Vendor Releases? This will also delete 1 article already pulled from this source.')
		).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Delete source and articles' }))

		await waitFor(() => {
			expect(sendMock).toHaveBeenCalledWith('/api/collections/feed_sources/records/feed-1', {
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