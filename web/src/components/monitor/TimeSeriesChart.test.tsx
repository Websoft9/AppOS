import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimeSeriesChart } from './TimeSeriesChart'

vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    disconnect() {}
  }
)

function formatValue(_unit: string, _name: string, value: number): string {
  return String(value)
}

describe('TimeSeriesChart', () => {
  it('removes the fixed-capacity top stroke for memory and disk usage stacks', () => {
    const { container } = render(
      <div>
        <TimeSeriesChart
          name="memory"
          unit="bytes"
          window="1h"
          formatValue={formatValue}
          segments={[
            {
              name: 'used',
              points: [
                [1713096000, 100],
                [1713096060, 120],
              ],
            },
            {
              name: 'available',
              points: [
                [1713096000, 400],
                [1713096060, 380],
              ],
            },
          ]}
        />
        <TimeSeriesChart
          name="disk_usage"
          unit="bytes"
          window="1h"
          formatValue={formatValue}
          segments={[
            {
              name: 'used',
              points: [
                [1713096000, 70],
                [1713096060, 73],
              ],
            },
            {
              name: 'free',
              points: [
                [1713096000, 30],
                [1713096060, 27],
              ],
            },
          ]}
        />
      </div>
    )

    expect(container.querySelector('path[stroke="#2563eb"]')).toBeTruthy()
    expect(container.querySelector('path[stroke="#c2410c"]')).toBeTruthy()
    expect(container.querySelector('path[stroke="#0f766e"]')).toBeFalsy()
  })
})
