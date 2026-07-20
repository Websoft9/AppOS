import { describe, expect, it, vi } from 'vitest'
import {
  buildSessionExpiryLoginUrl,
  createSessionExpiryHandler,
  getSessionExpiredMessage,
  SESSION_EXPIRED_REASON,
} from './auth-session'

describe('auth-session helpers', () => {
  it('builds a login redirect URL that preserves the current in-app location', () => {
    expect(buildSessionExpiryLoginUrl('/overview?tab=apps#health')).toBe(
      `/login?reason=${SESSION_EXPIRED_REASON}&redirect=%2Foverview%3Ftab%3Dapps%23health`
    )
  })

  it('omits redirect when already on the login page', () => {
    expect(buildSessionExpiryLoginUrl('/login')).toBe(`/login?reason=${SESSION_EXPIRED_REASON}`)
  })

  it('uses product-language session expiry messaging', () => {
    expect(getSessionExpiredMessage()).toBe('Session expired. Please sign in again.')
  })

  it('deduplicates concurrent session-expiry handling', () => {
    const clearAuth = vi.fn()
    const assign = vi.fn()
    const handler = createSessionExpiryHandler({
      clearAuth,
      assign,
      getCurrentPath: () => '/apps?filter=running',
    })

    expect(handler.handle()).toBe(true)
    expect(handler.handle()).toBe(false)
    expect(handler.isInProgress()).toBe(true)
    expect(clearAuth).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith(
      `/login?reason=${SESSION_EXPIRED_REASON}&redirect=%2Fapps%3Ffilter%3Drunning`
    )
  })
})
