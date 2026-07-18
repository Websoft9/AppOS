import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { Check, Loader2, Pencil, Power, PowerOff, RotateCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { ResourceListSettingsButton } from '@/components/resources/ResourceListSettingsButton'
import { ResourceStatusTimestamp } from '@/components/resources/ResourceStatusTimestamp'
import { ResourcesBreadcrumb } from '@/components/resources/ResourcesBreadcrumb'
import { formatResourceDateTime } from '@/components/resources/resource-formatters'
import {
  resolveReachabilityStaleAfterMs,
  shouldBackgroundProbeReachability,
} from '@/components/resources/reachability-policy'
import {
  buildEnabledStatusColumn,
  localizeReachabilityStatus,
  reachabilityStatusVariant,
  renderEnabledChoiceField,
} from '@/components/resources/resource-status'
import {
  buildResourceCategoryLabel,
  buildResourceKindLabel,
  buildResourceProductDescription,
  buildResourceProductMeta,
  buildResourceProductTitle,
  isGenericResourceTemplate,
} from '@/components/resources/resource-template-display'
import { SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { pb } from '@/lib/pb'

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

type InstanceReachabilityRecord = {
  id?: string
  status?: string
  reason?: string | null
  checked_at?: string | null
}

type MonitorSchedulingEntryResponse = {
  value?: {
    reachabilityIntervalMinutes?: number
  }
}

const SERVICE_INSTANCE_BACKGROUND_PROBE_BATCH_SIZE = 10

type InstanceTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  advanced?: boolean
  hidden?: boolean
  sensitive?: boolean
  secretTemplate?: string
  placeholder?: string
  helpText?: string
  default?: unknown
  showWhen?: { field: string; values: string[] }
}

type InstanceTemplate = {
  id: string
  category?: string
  kind: string
  title: string
  vendor?: string
  description?: string
  defaultEndpoint?: string
  defaultPort?: number
  defaultProtocolHint?: string
  layoutPreset?: string
  endpointShape?: string
  credentialPresentation?: string
  credentialLabel?: string
  fields?: InstanceTemplateField[]
}

type Translate = (key: string, options?: Record<string, unknown>) => string

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
  's3-compatible': 'S3-Compatible',
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

const TEMPLATE_FIELD_OVERRIDE_KEYS: Record<string, string> = {
  accessKeyId: 'serviceInstances.templateFields.accessKeyId',
  bucket: 'serviceInstances.templateFields.bucket',
  callbackPath: 'serviceInstances.templateFields.callbackPath',
  clientId: 'serviceInstances.templateFields.clientId',
  cluster: 'serviceInstances.templateFields.cluster',
  database: 'serviceInstances.templateFields.database',
  documentPath: 'serviceInstances.templateFields.documentPath',
  forcePathStyle: 'serviceInstances.templateFields.forcePathStyle',
  indexPrefix: 'serviceInstances.templateFields.indexPrefix',
  jwtHeader: 'serviceInstances.templateFields.jwtHeader',
  organization: 'serviceInstances.templateFields.organization',
  region: 'serviceInstances.templateFields.region',
  saslMechanism: 'serviceInstances.templateFields.saslMechanism',
  securityProtocol: 'serviceInstances.templateFields.securityProtocol',
  clusterIdentifier: 'serviceInstances.templateFields.clusterIdentifier',
  clusterId: 'serviceInstances.templateFields.clusterId',
  resourceGroup: 'serviceInstances.templateFields.resourceGroup',
  gatewayName: 'serviceInstances.templateFields.gatewayName',
  accountId: 'serviceInstances.templateFields.accountId',
  vhost: 'serviceInstances.templateFields.vhost',
}

const TEMPLATE_DISPLAY_OPTIONS = {
  namespace: 'serviceInstances',
  kindLabels: KIND_LABELS,
  categoryLabels: CATEGORY_LABELS,
  isGenericTitle: (template: InstanceTemplate, resolvedKindLabel: string) =>
    template.title.trim().toLowerCase() === `standard ${resolvedKindLabel.toLowerCase()}`,
} as const

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

function localizeTemplateFieldCopy(
  field: InstanceTemplateField,
  t: Translate
): InstanceTemplateField {
  const key = TEMPLATE_FIELD_OVERRIDE_KEYS[field.id]
  const nextField = { ...field }

  if (key) {
    const localizedLabel = t(key)
    if (localizedLabel !== key) {
      nextField.label = localizedLabel
    }
  }

  if (field.id === 'username') {
    const usernameLabel = t('serviceInstances.fields.username')
    if (usernameLabel !== 'serviceInstances.fields.username') {
      nextField.label = usernameLabel
    }
    const usernamePlaceholder = t('serviceInstances.placeholders.username')
    if (usernamePlaceholder !== 'serviceInstances.placeholders.username') {
      nextField.placeholder = usernamePlaceholder
    }
  }

  if (field.id === 'connect_timeout') {
    const timeoutLabel = t('serviceInstances.fields.connectionTimeout')
    if (timeoutLabel !== 'serviceInstances.fields.connectionTimeout') {
      nextField.label = timeoutLabel
    }
    const timeoutHelp = t('serviceInstances.help.connectionTimeout')
    if (timeoutHelp !== 'serviceInstances.help.connectionTimeout') {
      nextField.helpText = timeoutHelp
    }
  }

  return nextField
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

async function runBatchedIds(
  ids: string[],
  batchSize: number,
  worker: (ids: string[]) => Promise<void>
) {
  if (batchSize < 1) {
    throw new Error('batchSize must be at least 1')
  }
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize)
    await worker(batch)
  }
}

function kindLabel(kind: string, t: Translate) {
  return buildResourceKindLabel(kind, t, TEMPLATE_DISPLAY_OPTIONS)
}

function isGenericTemplate(template: InstanceTemplate, t: Translate) {
  return isGenericResourceTemplate(template, t, TEMPLATE_DISPLAY_OPTIONS)
}

function productTitle(template: InstanceTemplate, t: Translate) {
  return buildResourceProductTitle(template, t, TEMPLATE_DISPLAY_OPTIONS)
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

function getDefaultTemplateForKind(kind: string, templates: InstanceTemplate[], t: Translate) {
  return listTemplatesForKind(kind, templates, t)[0] ?? null
}

function kindSearchText(kind: string, templates: InstanceTemplate[], t: Translate) {
  const kindTemplates = listTemplatesForKind(kind, templates, t)
  const exampleTemplate = kindTemplates[0]
  return [
    kind,
    kindLabel(kind, t),
    exampleTemplate ? categoryLabel(exampleTemplate.category, t) : '',
    ...kindTemplates.flatMap(template => [
      template.id,
      productTitle(template, t),
      template.title,
      template.vendor ?? '',
      template.description ?? '',
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

function normalizeInstanceLayoutPreset(template: InstanceTemplate | null | undefined) {
  return String(template?.layoutPreset ?? '')
    .trim()
    .toLowerCase()
}

function normalizeInstanceEndpointShape(template: InstanceTemplate | null | undefined) {
  const normalized = String(template?.endpointShape ?? 'url')
    .trim()
    .toLowerCase()
  return normalized || 'url'
}

function normalizeInstanceCredentialPresentation(template: InstanceTemplate | null | undefined) {
  return String(template?.credentialPresentation ?? '')
    .trim()
    .toLowerCase()
}

function usesDatabaseConnectionLayout(template: InstanceTemplate | null | undefined) {
  return normalizeInstanceLayoutPreset(template) === 'database_connection'
}

function usesHostPortEndpoint(template: InstanceTemplate | null | undefined) {
  return normalizeInstanceEndpointShape(template) === 'host_port'
}

function supportsInlineCredentialSecret(template: InstanceTemplate | null | undefined) {
  return normalizeInstanceCredentialPresentation(template) === 'secret_or_inline'
}

function resolveCredentialFieldLabel(template: InstanceTemplate | null | undefined, t: Translate) {
  return String(template?.credentialLabel ?? '')
    .trim()
    .toLowerCase() === 'password'
    ? t('serviceInstances.fields.password')
    : t('serviceInstances.fields.credential')
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
  update('endpoint', '')
  update('credential', '')
  update('password_value', '')
  update('ssl_mode', '')

  if (usesHostPortEndpoint(template)) {
    update('host', '')
    update('port', Number(defaultPortForTemplate(template)))
  } else {
    update('host', '')
    update('port', '')
  }

  for (const field of mergeTemplateFields(template, t)) {
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
  return buildResourceCategoryLabel(category, t, TEMPLATE_DISPLAY_OPTIONS)
}

function productMeta(template: InstanceTemplate, t: Translate) {
  return buildResourceProductMeta(template, t, TEMPLATE_DISPLAY_OPTIONS)
}

function productDescription(template: InstanceTemplate, t: Translate) {
  return buildResourceProductDescription(template, t, TEMPLATE_DISPLAY_OPTIONS)
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
  const fallbackParts = splitEndpoint(fallback)
  if (!normalizedHost) {
    return fallback
  }
  const effectivePort = normalizedPort || fallbackParts.port
  if (!effectivePort) {
    return normalizedHost
  }
  return `${normalizedHost}:${effectivePort}`
}

function buildInstanceEndpoint(template: InstanceTemplate, payload: Record<string, unknown>) {
  if (usesHostPortEndpoint(template)) {
    return buildEndpoint(payload.host, payload.port, '')
  }

  const rawEndpoint = String(payload.endpoint ?? '').trim()
  if (!rawEndpoint) {
    return ''
  }

  const scheme = String(template.defaultProtocolHint ?? '')
    .trim()
    .toLowerCase()
  if (!scheme || rawEndpoint.includes('://')) {
    return rawEndpoint
  }

  return `${scheme}://${rawEndpoint}`
}

function resolveCanonicalFieldMeta(
  template: InstanceTemplate | null | undefined,
  fieldKey: CanonicalFieldKey
): CanonicalFieldMeta {
  if (!template) {
    return {}
  }
  switch (fieldKey) {
    case 'endpoint':
      return usesHostPortEndpoint(template) ? { advanced: false } : { required: true }
    case 'host':
    case 'port':
      return usesHostPortEndpoint(template) ? { required: true } : {}
    case 'credential':
      if (usesDatabaseConnectionLayout(template)) {
        return { required: true }
      }
      return { advanced: true }
    case 'provider_account':
    case 'is_enabled':
    case 'description':
    case 'groups':
      return { advanced: true }
    default:
      return {}
  }
}

function defaultPortForTemplate(template: InstanceTemplate | null | undefined) {
  return Number(template?.defaultPort ?? 0)
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

function mergeTemplateFields(template: InstanceTemplate | null | undefined, t: Translate) {
  if (!template) {
    return [] as InstanceTemplateField[]
  }
  return (template.fields ?? []).map(field => localizeTemplateFieldCopy(field, t))
}

function mapTemplateFieldToResourceField(field: InstanceTemplateField, t: Translate): FieldDef {
  const localizedField = field

  if (localizedField.type === 'certificate_ref') {
    return {
      key: localizedField.id,
      label: t('serviceInstances.fields.sslCertificate'),
      type: 'relation',
      advanced: localizedField.advanced ?? true,
      hidden: localizedField.hidden,
      showWhen: localizedField.showWhen,
      relationApiPath: "/api/collections/certificates/records?filter=(status='active')&sort=name",
      relationLabelKey: 'name',
      helpText: localizedField.helpText,
      relationShowNoneOption: false,
      relationShowSelectedIndicator: false,
      relationBorderlessMenu: true,
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
    hidden: localizedField.hidden,
    placeholder: localizedField.placeholder,
    defaultValue: normalizeTemplateFieldDefault(localizedField),
    helpText: localizedField.helpText,
    advanced: localizedField.advanced ?? !localizedField.required,
    showWhen: localizedField.showWhen,
  }
}

export async function buildInstancePayload(
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

  if (supportsInlineCredentialSecret(template)) {
    const credentialId = String(body.credential ?? '').trim()
    const passwordValue = String(body.password_value ?? '').trim()

    if (!credentialId) {
      if (!passwordValue && usesDatabaseConnectionLayout(template)) {
        throw new Error(t('serviceInstances.errors.passwordRequired'))
      }
      if (passwordValue) {
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

    if (usesDatabaseConnectionLayout(template) && !String(body.credential ?? '').trim()) {
      throw new Error(t('serviceInstances.errors.passwordSecretRequired'))
    }
  }

  if (usesDatabaseConnectionLayout(template)) {
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
  for (const field of mergeTemplateFields(template, t)) {
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
    endpoint: buildInstanceEndpoint(template, body),
    provider_account: String(body.provider_account ?? ''),
    credential: String(body.credential ?? ''),
    config,
    description: String(body.description ?? ''),
  }
}

export function mapInstanceRow(
  item: InstanceRecord,
  templatesById: Map<string, InstanceTemplate>,
  monitorByTargetId: Map<string, MonitorLatestStatusRecord>,
  t: Translate
): Record<string, unknown> {
  const template = templatesById.get(String(item.template_id ?? ''))
  const monitor = monitorByTargetId.get(String(item.id ?? ''))
  const endpointParts = splitEndpoint(String(item.endpoint ?? ''))
  const fallbackConfig = item.config ?? {}
  const flattenedConfig: Record<string, unknown> = { ...fallbackConfig }

  for (const field of mergeTemplateFields(template, t)) {
    const value = item.config?.[field.id]
    if (value === undefined) {
      continue
    }
    flattenedConfig[field.id] = value
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
    .map(
      part => tokenLabels[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    )
    .join(' ')
}

function buildColumns(
  t: Translate,
  onToggleEnabled: (item: Record<string, unknown>) => void,
  reachabilityOverrides: Map<string, InstanceReachabilityRecord>,
  reachabilityLoading: Set<string>
): Column[] {
  const reachabilityLabels = {
    reachable: t('serviceInstances.status.reachable'),
    unreachable: t('serviceInstances.status.unreachable'),
    unknown: t('serviceInstances.status.unknown'),
  }

  const resolveStatusMeta = (row: Record<string, unknown>) => {
    const override = reachabilityOverrides.get(String(row.id ?? ''))
    if (override) {
      return {
        status: String(override.status ?? '').trim(),
        reason: String(override.reason ?? '').trim(),
        checkedAt: String(override.checked_at ?? '').trim(),
        sourceLabel: t('serviceInstances.lastCheckedSources.liveReachability'),
      }
    }

    return {
      status: String(row.monitor_status ?? '').trim(),
      reason: String(row.monitor_reason ?? '').trim(),
      checkedAt: String(row.monitor_last_checked_at ?? '').trim(),
      sourceLabel: t('serviceInstances.lastCheckedSources.scheduledMonitor'),
    }
  }

  return [
    { key: 'name', label: t('serviceInstances.columns.name'), searchable: true, sortable: true },
    buildEnabledStatusColumn({
      label: t('serviceInstances.columns.enabled'),
      enabledLabel: t('serviceInstances.enabled.yes'),
      disabledLabel: t('serviceInstances.enabled.no'),
      enableTitle: t('serviceInstances.actions.enable'),
      disableTitle: t('serviceInstances.actions.disable'),
      resolveEnabled: resolveInstanceEnabled,
      onToggle: onToggleEnabled,
    }),
    {
      key: 'kind_label',
      label: t('serviceInstances.columns.kind'),
      sortable: true,
      filterValue: row => String(row.kind_label ?? ''),
      render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
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
      key: 'port',
      label: t('serviceInstances.columns.port'),
      sortable: true,
      render: value => {
        const portVal = Number(value)
        if (!portVal || portVal <= 0)
          return <span className="text-sm text-muted-foreground">—</span>
        return <span className="text-sm">{String(value)}</span>
      },
    },
    {
      key: 'monitor_status',
      label: t('serviceInstances.columns.reachability'),
      sortable: true,
      sortValue: row =>
        localizeReachabilityStatus(resolveStatusMeta(row).status, reachabilityLabels),
      filterValue: row =>
        localizeReachabilityStatus(resolveStatusMeta(row).status, reachabilityLabels),
      render: (value, row) => {
        const meta = resolveStatusMeta(row)
        const status = meta.status || String(value ?? '').trim()
        const reason = meta.reason
        const isLoading = reachabilityLoading.has(String(row.id ?? ''))
        const displayStatus = localizeReachabilityStatus(status, reachabilityLabels)
        return (
          <Badge
            variant={reachabilityStatusVariant(status)}
            title={reason || undefined}
            className="gap-1"
          >
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {displayStatus}
          </Badge>
        )
      },
    },
    {
      key: 'monitor_last_checked_at',
      label: t('serviceInstances.columns.lastChecked'),
      sortable: true,
      sortValue: row => resolveStatusMeta(row).checkedAt,
      render: (_value, row) => {
        const meta = resolveStatusMeta(row)
        return (
          <ResourceStatusTimestamp
            checkedAt={meta.checkedAt}
            sourceLabel={meta.sourceLabel}
            detail={meta.reason}
          />
        )
      },
    },
    {
      key: 'created',
      label: t('serviceInstances.columns.created'),
      sortable: true,
      render: value => (
        <span className="text-sm text-muted-foreground">{formatResourceDateTime(value)}</span>
      ),
    },
    {
      key: 'updated',
      label: t('serviceInstances.columns.updated'),
      sortable: true,
      render: value => (
        <span className="text-sm text-muted-foreground">{formatResourceDateTime(value)}</span>
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
  const [pageSize, setPageSize] = useState(10)
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<Set<string>>(
    () => new Set(['kind_label', 'host', 'port', 'monitor_status', 'monitor_last_checked_at'])
  )
  const [reachabilityOverrides, setReachabilityOverrides] = useState<
    Map<string, InstanceReachabilityRecord>
  >(new Map())
  const [reachabilityLoading, setReachabilityLoading] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const bgProbeKeyRef = useRef('')

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
      CREATABLE_INSTANCE_KINDS.filter(kind =>
        creatableTemplates.some(template => template.kind === kind)
      ).map(kind => {
        const exampleTemplate = getDefaultTemplateForKind(kind, creatableTemplates, t)
        return {
          id: kind,
          title: kindLabel(kind, t),
          description: exampleTemplate ? productDescription(exampleTemplate, t) : undefined,
          meta: exampleTemplate ? categoryLabel(exampleTemplate.category, t) : undefined,
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
        String(overrideTemplate.kind ?? '')
          .trim()
          .toLowerCase() === String(kind).trim().toLowerCase() &&
        isCreatableTemplate(overrideTemplate)
          ? overrideTemplate
          : getDefaultTemplateForKind(kind, creatableTemplates, t)

      const initialData: Record<string, unknown> = {
        selected_category: defaultTemplate?.category ?? '',
        template_id: '',
        kind: defaultTemplate?.kind ?? kind,
        name: '',
        is_enabled: true,
        title_name_editing: false,
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

  const fetchReachabilityStatuses = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setReachabilityOverrides(new Map())
      return
    }
    setReachabilityLoading(prev => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
    try {
      const rows = await pb.send<InstanceReachabilityRecord[]>('/api/instances/reachability', {
        method: 'POST',
        body: { ids },
      })
      setReachabilityOverrides(prev => {
        const next = new Map(prev)
        for (const row of Array.isArray(rows) ? rows : []) {
          const id = String(row.id ?? '').trim()
          if (!id) continue
          next.set(id, {
            id,
            status: String(row.status ?? '').trim(),
            reason: String(row.reason ?? ''),
            checked_at: String(row.checked_at ?? ''),
          })
        }
        return next
      })
    } catch {
      // keep previous overrides on error
    } finally {
      setReachabilityLoading(prev => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
    }
  }, [])

  const listItems = useCallback(async () => {
    const [items, monitorResponse, schedulingResponse] = await Promise.all([
      pb.send<InstanceRecord[]>('/api/instances', { method: 'GET' }),
      pb.send<{ items?: MonitorLatestStatusRecord[] }>(
        `/api/collections/monitor_latest_status/records?${new URLSearchParams({
          perPage: '500',
          sort: '-updated',
          filter: `(target_type='resource')`,
        }).toString()}`,
        { method: 'GET' }
      ),
      pb
        .send<MonitorSchedulingEntryResponse>('/api/settings/entries/monitor/scheduling', {
          method: 'GET',
        })
        .catch(() => ({ value: { reachabilityIntervalMinutes: 1 } })),
    ])

    const monitorByTargetId = new Map(
      Array.isArray(monitorResponse?.items)
        ? monitorResponse.items
            .map(record => [String(record.target_id ?? '').trim(), record] as const)
            .filter(([targetId]) => Boolean(targetId))
        : []
    )

    const staleAfterMs = resolveReachabilityStaleAfterMs(
      schedulingResponse?.value?.reachabilityIntervalMinutes
    )
    const rows = Array.isArray(items)
      ? items.map(item => mapInstanceRow(item, templatesById, monitorByTargetId, t))
      : []

    const backgroundProbeIDs = rows
      .filter(row =>
        shouldBackgroundProbeReachability(
          String(row.monitor_last_checked_at ?? '').trim(),
          staleAfterMs
        )
      )
      .map(row => String(row.id ?? '').trim())
      .filter(Boolean)

    const probeKey = backgroundProbeIDs.join(',')
    if (probeKey && bgProbeKeyRef.current !== probeKey) {
      bgProbeKeyRef.current = probeKey
      void runBatchedIds(
        backgroundProbeIDs,
        SERVICE_INSTANCE_BACKGROUND_PROBE_BATCH_SIZE,
        fetchReachabilityStatuses
      )
    }
    return rows
  }, [fetchReachabilityStatuses, t, templatesById])

  const renderCredentialField = useCallback(
    ({
      inputId,
      formData,
      editingItem,
      updateField,
      field,
    }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      const fieldLabel = String(field.label ?? '').trim() || t('serviceInstances.fields.credential')
      const passwordLabel = t('serviceInstances.fields.password').trim().toLowerCase()
      const isPasswordField = fieldLabel.trim().toLowerCase() === passwordLabel

      return (
        <SecretCredentialField
          inputId={inputId}
          manualValue={String(formData.password_value ?? '')}
          onManualValueChange={value => updateField('password_value', value)}
          useReference={false}
          onUseReferenceChange={() => {}}
          referenceValue=""
          onReferenceValueChange={() => {}}
          options={[]}
          editMode={Boolean(editingItem)}
          manualPlaceholder={
            editingItem
              ? 'Leave blank to keep the current secret value'
              : isPasswordField
                ? t('serviceInstances.credential.enterPassword')
                : `Enter ${fieldLabel}`
          }
          showLabel={
            isPasswordField ? t('serviceInstances.credential.showPassword') : `Show ${fieldLabel}`
          }
          hideLabel={
            isPasswordField ? t('serviceInstances.credential.hidePassword') : `Hide ${fieldLabel}`
          }
          allowGenerate={false}
          allowReference={false}
        />
      )
    },
    [t]
  )

  const renderEnabledField = useCallback(
    ({ field, inputId, value, setValue }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      return renderEnabledChoiceField({
        inputId,
        label: field.label,
        value: resolveInstanceEnabled(value),
        setValue,
        enabledLabel: t('serviceInstances.enabled.yes'),
        disabledLabel: t('serviceInstances.enabled.no'),
      })
    },
    [t]
  )

  const renderHostPortField = useCallback(
    ({ formData, updateField, field }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
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
              placeholder={field.placeholder || t('serviceInstances.placeholders.host')}
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
          hidden: !selectedTemplate || usesHostPortEndpoint(selectedTemplate),
          required: Boolean(endpointMeta.required),
          advanced: Boolean(endpointMeta.advanced),
          placeholder:
            selectedTemplate?.defaultEndpoint || t('serviceInstances.placeholders.endpoint'),
          defaultValue: '',
        },
        {
          key: 'host',
          label: t('serviceInstances.fields.host'),
          type: 'text',
          hideLabel: true,
          hidden: !selectedTemplate || !usesHostPortEndpoint(selectedTemplate),
          required: Boolean(hostMeta.required),
          advanced: Boolean(hostMeta.advanced),
          placeholder:
            splitEndpoint(selectedTemplate?.defaultEndpoint ?? '').host ||
            t('serviceInstances.placeholders.host'),
          defaultValue: '',
          render: usesHostPortEndpoint(selectedTemplate) ? renderHostPortField : undefined,
        },
        {
          key: 'port',
          label: t('serviceInstances.fields.port'),
          type: 'number',
          hidden: true,
          required: Boolean(portMeta.required),
          advanced: Boolean(portMeta.advanced),
          defaultValue: Number(defaultPortForTemplate(selectedTemplate)),
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
          label: resolveCredentialFieldLabel(selectedTemplate, t),
          type: 'text',
          hidden: !selectedTemplate,
          required: Boolean(selectedTemplate && credentialMeta.required),
          advanced: selectedTemplate ? Boolean(credentialMeta.advanced) : true,
          render: renderCredentialField,
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
          advanced: usesDatabaseConnectionLayout(selectedTemplate),
          hidden: !selectedTemplate || !usesDatabaseConnectionLayout(selectedTemplate),
          defaultValue: '',
          render: usesDatabaseConnectionLayout(selectedTemplate) ? renderSslModeField : undefined,
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
      renderCredentialField,
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
      const selectedTemplate = selectedTemplateId
        ? (templatesById.get(selectedTemplateId) ?? null)
        : null
      const baseFields = buildBaseFields(selectedCategory, selectedKind, selectedTemplate)
      const baseFieldByKey = new Map(baseFields.map(field => [field.key, field]))
      const dynamicFields = mergeTemplateFields(selectedTemplate, t).map(field =>
        mapTemplateFieldToResourceField(field, t)
      )

      if (usesDatabaseConnectionLayout(selectedTemplate)) {
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
          baseFieldByKey.get('password_value')!,
          ...hiddenTemplateFields,
          baseFieldByKey.get('template_id')!,
          baseFieldByKey.get('name')!,
          baseFieldByKey.get('title_name_editing')!,
          ...usernameFields,
          baseFieldByKey.get('credential')!,
          ...databaseFields,
          baseFieldByKey.get('host')!,
          baseFieldByKey.get('port')!,
          ...extraFields,
          baseFieldByKey.get('ssl_mode')!,
          ...certificateFields,
          ...otherAdvancedFields,
          baseFieldByKey.get('provider_account')!,
          baseFieldByKey.get('description')!,
          baseFieldByKey.get('groups')!,
          baseFieldByKey.get('is_enabled')!,
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
        baseFieldByKey.get('password_value')!,
        baseFieldByKey.get('ssl_mode')!,
        baseFieldByKey.get('description')!,
        baseFieldByKey.get('groups')!,
        baseFieldByKey.get('is_enabled')!,
      ]
    },
    [buildBaseFields, creatableTemplates, resolveSelectedCategory, t, templatesById]
  )

  const bootstrapFields = useMemo(() => buildBaseFields('', '', null), [buildBaseFields])
  const handleToggleEnabled = useCallback(
    async (item: Record<string, unknown>) => {
      const instanceId = String(item.id ?? '')
      if (!instanceId) return
      const current = await pb.send<InstanceRecord>(`/api/instances/${instanceId}`, {
        method: 'GET',
      })
      const currentFormData = mapInstanceRow(current, templatesById, new Map(), t)
      const body = await buildInstancePayload(
        {
          ...currentFormData,
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
  const allColumns = useMemo(
    () => buildColumns(t, handleToggleEnabled, reachabilityOverrides, reachabilityLoading),
    [handleToggleEnabled, reachabilityOverrides, reachabilityLoading, t]
  )
  const columns = useMemo(
    () =>
      allColumns.filter(column => {
        if (
          column.key === 'kind_label' ||
          column.key === 'host' ||
          column.key === 'port' ||
          column.key === 'monitor_status' ||
          column.key === 'monitor_last_checked_at' ||
          column.key === 'created' ||
          column.key === 'updated'
        ) {
          return visibleOptionalColumns.has(column.key)
        }
        return true
      }),
    [allColumns, visibleOptionalColumns]
  )
  const renderListSettings = useCallback(
    ({ pageSize, setPageSize }: { pageSize: number; setPageSize: (pageSize: number) => void }) => (
      <ResourceListSettingsButton
        title={t('servers.listSettings.title')}
        rowsPerPageLabel={t('servers.listSettings.rowsPerPage')}
        rowsPerPageOptionLabel={count => t('servers.listSettings.rowsPerPageOption', { count })}
        columnsLabel={t('servers.listSettings.columns')}
        pageSize={pageSize}
        setPageSize={setPageSize}
        pageSizeOptions={[10, 20, 50]}
        columnOptions={[
          {
            key: 'kind_label',
            label: t('serviceInstances.columns.kind'),
            checked: visibleOptionalColumns.has('kind_label'),
          },
          {
            key: 'host',
            label: t('serviceInstances.columns.host'),
            checked: visibleOptionalColumns.has('host'),
          },
          {
            key: 'port',
            label: t('serviceInstances.columns.port'),
            checked: visibleOptionalColumns.has('port'),
          },
          {
            key: 'monitor_status',
            label: t('serviceInstances.columns.reachability'),
            checked: visibleOptionalColumns.has('monitor_status'),
          },
          {
            key: 'monitor_last_checked_at',
            label: t('serviceInstances.columns.lastChecked'),
            checked: visibleOptionalColumns.has('monitor_last_checked_at'),
          },
          {
            key: 'created',
            label: t('serviceInstances.columns.created'),
            checked: visibleOptionalColumns.has('created'),
          },
          {
            key: 'updated',
            label: t('serviceInstances.columns.updated'),
            checked: visibleOptionalColumns.has('updated'),
          },
        ]}
        onColumnToggle={(columnKey, checked) => {
          setVisibleOptionalColumns(prev => {
            const next = new Set(prev)
            if (checked) {
              next.add(columnKey)
            } else {
              next.delete(columnKey)
            }
            return next
          })
        }}
      />
    ),
    [t, visibleOptionalColumns]
  )

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
          pageSizeValue: pageSize,
          onPageSizeChange: setPageSize,
          pageSizeOptions: [10, 20, 50],
          defaultSort: { key: 'name', dir: 'asc' },
          headerFilters: true,
          listControlsBorder: false,
          listControlsShowReset: false,
          pageSizeSelectorPlacement: 'none',
          paginationPlacement: 'header',
          paginationVariant: 'minimal',
          paginationSummary: false,
          paginationTotalLabel: totalCount =>
            t('serviceInstances.page.totalItems', { count: totalCount }),
          headerTrailingControls: renderListSettings,
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
          onRefresh: async ({ items, refreshList }) => {
            await refreshList()
            const ids = items.map(item => String(item.id ?? '')).filter(Boolean)
            await fetchReachabilityStatuses(ids)
          },
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
            const nextPayload = { ...payload }
            const credentialId = String(nextPayload.credential ?? '').trim()
            const secretValue = String(nextPayload.password_value ?? '').trim()

            if (secretValue && credentialId) {
              await pb.send(`/api/secrets/${credentialId}/payload`, {
                method: 'PUT',
                body: { payload: { value: secretValue } },
              })
              nextPayload.password_value = ''
            }

            const body = await buildInstancePayload(nextPayload, templatesById, t)
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
                {enabled
                  ? t('serviceInstances.actions.disable', { defaultValue: 'Disable' })
                  : t('serviceInstances.actions.enable', { defaultValue: 'Enable' })}
              </DropdownMenuItem>,
              <DropdownMenuItem
                key="check"
                onClick={() => {
                  void fetchReachabilityStatuses([String(item.id ?? '')])
                }}
              >
                <RotateCw className="h-4 w-4" />
                {t('serviceInstances.actions.check', { defaultValue: 'Check it' })}
              </DropdownMenuItem>,
            ]
          },
          deleteItem: async id => {
            await pb.send(`/api/instances/${id}`, { method: 'DELETE' })
          },
        }}
      />
    </>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/service-instances')({
  component: ServiceInstancesPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: typeof search.create === 'string' ? search.create : undefined,
  }),
})
