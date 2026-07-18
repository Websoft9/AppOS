import { describe, expect, it } from 'vitest'
import {
  canonicalReachabilityStatus,
  localizeReachabilityStatus,
  reachabilityStatusVariant,
} from './resource-status'

const labels = {
  reachable: 'Reachable',
  unreachable: 'Unreachable',
  unknown: 'Unknown',
}

describe('resource-status reachability helpers', () => {
  it('normalizes monitor and live probe statuses into a canonical reachability model', () => {
    expect(canonicalReachabilityStatus('reachable')).toBe('reachable')
    expect(canonicalReachabilityStatus('healthy')).toBe('reachable')
    expect(canonicalReachabilityStatus('online')).toBe('reachable')
    expect(canonicalReachabilityStatus('unreachable')).toBe('unreachable')
    expect(canonicalReachabilityStatus('offline')).toBe('unreachable')
    expect(canonicalReachabilityStatus('credential_invalid')).toBe('unreachable')
    expect(canonicalReachabilityStatus('degraded')).toBe('unknown')
    expect(canonicalReachabilityStatus(undefined)).toBe('unknown')
  })

  it('localizes canonical reachability values consistently', () => {
    expect(localizeReachabilityStatus('healthy', labels)).toBe('Reachable')
    expect(localizeReachabilityStatus('offline', labels)).toBe('Unreachable')
    expect(localizeReachabilityStatus('mystery', labels)).toBe('Unknown')
  })

  it('uses a consistent badge variant across resource pages', () => {
    expect(reachabilityStatusVariant('healthy')).toBe('default')
    expect(reachabilityStatusVariant('offline')).toBe('destructive')
    expect(reachabilityStatusVariant('unknown')).toBe('secondary')
  })
})
