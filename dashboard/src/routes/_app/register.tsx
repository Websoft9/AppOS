import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { pb } from '@/lib/pb'

function RegisterPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [countdown, setCountdown] = useState(3)
  const credentialsRef = useRef({ email: '', password: '' })

  // Countdown timer after successful registration → auto-login
  useEffect(() => {
    if (!success) return
    let cancelled = false
    if (countdown <= 0) {
      const { email: e, password: p } = credentialsRef.current
      pb.collection('users').authWithPassword(e, p)
        .then(() => { if (!cancelled) navigate({ to: '/dashboard' }) })
        .catch(() => { if (!cancelled) navigate({ to: '/login' }) })
      return () => { cancelled = true }
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [success, countdown, navigate])

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== passwordConfirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    try {
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm,
      })
      credentialsRef.current = { email, password }
      setSuccess(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [email, password, passwordConfirm])

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border text-center">
          <div className="mb-4 text-4xl">✅</div>
          <h2 className="text-2xl font-bold mb-2 text-card-foreground">Registration Successful!</h2>
          <p className="text-muted-foreground mb-2">Your account has been created.</p>
          <p className="font-mono text-sm bg-muted p-2 rounded mb-4 text-foreground">{credentialsRef.current.email}</p>
          <p className="text-muted-foreground">
            Auto-login in <span className="font-bold text-foreground">{countdown}</span>s...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border">
        <h2 className="text-2xl font-bold text-center mb-6 text-card-foreground">Register</h2>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/50 text-destructive rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1 text-foreground">
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              required
              disabled={loading}
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-foreground">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              required
              disabled={loading}
              minLength={8}
            />
          </div>
          <div>
            <label htmlFor="passwordConfirm" className="block text-sm font-medium mb-1 text-foreground">
              Confirm Password
            </label>
            <input
              type="password"
              id="passwordConfirm"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              required
              disabled={loading}
              minLength={8}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline">
            Login
          </Link>
        </p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/register')({
  component: RegisterPage,
})
