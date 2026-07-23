import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { pb } from '@/lib/pb'

function SetupPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [countdown, setCountdown] = useState(3)
  const credentialsRef = useRef({ email: '', password: '' })

  // If setup already done, redirect to login
  useEffect(() => {
    pb.send('/api/ext/setup/status', {})
      .then(res => {
        if (!res.needsSetup) {
          navigate({ to: '/login' })
        }
      })
      .catch(() => {})
  }, [navigate])

  // Countdown timer after successful setup → auto-login
  useEffect(() => {
    if (!success) return
    let cancelled = false
    if (countdown <= 0) {
      const { email: e, password: p } = credentialsRef.current
      pb.collection('_superusers')
        .authWithPassword(e, p)
        .then(() => {
          if (!cancelled) navigate({ to: '/overview' })
        })
        .catch(() => {
          if (!cancelled) navigate({ to: '/login' })
        })
      return () => {
        cancelled = true
      }
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [success, countdown, navigate])

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError('')

      if (password !== passwordConfirm) {
        setError(t('setup.errors.passwordsDoNotMatch'))
        return
      }
      if (password.length < 8) {
        setError(t('setup.errors.passwordTooShort'))
        return
      }

      setLoading(true)
      try {
        await pb.send('/api/ext/setup/init', {
          method: 'POST',
          body: { email, password },
        })
        credentialsRef.current = { email, password }
        setSuccess(true)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('setup.errors.fallback')
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [email, password, passwordConfirm]
  )

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border text-center">
          <div className="mb-4 text-4xl">✅</div>
          <h2 className="text-2xl font-bold mb-2 text-card-foreground">
            {t('setup.successTitle')}
          </h2>
          <p className="text-muted-foreground mb-2">{t('setup.successDescription')}</p>
          <p className="font-mono text-sm bg-muted p-2 rounded mb-4 text-foreground">
            {credentialsRef.current.email}
          </p>
          <p className="text-muted-foreground">
            {t('setup.autoLogin', { count: countdown })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border">
        <h2 className="text-2xl font-bold text-center mb-2 text-card-foreground">
          {t('setup.title')}
        </h2>
        <p className="text-center text-sm text-muted-foreground mb-6">
          {t('setup.description')}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/50 text-destructive rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1 text-foreground">
                {t('setup.adminEmail')}
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
                {t('setup.password')}
              </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              required
              disabled={loading}
              minLength={8}
            />
          </div>
          <div>
            <label
              htmlFor="passwordConfirm"
              className="block text-sm font-medium mb-1 text-foreground"
            >
              {t('setup.passwordConfirm')}
            </label>
            <input
              type="password"
              id="passwordConfirm"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              required
              disabled={loading}
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('setup.submitting') : t('setup.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/setup')({
  component: SetupPage,
})
