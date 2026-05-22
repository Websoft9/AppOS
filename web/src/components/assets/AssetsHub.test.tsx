import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetsHub } from './AssetsHub'

const navigateMock = vi.fn()
const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('AssetsHub', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    sendMock.mockReset()
    sendMock.mockResolvedValue([{ id: 'script-1' }, { id: 'script-2' }])
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the assets hub and routes asset creation to scripts', async () => {
    render(<AssetsHub />)

    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Reusable technical definitions shared across operators, terminal workflows, and future automation.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('1 grouped area')).toBeInTheDocument()
    expect(screen.getByText('1 live family')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Technical Assets' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Scripts/i })).toHaveAttribute('href', '/assets/scripts')

    await waitFor(() => {
      expect(screen.getByText('2 items')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Add Asset/i }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/assets/scripts', search: { create: '1' } })
  })
})