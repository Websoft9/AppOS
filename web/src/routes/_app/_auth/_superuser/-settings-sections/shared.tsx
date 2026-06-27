import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { SettingsSection } from '@/lib/settings-api'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; ok: boolean }[]>([])
  const nextToastID = useRef(1)
  const show = useCallback((msg: string, ok = true) => {
    const id = nextToastID.current++
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

type SMTPConnectorRecord = {
  id: string
  created?: string
  name?: string
  endpoint?: string
  config?: Record<string, unknown>
}

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
  footerPrefix,
}: {
  title: string
  description: string
  connectorKinds: string
  helperNoun?: string
  ctaLabel?: string
  ctaHref?: string
  footerPrefix?: string
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-lg border border-border/40 bg-background p-4">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This section now references {helperNoun}. Create and edit {connectorKinds} from Resources
            &gt; External Services so all profiles stay in one place.
          </p>
          {footerPrefix ? (
            <p className="text-sm text-muted-foreground">
              {footerPrefix}
              {' '}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href={ctaHref}
              >
                {ctaLabel}
              </a>
              .
            </p>
          ) : (
            <Button asChild>
              <a href={ctaHref}>{ctaLabel}</a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatSMTPOptionLabel(item: SMTPConnectorRecord) {
  const name = String(item.name ?? '').trim() || 'Unnamed SMTP'
  const endpoint = String(item.endpoint ?? '').trim() || '—'
  const username = String(item.config?.username ?? '').trim() || '—'
  return `${name} / ${endpoint} / ${username}`
}

export function SMTPSettingsSection({
  title,
  description,
  showToast,
}: {
  title: string
  description: string
  showToast: (msg: string, ok?: boolean) => void
}) {
  const [items, setItems] = useState<SMTPConnectorRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedID, setSelectedID] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const response = await pb.send<SMTPConnectorRecord[]>('/api/connectors?kind=smtp', {
          method: 'GET',
        })
        if (cancelled) return
        const normalized = (Array.isArray(response) ? response : [])
          .filter(item => item && typeof item === 'object')
          .sort((left, right) => {
            const leftCreated = String(left.created ?? '').trim()
            const rightCreated = String(right.created ?? '').trim()
            if (leftCreated && rightCreated && leftCreated !== rightCreated) {
              return leftCreated.localeCompare(rightCreated)
            }
            return String(left.name ?? '').localeCompare(String(right.name ?? ''))
          })
        setItems(normalized)
        setSelectedID(current => current || String(normalized[0]?.id ?? ''))
      } catch (err) {
        if (!cancelled) {
          setItems([])
          showToast(err instanceof Error ? err.message : 'Failed to load SMTP services', false)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [showToast])

  const selected = useMemo(() => {
    const current = items.find(item => item.id === selectedID)
    return current ?? items[0] ?? null
  }, [items, selectedID])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-lg border border-border/40 bg-background p-4">
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading SMTP services...
            </div>
          ) : items.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed border-border/60 bg-muted/10 p-4">
              <p className="text-sm text-muted-foreground">
                No SMTP services are available yet. Create one in Resources so AppOS can use it for
                outbound email delivery.
              </p>
              <div>
                <a
                  className="text-sm font-medium text-foreground underline underline-offset-4"
                  href="/resources/connectors"
                >
                  Add SMTP Service
                </a>
              </div>
            </div>
          ) : (
            <>
              {items.length > 1 ? (
                <div className="space-y-2">
                  <Label htmlFor="settings-smtp-service">SMTP Service</Label>
                  <select
                    id="settings-smtp-service"
                    className={selectClass}
                    value={selected?.id ?? ''}
                    onChange={event => setSelectedID(event.target.value)}
                  >
                    {items.map(item => (
                      <option key={item.id} value={item.id}>
                        {formatSMTPOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {selected ? (
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Name</p>
                      <p className="text-sm text-foreground">{String(selected.name ?? '').trim() || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">SMTP Endpoint</p>
                      <p className="text-sm text-foreground break-all">
                        {String(selected.endpoint ?? '').trim() || '—'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Username</p>
                      <p className="text-sm text-foreground">
                        {String(selected.config?.username ?? '').trim() || '—'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <p className="text-sm text-muted-foreground">
                Need to add or manage accounts first?
                {' '}
                <a
                  className="font-medium text-foreground underline underline-offset-4"
                  href="/resources/connectors"
                >
                  Add SMTP Service
                </a>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
