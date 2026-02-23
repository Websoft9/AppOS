import { useState } from 'react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2 } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────

interface ResetPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userEmail: string
  collection: 'users' | '_superusers'
  onSuccess: () => void
}

// ─── Component ───────────────────────────────────────────

export function ResetPasswordDialog({ open, onOpenChange, userId, userEmail, collection, onSuccess }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setPassword('')
      setPasswordConfirm('')
      setError('')
    }
    onOpenChange(next)
  }

  async function handleConfirm() {
    setError('')
    if (!password) { setError('Password is required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== passwordConfirm) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      await pb.send(`/api/ext/users/${collection}/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password, passwordConfirm }),
        headers: { 'Content-Type': 'application/json' },
      })
      onOpenChange(false)
      onSuccess()
    } catch (e: unknown) {
      const err = e as { message?: string }
      setError(err.message ?? 'Failed to reset password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Password</AlertDialogTitle>
          <AlertDialogDescription>
            Set a new password for <strong>{userEmail}</strong>. Their existing sessions will be invalidated.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm Password</Label>
            <Input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset Password
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
