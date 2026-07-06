import { describe, expect, it } from 'vitest'
import {
  isReachabilityStale,
  MIN_REACHABILITY_STALE_MINUTES,
  resolveReachabilityStaleAfterMs,
  REACHABILITY_STALE_MULTIPLIER,
  shouldBackgroundProbeReachability,
} from './reachability-policy'

describe('reachability-policy', () => {
  it('uses interval multiplier with a minimum stale threshold', () => {
    expect(resolveReachabilityStaleAfterMs(1)).toBe(MIN_REACHABILITY_STALE_MINUTES * 60 * 1000)
    expect(resolveReachabilityStaleAfterMs(10)).toBe(
      10 * REACHABILITY_STALE_MULTIPLIER * 60 * 1000
    )
  })

  it('treats missing or invalid timestamps as stale', () => {
    expect(isReachabilityStale('')).toBe(true)
    expect(isReachabilityStale('not-a-date')).toBe(true)
  })

  it('marks records stale only after the threshold', () => {
    const nowMs = Date.parse('2026-04-11T10:10:00Z')
    const staleAfterMs = resolveReachabilityStaleAfterMs(2)

    expect(
      isReachabilityStale('2026-04-11T10:06:00Z', staleAfterMs, nowMs)
    ).toBe(false)
    expect(
      shouldBackgroundProbeReachability('2026-04-11T10:04:59Z', staleAfterMs, nowMs)
    ).toBe(true)
  })
})