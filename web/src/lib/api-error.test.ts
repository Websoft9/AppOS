import { describe, expect, it } from 'vitest'

import { getApiErrorMessage, isRequestCancellation } from './api-error'

describe('api error helpers', () => {
  it('prefers specific backend response data messages over generic wrapper messages', () => {
    expect(
      getApiErrorMessage(
        {
          message: 'Something went wrong.',
          response: {
            message: 'Something went wrong.',
            data: { message: 'ssh dial failed: connection reset by peer' },
          },
        },
        'Failed'
      )
    ).toBe('ssh dial failed: connection reset by peer')
  })

  it('recognizes request cancellation noise', () => {
    expect(isRequestCancellation({ isAbort: true })).toBe(true)
    expect(isRequestCancellation({ response: { data: { message: 'context canceled' } } })).toBe(
      true
    )
    expect(isRequestCancellation(new Error('real failure'))).toBe(false)
  })
})
