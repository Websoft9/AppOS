import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { SettingsSection } from '@/lib/settings-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; ok: boolean }[]>([])
  const show = useCallback((msg: string, ok = true) => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, ok }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])
  return { toasts, show }
}

export function Toggle({
  checked,
  onChange,
  id,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onChange(!checked)
        }
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${checked ? 'bg-primary' : 'bg-input'}`}
    >
      <span
        className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

export const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

export function SaveButton({
  onClick,
  saving,
  label = 'Save',
  compact = false,
  align = 'right',
}: {
  onClick: () => void
  saving: boolean
  label?: string
  compact?: boolean
  align?: 'right' | 'left'
}) {
  return (
    <div className={`${compact ? 'mt-0' : 'mt-4'} flex ${align === 'left' ? 'justify-start' : 'justify-end'}`}>
      <Button onClick={onClick} disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          label
        )}
      </Button>
    </div>
  )
}

export function sectionLabel(section: SettingsSection): string {
  if (section === 'system') {
    return 'System'
  }
  if (section === 'workspace') {
    return 'Workspace'
  }
  return section
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function ConnectorReferenceSection({
  title,
  description,
  connectorKinds,
  helperNoun = 'external services',
  ctaLabel = 'Open External Services',
  ctaHref = '/resources/connectors',
}: {
  title: string
  description: string
  connectorKinds: string
  helperNoun?: string
  ctaLabel?: string
  ctaHref?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This section now references {helperNoun}. Create and edit {connectorKinds} from Resources
          &gt; External Services so all profiles stay in one place.
        </p>
        <Button asChild>
          <a href={ctaHref}>{ctaLabel}</a>
        </Button>
      </CardContent>
    </Card>
  )
}
