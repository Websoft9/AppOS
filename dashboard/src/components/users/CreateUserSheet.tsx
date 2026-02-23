import { useState } from 'react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2 } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────

interface FieldErrors {
  email?: string
  name?: string
  password?: string
  passwordConfirm?: string
}

interface CreateUserSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a user is successfully created; parent should refresh the list. */
  onSuccess: (collection: 'users' | '_superusers') => void
}

// ─── Helpers ─────────────────────────────────────────────

/** Map PocketBase 400 error data to field-level messages. */
function mapPBErrors(data: Record<string, { message?: string }>): FieldErrors {
  const errs: FieldErrors = {}
  if (data.email?.message) errs.email = data.email.message
  if (data.name?.message) errs.name = data.name.message
  if (data.password?.message) errs.password = data.password.message
  if (data.passwordConfirm?.message) errs.passwordConfirm = data.passwordConfirm.message
  return errs
}

// ─── Component ───────────────────────────────────────────

export function CreateUserSheet({ open, onOpenChange, onSuccess }: CreateUserSheetProps) {
  const [role, setRole] = useState<'users' | '_superusers'>('users')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)
  const [globalError, setGlobalError] = useState('')

  function reset() {
    setEmail('')
    setName('')
    setPassword('')
    setPasswordConfirm('')
    setErrors({})
    setGlobalError('')
    setRole('users')
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    setGlobalError('')

    // Client-side validation
    if (password.length < 8) {
      setErrors({ password: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== passwordConfirm) {
      setErrors({ passwordConfirm: 'Passwords do not match.' })
      return
    }

    setLoading(true)
    try {
      const body: Record<string, string> = { email, password, passwordConfirm }
      if (role === 'users' && name.trim()) body.name = name.trim()

      await pb.collection(role).create(body)

      reset()
      onOpenChange(false)
      onSuccess(role)
    } catch (e: unknown) {
      const err = e as { status?: number; data?: { data?: Record<string, { message?: string }> }; message?: string }
      if (err.status === 400 && err.data?.data) {
        const fieldErrors = mapPBErrors(err.data.data)
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors)
        } else {
          setGlobalError(err.message ?? 'Validation failed.')
        }
      } else {
        setGlobalError(err.message ?? 'An unexpected error occurred.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add User</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-6 px-4 pb-2">
          {/* Role selector */}
          <Tabs value={role} onValueChange={(v) => setRole(v as 'users' | '_superusers')}>
            <TabsList className="w-full">
              <TabsTrigger value="users" className="flex-1">Member</TabsTrigger>
              <TabsTrigger value="_superusers" className="flex-1">Superuser</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-4">
            <Field label="Email" error={errors.email}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
            {role === 'users' && (
              <Field label="Name" error={errors.name} optional>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            )}
            <Field label="Password" error={errors.password}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm Password" error={errors.passwordConfirm}>
              <Input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </Field>
          </div>

          {globalError && (
            <p className="text-sm text-destructive">{globalError}</p>
          )}

          <SheetFooter>
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create {role === 'users' ? 'Member' : 'Superuser'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ─── Field helper ─────────────────────────────────────────

function Field({
  label,
  error,
  optional,
  children,
}: {
  label: string
  error?: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {optional && <span className="ml-1 text-muted-foreground text-xs">(optional)</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
