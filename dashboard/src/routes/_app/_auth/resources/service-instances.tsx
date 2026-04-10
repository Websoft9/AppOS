import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { pb } from '@/lib/pb'

type InstanceRecord = {
  id: string
  created?: string
  updated?: string
  name?: string
  kind?: string
  template_id?: string
  endpoint?: string
  provider_account?: string
  credential?: string
  config?: Record<string, unknown>
  description?: string
}

type InstanceReachabilityRecord = {
  id: string
  status?: string
  latency_ms?: number
  reason?: string
}

type InstanceTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  sensitive?: boolean
  secretTemplate?: string
  placeholder?: string
  helpText?: string
  default?: unknown
}

type InstanceTemplate = {
  id: string
  category?: string
  kind: string
  title: string
  vendor?: string
  description?: string
  defaultEndpoint?: string
  omitCommonFields?: string[]
  fields?: InstanceTemplateField[]
}

const DATABASE_COMMON_FIELD_IDS = new Set(['username', 'connect_timeout', 'ssl_enabled'])

const DATABASE_COMMON_FIELDS: InstanceTemplateField[] = [
  {
    id: 'username',
    label: 'Username',
    type: 'text',
    required: true,
    placeholder: 'appuser',
  },
  {
    id: 'connect_timeout',
    label: 'Connection Timeout',
    type: 'number',
    default: 10,
    helpText: 'How many seconds to wait before the first connection attempt times out.',
  },
  {
    id: 'ssl_enabled',
    label: 'Use SSL',
    type: 'boolean',
    default: false,
  },
]

const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Password / Single Value',
}

const SECRET_TEMPLATE_IDS = new Set(Object.keys(SECRET_TEMPLATE_LABELS))

const CATEGORY_LABELS: Record<string, string> = {
  database: 'Databases',
  cache: 'Caches',
  'message-queue': 'Messaging',
  storage: 'Storage',
  artifact: 'Registries',
  ai: 'AI Services',
}

const KIND_LABELS: Record<string, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  redis: 'Redis',
  kafka: 'Kafka',
  s3: 'S3 Storage',
  registry: 'Registry',
  ollama: 'Ollama',
}

function normalizeTemplateFieldDefault(field: InstanceTemplateField) {
  if (field.default === undefined) {
    if (field.type === 'boolean') return false
    if (field.type === 'number') return 0
    return ''
  }
  return field.default
}

function slugifyNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
}

function isGenericTemplate(template: InstanceTemplate) {
  const normalizedTitle = template.title.trim().toLowerCase()
  return (
    template.id.startsWith('generic-') ||
    normalizedTitle.includes('generic') ||
    normalizedTitle === `standard ${kindLabel(template.kind).toLowerCase()}`
  )
}

function productTitle(template: InstanceTemplate) {
  return isGenericTemplate(template) ? kindLabel(template.kind) : template.title
}

function buildDefaultInstanceName(template: InstanceTemplate) {
  const base =
    slugifyNamePart(productTitle(template)) || slugifyNamePart(template.kind) || 'instance'
  return `${base}-${Date.now().toString().slice(-4)}`
}

function buildDefaultCredentialSecretName(template: InstanceTemplate, instanceName: string) {
  const base =
    slugifyNamePart(instanceName) || slugifyNamePart(productTitle(template)) || 'instance'
  return `${base}-password`
}

function categoryLabel(category?: string) {
  return CATEGORY_LABELS[String(category ?? '')] ?? 'Other'
}

function productMeta(template: InstanceTemplate) {
  return [categoryLabel(template.category), template.vendor].filter(Boolean).join(' · ')
}

function productDescription(template: InstanceTemplate) {
  if (isGenericTemplate(template)) {
    return 'Standard template'
  }
  return (
    template.description ||
    `${template.vendor ? `${template.vendor} ` : ''}${categoryLabel(template.category).toLowerCase()} profile.`
  )
}

function splitEndpoint(endpoint: string) {
  const raw = endpoint.trim()
  if (!raw) {
    return { host: '', port: '' }
  }
  if (raw.includes('://')) {
    try {
      const parsed = new URL(raw)
      return { host: parsed.hostname, port: parsed.port }
    } catch {
      return { host: raw, port: '' }
    }
  }
  const ipv6Match = raw.match(/^\[([^\]]+)\]:(\d+)$/)
  if (ipv6Match) {
    return { host: ipv6Match[1], port: ipv6Match[2] }
  }
  const separator = raw.lastIndexOf(':')
  if (separator > 0 && raw.indexOf(':') === separator) {
    return { host: raw.slice(0, separator), port: raw.slice(separator + 1) }
  }
  return { host: raw, port: '' }
}

function buildEndpoint(host: unknown, port: unknown, fallback: string) {
  const normalizedHost = String(host ?? '').trim()
  const normalizedPort = String(port ?? '').trim()
  if (!normalizedHost) {
    return fallback
  }
  if (!normalizedPort) {
    return normalizedHost
  }
  return `${normalizedHost}:${normalizedPort}`
}

function isDatabaseConnectionKind(template: InstanceTemplate | null | undefined) {
  return template?.kind === 'mysql' || template?.kind === 'postgres'
}

function isSecretBackedConnectionKind(template: InstanceTemplate | null | undefined) {
  return (
    template?.kind === 'mysql' ||
    template?.kind === 'postgres' ||
    template?.kind === 'redis' ||
    template?.kind === 'kafka'
  )
}

function defaultPortForTemplate(template: InstanceTemplate | null | undefined) {
  if (template?.kind === 'postgres') return 5432
  return 3306
}

function buildSecretRelationApiPath(secretTemplateIds: string[]) {
  const filter = secretTemplateIds.map(id => `template_id='${id}'`).join('||')
  return `/api/collections/secrets/records?filter=(status='active'%26%26(${filter}))&sort=name`
}

function databaseCredentialLabel(template: InstanceTemplate | null | undefined) {
  if (template?.kind === 'redis') return 'Password'
  if (template?.kind === 'kafka') return 'Credential'
  return isDatabaseConnectionKind(template) ? 'Password' : 'Credential'
}

function databaseCertificateHelpText(template: InstanceTemplate | null | undefined) {
  if (template?.kind === 'postgres') {
    return 'Use a root CA certificate only when your PostgreSQL server requires custom SSL trust.'
  }
  return 'Use a root CA certificate only when your MySQL server requires custom SSL trust.'
}

function formatDateTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function reachabilityTone(status: unknown) {
  switch (String(status ?? '').toLowerCase()) {
    case 'online':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'offline':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700'
  }
}

function reachabilityLabel(status: unknown) {
  switch (String(status ?? '').toLowerCase()) {
    case 'online':
      return 'Reachable'
    case 'offline':
      return 'Unreachable'
    default:
      return 'Unknown'
  }
}

function mergeDatabaseTemplateFields(template: InstanceTemplate | null | undefined) {
  if (!template) {
    return [] as InstanceTemplateField[]
  }
  if (!isDatabaseConnectionKind(template)) {
    return template.fields ?? []
  }

  const omitted = new Set((template.omitCommonFields ?? []).map(value => String(value).trim()))
  const merged: InstanceTemplateField[] = []
  const existingById = new Map((template.fields ?? []).map(field => [field.id, field]))

  for (const field of DATABASE_COMMON_FIELDS) {
    if (omitted.has(field.id)) {
      continue
    }
    merged.push(existingById.get(field.id) ?? field)
  }

  for (const field of template.fields ?? []) {
    if (DATABASE_COMMON_FIELD_IDS.has(field.id) && omitted.has(field.id)) {
      continue
    }
    if (merged.some(existing => existing.id === field.id)) {
      continue
    }
    merged.push(field)
  }

  return merged
}

function mapTemplateFieldToResourceField(
  field: InstanceTemplateField,
  template: InstanceTemplate
): FieldDef {
  if (isDatabaseConnectionKind(template) && (field.id === 'engine' || field.id === 'provider')) {
    return {
      key: field.id,
      label: field.label,
      type: 'text',
      hidden: true,
      defaultValue: normalizeTemplateFieldDefault(field),
    }
  }

  if (isDatabaseConnectionKind(template) && field.id === 'ssl_ca_certificate') {
    return {
      key: field.id,
      label: 'SSL Root CA Certificate',
      type: 'relation',
      advanced: true,
      showWhen: { field: 'ssl_enabled', values: ['true'] },
      relationApiPath: "/api/collections/certificates/records?filter=(status='active')&sort=name",
      relationLabelKey: 'name',
      helpText: databaseCertificateHelpText(template),
      defaultValue: normalizeTemplateFieldDefault(field),
    }
  }

  return {
    key: field.id,
    label:
      isDatabaseConnectionKind(template) && field.id === 'ssl_enabled' ? 'Use SSL' : field.label,
    type: field.type === 'boolean' ? 'boolean' : field.type === 'number' ? 'number' : 'text',
    required: field.required,
    placeholder: field.placeholder,
    defaultValue: normalizeTemplateFieldDefault(field),
    helpText: field.helpText,
    advanced:
      isDatabaseConnectionKind(template) && ['connect_timeout', 'ssl_enabled'].includes(field.id),
  }
}

async function buildInstancePayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, InstanceTemplate>
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error('Instance profile is required')
  }

  if (isSecretBackedConnectionKind(template)) {
    const useCredentialReference = Boolean(body.credential_use_secret)
    if (!useCredentialReference) {
      const passwordValue = String(body.password_value ?? '')
      if (!passwordValue.trim() && isDatabaseConnectionKind(template)) {
        throw new Error('Password is required')
      }
      if (passwordValue.trim()) {
        const instanceName = String(body.name ?? '').trim()
        const createdSecret = await pb.collection('secrets').create({
          name: buildDefaultCredentialSecretName(template, instanceName),
          description: `Password for ${instanceName || productTitle(template)}`,
          template_id: 'single_value',
          scope: 'global',
          payload: { value: passwordValue },
        })
        body.credential = String(createdSecret.id ?? '')
      } else {
        body.credential = ''
      }
    }

    if (isDatabaseConnectionKind(template) && !String(body.credential ?? '').trim()) {
      throw new Error('Password Secret is required')
    }
  }

  const config: Record<string, unknown> = {}
  for (const field of mergeDatabaseTemplateFields(template)) {
    const value = body[field.id]
    if (value === undefined || value === '') {
      continue
    }
    config[field.id] = field.type === 'number' ? Number(value) : value
  }

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
    template_id: template.id,
    endpoint: buildEndpoint(
      body.host,
      body.port,
      String(body.endpoint ?? template.defaultEndpoint ?? '')
    ),
    provider_account: String(body.provider_account ?? ''),
    credential: String(body.credential ?? ''),
    config,
    description: String(body.description ?? ''),
  }
}

function mapInstanceRow(
  item: InstanceRecord,
  templatesById: Map<string, InstanceTemplate>
): Record<string, unknown> {
  const template = templatesById.get(String(item.template_id ?? ''))
  const endpointParts = splitEndpoint(String(item.endpoint ?? ''))
  const flattenedConfig: Record<string, unknown> = {}

  for (const field of mergeDatabaseTemplateFields(template)) {
    const value = item.config?.[field.id]
    if (value === undefined) {
      continue
    }
    flattenedConfig[field.id] = value
  }

  return {
    id: item.id,
    created: String(item.created ?? ''),
    updated: String(item.updated ?? ''),
    name: String(item.name ?? ''),
    kind: String(item.kind ?? ''),
    kind_label: kindLabel(String(item.kind ?? '')),
    template_id: String(item.template_id ?? ''),
    profile: template?.title ?? String(item.template_id ?? ''),
    endpoint: String(item.endpoint ?? ''),
    host: endpointParts.host,
    port: endpointParts.port,
    provider_account: String(item.provider_account ?? ''),
    credential: String(item.credential ?? ''),
    description: String(item.description ?? ''),
    reachability: 'unknown',
    reachability_reason: '',
    reachability_latency_ms: undefined,
    ...flattenedConfig,
  }
}

const columns: Column[] = [
  { key: 'name', label: 'Name' },
  {
    key: 'kind_label',
    label: 'Kind',
    render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
  },
  { key: 'profile', label: 'Profile' },
  {
    key: 'endpoint',
    label: 'Endpoint',
    render: value => (
      <span className="max-w-[220px] truncate block" title={String(value || '')}>
        {String(value || '—')}
      </span>
    ),
  },
  {
    key: 'reachability',
    label: 'Network Reachability',
    render: (value, row) => {
      const status = String(value ?? 'unknown')
      const reason = String(row.reachability_reason ?? '').trim()
      const latency = Number(row.reachability_latency_ms ?? 0)
      const title = status === 'online' && latency > 0
        ? `${reachabilityLabel(status)} · ${latency} ms`
        : reason || reachabilityLabel(status)

      return (
        <Badge variant="outline" className={reachabilityTone(status)} title={title}>
          {reachabilityLabel(status)}
        </Badge>
      )
    },
  },
  {
    key: 'created',
    label: 'Created',
    render: value => <span className="text-sm text-muted-foreground">{formatDateTime(value)}</span>,
  },
  {
    key: 'updated',
    label: 'Updated',
    render: value => <span className="text-sm text-muted-foreground">{formatDateTime(value)}</span>,
  },
]

export function ServiceInstancesPage() {
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [instanceTemplates, setInstanceTemplates] = useState<InstanceTemplate[]>([])
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)

  useEffect(() => {
    void (async () => {
      try {
        const data = await pb.send<InstanceTemplate[]>('/api/instances/templates', {
          method: 'GET',
        })
        setInstanceTemplates(Array.isArray(data) ? data : [])
      } catch {
        setInstanceTemplates([])
      }
    })()
  }, [])

  const templatesById = useMemo(
    () => new Map(instanceTemplates.map(template => [template.id, template])),
    [instanceTemplates]
  )

  const productOptions = useMemo(
    () =>
      [...instanceTemplates]
        .sort((left, right) => {
          const genericCompare = Number(isGenericTemplate(right)) - Number(isGenericTemplate(left))
          if (genericCompare !== 0) return genericCompare
          return productTitle(left).localeCompare(productTitle(right))
        })
        .map(template => ({
          id: template.id,
          title: productTitle(template),
          description: productDescription(template),
          meta: productMeta(template),
          searchText: [
            template.title,
            template.vendor,
            template.kind,
            categoryLabel(template.category),
          ].join(' '),
        })),
    [instanceTemplates]
  )

  const openSecretDialog = useCallback(
    (callbacks: { addOption: (id: string, label: string) => void }) => {
      setSecretAddOption(() => callbacks.addOption)
      setSecretDialogOpen(true)
    },
    []
  )

  const renderDatabaseCredentialField = useCallback(
    ({
      inputId,
      formData,
      updateField,
      relationOptions,
      addRelationOption,
    }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      const useSecret = Boolean(formData.credential_use_secret)

      return (
        <SecretCredentialField
          inputId={inputId}
          manualValue={String(formData.password_value ?? '')}
          onManualValueChange={value => updateField('password_value', value)}
          useReference={useSecret}
          onUseReferenceChange={checked => {
            updateField('credential_use_secret', checked)
            if (!checked) {
              updateField('credential', '')
            }
          }}
          referenceValue={String(formData.credential ?? '')}
          onReferenceValueChange={value => updateField('credential', value)}
          options={relationOptions}
          onCreateReference={() => {
            openSecretDialog({
              addOption: (id, label) => {
                addRelationOption(id, label)
                updateField('credential_use_secret', true)
                updateField('credential', id)
              },
            })
          }}
        />
      )
    },
    [openSecretDialog]
  )

  const buildBaseFields = useCallback(
    (selectedTemplate: InstanceTemplate | null) =>
      [
        {
          key: 'kind',
          label: 'Kind',
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.kind ?? '',
        },
        {
          key: 'template_id',
          label: 'Template',
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.id ?? '',
        },
        {
          key: 'selected_product',
          label: 'Selected Product',
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productTitle(selectedTemplate) : '',
        },
        {
          key: 'selected_product_meta',
          label: 'Selected Product Meta',
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productMeta(selectedTemplate) : '',
        },
        {
          key: 'selected_product_description',
          label: 'Selected Product Description',
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productDescription(selectedTemplate) : '',
        },
        {
          key: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          hidden: true,
          placeholder: 'db-prod',
          defaultValue: selectedTemplate ? buildDefaultInstanceName(selectedTemplate) : '',
        },
        {
          key: 'title_name_editing',
          label: 'Title Name Editing',
          type: 'boolean',
          hidden: true,
          readOnly: true,
          defaultValue: false,
        },
        {
          key: 'endpoint',
          label: 'Endpoint',
          type: 'text',
          hidden: isDatabaseConnectionKind(selectedTemplate),
          placeholder: 'db.example.com:3306 or https://service.example.com',
          defaultValue: selectedTemplate?.defaultEndpoint ?? '',
        },
        {
          key: 'host',
          label: 'Host',
          type: 'text',
          hidden: !isDatabaseConnectionKind(selectedTemplate),
          required: isDatabaseConnectionKind(selectedTemplate),
          placeholder: 'db.example.com',
          defaultValue: splitEndpoint(selectedTemplate?.defaultEndpoint ?? '').host,
        },
        {
          key: 'port',
          label: 'Port',
          type: 'number',
          hidden: !isDatabaseConnectionKind(selectedTemplate),
          required: isDatabaseConnectionKind(selectedTemplate),
          defaultValue: Number(
            splitEndpoint(selectedTemplate?.defaultEndpoint ?? '').port ||
              defaultPortForTemplate(selectedTemplate)
          ),
        },
        {
          key: 'provider_account',
          label: 'Platform Account',
          type: 'relation',
          advanced: isDatabaseConnectionKind(selectedTemplate),
          relationApiPath: '/api/provider-accounts',
          relationLabelKey: 'name',
        },
        {
          key: 'credential',
          label: databaseCredentialLabel(selectedTemplate),
          type: 'relation',
          required: isDatabaseConnectionKind(selectedTemplate) && Boolean(selectedTemplate),
          relationApiPath: isSecretBackedConnectionKind(selectedTemplate)
            ? buildSecretRelationApiPath(['single_value'])
            : '/api/collections/secrets/records?perPage=500&sort=name',
          relationLabelKey: 'name',
          helpText: isSecretBackedConnectionKind(selectedTemplate)
            ? 'Use a direct password or switch to a reusable Secret.'
            : undefined,
          render: isSecretBackedConnectionKind(selectedTemplate)
            ? renderDatabaseCredentialField
            : undefined,
        },
        {
          key: 'description',
          label: 'Description',
          type: 'textarea',
          advanced: isDatabaseConnectionKind(selectedTemplate),
        },
        {
          key: 'groups',
          label: 'Groups',
          type: 'relation',
          advanced: isDatabaseConnectionKind(selectedTemplate),
          multiSelect: true,
          relationAutoSelectDefault: true,
          relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
          relationLabelKey: 'name',
          defaultValue: [],
        },
      ] satisfies FieldDef[],
    [renderDatabaseCredentialField]
  )

  const resolveInstanceFields = useCallback(
    ({ formData }: { formData: Record<string, unknown> }) => {
      const selectedTemplateId = String(formData.template_id ?? '')
      const selectedTemplate = templatesById.get(selectedTemplateId)
      const baseFields = buildBaseFields(selectedTemplate ?? null)
      const dynamicFields = mergeDatabaseTemplateFields(selectedTemplate).map(field =>
        mapTemplateFieldToResourceField(field, selectedTemplate!)
      )

      if (isDatabaseConnectionKind(selectedTemplate)) {
        const primaryTemplateFields = dynamicFields.filter(
          field => !field.hidden && !field.advanced
        )
        const advancedTemplateFields = dynamicFields.filter(
          field => !field.hidden && field.advanced
        )
        const hiddenTemplateFields = dynamicFields.filter(field => field.hidden)
        const identityFields = ['database', 'username'].flatMap(key =>
          primaryTemplateFields.filter(field => field.key === key)
        )
        const extraFields = primaryTemplateFields.filter(
          field => !['database', 'username'].includes(field.key)
        )

        return [
          baseFields[0],
          baseFields[1],
          baseFields[2],
          baseFields[3],
          baseFields[4],
          baseFields[7],
          ...hiddenTemplateFields,
          baseFields[5],
          ...identityFields,
          baseFields[11],
          baseFields[8],
          baseFields[9],
          ...extraFields,
          ...advancedTemplateFields,
          baseFields[10],
          baseFields[12],
          baseFields[13],
          baseFields[6],
        ]
      }

      return [
        baseFields[0],
        baseFields[1],
        baseFields[2],
        baseFields[3],
        baseFields[4],
        baseFields[5],
        baseFields[6],
        ...dynamicFields,
        ...baseFields.slice(7),
      ]
    },
    [buildBaseFields, templatesById]
  )

  const bootstrapFields = useMemo(() => buildBaseFields(null), [buildBaseFields])

  return (
    <>
      <ResourcePage
        config={{
          title: 'Service Instances',
          description:
            'MySQL, PostgreSQL, Redis, Kafka, S3 storage, and model services with profile-based templates.',
          apiPath: '/api/instances',
          columns,
          fields: bootstrapFields,
          createSelection: {
            title: 'Choose a Product',
            description: 'Choose a product, then enter connection details.',
            searchPlaceholder: 'Search products like MySQL, Redis, Aurora, PostgreSQL...',
            emptyMessage: 'No matching products found.',
            options: productOptions,
            onSelect: optionId => {
              const selectedTemplate = templatesById.get(optionId)
              if (!selectedTemplate) return {}

              const defaults: Record<string, unknown> = {
                kind: selectedTemplate.kind,
                template_id: selectedTemplate.id,
                name: buildDefaultInstanceName(selectedTemplate),
                selected_product: productTitle(selectedTemplate),
                selected_product_meta: productMeta(selectedTemplate),
                selected_product_description: productDescription(selectedTemplate),
                endpoint: selectedTemplate.defaultEndpoint ?? '',
                credential_use_secret: false,
                password_value: '',
                title_name_editing: false,
              }

              if (isDatabaseConnectionKind(selectedTemplate)) {
                const endpointParts = splitEndpoint(selectedTemplate.defaultEndpoint ?? '')
                defaults.host = endpointParts.host
                defaults.port = Number(
                  endpointParts.port || defaultPortForTemplate(selectedTemplate)
                )
              }

              for (const field of mergeDatabaseTemplateFields(selectedTemplate)) {
                defaults[field.id] = normalizeTemplateFieldDefault(field)
              }

              return defaults
            },
          },
          dialogContentClassName: 'sm:max-w-4xl',
          dialogHeader: ({ formData, editingItem, updateField, title, description }) => {
            const selectedTemplate = templatesById.get(String(formData.template_id ?? ''))
            const instanceName = String(formData.name ?? '').trim()
            const editingName = Boolean(formData.title_name_editing)
            if (!selectedTemplate) {
              return { title, description, hideSelectedProductSummary: true }
            }

            return {
              title: (
                <div className="flex flex-wrap items-center gap-2">
                  {editingName ? (
                    <div className="flex min-w-[280px] flex-1 items-center gap-2">
                      <Input
                        value={instanceName}
                        aria-label="Instance title"
                        onChange={event => updateField('name', event.target.value)}
                        onBlur={() => updateField('title_name_editing', false)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            updateField('title_name_editing', false)
                          }
                        }}
                        autoFocus
                        className="h-9 max-w-xl"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Apply title"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => updateField('title_name_editing', false)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="max-w-full truncate text-xl font-semibold">
                        {instanceName || 'New Service Instance'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Edit title"
                        onClick={() => updateField('title_name_editing', true)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Editable
                  </span>
                </div>
              ),
              description: `${editingItem ? 'Update' : 'Create'} ${productTitle(selectedTemplate)} ${categoryLabel(selectedTemplate.category)} Service Instance`,
              hideSelectedProductSummary: true,
            }
          },
          resolveFields: resolveInstanceFields,
          resourceType: 'instance',
          autoCreate,
          enableGroupAssign: true,
          showRefreshButton: true,
          createButtonIconOnly: true,
          wrapTableInCard: false,
          listItems: async () => {
            const items = await pb.send<InstanceRecord[]>('/api/instances', { method: 'GET' })
            const rows = Array.isArray(items)
              ? items.map(item => mapInstanceRow(item, templatesById))
              : []
            if (rows.length === 0) {
              return rows
            }

            let reachability: InstanceReachabilityRecord[] = []
            try {
              const response = await pb.send<InstanceReachabilityRecord[]>('/api/instances/reachability', {
                method: 'POST',
                body: { ids: rows.map(row => String(row.id)) },
              })
              reachability = Array.isArray(response) ? response : []
            } catch {
              reachability = []
            }

            const byId = new Map(
              reachability.map(item => [
                item.id,
                {
                  reachability: String(item.status ?? 'unknown'),
                  reachability_reason: String(item.reason ?? ''),
                  reachability_latency_ms: item.latency_ms,
                },
              ])
            )

            return rows.map(row => ({
              ...row,
              ...(byId.get(String(row.id)) ?? {}),
            }))
          },
          createItem: async payload => {
            const body = await buildInstancePayload(payload, templatesById)
            const created = await pb.send<InstanceRecord>('/api/instances', {
              method: 'POST',
              body,
            })
            return mapInstanceRow(created, templatesById)
          },
          updateItem: async (id, payload) => {
            const body = await buildInstancePayload(payload, templatesById)
            await pb.send(`/api/instances/${id}`, { method: 'PUT', body })
          },
          deleteItem: async id => {
            await pb.send(`/api/instances/${id}`, { method: 'DELETE' })
          },
        }}
      />

      <SecretCreateDialog
        open={secretDialogOpen}
        onOpenChange={setSecretDialogOpen}
        title="New Secret"
        description="Create a reusable password secret and attach it to this service instance."
        allowedTemplateIds={Array.from(SECRET_TEMPLATE_IDS)}
        templateLabels={SECRET_TEMPLATE_LABELS}
        defaultTemplateId="single_value"
        onCreated={({ id, label }) => {
          secretAddOption?.(id, label)
        }}
      />
    </>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/service-instances')({
  component: ServiceInstancesPage,
})
