import { describe, expect, it, vi } from 'vitest'
import { completeLoginRedirect, resolveLoginRedirectTarget } from './-login-redirect'

describe('login redirect helpers', () => {
  it('normalizes same-origin absolute redirects into SPA targets', () => {
    expect(
      resolveLoginRedirectTarget(
        'http://appos.local/actions?returnTo=list#logs',
        'http://appos.local'
      )
    ).toBe('/actions?returnTo=list#logs')
  })

  it('keeps relative in-app redirects as SPA targets', () => {
    expect(resolveLoginRedirectTarget('/resources/servers?create=1', 'http://appos.local')).toBe(
      '/resources/servers?create=1'
    )
  })

  it('rejects cross-origin redirects for SPA routing', () => {
    expect(resolveLoginRedirectTarget('https://example.com/sso', 'http://appos.local')).toBeNull()
  })

  it('uses navigate for same-origin redirects', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined)
    const assign = vi.fn()

    await completeLoginRedirect(
      navigate,
      'http://appos.local/actions?returnTo=list',
      'http://appos.local',
      assign
    )

    expect(navigate).toHaveBeenCalledWith({ to: '/actions?returnTo=list' })
    expect(assign).not.toHaveBeenCalled()
  })

  it('falls back to native navigation for cross-origin redirects', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined)
    const assign = vi.fn()

    await completeLoginRedirect(navigate, 'https://example.com/sso', 'http://appos.local', assign)

    expect(assign).toHaveBeenCalledWith('https://example.com/sso')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('defaults to overview when no redirect is provided', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined)
    const assign = vi.fn()

    await completeLoginRedirect(navigate, undefined, 'http://appos.local', assign)

    expect(navigate).toHaveBeenCalledWith({ to: '/overview' })
    expect(assign).not.toHaveBeenCalled()
  })
})
