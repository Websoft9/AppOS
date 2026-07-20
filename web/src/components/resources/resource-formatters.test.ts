import { describe, expect, it } from 'vitest'
import { formatResourceDateTime } from './resource-formatters'

describe('formatResourceDateTime', () => {
  it('returns an em dash for empty values', () => {
    expect(formatResourceDateTime('')).toBe('—')
  })

  it('returns the raw value when the date is invalid', () => {
    expect(formatResourceDateTime('not-a-date')).toBe('not-a-date')
  })

  it('formats a UTC timestamp as YYYY-MM-DD HH:mm', () => {
    expect(formatResourceDateTime('2026-07-01T10:20:00Z')).toBe('2026-07-01 10:20')
  })

  it('formats a non-UTC timestamp correctly', () => {
    expect(formatResourceDateTime('2026-12-25T23:59:00Z')).toBe('2026-12-25 23:59')
  })

  it('zero-pads single-digit months, days, hours, and minutes', () => {
    expect(formatResourceDateTime('2026-01-05T03:08:00Z')).toBe('2026-01-05 03:08')
  })
})
