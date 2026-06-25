import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './login'

const navigateMock = vi.fn()
const useSearchMock = vi.fn()
const loginMock = vi.fn()
const pbSendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: ({
    children,
    to,
    className,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} className={className} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
    isAuthenticated: false,
  }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => pbSendMock(...args),
  },
}))

vi.mock('@/components/mode-toggle', () => ({
  ModeToggle: () => <div>mode-toggle</div>,
}))

describe('LoginPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    navigateMock.mockReset()
    useSearchMock.mockReset()
    loginMock.mockReset()
    pbSendMock.mockReset()

    useSearchMock.mockReturnValue({ reason: 'session-expired' })
    pbSendMock.mockResolvedValue({ needsSetup: false })
  })

  it('shows the session-expired guidance when redirected back to login', async () => {
    render(<LoginPage />)

    expect(screen.getByText('Session expired. Please sign in again.')).toBeInTheDocument()

    await waitFor(() => {
      expect(pbSendMock).toHaveBeenCalledWith('/api/ext/setup/status', {})
    })
  })

  it('hides the session-expired guidance when a login error is present', async () => {
    loginMock.mockRejectedValue(new Error('Invalid credentials'))

    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad-password' } })

    const form = screen.getByRole('button', { name: 'Sign In' }).closest('form')
    if (!form) {
      throw new Error('Expected login form')
    }

    fireEvent.submit(form)

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
    expect(screen.queryByText('Session expired. Please sign in again.')).not.toBeInTheDocument()
  })
})