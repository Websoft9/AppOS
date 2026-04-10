import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComponentsPage } from './ComponentsPage'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('ComponentsPage installed components presentation', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders installed components as read-only text cards in the current responsive grid container', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/components') {
        return Promise.resolve([
          {
            id: 'c1',
            name: 'Nginx',
            version: '1.27.0',
            available: true,
            updated_at: '2026-03-20T10:00:00Z',
          },
          {
            id: 'c2',
            name: 'Redis',
            version: '7.2.0',
            available: false,
            updated_at: '2026-03-20T09:30:00Z',
          },
        ])
      }

      if (path === '/api/components/services') {
        return Promise.resolve([])
      }

      return Promise.resolve([])
    })

    const { container } = render(<ComponentsPage />)

    await waitFor(() => {
      expect(screen.getByText('Nginx')).toBeInTheDocument()
      expect(screen.getByText('Redis')).toBeInTheDocument()
    })

    expect(
      screen.getByText('Read-only snapshot for quick awareness. No actions are required here.')
    ).toBeInTheDocument()
    expect(screen.getByText('Version 1.27.0')).toBeInTheDocument()
    expect(screen.getByText('Version 7.2.0')).toBeInTheDocument()
    expect(screen.getAllByText(/^Updated /).length).toBe(2)

    const cards = container.querySelectorAll('article')
    expect(cards.length).toBe(2)

    const grid = container.querySelector('div.grid')
    expect(grid).toBeTruthy()
    expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-4', 'xl:grid-cols-6')
  })
})
