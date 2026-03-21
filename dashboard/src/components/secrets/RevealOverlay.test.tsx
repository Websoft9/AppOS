import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevealOverlay } from './RevealOverlay'

describe('RevealOverlay', () => {
  const writeText = vi.fn<(...args: [string]) => Promise<void>>()

  beforeEach(() => {
    vi.useFakeTimers()
    writeText.mockReset()
    writeText.mockResolvedValue()
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('clears clipboard after the configured delay', async () => {
    render(
      <RevealOverlay
        open
        payload={{ value: 'secret-value' }}
        clearAfterSeconds={3}
        onClose={() => {}}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith('{\n  "value": "secret-value"\n}')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(writeText).toHaveBeenLastCalledWith('')
  })
})
