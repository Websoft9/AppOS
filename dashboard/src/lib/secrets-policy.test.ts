import { describe, expect, it } from 'vitest'
import { canRevealSecret, DEFAULT_SECRET_POLICY, normalizeSecretPolicy } from './secrets-policy'

describe('secrets policy helpers', () => {
  it('hides reveal actions when revealDisabled is enabled', () => {
    expect(
      canRevealSecret('reveal_allowed', {
        ...DEFAULT_SECRET_POLICY,
        revealDisabled: true,
      })
    ).toBe(false)
  })

  it('normalizes invalid policy payloads to safe defaults', () => {
    expect(
      normalizeSecretPolicy({
        revealDisabled: 'yes',
        defaultAccessMode: 'bad-value',
        clipboardClearSeconds: -5,
      })
    ).toEqual(DEFAULT_SECRET_POLICY)
  })
})
