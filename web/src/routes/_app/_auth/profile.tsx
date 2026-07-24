import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { User, KeyRound, Mail, Upload, CheckCircle2, AlertCircle } from 'lucide-react'

// ─── Inline feedback helpers ────────────────────────────────

function SuccessMsg({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-green-600">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      {msg}
    </p>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {msg}
    </p>
  )
}

// ─── Profile Section ────────────────────────────────────────

function ProfileSection({ collectionName, authId }: { collectionName: string; authId: string }) {
  const { t } = useTranslation('profile')
  const isMember = collectionName === 'users'
  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const record = pb.authStore.record
    if (!record) return
    if (isMember) {
      setName((record.name as string) ?? '')
      if (record.avatar) {
        setAvatarUrl(pb.files.getURL(record, record.avatar as string))
      }
    }
  }, [isMember])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    if (avatarPreview) URL.revokeObjectURL(avatarPreview)
    setAvatarPreview(URL.createObjectURL(file))
  }

  async function handleSave() {
    setProfileSuccess('')
    setProfileError('')
    setSaving(true)
    try {
      let body: FormData | Record<string, unknown>
      if (avatarFile) {
        const fd = new FormData()
        if (isMember) fd.append('name', name)
        fd.append('avatar', avatarFile)
        body = fd
      } else {
        body = isMember ? { name } : {}
      }
      await pb.collection(collectionName).update(authId, body)
      await pb.collection(collectionName).authRefresh()
      setProfileSuccess(t('profile.updated'))
      setAvatarFile(null)
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : t('profile.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const displayAvatar = avatarPreview || avatarUrl

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{t('profile.title')}</h2>
      </div>
      <Separator />
      <div className="space-y-4 max-w-sm">
        {/* Avatar (members only) */}
        {isMember && (
          <div className="space-y-2">
            <Label>{t('profile.avatar')}</Label>
            <div className="flex items-center gap-4">
              {displayAvatar ? (
                <img
                  src={displayAvatar}
                  alt="avatar"
                  className="h-16 w-16 rounded-full object-cover border"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  <User className="h-8 w-8" />
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {t('profile.upload')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        )}

        {/* Name (members only) */}
        {isMember && (
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">{t('profile.name')}</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('profile.namePlaceholder')}
            />
          </div>
        )}

        {!isMember && <p className="text-sm text-muted-foreground">{t('profile.superuserNote')}</p>}

        {profileSuccess && <SuccessMsg msg={profileSuccess} />}
        {profileError && <ErrorMsg msg={profileError} />}

        {isMember && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('profile.saving') : t('profile.save')}
          </Button>
        )}
      </div>
    </section>
  )
}

// ─── Password Section ────────────────────────────────────────

function PasswordSection({ collectionName, authId }: { collectionName: string; authId: string }) {
  const { t } = useTranslation('profile')
  const [oldPassword, setOldPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [globalError, setGlobalError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setFieldErrors({})
    setGlobalError('')
    setPwSuccess('')
    if (password !== passwordConfirm) {
      setFieldErrors({ passwordConfirm: t('password.mismatch') })
      return
    }
    if (password.length < 8) {
      setFieldErrors({ password: t('password.tooShort') })
      return
    }
    setSaving(true)
    try {
      await pb.collection(collectionName).update(authId, {
        oldPassword,
        password,
        passwordConfirm,
      })
      setPwSuccess(t('password.updated'))
      setOldPassword('')
      setPassword('')
      setPasswordConfirm('')
    } catch (err: unknown) {
      type PBError = { response?: { data?: Record<string, { message: string }> }; message?: string }
      const pbErr = err as PBError
      const data = pbErr?.response?.data ?? {}
      const errs: Record<string, string> = {}
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val === 'object' && 'message' in val) {
          errs[key] = (val as { message: string }).message
        }
      }
      if (Object.keys(errs).length > 0) {
        setFieldErrors(errs)
      } else {
        setGlobalError(pbErr.message ?? t('password.saveError'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{t('password.title')}</h2>
      </div>
      <Separator />
      <div className="space-y-4 max-w-sm">
        <div className="space-y-1.5">
          <Label htmlFor="old-password">{t('password.current')}</Label>
          <Input
            id="old-password"
            type="password"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            autoComplete="current-password"
          />
          {fieldErrors.oldPassword && (
            <p className="text-xs text-destructive">{fieldErrors.oldPassword}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">{t('password.new')}</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          {fieldErrors.password && (
            <p className="text-xs text-destructive">{fieldErrors.password}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">{t('password.confirm')}</Label>
          <Input
            id="confirm-password"
            type="password"
            value={passwordConfirm}
            onChange={e => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {fieldErrors.passwordConfirm && (
            <p className="text-xs text-destructive">{fieldErrors.passwordConfirm}</p>
          )}
        </div>

        {pwSuccess && <SuccessMsg msg={pwSuccess} />}
        {globalError && <ErrorMsg msg={globalError} />}

        <Button
          onClick={handleSave}
          disabled={saving || !oldPassword || !password || !passwordConfirm}
        >
          {saving ? t('password.saving') : t('password.save')}
        </Button>
      </div>
    </section>
  )
}

// ─── Email Section ────────────────────────────────────────

function EmailSection({ collectionName }: { collectionName: string }) {
  const { t } = useTranslation('profile')
  const currentEmail = pb.authStore.record?.email as string | undefined
  const [newEmail, setNewEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState('')
  const [emailError, setEmailError] = useState('')

  async function handleRequest() {
    if (!newEmail) return
    setEmailSuccess('')
    setEmailError('')
    setSending(true)
    try {
      await pb.collection(collectionName).requestEmailChange(newEmail)
      setEmailSuccess(t('email.requested'))
      setNewEmail('')
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : t('email.saveError'))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{t('email.title')}</h2>
      </div>
      <Separator />
      <div className="space-y-4 max-w-sm">
        <div className="space-y-1.5">
          <Label>{t('email.current')}</Label>
          <p className="text-sm text-muted-foreground">{currentEmail ?? '—'}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-email">{t('email.new')}</Label>
          <Input
            id="new-email"
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder={t('email.placeholder')}
          />
        </div>
        {emailSuccess && <SuccessMsg msg={emailSuccess} />}
        {emailError && <ErrorMsg msg={emailError} />}

        <Button onClick={handleRequest} disabled={sending || !newEmail}>
          {sending ? t('email.saving') : t('email.save')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('email.note')}</p>
      </div>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────

function ProfilePage() {
  const { t } = useTranslation('profile')
  const collectionName = pb.authStore.record?.collectionName ?? 'users'
  const authId = pb.authStore.record?.id ?? ''

  return (
    <div className="container mx-auto max-w-2xl space-y-10 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <ProfileSection collectionName={collectionName} authId={authId} />
      <PasswordSection collectionName={collectionName} authId={authId} />
      <EmailSection collectionName={collectionName} />
    </div>
  )
}

// Route is under _auth (not _superuser) — accessible to all authenticated users.
export const Route = createFileRoute('/_app/_auth/profile')({
  component: ProfilePage,
})
