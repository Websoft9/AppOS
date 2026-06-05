import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
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
import { buildResourceSecretRelationApiPath } from '@/components/secrets/SecretVisibilityField'
import { getLocale } from '@/lib/i18n'
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

type Translate = (key: string, options?: Record<string, unknown>) => string

const DATABASE_COMMON_FIELD_IDS = new Set(['username', 'connect_timeout', 'ssl_enabled'])

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

const TEMPLATE_FIELD_OVERRIDE_KEYS: Record<string, string> = {
  database: 'serviceInstances.templateFields.database',
  region: 'serviceInstances.templateFields.region',
  clusterIdentifier: 'serviceInstances.templateFields.clusterIdentifier',
  clusterId: 'serviceInstances.templateFields.clusterId',
}

function buildDatabaseCommonFields(t: Translate): InstanceTemplateField[] {
  return [
    {
      id: 'username',
      label: t('serviceInstances.fields.username'),
      type: 'text',
      required: true,
      placeholder: t('serviceInstances.placeholders.username'),
    },
    {
      id: 'connect_timeout',
      label: t('serviceInstances.fields.connectionTimeout'),
      type: 'number',
      default: 10,
      helpText: t('serviceInstances.help.connectionTimeout'),
    },
    {
      id: 'ssl_enabled',
      label: t('serviceInstances.fields.useSsl'),
      type: 'boolean',
      default: false,
    },
  ]
}

function localizeTemplateFieldCopy(
  field: InstanceTemplateField,
  t: Translate
): InstanceTemplateField {
  const key = TEMPLATE_FIELD_OVERRIDE_KEYS[field.id]
  if (!key) {
    return field
  }

  const localizedLabel = t(key)
  if (localizedLabel === key) {
    return field
  }

  return {
    ...field,
    label: localizedLabel,
  }
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

function kindLabel(kind: string, t: Translate) {
  const normalized = String(kind).trim().toLowerCase()
  if (KIND_LABELS[normalized]) {
    return t(`serviceInstances.kinds.${normalized}`)
  }
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : t('serviceInstances.kinds.unknown')
}

function isGenericTemplate(template: InstanceTemplate, t: Translate) {
  const normalizedTitle = template.title.trim().toLowerCase()
  return (
    template.id.startsWith('generic-') ||
    normalizedTitle.includes('generic') ||
    normalizedTitle === `standard ${kindLabel(template.kind, t).toLowerCase()}`
  )
}

function productTitle(template: InstanceTemplate, t: Translate) {
  return isGenericTemplate(template, t) ? kindLabel(template.kind, t) : template.title
}

function buildDefaultInstanceName(template: InstanceTemplate, t: Translate) {
  const base =
    slugifyNamePart(productTitle(template, t)) || slugifyNamePart(template.kind) || 'instance'
  return `${base}-${Date.now().toString().slice(-4)}`
}

function buildDefaultCredentialSecretName(
  template: InstanceTemplate,
  instanceName: string,
  t: Translate
) {
  const base =
    slugifyNamePart(instanceName) || slugifyNamePart(productTitle(template, t)) || 'instance'
  return `${base}-password`
}

function categoryLabel(category: string | undefined, t: Translate) {
  const normalized = String(category ?? '')
    .trim()
    .toLowerCase()
  if (CATEGORY_LABELS[normalized]) {
    return t(`serviceInstances.categories.${normalized}`)
  }
  return t('serviceInstances.categories.other')
}

function productMeta(template: InstanceTemplate, t: Translate) {
  return [categoryLabel(template.category, t), template.vendor].filter(Boolean).join(' · ')
}

function productDescription(template: InstanceTemplate, t: Translate) {
  if (isGenericTemplate(template, t)) {
    return t('serviceInstances.product.standardTemplate')
  }
  return (
    template.description ||
    t('serviceInstances.product.profileDescription', {
      vendorPrefix: template.vendor ? `${template.vendor} ` : '',
      category: categoryLabel(template.category, t).toLowerCase(),
    })
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
  return buildResourceSecretRelationApiPath({
    visibleTo: 'service_instance',
    templateIds: secretTemplateIds,
  })
}

function databaseCertificateHelpText(template: InstanceTemplate | null | undefined, t: Translate) {
  if (template?.kind === 'postgres') {
    return t('serviceInstances.help.sslCertificatePostgres')
  }
  return t('serviceInstances.help.sslCertificateMysql')
}

function formatDateTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const locale = getLocale()
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatMonitorStatusLabel(value: unknown, t: Translate) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return t('serviceInstances.monitor.unknown')
  const key = `serviceInstances.monitor.status.${raw}`
  const localized = t(key)
  if (localized !== key) {
    return localized
  }
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

function mergeDatabaseTemplateFields(template: InstanceTemplate | null | undefined, t: Translate) {
  if (!template) {
    return [] as InstanceTemplateField[]
  }
  if (!isDatabaseConnectionKind(template)) {
    return template.fields ?? []
  }

  const omitted = new Set((template.omitCommonFields ?? []).map(value => String(value).trim()))
  const merged: InstanceTemplateField[] = []
  const existingById = new Map((template.fields ?? []).map(field => [field.id, field]))

  for (const field of buildDatabaseCommonFields(t)) {
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
  template: InstanceTemplate,
  t: Translate
): FieldDef {
  const localizedField = localizeTemplateFieldCopy(field, t)

  if (isDatabaseConnectionKind(template) && (field.id === 'engine' || field.id === 'provider')) {
    return {
      key: localizedField.id,
      label: localizedField.label,
      type: 'text',
      hidden: true,
      defaultValue: normalizeTemplateFieldDefault(localizedField),
    }
  }

  if (isDatabaseConnectionKind(template) && field.id === 'ssl_ca_certificate') {
    return {
      key: localizedField.id,
      label: t('serviceInstances.fields.sslCertificate'),
      type: 'relation',
      advanced: true,
      showWhen: { field: 'ssl_mode', values: ['mutual'] },
      relationApiPath: "/api/collections/certificates/records?filter=(status='active')&sort=name",
      relationLabelKey: 'name',
      helpText: databaseCertificateHelpText(template, t),
      relationShowNoneOption: false,
      relationShowSelectedIndicator: false,
      relationBorderlessMenu: true,
      defaultValue: normalizeTemplateFieldDefault(localizedField),
    }
  }

  if (isDatabaseConnectionKind(template) && field.id === 'ssl_enabled') {
    return {
      key: localizedField.id,
      label: localizedField.label,
      type: 'boolean',
      hidden: true,
      defaultValue: normalizeTemplateFieldDefault(localizedField),
    }
  }

  return {
    key: localizedField.id,
    label: localizedField.label,
    type:
      localizedField.type === 'boolean'
        ? 'boolean'
        : localizedField.type === 'number'
          ? 'number'
          : 'text',
    required: localizedField.required,
    placeholder: localizedField.placeholder,
    defaultValue: normalizeTemplateFieldDefault(localizedField),
    helpText: localizedField.helpText,
    advanced: isDatabaseConnectionKind(template) && ['connect_timeout'].includes(localizedField.id),
  }
}

async function buildInstancePayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, InstanceTemplate>,
  t: Translate
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error(t('serviceInstances.errors.instanceProfileRequired'))
  }

  if (isSecretBackedConnectionKind(template)) {
    const useCredentialReference = Boolean(body.credential_use_secret)
    if (!useCredentialReference) {
      const passwordValue = String(body.password_value ?? '')
      if (!passwordValue.trim() && isDatabaseConnectionKind(template)) {
        throw new Error(t('serviceInstances.errors.passwordRequired'))
      }
      if (passwordValue.trim()) {
        const instanceName = String(body.name ?? '').trim()
        const createdSecret = await pb.collection('secrets').create({
          name: buildDefaultCredentialSecretName(template, instanceName, t),
          description: t('serviceInstances.secret.generatedDescription', {
            name: instanceName || productTitle(template, t),
          }),
          template_id: 'single_value',
          scope: 'global',
          visible_to: ['service_instance'],
          payload: { value: passwordValue },
        })
        body.credential = String(createdSecret.id ?? '')
      } else {
        body.credential = ''
      }
    }

    if (isDatabaseConnectionKind(template) && !String(body.credential ?? '').trim()) {
      throw new Error(t('serviceInstances.errors.passwordSecretRequired'))
    }
  }

  if (isDatabaseConnectionKind(template)) {
    const sslMode = String(body.ssl_mode ?? '').trim()
    body.ssl_enabled = sslMode === 'one_way' || sslMode === 'mutual'
    if (sslMode !== 'mutual') {
      body.ssl_ca_certificate = ''
    }
    if (sslMode === 'mutual' && !String(body.ssl_ca_certificate ?? '').trim()) {
      throw new Error(t('serviceInstances.errors.sslCertificateRequired'))
    }
  }

  const config: Record<string, unknown> = {}
  for (const field of mergeDatabaseTemplateFields(template, t)) {
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
  monitorByTargetId: Map<string, MonitorLatestStatusRecord>,
  t: Translate
): Record<string, unknown> {
  const template = templatesById.get(String(item.template_id ?? ''))
  const monitor = monitorByTargetId.get(String(item.id ?? ''))
  const endpointParts = splitEndpoint(String(item.endpoint ?? ''))
  const flattenedConfig: Record<string, unknown> = {}
  const fallbackConfig = item.config ?? {}

  for (const field of mergeDatabaseTemplateFields(template, t)) {
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
    kind_label: kindLabel(String(item.kind ?? ''), t),
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

function buildColumns(t: Translate): Column[] {
  return [
    { key: 'name', label: t('serviceInstances.columns.name'), searchable: true, sortable: true },
    {
      key: 'kind_label',
      label: t('serviceInstances.columns.kind'),
      sortable: true,
      filterValue: row => String(row.kind_label ?? ''),
      render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
    },
    {
      key: 'profile',
      label: t('serviceInstances.columns.profile'),
      searchable: true,
      sortable: true,
      filterValue: row => String(row.profile ?? ''),
    },
    {
      key: 'host',
      label: t('serviceInstances.columns.host'),
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
      label: t('serviceInstances.columns.monitor'),
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
            {formatMonitorStatusLabel(status, t)}
          </Badge>
        )
      },
    },
    {
      key: 'monitor_last_checked_at',
      label: t('serviceInstances.columns.lastChecked'),
      sortable: true,
      sortValue: row => String(row.monitor_last_checked_at ?? ''),
      render: value => (
        <span className="text-sm text-muted-foreground">{formatDateTime(value)}</span>
      ),
    },
    {
      key: 'created',
      label: t('serviceInstances.columns.created'),
      sortable: true,
      render: value => (
        <span className="text-sm text-muted-foreground">{formatDateTime(value)}</span>
      ),
    },
    {
      key: 'updated',
      label: t('serviceInstances.columns.updated'),
      sortable: true,
      render: value => (
        <span className="text-sm text-muted-foreground">{formatDateTime(value)}</span>
      ),
    },
  ]
}

export function ServiceInstancesPage() {
  const { t } = useTranslation('resources')
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
          const genericCompare =
            Number(isGenericTemplate(right, t)) - Number(isGenericTemplate(left, t))
          if (genericCompare !== 0) return genericCompare
          return productTitle(left, t).localeCompare(productTitle(right, t))
        })
        .map(template => ({
          id: template.id,
          title: productTitle(template, t),
          meta: productMeta(template, t),
          searchText: [
            productDescription(template, t),
            template.title,
            template.vendor,
            template.kind,
            categoryLabel(template.category, t),
          ].join(' '),
        })),
    [instanceTemplates, t]
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
      ? items.map(item => mapInstanceRow(item, templatesById, monitorByTargetId, t))
      : []
  }, [t, templatesById])

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
        label:
          template.id === 'single_value'
            ? t('serviceInstances.secret.singleValueTemplate')
            : (SECRET_TEMPLATE_LABELS[template.id] ?? template.label),
      }))
  }, [t])

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
        setSecretEditError(
          error instanceof Error ? error.message : t('serviceInstances.secret.errors.load')
        )
      } finally {
        setSecretEditLoading(false)
      }
    },
    [loadAllowedSecretTemplates, t]
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
      setSecretEditError(t('serviceInstances.secret.errors.nameRequired'))
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
      setSecretEditError(
        error instanceof Error ? error.message : t('serviceInstances.secret.errors.update')
      )
    } finally {
      setSecretEditSaving(false)
    }
  }, [closeSecretEditor, secretEditDescription, secretEditId, secretEditName, secretEditPayload, t])

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
            <span>{t('serviceInstances.ssl.oneWay')}</span>
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
            <span>{t('serviceInstances.ssl.mutual')}</span>
          </label>
        </div>
      )
    },
    [t]
  )

  const buildBaseFields = useCallback(
    (selectedTemplate: InstanceTemplate | null) =>
      [
        {
          key: 'kind',
          label: t('serviceInstances.fields.kind'),
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.kind ?? '',
        },
        {
          key: 'template_id',
          label: t('serviceInstances.fields.template'),
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.id ?? '',
        },
        {
          key: 'selected_product',
          label: t('serviceInstances.fields.selectedProduct'),
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productTitle(selectedTemplate, t) : '',
        },
        {
          key: 'selected_product_meta',
          label: t('serviceInstances.fields.selectedProductMeta'),
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productMeta(selectedTemplate, t) : '',
        },
        {
          key: 'selected_product_description',
          label: t('serviceInstances.fields.selectedProductDescription'),
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productDescription(selectedTemplate, t) : '',
        },
        {
          key: 'name',
          label: t('serviceInstances.fields.name'),
          type: 'text',
          required: true,
          hidden: true,
          placeholder: t('serviceInstances.placeholders.name'),
          defaultValue: selectedTemplate ? buildDefaultInstanceName(selectedTemplate, t) : '',
        },
        {
          key: 'title_name_editing',
          label: t('serviceInstances.fields.titleNameEditing'),
          type: 'boolean',
          hidden: true,
          readOnly: true,
          defaultValue: false,
        },
        {
          key: 'endpoint',
          label: t('serviceInstances.fields.endpoint'),
          type: 'text',
          hidden: isDatabaseConnectionKind(selectedTemplate),
          placeholder: t('serviceInstances.placeholders.endpoint'),
          defaultValue: selectedTemplate?.defaultEndpoint ?? '',
        },
        {
          key: 'host',
          label: t('serviceInstances.fields.host'),
          type: 'text',
          hidden: !isDatabaseConnectionKind(selectedTemplate),
          required: isDatabaseConnectionKind(selectedTemplate),
          placeholder: t('serviceInstances.placeholders.host'),
          defaultValue: splitEndpoint(selectedTemplate?.defaultEndpoint ?? '').host,
        },
        {
          key: 'port',
          label: t('serviceInstances.fields.port'),
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
          label: t('serviceInstances.fields.platformAccount'),
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
          label:
            selectedTemplate?.kind === 'redis'
              ? t('serviceInstances.fields.password')
              : selectedTemplate?.kind === 'kafka'
                ? t('serviceInstances.fields.credential')
                : isDatabaseConnectionKind(selectedTemplate)
                  ? t('serviceInstances.fields.password')
                  : t('serviceInstances.fields.credential'),
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
          label: t('serviceInstances.fields.credentialUsesSecret'),
          type: 'boolean',
          hidden: true,
          defaultValue: false,
        },
        {
          key: 'password_value',
          label: t('serviceInstances.fields.passwordValue'),
          type: 'text',
          hidden: true,
          defaultValue: '',
        },
        {
          key: 'ssl_mode',
          label: t('serviceInstances.fields.useSsl'),
          type: 'text',
          advanced: isDatabaseConnectionKind(selectedTemplate),
          hidden: !isDatabaseConnectionKind(selectedTemplate),
          defaultValue: '',
          render: isDatabaseConnectionKind(selectedTemplate) ? renderSslModeField : undefined,
        },
        {
          key: 'description',
          label: t('serviceInstances.fields.description'),
          type: 'textarea',
          advanced: isDatabaseConnectionKind(selectedTemplate),
        },
        {
          key: 'groups',
          label: t('serviceInstances.fields.groups'),
          type: 'relation',
          advanced: isDatabaseConnectionKind(selectedTemplate),
          multiSelect: true,
          relationAutoSelectDefault: true,
          relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
          relationLabelKey: 'name',
          defaultValue: [],
        },
      ] satisfies FieldDef[],
    [renderDatabaseCredentialField, renderSslModeField, t]
  )

  const resolveInstanceFields = useCallback(
    ({ formData }: { formData: Record<string, unknown> }) => {
      const selectedTemplateId = String(formData.template_id ?? '')
      const selectedTemplate = templatesById.get(selectedTemplateId)
      const baseFields = buildBaseFields(selectedTemplate ?? null)
      const dynamicFields = mergeDatabaseTemplateFields(selectedTemplate, t).map(field =>
        mapTemplateFieldToResourceField(field, selectedTemplate!, t)
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
    [buildBaseFields, t, templatesById]
  )

  const bootstrapFields = useMemo(() => buildBaseFields(null), [buildBaseFields])
  const columns = useMemo(() => buildColumns(t), [t])

  return (
    <>
      <ResourcePage
        config={{
          title: t('resources.serviceInstances.title', {
            defaultValue: t('serviceInstances.page.title'),
          }),
          description: t('serviceInstances.page.description'),
          apiPath: '/api/instances',
          favoriteStorageKey: 'resource-page:favorites:service-instances',
          favoritesFilterLabel: t('serviceInstances.page.favoritesOnly'),
          createButtonLabel: t('serviceInstances.page.addInstance'),
          createButtonShowIcon: false,
          searchPlaceholder: t('serviceInstances.page.searchPlaceholder'),
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
            title: t('serviceInstances.selection.title'),
            description: t('serviceInstances.selection.description'),
            searchPlaceholder: t('serviceInstances.selection.searchPlaceholder'),
            emptyMessage: t('serviceInstances.selection.emptyMessage'),
            options: productOptions,
            onSelect: optionId => {
              const selectedTemplate = templatesById.get(optionId)
              if (!selectedTemplate) return {}

              const defaults: Record<string, unknown> = {
                kind: selectedTemplate.kind,
                template_id: selectedTemplate.id,
                name: buildDefaultInstanceName(selectedTemplate, t),
                selected_product: productTitle(selectedTemplate, t),
                selected_product_meta: productMeta(selectedTemplate, t),
                selected_product_description: productDescription(selectedTemplate, t),
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

              for (const field of mergeDatabaseTemplateFields(selectedTemplate, t)) {
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
                        aria-label={t('serviceInstances.dialog.instanceTitle')}
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
                        title={t('serviceInstances.dialog.applyTitle')}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => updateField('title_name_editing', false)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="max-w-full truncate text-xl font-semibold">
                        {instanceName || t('serviceInstances.dialog.newInstance')}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={t('serviceInstances.dialog.editTitle')}
                        onClick={() => updateField('title_name_editing', true)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ),
              description: `${editingItem ? t('serviceInstances.dialog.update') : t('serviceInstances.dialog.create')} ${productTitle(selectedTemplate, t)} ${categoryLabel(selectedTemplate.category, t)} ${t('serviceInstances.dialog.suffix')}`,
              hideSelectedProductSummary: true,
            }
          },
          resolveFields: resolveInstanceFields,
          resourceType: 'instance',
          parentNav: { label: t('hub.title'), href: '/resources' },
          autoCreate,
          enableGroupAssign: true,
          showRefreshButton: true,
          wrapTableInCard: false,
          listItems,
          createItem: async payload => {
            const body = await buildInstancePayload(payload, templatesById, t)
            const created = await pb.send<InstanceRecord>('/api/instances', {
              method: 'POST',
              body,
            })
            return mapInstanceRow(created, templatesById, new Map(), t)
          },
          updateItem: async (id, payload) => {
            const body = await buildInstancePayload(payload, templatesById, t)
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
        title={t('serviceInstances.secret.newTitle')}
        description={t('serviceInstances.secret.newDescription')}
        allowedTemplateIds={Array.from(SECRET_TEMPLATE_IDS)}
        templateLabels={{
          ...SECRET_TEMPLATE_LABELS,
          single_value: t('serviceInstances.secret.singleValueTemplate'),
        }}
        defaultTemplateId="single_value"
        defaultVisibleTo={['service_instance']}
        onCreated={({ id, label }) => {
          secretAddOption?.(id, label)
        }}
      />

      <Dialog open={secretEditOpen} onOpenChange={closeSecretEditor}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('serviceInstances.secret.editTitle')}</DialogTitle>
            <DialogDescription>{t('serviceInstances.secret.editDescription')}</DialogDescription>
          </DialogHeader>

          {secretEditLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('serviceInstances.secret.loading')}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="instance-secret-edit-name"
                  className="text-sm font-medium text-foreground"
                >
                  {t('serviceInstances.fields.name')} <span className="text-destructive">*</span>
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
                  {t('serviceInstances.fields.description')}
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
              {t('serviceInstances.page.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSecretEditSave()
              }}
              disabled={secretEditLoading || secretEditSaving}
            >
              {secretEditSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('serviceInstances.secret.save')}
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
