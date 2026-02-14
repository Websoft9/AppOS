import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { pb } from '@/lib/pb'

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Check if email exists in either collection
      const check = await pb.send('/api/appos/auth/check-email', {
        method: 'POST',
        body: { email },
      })

      if (!check.exists) {
        setError('No account found with this email')
        setLoading(false)
        return
      }

      // Send reset to the correct collection
      await pb.collection(check.collection).requestPasswordReset(email)
      setSent(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send reset email'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border text-center">
          <h2 className="text-2xl font-bold mb-4 text-card-foreground">Check Your Email</h2>
          <p className="text-muted-foreground mb-6">
            We've sent a password reset link to <strong>{email}</strong>.
          </p>
          <Link to="/login" className="text-primary hover:underline">
            Back to Login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 bg-card rounded-lg shadow-md border border-border">
        <h2 className="text-2xl font-bold text-center mb-2 text-card-foreground">Forgot Password</h2>
        <p className="text-center text-sm text-muted-foreground mb-6">
          Enter your email to receive a password reset link
        </p>

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
          <Button
            type="submit"
            className="w-full"
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline">
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/forgot-password')({
  component: ForgotPasswordPage,
})
