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
  it('renders a single sparse point for 24h history instead of empty state', () => {
    const { container, queryByText } = render(
      <TimeSeriesChart
        name="cpu"
        unit="percent"
        window="24h"
        rangeStartAt="2026-05-13T02:30:00Z"
        rangeEndAt="2026-05-14T02:30:00Z"
        stepSeconds={900}
        formatValue={formatValue}
        points={[[1778723100, 4.9]]}
      />
    )

    expect(queryByText('No trend yet')).toBeNull()
    expect(container.querySelectorAll('circle.recharts-dot').length).toBeGreaterThan(0)
  })

  it('renders visible point markers for sparse 24h data without connecting gaps', () => {
    const { container } = render(
      <TimeSeriesChart
        name="cpu"
        unit="percent"
        window="24h"
        rangeStartAt="2026-05-13T02:30:00Z"
        rangeEndAt="2026-05-14T02:30:00Z"
        stepSeconds={900}
        formatValue={formatValue}
        points={[
          [1778669100, 5.38],
          [1778723100, 4.9],
          [1778724000, 4.6],
        ]}
      />
    )

    expect(container.querySelectorAll('circle.recharts-dot').length).toBeGreaterThan(0)
  })

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
