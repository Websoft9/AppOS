import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildActionWebSocketUrl } from './action-utils'

const { authStore } = vi.hoisted(() => ({
	authStore: {
		token: '',
	},
}))

vi.mock('@/lib/pb', () => ({
	pb: {
		authStore,
	},
}))

describe('buildActionWebSocketUrl', () => {
	beforeEach(() => {
		authStore.token = ''
		window.history.replaceState({}, '', '/actions/demo')
	})

	it('uses the current browser host and protocol', () => {
		const url = new URL(buildActionWebSocketUrl('act_123'))

		expect(url.protocol).toBe(window.location.protocol === 'https:' ? 'wss:' : 'ws:')
		expect(url.host).toBe(window.location.host)
		expect(url.pathname).toBe('/api/actions/act_123/stream')
		expect(url.search).toBe('')
	})

	it('preserves the auth token as a query parameter for websocket routes', () => {
		authStore.token = 'token-123'

		const url = new URL(buildActionWebSocketUrl('act_live'))

		expect(url.pathname).toBe('/api/actions/act_live/stream')
		expect(url.searchParams.get('token')).toBe('token-123')
	})
})