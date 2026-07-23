import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { getSessionExpiredMessage, SESSION_EXPIRED_REASON } from '@/lib/auth-session'
import { pb } from '@/lib/pb'
import { tWithFallback } from '@/lib/i18n'
import { ModeToggle } from '@/components/mode-toggle'
import { completeLoginRedirect } from './-login-redirect'

export function LoginPage() {
  const { t } = useTranslation('auth')
  const titleLabel = tWithFallback(t, 'login.title', 'Login')
  const emailLabel = tWithFallback(t, 'login.email', 'Email')
  const passwordLabel = tWithFallback(t, 'login.password', 'Password')
  const submitLabel = tWithFallback(t, 'login.submit', 'Sign In')
  const submittingLabel = tWithFallback(t, 'login.submitting', 'Signing in...')
  const forgotPasswordLabel = tWithFallback(t, 'login.forgotPassword', 'Forgot password?')
  const registerLabel = tWithFallback(t, 'login.register', 'Register')
  const navigate = useNavigate()
  const { redirect, reason } = useSearch({ strict: false }) as {
    redirect?: string
    reason?: string
  }
  const { login, isAuthenticated } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const sessionExpiredMessage = reason === SESSION_EXPIRED_REASON ? getSessionExpiredMessage() : ''

  // If already authenticated, redirect away
  useEffect(() => {
    if (isAuthenticated) {
      void completeLoginRedirect(navigate, redirect, window.location.origin, url =>
        window.location.assign(url)
      )
    }
  }, [isAuthenticated, navigate, redirect])

  // Check if setup is needed → redirect to /setup
  useEffect(() => {
    pb.send('/api/ext/setup/status', {})
      .then(res => {
        if (res.needsSetup) {
          navigate({ to: '/setup' })
        }
      })
      .catch(() => {})
  }, [navigate])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)
      await completeLoginRedirect(navigate, redirect, window.location.origin, url =>
        window.location.assign(url)
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('login.errors.fallback')
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background relative">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border">
        <h2 className="text-2xl font-bold text-center mb-6 text-card-foreground">{titleLabel}</h2>

        {!error && sessionExpiredMessage && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/40 text-amber-700 rounded dark:text-amber-300">
            {sessionExpiredMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/50 text-destructive rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1 text-foreground">
                {emailLabel}
              </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              required
              disabled={loading}
            />
          </div>
          <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1 text-foreground">
                {passwordLabel}
              </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              required
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? submittingLabel : submitLabel}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-sm text-muted-foreground">
          <Link to="/forgot-password" className="text-primary hover:underline">
            {forgotPasswordLabel}
          </Link>
          <Link to="/register" className="text-primary hover:underline">
            {registerLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/login')({
  component: LoginPage,
})
