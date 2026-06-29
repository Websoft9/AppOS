import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { Check, Loader2, Pencil, Power, PowerOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
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
import { ResourcesBreadcrumb } from '@/components/resources/ResourcesBreadcrumb'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { buildApiKeyValue, SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { SecretForm, type SecretTemplate } from '@/components/secrets/SecretForm'
import { buildUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'
import { getLocale } from '@/lib/i18n'
import { pb } from '@/lib/pb'
import { cn } from '@/lib/utils'

type InstanceRecord = {
  id: string
  created?: string
  updated?: string
  name?: string
  kind?: string
  is_enabled?: boolean
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
  'message-queue': 'MQ',
  storage: 'Storage',
  search: 'Search',
  'application-service': 'Application Service',
}

const KIND_LABELS: Record<string, string> = {
  'mysql-compatible': 'MySQL-Compatible',
  'postgres-compatible': 'PostgreSQL-Compatible',
  'mongodb-compatible': 'MongoDB-Compatible',
  'clickhouse-compatible': 'ClickHouse-Compatible',
  'neo4j-compatible': 'Neo4j-Compatible',
  'influxdb-compatible': 'InfluxDB-Compatible',
  'redis-compatible': 'Redis-Compatible',
  'elasticsearch-compatible': 'Elasticsearch-Compatible',
  'kafka-compatible': 'Kafka-Compatible',
  'amqp-compatible': 'AMQP-Compatible',
  'nats-compatible': 'NATS-Compatible',
  'mqtt-compatible': 'MQTT-Compatible',
  's3-compatible': 'S3-Compatible Storage',
  'onlyoffice-compatible': 'ONLYOFFICE-Compatible',
}

const CREATABLE_INSTANCE_KINDS = [
  'mysql-compatible',
  'postgres-compatible',
  'mongodb-compatible',
  'clickhouse-compatible',
  'neo4j-compatible',
  'influxdb-compatible',
  'redis-compatible',
  'elasticsearch-compatible',
  'kafka-compatible',
  'amqp-compatible',
  'nats-compatible',
  'mqtt-compatible',
  's3-compatible',
  'onlyoffice-compatible',
] as const

const KIND_SEARCH_HINTS: Partial<Record<(typeof CREATABLE_INSTANCE_KINDS)[number], string[]>> = {
  'mysql-compatible': ['mysql', 'aurora', 'mariadb'],
  'postgres-compatible': ['postgres', 'postgresql', 'aurora', 'rds'],
  'mongodb-compatible': ['mongodb', 'mongo', 'atlas', 'document database'],
  'clickhouse-compatible': ['clickhouse', 'analytic', 'analytics', 'columnar'],
  'neo4j-compatible': ['neo4j', 'graph'],
  'influxdb-compatible': ['influxdb', 'timeseries', 'time series', 'metrics'],
  'redis-compatible': ['redis', 'valkey'],
  'elasticsearch-compatible': ['elasticsearch', 'elastic', 'opensearch', 'search'],
  'kafka-compatible': ['kafka', 'redpanda'],
  'amqp-compatible': ['rabbitmq', 'amqp'],
  'nats-compatible': ['nats'],
  'mqtt-compatible': ['mqtt', 'mosquitto', 'emqx'],
  's3-compatible': ['s3', 'minio', 'r2', 'object storage'],
  'onlyoffice-compatible': ['onlyoffice', 'docs', 'document server'],
}

const TEMPLATE_FIELD_OVERRIDE_KEYS: Record<string, string> = {
  database: 'serviceInstances.templateFields.database',
  region: 'serviceInstances.templateFields.region',
  clusterIdentifier: 'serviceInstances.templateFields.clusterIdentifier',
  clusterId: 'serviceInstances.templateFields.clusterId',
  resourceGroup: 'serviceInstances.templateFields.resourceGroup',
  gatewayName: 'serviceInstances.templateFields.gatewayName',
  accountId: 'serviceInstances.templateFields.accountId',
}

type CanonicalFieldKey =
  | 'endpoint'
  | 'host'
  | 'port'
  | 'credential'
  | 'provider_account'
  | 'is_enabled'
  | 'description'
  | 'groups'

type CanonicalFieldMeta = {
  required?: boolean
  advanced?: boolean
}

const INSTANCE_CANONICAL_FIELD_META: Record<
  string,
  Partial<Record<CanonicalFieldKey, CanonicalFieldMeta>>
> = {
  'mysql-compatible': {
    host: { required: true },
    port: { required: true },
    credential: { required: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'postgres-compatible': {
    host: { required: true },
    port: { required: true },
    credential: { required: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'mongodb-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'clickhouse-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'neo4j-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'influxdb-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'redis-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'elasticsearch-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'kafka-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'amqp-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'nats-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'mqtt-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  's3-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
  'onlyoffice-compatible': {
    endpoint: { required: true },
    credential: { advanced: true },
    provider_account: { advanced: true },
    is_enabled: { advanced: true },
    description: { advanced: true },
    groups: { advanced: true },
  },
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

function isCreatableTemplate(template: InstanceTemplate) {
  return CREATABLE_INSTANCE_KINDS.includes(
    template.kind as (typeof CREATABLE_INSTANCE_KINDS)[number]
  )
}

function compareTemplatesForCreate(left: InstanceTemplate, right: InstanceTemplate, t: Translate) {
  const genericCompare = Number(isGenericTemplate(right, t)) - Number(isGenericTemplate(left, t))
  if (genericCompare !== 0) {
    return genericCompare
  }
  return productTitle(left, t).localeCompare(productTitle(right, t))
}

function listTemplatesForKind(
  kind: string,
  templates: InstanceTemplate[],
  t: Translate
): InstanceTemplate[] {
  return templates
    .filter(template => isCreatableTemplate(template) && template.kind === kind)
    .sort((left, right) => compareTemplatesForCreate(left, right, t))
}

function getDefaultTemplateForKind(
  kind: string,
  templates: InstanceTemplate[],
  t: Translate
) {
  return listTemplatesForKind(kind, templates, t)[0] ?? null
}

function kindSearchText(kind: string, templates: InstanceTemplate[], t: Translate) {
  const kindTemplates = listTemplatesForKind(kind, templates, t)
  return [
    kindLabel(kind, t),
    ...(KIND_SEARCH_HINTS[kind as (typeof CREATABLE_INSTANCE_KINDS)[number]] ?? []),
    ...kindTemplates.flatMap(template => [
      template.id,
      productTitle(template, t),
      template.title,
      template.vendor ?? '',
      template.description ?? '',
      categoryLabel(template.category, t),
    ]),
  ]
    .filter(Boolean)
    .join(' ')
}

function buildDefaultInstanceName(template: InstanceTemplate, t: Translate) {
  const base =
    slugifyNamePart(productTitle(template, t)) || slugifyNamePart(template.kind) || 'instance'
  return `${base}-${Date.now().toString().slice(-4)}`
}

function applyInstanceTemplateDefaults(
  template: InstanceTemplate,
  update: (key: string, value: unknown) => void,
  t: Translate
) {
  update('selected_category', template.category ?? '')
  update('kind', template.kind)
  update('template_id', template.id)
  update('selected_product', productTitle(template, t))
  update('selected_product_meta', productMeta(template, t))
  update('selected_product_description', productDescription(template, t))
  update('endpoint', template.defaultEndpoint ?? '')
  update('credential', '')
  update('credential_use_secret', false)
  update('password_value', '')
  update('ssl_mode', '')

  if (isDatabaseConnectionKind(template)) {
    const endpointParts = splitEndpoint(template.defaultEndpoint ?? '')
    update('host', endpointParts.host)
    update('port', Number(endpointParts.port || defaultPortForTemplate(template)))
  } else {
    update('host', '')
    update('port', '')
  }

  for (const field of mergeDatabaseTemplateFields(template, t)) {
    update(field.id, normalizeTemplateFieldDefault(field))
  }
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
  return template?.kind === 'mysql-compatible' || template?.kind === 'postgres-compatible'
}

function isSecretBackedConnectionKind(template: InstanceTemplate | null | undefined) {
  return (
    template?.kind === 'mysql-compatible' ||
    template?.kind === 'postgres-compatible' ||
    template?.kind === 'mongodb-compatible' ||
    template?.kind === 'clickhouse-compatible' ||
    template?.kind === 'neo4j-compatible' ||
    template?.kind === 'influxdb-compatible' ||
    template?.kind === 'redis-compatible' ||
    template?.kind === 'elasticsearch-compatible' ||
    template?.kind === 'kafka-compatible' ||
    template?.kind === 'amqp-compatible' ||
    template?.kind === 'nats-compatible' ||
	 template?.kind === 'mqtt-compatible' ||
	 template?.kind === 'onlyoffice-compatible'
  )
}

function resolveCanonicalFieldMeta(
  template: InstanceTemplate | null | undefined,
  fieldKey: CanonicalFieldKey
): CanonicalFieldMeta {
  if (!template) {
    return {}
  }
  return INSTANCE_CANONICAL_FIELD_META[template.kind]?.[fieldKey] ?? {}
}

function defaultPortForTemplate(template: InstanceTemplate | null | undefined) {
  if (template?.kind === 'postgres-compatible') return 5432
  return 3306
}

function databaseCertificateHelpText(template: InstanceTemplate | null | undefined, t: Translate) {
  if (template?.kind === 'postgres-compatible') {
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

function resolveInstanceEnabled(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  }
  if (typeof value === 'number') return value !== 0
  return true
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
    advanced: !localizedField.required,
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
    ...(body.is_enabled !== undefined
      ? { is_enabled: resolveInstanceEnabled(body.is_enabled) }
      : {}),
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
  const fallbackProfile = normalizeInstanceTemplateTitle(String(item.template_id ?? ''))

  return {
    id: item.id,
    created: String(item.created ?? ''),
    updated: String(item.updated ?? ''),
    name: String(item.name ?? ''),
    kind: String(item.kind ?? ''),
    is_enabled: resolveInstanceEnabled(item.is_enabled),
    enabled_status: resolveInstanceEnabled(item.is_enabled) ? 'Enabled' : 'Disabled',
    kind_label: kindLabel(String(item.kind ?? ''), t),
    template_id: String(item.template_id ?? ''),
    profile: template?.title ?? fallbackProfile,
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

function normalizeInstanceTemplateTitle(templateId: string) {
  const tokenLabels: Record<string, string> = {
    generic: 'Generic',
    mysql: 'MySQL',
    postgres: 'PostgreSQL',
    redis: 'Redis',
    kafka: 'Kafka',
    amqp: 'AMQP',
    nats: 'NATS',
    mqtt: 'MQTT',
    s3: 'S3',
    mongodb: 'MongoDB',
    clickhouse: 'ClickHouse',
    neo4j: 'Neo4j',
    influxdb: 'InfluxDB',
    elasticsearch: 'Elasticsearch',
    onlyoffice: 'ONLYOFFICE',
    minio: 'MinIO',
    mariadb: 'MariaDB',
    sqlserver: 'SQL Server',
  }

  return templateId
    .split('-')
    .filter(Boolean)
    .map(part => tokenLabels[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function buildColumns(t: Translate, onToggleEnabled: (item: Record<string, unknown>) => void): Column[] {
  return [
    { key: 'name', label: t('serviceInstances.columns.name'), searchable: true, sortable: true },
    {
      key: 'enabled_status',
      label: t('serviceInstances.columns.enabled'),
      sortable: true,
      filterOptions: [
        { label: t('serviceInstances.enabled.yes'), value: 'Enabled' },
        { label: t('serviceInstances.enabled.no'), value: 'Disabled' },
      ],
      filterValue: row => String(row.enabled_status ?? ''),
      render: (_value, row) => {
        const enabled = resolveInstanceEnabled(row.is_enabled)
        return (
          <button
            type="button"
            className={
              enabled
                ? 'inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
                : 'inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer'
            }
            onClick={event => {
              event.stopPropagation()
              void onToggleEnabled(row)
            }}
            title={enabled ? t('serviceInstances.actions.disable') : t('serviceInstances.actions.enable')}
          >
            {enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
            {enabled ? t('serviceInstances.enabled.yes') : t('serviceInstances.enabled.no')}
          </button>
        )
      },
    },
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
      label: t('serviceInstances.columns.reachability'),
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
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
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
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <ResourcesBreadcrumb
        parentLabel={t('hub.title')}
        currentPage={t('resources.serviceInstances.title', {
          defaultValue: t('serviceInstances.page.title'),
        })}
      />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent, t])

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

  const creatableTemplates = useMemo(
    () => instanceTemplates.filter(template => isCreatableTemplate(template)),
    [instanceTemplates]
  )

  const kindOptions = useMemo(
    () =>
      Array.from(
        new Set(
          creatableTemplates
            .map(template => String(template.kind ?? '').trim())
            .filter(Boolean)
        )
      )
        .sort((left, right) => {
          const leftCategory = categoryLabel(
            listTemplatesForKind(left, creatableTemplates, t)[0]?.category,
            t
          )
          const rightCategory = categoryLabel(
            listTemplatesForKind(right, creatableTemplates, t)[0]?.category,
            t
          )
          const categoryCompare = leftCategory.localeCompare(rightCategory)
          if (categoryCompare !== 0) {
            return categoryCompare
          }
          return kindLabel(left, t).localeCompare(kindLabel(right, t))
        })
        .map(kind => {
          const templates = listTemplatesForKind(kind, creatableTemplates, t)
          return {
            id: kind,
            title: kindLabel(kind, t),
            description: undefined,
            meta: categoryLabel(templates[0]?.category, t),
            searchText: kindSearchText(kind, creatableTemplates, t),
          }
        }),
    [creatableTemplates, t]
  )

  const resolveSelectedCategory = useCallback(
    (formData: Record<string, unknown>, editingItem: Record<string, unknown> | null) => {
      const explicitCategory = String(
        formData.selected_category ?? editingItem?.selected_category ?? ''
      ).trim()
      if (explicitCategory) {
        return explicitCategory
      }
      const templateId = String(formData.template_id ?? editingItem?.template_id ?? '').trim()
      return templatesById.get(templateId)?.category ?? ''
    },
    [templatesById]
  )

  const buildInitialCreateData = useCallback(
    (kind: string, templateOverride?: string) => {
      const overrideTemplate = templatesById.get(templateOverride ?? '')
      const defaultTemplate =
        overrideTemplate &&
        overrideTemplate.kind === kind &&
        isCreatableTemplate(overrideTemplate)
          ? overrideTemplate
          : getDefaultTemplateForKind(kind, creatableTemplates, t)

      const initialData: Record<string, unknown> = {
        selected_category: defaultTemplate?.category ?? '',
        template_id: '',
        kind,
        name: '',
        is_enabled: true,
        title_name_editing: false,
        credential_use_secret: false,
        password_value: '',
        ssl_mode: '',
        selected_product: '',
        selected_product_meta: '',
        selected_product_description: '',
      }

      if (defaultTemplate) {
        applyInstanceTemplateDefaults(
          defaultTemplate,
          (key, value) => {
            initialData[key] = value
          },
          t
        )
        initialData.name = buildDefaultInstanceName(defaultTemplate, t)
      }

      return initialData
    },
    [creatableTemplates, t, templatesById]
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
          manualPlaceholder={t('serviceInstances.credential.enterPassword')}
          showLabel={t('serviceInstances.credential.showPassword')}
          hideLabel={t('serviceInstances.credential.hidePassword')}
          allowGenerate={false}
          referenceToggleMode="icon"
          editReferenceMode="icon"
          generateValue={buildApiKeyValue}
        />
      )
    },
    [openSecretDialog, openSecretEditor, t]
  )

  const renderEnabledField = useCallback(
    ({ field, value, setValue }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      const currentValue = resolveInstanceEnabled(value)
      const options = [
        { label: t('serviceInstances.enabled.yes'), value: true },
        { label: t('serviceInstances.enabled.no'), value: false },
      ]

      return (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">{field.label}</label>
          <div className="flex flex-wrap items-center gap-5">
            {options.map(option => {
              const selected = option.value === currentValue
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    'cursor-pointer select-none text-left transition-colors',
                    selected
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => {
                    setValue(option.value)
                    event.currentTarget.blur()
                  }}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border',
                        selected ? 'border-foreground' : 'border-muted-foreground/40'
                      )}
                    >
                      {selected ? <span className="h-2 w-2 rounded-full bg-foreground" /> : null}
                    </span>
                    {option.label}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )
    },
    [t]
  )

  const renderHostPortField = useCallback(
    ({ formData, updateField }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="resource-field-host" className="text-sm font-medium text-foreground">
              {t('serviceInstances.fields.host')}
              <span className="ml-1 text-destructive">*</span>
            </label>
            <Input
              id="resource-field-host"
              value={String(formData.host ?? '')}
              onChange={event => updateField('host', event.target.value)}
              placeholder={t('serviceInstances.placeholders.host')}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="resource-field-port" className="text-sm font-medium text-foreground">
              {t('serviceInstances.fields.port')}
              <span className="ml-1 text-destructive">*</span>
            </label>
            <Input
              id="resource-field-port"
              type="number"
              value={String(formData.port ?? '')}
              onChange={event => updateField('port', event.target.value)}
            />
          </div>
        </div>
      )
    },
    [t]
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
    (selectedCategory: string, selectedKind: string, selectedTemplate: InstanceTemplate | null) => {
      const endpointMeta = resolveCanonicalFieldMeta(selectedTemplate, 'endpoint')
      const hostMeta = resolveCanonicalFieldMeta(selectedTemplate, 'host')
      const portMeta = resolveCanonicalFieldMeta(selectedTemplate, 'port')
      const credentialMeta = resolveCanonicalFieldMeta(selectedTemplate, 'credential')
      const providerAccountMeta = resolveCanonicalFieldMeta(selectedTemplate, 'provider_account')
      const enabledMeta = resolveCanonicalFieldMeta(selectedTemplate, 'is_enabled')
      const descriptionMeta = resolveCanonicalFieldMeta(selectedTemplate, 'description')
      const groupsMeta = resolveCanonicalFieldMeta(selectedTemplate, 'groups')
      const profileTemplates = selectedTemplate
        ? isCreatableTemplate(selectedTemplate)
          ? listTemplatesForKind(selectedTemplate.kind, creatableTemplates, t)
          : [selectedTemplate]
        : selectedKind
          ? listTemplatesForKind(selectedKind, creatableTemplates, t)
          : []

      return [
        {
          key: 'selected_category',
          label: t('serviceInstances.fields.category'),
          type: 'text',
          hidden: true,
          defaultValue: selectedCategory || (selectedTemplate?.category ?? ''),
        },
        {
          key: 'kind',
          label: t('serviceInstances.fields.kind'),
          type: 'text',
          hidden: true,
          defaultValue: selectedKind || selectedTemplate?.kind || '',
        },
        {
          key: 'template_id',
          label: t('serviceInstances.fields.template'),
          type: 'select',
          required: true,
          hidden: profileTemplates.length <= 1,
          options: profileTemplates.map(template => ({
            label: productTitle(template, t),
            value: template.id,
          })),
          onValueChange: (value, update) => {
            const template = templatesById.get(String(value ?? ''))
            if (!template) {
              update('template_id', '')
              update('kind', selectedKind)
              update('name', '')
              update('selected_product', '')
              update('selected_product_meta', '')
              update('selected_product_description', '')
              update('selected_category', selectedCategory)
              update('endpoint', '')
              update('host', '')
              update('port', '')
              update('provider_account', '')
              update('credential', '')
              update('credential_use_secret', false)
              update('password_value', '')
              update('ssl_mode', '')
              return
            }
            applyInstanceTemplateDefaults(template, update, t)
            update('name', buildDefaultInstanceName(template, t))
          },
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
          hidden: !selectedTemplate || isDatabaseConnectionKind(selectedTemplate),
          required: Boolean(endpointMeta.required),
          advanced: Boolean(endpointMeta.advanced),
          placeholder: t('serviceInstances.placeholders.endpoint'),
          defaultValue: selectedTemplate?.defaultEndpoint ?? '',
        },
        {
          key: 'host',
          label: t('serviceInstances.fields.host'),
          type: 'text',
          hideLabel: true,
          hidden: !selectedTemplate || !isDatabaseConnectionKind(selectedTemplate),
          required: Boolean(hostMeta.required),
          advanced: Boolean(hostMeta.advanced),
          placeholder: t('serviceInstances.placeholders.host'),
          defaultValue: splitEndpoint(selectedTemplate?.defaultEndpoint ?? '').host,
          render: isDatabaseConnectionKind(selectedTemplate) ? renderHostPortField : undefined,
        },
        {
          key: 'port',
          label: t('serviceInstances.fields.port'),
          type: 'number',
          hidden: true,
          required: Boolean(portMeta.required),
          advanced: Boolean(portMeta.advanced),
          defaultValue: Number(
            splitEndpoint(selectedTemplate?.defaultEndpoint ?? '').port ||
              defaultPortForTemplate(selectedTemplate)
          ),
        },
        {
          key: 'provider_account',
          label: t('serviceInstances.fields.platformAccount'),
          type: 'relation',
          hidden: !selectedTemplate,
          advanced: selectedTemplate ? Boolean(providerAccountMeta.advanced) : true,
          relationApiPath: '/api/provider-accounts',
          relationLabelKey: 'name',
          relationShowNoneOption: false,
          relationShowSelectedIndicator: false,
          relationBorderlessMenu: true,
        },
        {
          key: 'credential',
          label:
            selectedTemplate?.kind === 'redis-compatible'
              ? t('serviceInstances.fields.password')
              : selectedTemplate?.kind === 'kafka-compatible'
                ? t('serviceInstances.fields.credential')
                : isDatabaseConnectionKind(selectedTemplate)
                  ? t('serviceInstances.fields.password')
                  : t('serviceInstances.fields.credential'),
          type: 'relation',
          hidden: !selectedTemplate,
          required: Boolean(selectedTemplate && credentialMeta.required),
          advanced: selectedTemplate ? Boolean(credentialMeta.advanced) : true,
          relationApiPath: buildUserVisibleSecretRelationApiPath('service_instance', {
            secretTemplate: 'single_value',
          }),
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
          key: 'is_enabled',
          label: t('serviceInstances.fields.enableIt'),
          type: 'boolean',
          hidden: !selectedTemplate,
          advanced: selectedTemplate ? Boolean(enabledMeta.advanced) : true,
          defaultValue: true,
          render: renderEnabledField,
        },
        {
          key: 'ssl_mode',
          label: t('serviceInstances.fields.useSsl'),
          type: 'text',
          advanced: isDatabaseConnectionKind(selectedTemplate),
          hidden: !selectedTemplate || !isDatabaseConnectionKind(selectedTemplate),
          defaultValue: '',
          render: isDatabaseConnectionKind(selectedTemplate) ? renderSslModeField : undefined,
        },
        {
          key: 'description',
          label: t('serviceInstances.fields.description'),
          type: 'text',
          hidden: !selectedTemplate,
          advanced: selectedTemplate ? Boolean(descriptionMeta.advanced) : true,
          maxLength: 100,
        },
        {
          key: 'groups',
          label: t('serviceInstances.fields.groups'),
          type: 'relation',
          hidden: !selectedTemplate,
          advanced: selectedTemplate ? Boolean(groupsMeta.advanced) : true,
          multiSelect: true,
          relationAutoSelectDefault: true,
          relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
          relationLabelKey: 'name',
          defaultValue: [],
        },
      ] satisfies FieldDef[]
    },
    [
      creatableTemplates,
      renderDatabaseCredentialField,
      renderEnabledField,
      renderHostPortField,
      renderSslModeField,
      t,
      templatesById,
    ]
  )

  const resolveInstanceFields = useCallback(
    ({
      formData,
      editingItem,
    }: {
      formData: Record<string, unknown>
      editingItem: Record<string, unknown> | null
    }) => {
      const selectedTemplateId = String(formData.template_id ?? '')
      const selectedCategory = resolveSelectedCategory(formData, editingItem)
      const selectedKind = String(
        formData.kind ?? editingItem?.kind ?? templatesById.get(selectedTemplateId)?.kind ?? ''
      ).trim()
      const selectedTemplate = selectedTemplateId ? (templatesById.get(selectedTemplateId) ?? null) : null
      const baseFields = buildBaseFields(selectedCategory, selectedKind, selectedTemplate)
      const baseFieldByKey = new Map(baseFields.map(field => [field.key, field]))
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
        const usernameFields = primaryTemplateFields.filter(field => field.key === 'username')
        const databaseFields = primaryTemplateFields.filter(field => field.key === 'database')
        const extraFields = primaryTemplateFields.filter(
          field => !['database', 'username'].includes(field.key)
        )

        return [
          baseFieldByKey.get('selected_category')!,
          baseFieldByKey.get('kind')!,
          baseFieldByKey.get('selected_product')!,
          baseFieldByKey.get('selected_product_meta')!,
          baseFieldByKey.get('selected_product_description')!,
          baseFieldByKey.get('credential_use_secret')!,
          baseFieldByKey.get('password_value')!,
          ...hiddenTemplateFields,
          baseFieldByKey.get('template_id')!,
          baseFieldByKey.get('name')!,
          baseFieldByKey.get('title_name_editing')!,
          ...usernameFields,
          baseFieldByKey.get('credential')!,
          ...databaseFields,
          baseFieldByKey.get('host')!,
          ...extraFields,
          baseFieldByKey.get('ssl_mode')!,
          ...certificateFields,
          ...otherAdvancedFields,
          baseFieldByKey.get('provider_account')!,
          baseFieldByKey.get('is_enabled')!,
          baseFieldByKey.get('description')!,
          baseFieldByKey.get('groups')!,
          baseFieldByKey.get('endpoint')!,
        ]
      }

      return [
        baseFieldByKey.get('selected_category')!,
        baseFieldByKey.get('kind')!,
        baseFieldByKey.get('selected_product')!,
        baseFieldByKey.get('selected_product_meta')!,
        baseFieldByKey.get('selected_product_description')!,
        baseFieldByKey.get('name')!,
        baseFieldByKey.get('title_name_editing')!,
        baseFieldByKey.get('template_id')!,
        ...dynamicFields,
        baseFieldByKey.get('endpoint')!,
        baseFieldByKey.get('host')!,
        baseFieldByKey.get('provider_account')!,
        baseFieldByKey.get('credential')!,
        baseFieldByKey.get('credential_use_secret')!,
        baseFieldByKey.get('password_value')!,
        baseFieldByKey.get('ssl_mode')!,
        baseFieldByKey.get('is_enabled')!,
        baseFieldByKey.get('description')!,
        baseFieldByKey.get('groups')!,
      ]
    },
    [buildBaseFields, creatableTemplates, resolveSelectedCategory, t, templatesById]
  )

  const bootstrapFields = useMemo(() => buildBaseFields('', '', null), [buildBaseFields])
  const handleToggleEnabled = useCallback(
    async (item: Record<string, unknown>) => {
      const instanceId = String(item.id ?? '')
      if (!instanceId) return
      const current = await pb.send<InstanceRecord>(`/api/instances/${instanceId}`, { method: 'GET' })
      const body = await buildInstancePayload(
        {
          ...current,
          credential_use_secret: Boolean(String(current.credential ?? '').trim()),
          password_value: '',
          is_enabled: !resolveInstanceEnabled(current.is_enabled),
        },
        templatesById,
        t
      )
      await pb.send(`/api/instances/${instanceId}`, { method: 'PUT', body })
      setRefreshKey(current => current + 1)
    },
    [t, templatesById]
  )
  const columns = useMemo(() => buildColumns(t, handleToggleEnabled), [handleToggleEnabled, t])

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
            options: kindOptions,
            onSelect: optionId => buildInitialCreateData(String(optionId)),
          },
          dialogContentClassName: 'sm:max-w-4xl',
          dialogHeader: ({ formData, editingItem, updateField, title, description }) => {
            const selectedTemplate = templatesById.get(String(formData.template_id ?? ''))
            const instanceName = String(formData.name ?? '').trim()
            const editingName = Boolean(formData.title_name_editing)
            if (!selectedTemplate) {
              return { title, description, hideSelectedProductSummary: true }
            }

            const actionLabel = editingItem
              ? t('serviceInstances.dialog.updateKind', {
                  kind: kindLabel(selectedTemplate.kind, t),
                })
              : t('serviceInstances.dialog.createKind', {
                  kind: kindLabel(selectedTemplate.kind, t),
                })

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
              description: actionLabel,
              hideSelectedProductSummary: true,
            }
          },
          resolveFields: resolveInstanceFields,
          resourceType: 'instance',
          autoCreate,
          enableGroupAssign: true,
          showRefreshButton: true,
          wrapTableInCard: false,
          refreshKey,
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
          extraActions: item => {
            const enabled = resolveInstanceEnabled(item.is_enabled)
            return [
              <DropdownMenuItem
                key="toggle-enabled"
                onClick={() => {
                  void handleToggleEnabled(item)
                }}
              >
                {enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                {enabled ? t('serviceInstances.actions.disable', { defaultValue: 'Disable' }) : t('serviceInstances.actions.enable', { defaultValue: 'Enable' })}
              </DropdownMenuItem>,
            ]
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
