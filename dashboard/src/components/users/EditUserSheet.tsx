import { useState } from 'react'
import { pb } from '@/lib/pb'
import type { AuthRecord } from '@/lib/auth-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import { Loader2 } from 'lucide-react'

interface EditUserSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AuthRecord
  collection: 'users' | '_superusers'
  onSuccess: () => void
}

interface FieldErrors {
  email?: string
  name?: string
}

// ─── Component ───────────────────────────────────────────

export function EditUserSheet({ open, onOpenChange, record, collection, onSuccess }: EditUserSheetProps) {
  const [email, setEmail] = useState(record.email)
  const [name, setName] = useState(record.name ?? '')
  const [emailVisibility, setEmailVisibility] = useState(record.emailVisibility ?? false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setErrors({})
      setGlobalError('')
      setAvatarFile(null)
    }
    onOpenChange(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    setGlobalError('')
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('email', email)
      formData.append('emailVisibility', String(emailVisibility))
      if (collection === 'users') formData.append('name', name.trim())
      if (avatarFile) formData.append('avatar', avatarFile)

      await pb.collection(collection).update(record.id, formData)

      onOpenChange(false)
      onSuccess()
    } catch (e: unknown) {
      const err = e as { status?: number; data?: { data?: Record<string, { message?: string }> }; message?: string }
      if (err.status === 400 && err.data?.data) {
        const errs: FieldErrors = {}
        if (err.data.data.email?.message) errs.email = err.data.data.email.message
        if (err.data.data.name?.message) errs.name = err.data.data.name.message
        setErrors(errs)
      } else {
        setGlobalError(err.message ?? 'Update failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  const isMember = collection === 'users'

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit User</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4 px-4 pb-2">
          {isMember && (
            <div className="space-y-1.5">
              <Label>Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input
              id="emailVisibility"
              type="checkbox"
              checked={emailVisibility}
              onChange={(e) => setEmailVisibility(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="emailVisibility">Make email visible to other users</Label>
          </div>

          {isMember && (
            <div className="space-y-1.5">
              <Label>Avatar <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {globalError && <p className="text-sm text-destructive">{globalError}</p>}

          <SheetFooter>
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
