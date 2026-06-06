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
  { value: 'server', label: 'Servers', description: 'Visible in server credential dialogs.' },
  {
    value: 'application',
    label: 'Applications',
    description: 'Visible in application deployment and application credential dialogs.',
  },
  {
    value: 'service_instance',
    label: 'Service Instances',
    description: 'Visible in service instance credential dialogs.',
  },
  {
    value: 'connector',
    label: 'Connectors',
    description: 'Visible in connector credential dialogs.',
  },
  {
    value: 'provider_account',
    label: 'Provider Accounts',
    description: 'Visible in provider account dialogs.',
  },
  {
    value: 'ai_provider',
    label: 'AI Providers',
    description: 'Visible in AI provider credential dialogs.',
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
}: {
  value: ResourceSecretVisibleTo[]
  onChange: (next: ResourceSecretVisibleTo[]) => void
}) {
  return (
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
}
