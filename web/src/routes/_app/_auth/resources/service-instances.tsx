import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Loader2, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { SecretForm, type SecretTemplate } from '@/components/secrets/SecretForm'
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

type MonitorLatestStatusRecord = {
  target_id?: string
  status?: string
  reason?: string | null
  last_checked_at?: string | null
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
  commonFieldDefaults?: Record<string, unknown>
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

function parseBooleanValue(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!normalized) return false
  return ['1', 'true', 'yes', 'on'].includes(normalized)
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
    return 'Choose a certificate only when your PostgreSQL connection requires mutual SSL.'
  }
  return 'Choose a certificate only when your MySQL connection requires mutual SSL.'
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

function formatMonitorStatusLabel(value: unknown) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return 'Unknown'
  return raw
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function monitorStatusVariant(
  status: unknown
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (
    String(status ?? '')
      .trim()
      .toLowerCase()
  ) {
    case 'healthy':
      return 'default'
    case 'offline':
    case 'unreachable':
    case 'credential_invalid':
      return 'destructive'
    case 'degraded':
      return 'outline'
    default:
      return 'secondary'
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
    const override = existingById.get(field.id)
    const configuredDefault = template.commonFieldDefaults?.[field.id]
    merged.push(
      override ?? {
        ...field,
        default: configuredDefault ?? field.default,
      }
    )
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
      label: 'SSL Certificate',
      type: 'relation',
      advanced: true,
      showWhen: { field: 'ssl_mode', values: ['mutual'] },
      relationApiPath: "/api/collections/certificates/records?filter=(status='active')&sort=name",
      relationLabelKey: 'name',
      helpText: databaseCertificateHelpText(template),
      relationShowNoneOption: false,
      relationShowSelectedIndicator: false,
      relationBorderlessMenu: true,
      defaultValue: normalizeTemplateFieldDefault(field),
    }
  }

  if (isDatabaseConnectionKind(template) && field.id === 'ssl_enabled') {
    return {
      key: field.id,
      label: field.label,
      type: 'boolean',
      hidden: true,
      defaultValue: normalizeTemplateFieldDefault(field),
    }
  }

  return {
    key: field.id,
    label: field.label,
    type: field.type === 'boolean' ? 'boolean' : field.type === 'number' ? 'number' : 'text',
    required: field.required,
    placeholder: field.placeholder,
    defaultValue: normalizeTemplateFieldDefault(field),
    helpText: field.helpText,
    advanced: isDatabaseConnectionKind(template) && ['connect_timeout'].includes(field.id),
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

  if (isDatabaseConnectionKind(template)) {
    const sslMode = String(body.ssl_mode ?? '').trim()
    body.ssl_enabled = sslMode === 'one_way' || sslMode === 'mutual'
    if (sslMode !== 'mutual') {
      body.ssl_ca_certificate = ''
    }
    if (sslMode === 'mutual' && !String(body.ssl_ca_certificate ?? '').trim()) {
      throw new Error('SSL certificate is required for mutual SSL')
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
  templatesById: Map<string, InstanceTemplate>,
  monitorByTargetId: Map<string, MonitorLatestStatusRecord>
): Record<string, unknown> {
  const template = templatesById.get(String(item.template_id ?? ''))
  const monitor = monitorByTargetId.get(String(item.id ?? ''))
  const endpointParts = splitEndpoint(String(item.endpoint ?? ''))
  const flattenedConfig: Record<string, unknown> = {}
  const fallbackConfig = item.config ?? {}

  for (const field of mergeDatabaseTemplateFields(template)) {
    const value = item.config?.[field.id]
    if (value === undefined) {
      continue
    }
    flattenedConfig[field.id] = value
  }

  if (Object.keys(flattenedConfig).length === 0) {
    Object.assign(flattenedConfig, fallbackConfig)
  }

  const credentialId = String(item.credential ?? '').trim()
  const sslEnabled = parseBooleanValue(flattenedConfig.ssl_enabled)
  const sslCertificate = String(flattenedConfig.ssl_ca_certificate ?? '').trim()
  flattenedConfig.ssl_mode = sslEnabled ? (sslCertificate ? 'mutual' : 'one_way') : ''

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
    credential: credentialId,
    monitor_status: String(monitor?.status ?? ''),
    monitor_reason: String(monitor?.reason ?? ''),
    monitor_last_checked_at: String(monitor?.last_checked_at ?? ''),
    credential_use_secret: Boolean(credentialId),
    password_value: '',
    description: String(item.description ?? ''),
    ...flattenedConfig,
  }
}

const columns: Column[] = [
  { key: 'name', label: 'Name', searchable: true, sortable: true },
  {
    key: 'kind_label',
    label: 'Kind',
    sortable: true,
    filterValue: row => String(row.kind_label ?? ''),
    render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
  },
  {
    key: 'profile',
    label: 'Profile',
    searchable: true,
    sortable: true,
    filterValue: row => String(row.profile ?? ''),
  },
  {
    key: 'host',
    label: 'Host',
    searchable: true,
    sortable: true,
    render: value => (
      <span className="max-w-[220px] truncate block" title={String(value || '')}>
        {String(value || '—')}
      </span>
    ),
  },
  {
    key: 'monitor_status',
    label: 'Monitor',
    sortable: true,
    sortValue: row => String(row.monitor_status ?? ''),
    filterValue: row => String(row.monitor_status ?? ''),
    render: (value, row) => {
      const status = String(value ?? '').trim()
      const reason = String(row.monitor_reason ?? '').trim()
      if (!status) {
        return <span className="text-sm text-muted-foreground">—</span>
      }
      return (
        <Badge variant={monitorStatusVariant(status)} title={reason || undefined}>
          {formatMonitorStatusLabel(status)}
        </Badge>
      )
    },
  },
  {
    key: 'monitor_last_checked_at',
    label: 'Last Checked',
    sortable: true,
    sortValue: row => String(row.monitor_last_checked_at ?? ''),
    render: value => <span className="text-sm text-muted-foreground">{formatDateTime(value)}</span>,
  },
  {
    key: 'created',
    label: 'Created',
    sortable: true,
    render: value => <span className="text-sm text-muted-foreground">{formatDateTime(value)}</span>,
  },
  {
    key: 'updated',
    label: 'Updated',
    sortable: true,
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
  const [secretEditOpen, setSecretEditOpen] = useState(false)
  const [secretEditLoading, setSecretEditLoading] = useState(false)
  const [secretEditSaving, setSecretEditSaving] = useState(false)
  const [secretEditError, setSecretEditError] = useState('')
  const [secretEditId, setSecretEditId] = useState('')
  const [secretEditName, setSecretEditName] = useState('')
  const [secretEditDescription, setSecretEditDescription] = useState('')
  const [secretEditTemplateId, setSecretEditTemplateId] = useState('')
  const [secretEditPayload, setSecretEditPayload] = useState<Record<string, string>>({})
  const [secretEditTemplates, setSecretEditTemplates] = useState<SecretTemplate[]>([])

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
          meta: productMeta(template),
          searchText: [
            productDescription(template),
            template.title,
            template.vendor,
            template.kind,
            categoryLabel(template.category),
          ].join(' '),
        })),
    [instanceTemplates]
  )

  const listItems = useCallback(async () => {
    const [items, monitorResponse] = await Promise.all([
      pb.send<InstanceRecord[]>('/api/instances', { method: 'GET' }),
      pb.send<{ items?: MonitorLatestStatusRecord[] }>(
        `/api/collections/monitor_latest_status/records?${new URLSearchParams({
          perPage: '500',
          sort: '-updated',
          filter: `(target_type='resource')`,
        }).toString()}`,
        { method: 'GET' }
      ),
    ])

    const monitorByTargetId = new Map(
      Array.isArray(monitorResponse?.items)
        ? monitorResponse.items
            .map(record => [String(record.target_id ?? '').trim(), record] as const)
            .filter(([targetId]) => Boolean(targetId))
        : []
    )

    return Array.isArray(items)
      ? items.map(item => mapInstanceRow(item, templatesById, monitorByTargetId))
      : []
  }, [templatesById])

  const openSecretDialog = useCallback(
    (callbacks: { addOption: (id: string, label: string) => void }) => {
      setSecretAddOption(() => callbacks.addOption)
      setSecretDialogOpen(true)
    },
    []
  )

  const loadAllowedSecretTemplates = useCallback(async () => {
    const data = await pb.send<SecretTemplate[]>('/api/secrets/templates', { method: 'GET' })
    return (Array.isArray(data) ? data : [])
      .filter(template => SECRET_TEMPLATE_IDS.has(template.id))
      .map(template => ({
        ...template,
        label: SECRET_TEMPLATE_LABELS[template.id] ?? template.label,
      }))
  }, [])

  const openSecretEditor = useCallback(
    async (secretId: string) => {
      setSecretEditOpen(true)
      setSecretEditLoading(true)
      setSecretEditSaving(false)
      setSecretEditError('')
      setSecretEditId(secretId)
      setSecretEditPayload({})

      try {
        const [secret, templates] = await Promise.all([
          pb.collection('secrets').getOne(secretId),
          loadAllowedSecretTemplates(),
        ])

        setSecretEditTemplates(templates)
        setSecretEditName(String(secret.name ?? ''))
        setSecretEditDescription(String(secret.description ?? ''))
        setSecretEditTemplateId(String(secret.template_id ?? ''))
      } catch (error) {
        setSecretEditError(error instanceof Error ? error.message : 'Failed to load secret')
      } finally {
        setSecretEditLoading(false)
      }
    },
    [loadAllowedSecretTemplates]
  )

  const closeSecretEditor = useCallback((open: boolean) => {
    setSecretEditOpen(open)
    if (!open) {
      setSecretEditLoading(false)
      setSecretEditSaving(false)
      setSecretEditError('')
      setSecretEditId('')
      setSecretEditName('')
      setSecretEditDescription('')
      setSecretEditTemplateId('')
      setSecretEditPayload({})
      setSecretEditTemplates([])
    }
  }, [])

  const handleSecretEditSave = useCallback(async () => {
    if (!secretEditId) {
      return
    }
    if (!secretEditName.trim()) {
      setSecretEditError('Name is required')
      return
    }

    setSecretEditSaving(true)
    setSecretEditError('')
    try {
      await pb.collection('secrets').update(secretEditId, {
        name: secretEditName.trim(),
        description: secretEditDescription.trim(),
      })

      const payloadHasValues = Object.values(secretEditPayload).some(value => value.trim() !== '')
      if (payloadHasValues) {
        await pb.send(`/api/secrets/${secretEditId}/payload`, {
          method: 'PUT',
          body: { payload: secretEditPayload },
        })
      }

      closeSecretEditor(false)
    } catch (error) {
      setSecretEditError(error instanceof Error ? error.message : 'Failed to update secret')
    } finally {
      setSecretEditSaving(false)
    }
  }, [closeSecretEditor, secretEditDescription, secretEditId, secretEditName, secretEditPayload])

  const renderDatabaseCredentialField = useCallback(
    ({
      inputId,
      formData,
      editingItem,
      updateField,
      relationOptions,
      addRelationOption,
    }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      const editMode = Boolean(editingItem)
      const useSecret = editMode ? true : Boolean(formData.credential_use_secret)

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
          onEditReference={openSecretEditor}
          editMode={editMode}
        />
      )
    },
    [openSecretDialog, openSecretEditor]
  )

  const renderSslModeField = useCallback(
    ({ formData, updateField }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      const mode = String(formData.ssl_mode ?? '')

      return (
        <div className="flex flex-wrap items-center gap-4 py-1">
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={mode === 'one_way'}
              onCheckedChange={checked => {
                updateField('ssl_mode', checked ? 'one_way' : '')
                if (!checked) {
                  updateField('ssl_ca_certificate', '')
                }
              }}
            />
            <span>One-way SSL</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={mode === 'mutual'}
              onCheckedChange={checked => {
                updateField('ssl_mode', checked ? 'mutual' : '')
                if (!checked) {
                  updateField('ssl_ca_certificate', '')
                }
              }}
            />
            <span>Mutual SSL</span>
          </label>
        </div>
      )
    },
    []
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
          relationShowNoneOption: false,
          relationShowSelectedIndicator: false,
          relationBorderlessMenu: true,
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
          render: isSecretBackedConnectionKind(selectedTemplate)
            ? renderDatabaseCredentialField
            : undefined,
          relationShowNoneOption: false,
          relationShowSelectedIndicator: false,
          relationBorderlessMenu: true,
        },
        {
          key: 'credential_use_secret',
          label: 'Credential Uses Secret',
          type: 'boolean',
          hidden: true,
          defaultValue: false,
        },
        {
          key: 'password_value',
          label: 'Password Value',
          type: 'text',
          hidden: true,
          defaultValue: '',
        },
        {
          key: 'ssl_mode',
          label: 'Use SSL',
          type: 'text',
          advanced: isDatabaseConnectionKind(selectedTemplate),
          hidden: !isDatabaseConnectionKind(selectedTemplate),
          defaultValue: '',
          render: isDatabaseConnectionKind(selectedTemplate) ? renderSslModeField : undefined,
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
    [renderDatabaseCredentialField, renderSslModeField]
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
        const certificateFields = advancedTemplateFields.filter(
          field => field.key === 'ssl_ca_certificate'
        )
        const otherAdvancedFields = advancedTemplateFields.filter(
          field => field.key !== 'ssl_ca_certificate'
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
          baseFields[12],
          baseFields[13],
          ...hiddenTemplateFields,
          baseFields[5],
          ...identityFields,
          baseFields[11],
          baseFields[8],
          baseFields[9],
          ...extraFields,
          baseFields[14],
          ...certificateFields,
          ...otherAdvancedFields,
          baseFields[10],
          baseFields[15],
          baseFields[16],
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
          favoriteStorageKey: 'resource-page:favorites:service-instances',
          favoritesFilterLabel: 'Favorites only',
          createButtonLabel: 'Add Instance',
          createButtonShowIcon: false,
          searchPlaceholder: 'Search any instances',
          pageSize: 10,
          pageSizeOptions: [10, 20, 50],
          defaultSort: { key: 'name', dir: 'asc' },
          headerFilters: true,
          listControlsBorder: false,
          listControlsShowReset: false,
          pageSizeSelectorPlacement: 'footer',
          paginationSummary: false,
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
                ssl_mode: '',
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
                </div>
              ),
              description: `${editingItem ? 'Update' : 'Create'} ${productTitle(selectedTemplate)} ${categoryLabel(selectedTemplate.category)} Service Instance`,
              hideSelectedProductSummary: true,
            }
          },
          resolveFields: resolveInstanceFields,
          resourceType: 'instance',
          parentNav: { label: 'Resources', href: '/resources' },
          autoCreate,
          enableGroupAssign: true,
          showRefreshButton: true,
          wrapTableInCard: false,
          listItems,
          createItem: async payload => {
            const body = await buildInstancePayload(payload, templatesById)
            const created = await pb.send<InstanceRecord>('/api/instances', {
              method: 'POST',
              body,
            })
            return mapInstanceRow(created, templatesById, new Map())
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

      <Dialog open={secretEditOpen} onOpenChange={closeSecretEditor}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Secret</DialogTitle>
            <DialogDescription>
              Update the selected Secret without leaving service instance editing.
            </DialogDescription>
          </DialogHeader>

          {secretEditLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading secret...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="instance-secret-edit-name"
                  className="text-sm font-medium text-foreground"
                >
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  id="instance-secret-edit-name"
                  type="text"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={secretEditName}
                  onChange={event => setSecretEditName(event.target.value)}
                  required
                />
              </div>

              <SecretForm
                templates={secretEditTemplates}
                templateId={secretEditTemplateId}
                payload={secretEditPayload}
                onTemplateChange={() => {}}
                onPayloadChange={(key, value) => {
                  setSecretEditPayload(prev => ({ ...prev, [key]: value }))
                }}
                disableTemplateChange
              />

              <div className="space-y-2">
                <label
                  htmlFor="instance-secret-edit-description"
                  className="text-sm font-medium text-foreground"
                >
                  Description
                </label>
                <input
                  id="instance-secret-edit-description"
                  type="text"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={secretEditDescription}
                  onChange={event => setSecretEditDescription(event.target.value)}
                />
              </div>

              {secretEditError ? (
                <p className="text-sm text-destructive">{secretEditError}</p>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => closeSecretEditor(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSecretEditSave()
              }}
              disabled={secretEditLoading || secretEditSaving}
            >
              {secretEditSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/service-instances')({
  component: ServiceInstancesPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: typeof search.create === 'string' ? search.create : undefined,
  }),
})
