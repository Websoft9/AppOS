import { createElement } from 'react'
import { pb } from '@/lib/pb'
import {
  cloneConfig,
  formatResourceSecretLabel,
  normalizeTemplateID,
  resolveEnabledFlag,
} from '@/lib/resource-helpers'
import type {
  AccessResourceRecord,
  ResourceSaveInput,
  ResourceTemplateBase,
  ResourceTemplateField,
} from '@/lib/resource-types'
import type { FieldDef } from '@/components/resources/ResourcePage'
import { renderBooleanSwitchField } from '@/components/resources/resource-status'
import { SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { Input } from '@/components/ui/input'
import { type ResourceSecretVisibleTo } from '@/components/secrets/SecretVisibilityField'
import { buildUserVisibleSecretRelationApiPath as buildSharedUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'

export type ConnectorRecord = AccessResourceRecord

export type ConnectorTemplateField = ResourceTemplateField

export type ConnectorTemplate = ResourceTemplateBase<ConnectorTemplateField>

export type Translate = (key: string, options?: Record<string, unknown>) => string

export const SUPPORTED_KINDS = [
  'rest_api',
  'webhook',
  'mcp',
  'http-gateway',
  'proxy',
  'smtp',
  'registry',
  'dns',
] as const

export const KIND_LABELS: Record<(typeof SUPPORTED_KINDS)[number], string> = {
  rest_api: 'REST API',
  webhook: 'Webhook',
  mcp: 'MCP Server',
  'http-gateway': 'HTTP Gateway',
  proxy: 'Outbound Proxy',
  smtp: 'SMTP',
  registry: 'Registry',
  dns: 'DNS',
}

export const CONNECTOR_KIND_QUERY = SUPPORTED_KINDS.join(',')

export const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Token / Single Value',
}

function secretFieldUseSecretKey(fieldID: string) {
  return `${fieldID}__use_secret`
}

function secretFieldManualValueKey(fieldID: string) {
  return `${fieldID}__manual_value`
}

function secretFieldEditModeKey(fieldID: string) {
  return `${fieldID}__editing`
}

function secretFieldInlineValueKey(fieldID: string) {
  return `${fieldID}__inline_value`
}

function InlineSecretEditorField({
  inputId,
  inlineValue,
  onInlineValueChange,
}: {
  inputId: string
  inlineValue: string
  onInlineValueChange: (value: string) => void
}) {
  return createElement(
    'div',
    { className: 'space-y-1.5' },
    createElement(
      'div',
      { className: 'flex items-center gap-2' },
      createElement(Input, {
        id: inputId,
        type: 'password',
        value: inlineValue,
        onChange: (event: { target: { value: string } }) => onInlineValueChange(event.target.value),
        placeholder: 'Leave blank to keep the current secret value',
        autoFocus: true,
      })
    ),
    createElement(
      'div',
      { className: 'text-xs text-muted-foreground' },
      'Leave this field blank to keep the current secret. Saving this external service will update the current secret value in place when a new value is provided.'
    )
  )
}

function translateOrFallback(
  t: Translate | undefined,
  key: string,
  fallback: string,
  options?: Record<string, unknown>
) {
  if (!t) {
    return fallback
  }
  const value = t(key, options)
  return value === key ? fallback : value
}

export function getConnectorKindLabel(kind: string, t?: Translate) {
  const normalized = String(kind ?? '')
    .trim()
    .toLowerCase() as (typeof SUPPORTED_KINDS)[number]
  const fallback = KIND_LABELS[normalized] ?? String(kind ?? 'Unknown')
  return translateOrFallback(t, `connectors.kinds.${normalized}`, fallback)
}

export function getConnectorSecretTemplateLabel(templateId: string, t?: Translate) {
  const normalized = String(templateId ?? '').trim()
  const fallback = SECRET_TEMPLATE_LABELS[normalized] ?? normalized
  return translateOrFallback(t, `connectors.secretTemplates.${normalized}`, fallback)
}

export function getConnectorAuthSchemeLabel(authScheme: string, t?: Translate) {
  const normalized = String(authScheme ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'bearer' || normalized === 'api_key') {
    return translateOrFallback(t, 'connectors.authValues.token', 'API Key / Token')
  }
  const fallback = normalized || 'none'
  return translateOrFallback(t, `connectors.authValues.${normalized || 'none'}`, fallback)
}

export function buildDefaultConnectorName(kind?: string) {
  const prefix =
    (kind ? KIND_LABELS[kind as (typeof SUPPORTED_KINDS)[number]] : undefined) ||
    kind?.trim() ||
    'connector'
  return `${prefix}-${Date.now().toString().slice(-6)}`
}

function slugifyNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isGenericConnectorTemplate(template: ConnectorTemplate) {
  const vendor = String(template.vendor ?? '')
    .trim()
    .toLowerCase()
  return (
    template.id.startsWith('generic-') ||
    vendor === 'generic' ||
    template.title.trim().toLowerCase().startsWith('generic ')
  )
}

export function listConnectorTemplatesForKind(
  kind: string,
  templates: ConnectorTemplate[]
): ConnectorTemplate[] {
  return templates
    .filter(template => template.kind === kind)
    .sort((left, right) => {
      const leftIsGeneric = isGenericConnectorTemplate(left)
      const rightIsGeneric = isGenericConnectorTemplate(right)
      if (leftIsGeneric !== rightIsGeneric) {
        return leftIsGeneric ? -1 : 1
      }
      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    })
}

export function getDefaultConnectorTemplate(
  kind: string,
  templates: ConnectorTemplate[]
): ConnectorTemplate | null {
  return listConnectorTemplatesForKind(kind, templates)[0] ?? null
}

function mergeConnectorField(
  current: ConnectorTemplateField,
  incoming: ConnectorTemplateField
): ConnectorTemplateField {
  return {
    ...current,
    label: current.label || incoming.label,
    type: current.type || incoming.type,
    secretTemplate: current.secretTemplate || incoming.secretTemplate,
    placeholder: current.placeholder || incoming.placeholder,
    helpUrl: current.helpUrl || incoming.helpUrl,
    helpText: current.helpText || incoming.helpText,
    default: current.default !== undefined ? current.default : incoming.default,
    options: current.options?.length ? current.options : incoming.options,
    showWhen: current.showWhen ?? incoming.showWhen,
  }
}

export function buildConnectorKindSchema(
  kind: string,
  templates: ConnectorTemplate[]
): ConnectorTemplateField[] {
  const schema: ConnectorTemplateField[] = []
  const fieldIndexByID = new Map<string, number>()

  for (const template of listConnectorTemplatesForKind(kind, templates)) {
    for (const field of template.fields ?? []) {
      const existingIndex = fieldIndexByID.get(field.id)
      if (existingIndex === undefined) {
        fieldIndexByID.set(field.id, schema.length)
        schema.push({ ...field, required: false })
        continue
      }
      schema[existingIndex] = mergeConnectorField(schema[existingIndex], field)
    }
  }

  return schema
}

export function applyConnectorTemplateDefaults(
  template: ConnectorTemplate | null | undefined,
  update: (key: string, value: unknown) => void
) {
  if (!template) {
    return
  }
  if (template.endpointShape === 'host_port_tls') {
    const parsedDefault = parseConnectorEndpoint(template.defaultEndpoint)
    update('endpoint', parsedDefault.host)
    update('port', parsedDefault.port || 587)
    update('tls', parsedDefault.scheme === 'smtps' || parsedDefault.port === 465)
  } else if (template.defaultEndpoint) {
    update('endpoint', template.defaultEndpoint)
  }
  for (const field of template.fields ?? []) {
    if (
      template.endpointShape === 'host_port_tls' &&
      (field.id === 'endpoint' || field.id === 'port' || field.id === 'tls')
    ) {
      continue
    }
    if (field.default !== undefined) {
      update(field.id, normalizeTemplateFieldDefault(field))
    }
  }
}

export function buildConnectorCreateHref(kind?: string, templateID?: string) {
  const params = new URLSearchParams({ create: '1' })
  if (kind) {
    params.set('kind', kind)
  }
  if (templateID) {
    params.set('template', templateID)
  }
  return `/resources/connectors?${params.toString()}`
}

export function formatSecretLabel(raw: Record<string, unknown>): string {
  return formatResourceSecretLabel(raw)
}

export function humanizeTemplateId(templateId: string) {
  return templateId
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function buildUserVisibleSecretRelationApiPath(
  visibleTo: ResourceSecretVisibleTo,
  secretTemplate?: string
) {
  return buildSharedUserVisibleSecretRelationApiPath(visibleTo, { secretTemplate })
}

export function normalizeTemplateFieldDefault(field: ConnectorTemplateField) {
  if (field.default === undefined) {
    if (field.type === 'boolean') return false
    return ''
  }
  if (field.type === 'json' && typeof field.default !== 'string') {
    return JSON.stringify(field.default, null, 2)
  }
  return field.default
}

function parseConnectorEndpoint(endpoint: string | undefined) {
  const raw = String(endpoint ?? '').trim()
  if (!raw) {
    return { scheme: '', host: '', port: 0 }
  }

  const normalized = raw.includes('://') ? raw : `tcp://${raw}`
  try {
    const parsed = new URL(normalized)
    return {
      scheme: parsed.protocol.replace(/:$/, '').toLowerCase(),
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 0,
    }
  } catch {
    return { scheme: '', host: raw, port: 0 }
  }
}

function resolveSMTPDefaultEndpoint(template: ConnectorTemplate, sslEnabled: boolean) {
  const explicitTLSEndpoint = String(template.defaultEndpointTls ?? '').trim()
  if (sslEnabled && explicitTLSEndpoint) {
    return explicitTLSEndpoint
  }
  return String(template.defaultEndpoint ?? '').trim()
}

export function resolveConnectorEnabled(value: unknown) {
  return resolveEnabledFlag(value)
}

function inferEndpointScheme(
  template: ConnectorTemplate,
  payload: Record<string, unknown>
): string {
  const explicitProtocol = String(payload.protocol ?? '')
    .trim()
    .toLowerCase()
  if (explicitProtocol) {
    return explicitProtocol
  }

  const defaultEndpoint = String(template.defaultEndpoint ?? '').trim()
  const schemeMatch = defaultEndpoint.match(/^([a-z0-9+.-]+):\/\//i)
  if (schemeMatch?.[1]) {
    return schemeMatch[1].toLowerCase()
  }

  const templateScheme = String(template.endpointScheme ?? '')
    .trim()
    .toLowerCase()
  if (templateScheme) {
    return templateScheme
  }

  return ''
}

export function extractConnectorEndpointScheme(endpoint: string | undefined): string {
  const raw = String(endpoint ?? '').trim()
  const match = raw.match(/^([a-z0-9+.-]+):\/\//i)
  return match?.[1]?.toLowerCase() ?? ''
}

export function inferDefaultConnectorEndpointScheme(template: ConnectorTemplate): string {
  return inferEndpointScheme(template, {})
}

export function resolveConnectorTemplateId(
  payload: Record<string, unknown>,
  editingItem?: Record<string, unknown> | null
): string {
  return String(payload.template_id ?? editingItem?.template_id ?? '').trim()
}

function normalizeEndpointValue(
  endpoint: string,
  template: ConnectorTemplate,
  payload: Record<string, unknown>
): string {
  const trimmed = endpoint.trim()
  if (!trimmed || trimmed.includes('://')) {
    return trimmed
  }

  const scheme = inferEndpointScheme(template, payload)
  return scheme ? `${scheme}://${trimmed}` : trimmed
}

export function normalizeConnectorEndpointValue(
  endpoint: string,
  template: ConnectorTemplate,
  payload: Record<string, unknown>
): string {
  return normalizeEndpointValue(endpoint, template, payload)
}

export function mapTemplateFieldToResourceField(
  template: ConnectorTemplate,
  field: ConnectorTemplateField,
  t?: Translate
): FieldDef {
  if (field.type === 'select') {
    return {
      key: field.id,
      label: field.label,
      type: 'select',
      required: field.required,
      options: (field.options ?? []).map(option => ({
        label: option.label,
        value: option.value,
      })),
      defaultValue: normalizeTemplateFieldDefault(field),
      showWhen: field.showWhen,
    }
  }

  if (field.type === 'secret_ref') {
    return {
      key: field.id,
      label: field.label,
      type: 'text',
      required: field.required,
      showWhen: field.showWhen,
      render: ({
        inputId,
        formData,
        editingItem,
        updateField,
      }) => {
        if (editingItem) {
          return createElement(InlineSecretEditorField, {
            inputId,
            inlineValue: String(formData[secretFieldInlineValueKey(field.id)] ?? ''),
            onInlineValueChange: (value: string) => {
              updateField(secretFieldInlineValueKey(field.id), value)
            },
          })
        }

        return createElement(SecretCredentialField, {
          inputId,
          manualValue: String(
            formData[secretFieldInlineValueKey(field.id)] ??
              formData[secretFieldManualValueKey(field.id)] ??
              ''
          ),
          onManualValueChange: value => {
            updateField(secretFieldInlineValueKey(field.id), value)
            updateField(secretFieldManualValueKey(field.id), value)
          },
          useReference: false,
          onUseReferenceChange: () => {},
          referenceValue: '',
          onReferenceValueChange: () => {},
          options: [],
          editMode: false,
          manualPlaceholder: translateOrFallback(
            t,
            'connectors.secret.directPlaceholder',
            `Enter ${field.label}`
          ),
          showLabel: translateOrFallback(t, 'connectors.secret.show', 'Show secret'),
          hideLabel: translateOrFallback(t, 'connectors.secret.hide', 'Hide secret'),
          allowGenerate: false,
          allowReference: false,
        })
      },
    }
  }

  if (template.endpointShape === 'host_port_tls' && field.id === 'tls') {
    return {
      key: field.id,
      label: field.label,
      type: 'boolean',
      required: field.required,
      defaultValue: normalizeTemplateFieldDefault(field),
      helpUrl: field.helpUrl,
      render: ({ inputId, value, formData, updateField }) => {
        const checked = Boolean(value)
        return renderBooleanSwitchField({
          inputId,
          label: field.label,
          value: checked,
          setValue: nextChecked => {
            const currentDefault = parseConnectorEndpoint(
              resolveSMTPDefaultEndpoint(template, checked)
            )
            const nextDefault = parseConnectorEndpoint(
              resolveSMTPDefaultEndpoint(template, nextChecked)
            )
            const currentHost = String(formData.endpoint ?? '').trim()
            const currentPort = Number(formData.port ?? 0)

            updateField(field.id, nextChecked)

            if ((!currentHost || currentHost === currentDefault.host) && nextDefault.host) {
              updateField('endpoint', nextDefault.host)
            }

            if (
              !currentPort ||
              currentPort === currentDefault.port ||
              currentPort === 465 ||
              currentPort === 587
            ) {
              updateField('port', nextDefault.port || (nextChecked ? 465 : 587))
            }
          },
          enabledLabel: translateOrFallback(t, 'connectors.enabled.yes', 'Yes'),
          disabledLabel: translateOrFallback(t, 'connectors.enabled.no', 'No'),
        })
      },
    }
  }

  return {
    key: field.id,
    label: field.label,
    type:
      field.type === 'boolean'
        ? 'boolean'
        : field.type === 'json'
          ? 'textarea'
          : field.type === 'number'
            ? 'number'
            : 'text',
    required: field.required,
    placeholder: field.placeholder,
    defaultValue: normalizeTemplateFieldDefault(field),
    helpUrl: field.helpUrl,
    helpText: field.helpText,
    showWhen: field.showWhen,
  }
}

export async function saveEditedConnectorSecrets(
  payload: Record<string, unknown>,
  template: ConnectorTemplate
) {
  for (const field of template.fields ?? []) {
    if (field.type !== 'secret_ref') {
      continue
    }
    const inlineValue = String(payload[secretFieldInlineValueKey(field.id)] ?? '').trim()
    if (!inlineValue) {
      continue
    }
    const secretId = String(payload[field.id] ?? '').trim()
    if (!secretId) {
      throw new Error(`${field.label} secret must be selected before editing it.`)
    }
    await pb.send(`/api/secrets/${secretId}/payload`, {
      method: 'PUT',
      body: { payload: { value: inlineValue } },
    })
    payload[secretFieldInlineValueKey(field.id)] = ''
    payload[secretFieldManualValueKey(field.id)] = ''
    payload[secretFieldEditModeKey(field.id)] = false
    payload[secretFieldUseSecretKey(field.id)] = true
  }
}

async function createSecretForConnectorField(
  payload: Record<string, unknown>,
  template: ConnectorTemplate,
  field: ConnectorTemplateField,
  t?: Translate
) {
  const manualValue = String(payload[secretFieldManualValueKey(field.id)] ?? '').trim()
  const secretId = String(payload[field.id] ?? '').trim()

  if (!secretId && manualValue) {
    const connectorName = String(payload.name ?? '').trim()
    const secret = await pb.collection('secrets').create({
      name: `${slugifyNamePart(connectorName || template.title || 'external-service') || 'external-service'}-${slugifyNamePart(field.id) || 'secret'}`,
      description: t
        ? t('connectors.secret.generatedDescription', {
            name: connectorName || template.title,
            field: field.label,
          })
        : `${field.label} for ${connectorName || template.title}`,
      template_id: field.secretTemplate || 'single_value',
      scope: 'global',
      visible_to: ['connector'],
      payload: { value: manualValue },
    })
    payload[field.id] = String(secret.id ?? '')
  }

  return String(payload[field.id] ?? '').trim()
}

export function hasConnectorSecretFieldValue(
  payload: Record<string, unknown>,
  field: ConnectorTemplateField
) {
  const selectedValue = String(payload[field.id] ?? '').trim()
  const manualValue = String(
    payload[secretFieldManualValueKey(field.id)] ??
      payload[secretFieldInlineValueKey(field.id)] ??
      ''
  ).trim()
  return Boolean(selectedValue || manualValue)
}

export async function buildConnectorPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, ConnectorTemplate>,
  t?: Translate
): Promise<ResourceSaveInput> {
  const body = { ...payload }
  const templateId = normalizeTemplateID(body.template_id)
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error(
      translateOrFallback(t, 'connectors.errors.profileRequired', 'Connector profile is required')
    )
  }

  for (const field of template.fields ?? []) {
    if (field.type !== 'secret_ref') {
      continue
    }
    const secretID = await createSecretForConnectorField(body, template, field, t)
    if (field.required && !secretID) {
      throw new Error(
        translateOrFallback(t, 'connectors.errors.fieldRequired', `${field.label} is required`, {
          field: field.label,
        })
      )
    }
  }

  const credentialId = String(body.credential ?? '').trim()
  const authScheme = String(template.defaultAuthScheme ?? 'none').trim() || 'none'

  const extra =
    typeof body.advanced_config === 'string' ? body.advanced_config.trim() : body.advanced_config
  let config: Record<string, unknown> = {}
  if (!(extra === '' || extra == null)) {
    config = typeof extra === 'string' ? JSON.parse(extra) : (extra as Record<string, unknown>)
  }

  const normalizedEndpoint =
    template.endpointShape === 'host_port_tls'
      ? buildSMTPConnectorEndpoint(
          String(body.endpoint ?? ''),
          Number(body.port ?? 0),
          Boolean(body.tls)
        )
      : normalizeEndpointValue(
          String(body.endpoint ?? template.defaultEndpoint ?? ''),
          template,
          body
        )

  for (const field of template.fields ?? []) {
    if (
      field.id === 'endpoint' ||
      field.id === 'credential' ||
      (template.endpointShape === 'host_port_tls' && field.id === 'port')
    ) {
      continue
    }
    const value = body[field.id]
    if (value === undefined || value === '') {
      continue
    }
    if (field.type === 'json' && typeof value === 'string') {
      config[field.id] = JSON.parse(value)
      continue
    }
    if (field.type === 'number') {
      config[field.id] = Number(value)
      continue
    }
    if (field.type === 'boolean') {
      config[field.id] = Boolean(value)
      continue
    }
    config[field.id] = value
  }

  if (template.kind === 'proxy') {
    const scheme = inferEndpointScheme(template, { ...body, endpoint: normalizedEndpoint })
    if (scheme) {
      config.protocol = scheme
    }
  }

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
    ...(body.is_enabled !== undefined
      ? { is_enabled: resolveConnectorEnabled(body.is_enabled) }
      : {}),
    template_id: template.id,
    endpoint: normalizedEndpoint,
    auth_scheme: authScheme,
    credential: credentialId,
    config,
    description: String(body.description ?? ''),
  }
}

function buildSMTPConnectorEndpoint(host: string, port: number, sslEnabled: boolean) {
  const trimmedHost = host.trim()
  if (!trimmedHost) {
    return ''
  }
  const normalizedPort = Number.isFinite(port) && port > 0 ? port : sslEnabled ? 465 : 587
  return `${sslEnabled ? 'smtps' : 'smtp'}://${trimmedHost}:${normalizedPort}`
}

export function mapConnectorRow(
  item: ConnectorRecord,
  templatesById: Map<string, ConnectorTemplate>,
  t?: Translate,
  monitorByTargetId?: Map<
    string,
    { status?: string; reason?: string | null; last_checked_at?: string | null }
  >
): Record<string, unknown> {
  const kind = String(item.kind ?? '') as (typeof SUPPORTED_KINDS)[number]
  const template = templatesById.get(String(item.template_id ?? ''))
  const flattenedConfig: Record<string, unknown> = {}
  const knownFieldIDs = new Set((template?.fields ?? []).map(field => field.id))
  const parsedEndpoint = parseConnectorEndpoint(String(item.endpoint ?? ''))

  for (const field of template?.fields ?? []) {
    if (
      field.id === 'endpoint' ||
      field.id === 'credential' ||
      (template?.endpointShape === 'host_port_tls' && (field.id === 'port' || field.id === 'tls'))
    ) {
      continue
    }
    const value = item.config?.[field.id]
    if (value === undefined) {
      continue
    }
    flattenedConfig[field.id] = field.type === 'json' ? JSON.stringify(value, null, 2) : value
  }

  const advancedConfig = Object.fromEntries(
    Object.entries(cloneConfig(item.config)).filter(([key]) => !knownFieldIDs.has(key))
  )

  const monitor = monitorByTargetId?.get(String(item.id ?? ''))
  const monitorStatus = String(monitor?.status ?? '')
    .trim()
    .toLowerCase()
  let reachability = ''
  let reachabilityReason = ''
  let reachabilityLastCheckedAt = ''
  if (monitorStatus === 'healthy') {
    reachability = 'reachable'
  } else if (monitorStatus === 'unreachable') {
    reachability = 'unreachable'
  } else if (monitorStatus) {
    reachability = 'unknown'
  }
  reachabilityReason = String(monitor?.reason ?? '')
  reachabilityLastCheckedAt = String(monitor?.last_checked_at ?? '')

  return {
    id: item.id,
    created: String(item.created ?? ''),
    updated: String(item.updated ?? ''),
    name: String(item.name ?? ''),
    kind,
    is_enabled: resolveConnectorEnabled(item.is_enabled),
    enabled_status: resolveConnectorEnabled(item.is_enabled) ? 'Enabled' : 'Disabled',
    template_id: String(item.template_id ?? ''),
    kind_label: getConnectorKindLabel(kind, t),
    profile: template?.title ?? humanizeTemplateId(String(item.template_id ?? '')),
    endpoint:
      template?.endpointShape === 'host_port_tls'
        ? parsedEndpoint.host
        : String(item.endpoint ?? ''),
    port: parsedEndpoint.port || 0,
    auth_type: String(item.auth_scheme ?? 'none'),
    credential: String(item.credential ?? ''),
    [secretFieldUseSecretKey('credential')]: true,
    [secretFieldManualValueKey('credential')]: '',
    [secretFieldInlineValueKey('credential')]: '',
    description: String(item.description ?? ''),
    [secretFieldEditModeKey('credential')]: false,
    tls:
      template?.endpointShape === 'host_port_tls'
        ? parsedEndpoint.scheme === 'smtps' || parsedEndpoint.port === 465
        : flattenedConfig.tls,
    advanced_config:
      Object.keys(advancedConfig).length > 0 ? JSON.stringify(advancedConfig, null, 2) : '',
    reachability,
    reachability_reason: reachabilityReason,
    reachability_last_checked_at: reachabilityLastCheckedAt,
    ...flattenedConfig,
  }
}
