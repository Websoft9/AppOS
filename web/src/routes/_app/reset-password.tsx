import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { pb } from '@/lib/pb'
import { ClientResponseError } from 'pocketbase'

function ResetPasswordPage() {
  const { t } = useTranslation('auth')
  const { token } = useSearch({ strict: false }) as { token?: string }
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border text-center">
          <h2 className="text-2xl font-bold mb-4 text-card-foreground">
            {t('resetPassword.invalidLinkTitle')}
          </h2>
          <p className="text-muted-foreground mb-6">{t('resetPassword.invalidLinkDescription')}</p>
          <Link to="/forgot-password" className="text-primary hover:underline">
            {t('resetPassword.requestNewLink')}
          </Link>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== passwordConfirm) {
      setError(t('resetPassword.errors.passwordsDoNotMatch'))
      return
    }
    if (password.length < 8) {
      setError(t('resetPassword.errors.passwordTooShort'))
      return
    }

    setLoading(true)
    try {
      // Try _superusers first, then users (token is collection-specific)
      try {
        await pb.collection('_superusers').confirmPasswordReset(token, password, passwordConfirm)
      } catch (err) {
        // Network error → throw immediately
        if (err instanceof ClientResponseError && err.status === 0) throw err
        await pb.collection('users').confirmPasswordReset(token, password, passwordConfirm)
      }
      setSuccess(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('resetPassword.errors.fallback')
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border text-center">
          <h2 className="text-2xl font-bold mb-4 text-card-foreground">
            {t('resetPassword.successTitle')}
          </h2>
          <p className="text-muted-foreground mb-6">{t('resetPassword.successDescription')}</p>
          <Link to="/login" className="text-primary hover:underline">
            {t('resetPassword.goToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border">
        <h2 className="text-2xl font-bold text-center mb-2 text-card-foreground">
          {t('resetPassword.title')}
        </h2>
        <p className="text-center text-sm text-muted-foreground mb-6">
          {t('resetPassword.description')}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/50 text-destructive rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-foreground">
              {t('resetPassword.newPassword')}
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
              {t('resetPassword.confirmNewPassword')}
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
            {loading ? t('resetPassword.submitting') : t('resetPassword.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/reset-password')({
  component: ResetPasswordPage,
})
