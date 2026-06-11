import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'

export const RESOURCE_SECRET_VISIBLE_TO_VALUES = [
  'server',
  'application',
  'service_instance',
  'connector',
  'provider_account',
  'ai_provider',
] as const

export type ResourceSecretVisibleTo = (typeof RESOURCE_SECRET_VISIBLE_TO_VALUES)[number]

export const RESOURCE_SECRET_VISIBLE_TO_OPTIONS: Array<{
  value: ResourceSecretVisibleTo
  label: string
  description: string
}> = [
  { value: 'server', label: 'Servers', description: 'Shown in server credential forms.' },
  {
    value: 'application',
    label: 'Applications',
    description: 'Shown in application credential forms.',
  },
  {
    value: 'service_instance',
    label: 'Service Instances',
    description: 'Shown in service instance forms.',
  },
  {
    value: 'connector',
    label: 'Connectors',
    description: 'Shown in connector credential forms.',
  },
  {
    value: 'provider_account',
    label: 'Provider Accounts',
    description: 'Shown in provider account forms.',
  },
  {
    value: 'ai_provider',
    label: 'AI Providers',
    description: 'Shown in AI provider forms.',
  },
]

const RESOURCE_SECRET_VISIBLE_TO_SET = new Set<string>(RESOURCE_SECRET_VISIBLE_TO_VALUES)

export function normalizeResourceSecretVisibleTo(value: unknown): ResourceSecretVisibleTo[] {
  const normalized = Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && RESOURCE_SECRET_VISIBLE_TO_SET.has(item))
    : []
  const unique = Array.from(new Set(normalized)) as ResourceSecretVisibleTo[]
  return unique.length > 0 ? unique : [...RESOURCE_SECRET_VISIBLE_TO_VALUES]
}

function encodeSecretFilterValue(filter: string) {
  return filter.replaceAll('&&', '%26%26').replaceAll('?', '%3F')
}

export function buildResourceSecretRelationApiPath({
  visibleTo,
  templateIds,
}: {
  visibleTo: ResourceSecretVisibleTo
  templateIds: string[]
}) {
  const filterParts = [
    "(created_source=''||created_source='user')",
    "type!='tunnel_token'",
    "status='active'",
    `(${templateIds.map(id => `template_id='${id}'`).join('||')})`,
    `(visible_to:length=0||visible_to:each?='${visibleTo}')`,
  ]
  return `/api/collections/secrets/records?filter=${encodeSecretFilterValue(filterParts.join('&&'))}&sort=name`
}

export function SecretVisibilityField({
  value,
  onChange,
  collapsible = false,
  defaultOpen = true,
  collapsedHint,
}: {
  value: ResourceSecretVisibleTo[]
  onChange: (next: ResourceSecretVisibleTo[]) => void
  collapsible?: boolean
  defaultOpen?: boolean
  collapsedHint?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const selectedSummary = useMemo(() => {
    const selected = RESOURCE_SECRET_VISIBLE_TO_OPTIONS.filter(option => value.includes(option.value))
    if (selected.length === RESOURCE_SECRET_VISIBLE_TO_OPTIONS.length) {
      return 'All supported dialogs'
    }
    if (selected.length === 0) {
      return 'No dialogs selected'
    }
    if (selected.length <= 2) {
      return selected.map(option => option.label).join(', ')
    }
    return `${selected.length} targets selected`
  }, [value])

  const content = (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-foreground">Visible In</div>
        <p className="text-xs text-muted-foreground">
          Choose which resource dialogs can discover this secret.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {RESOURCE_SECRET_VISIBLE_TO_OPTIONS.map(option => {
          const checked = value.includes(option.value)
          return (
            <label
              key={option.value}
              className="flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={nextChecked => {
                  if (nextChecked) {
                    if (!checked) {
                      onChange([...value, option.value])
                    }
                    return
                  }
                  if (value.length <= 1) {
                    return
                  }
                  onChange(value.filter(item => item !== option.value))
                }}
              />
              <span className="space-y-1">
                <span className="block font-medium text-foreground">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )

  if (!collapsible) {
    return content
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:bg-muted/35"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
      >
        <span className="space-y-0.5">
          <span className="block text-sm font-medium text-foreground">Visible In</span>
          <span className="block text-xs text-muted-foreground">
            {open ? 'Choose which resource dialogs can discover this secret.' : selectedSummary}
          </span>
          {!open && collapsedHint ? (
            <span className="block text-[11px] text-muted-foreground/90">{collapsedHint}</span>
          ) : null}
        </span>
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open ? <div className="pt-1">{content}</div> : null}
    </div>
  )
}
