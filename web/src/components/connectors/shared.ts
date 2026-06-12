import { createElement } from 'react'
import { pb } from '@/lib/pb'
import type { FieldDef, SelectOption } from '@/components/resources/ResourcePage'
import { SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { Button } from '@/components/ui/button'
import {
  type ResourceSecretVisibleTo,
} from '@/components/secrets/SecretVisibilityField'
import { buildUserVisibleSecretRelationApiPath as buildSharedUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'

export type ConnectorRecord = {
  id: string
  name?: string
  kind?: string
  is_default?: boolean
  template_id?: string
  endpoint?: string
  auth_scheme?: string
  credential?: string
  config?: Record<string, unknown>
  description?: string
}

export type ConnectorTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  secretTemplate?: string
  placeholder?: string
  helpText?: string
  default?: unknown
}

export type ConnectorTemplate = {
  id: string
  kind: string
  title: string
  vendor?: string
  category?: string
  description?: string
  helpUrl?: string
  defaultEndpoint?: string
  defaultAuthScheme?: string
  fields?: ConnectorTemplateField[]
}

export type Translate = (key: string, options?: Record<string, unknown>) => string

export const PROXY_AUTH_OPTIONS: SelectOption[] = [
  { label: 'No authentication', value: 'none' },
  { label: 'Username + Password', value: 'username_password' },
]

export const SUPPORTED_KINDS = [
  'rest_api',
  'webhook',
  'mcp',
  'proxy',
  'smtp',
  'registry',
  'dns',
] as const

export const KIND_LABELS: Record<(typeof SUPPORTED_KINDS)[number], string> = {
  rest_api: 'REST API',
  webhook: 'Webhook',
  mcp: 'MCP',
  proxy: 'Proxy',
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
  const fallback = normalized || 'none'
  return translateOrFallback(t, `connectors.authValues.${normalized || 'none'}`, fallback)
}

export function buildProxyAuthOptions(t?: Translate): SelectOption[] {
  return [
    {
      label: translateOrFallback(t, 'connectors.auth.none', 'No authentication'),
      value: 'none',
    },
    {
      label: translateOrFallback(t, 'connectors.auth.usernamePassword', 'Username + Password'),
      value: 'username_password',
    },
  ]
}

export function buildDefaultConnectorName() {
  return `connector-${Date.now().toString().slice(-6)}`
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
    helpText: current.helpText || incoming.helpText,
    default: current.default !== undefined ? current.default : incoming.default,
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
  if (template.defaultEndpoint) {
    update('endpoint', template.defaultEndpoint)
  }
  for (const field of template.fields ?? []) {
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
  return String(raw.name ?? raw.id)
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

  if (template.kind === 'proxy') {
    return template.id === 'socks5-proxy' ? 'socks5' : 'http'
  }

  return ''
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

export function mapTemplateFieldToResourceField(
  template: ConnectorTemplate,
  field: ConnectorTemplateField,
  openSecretDialog: (callbacks: { addOption: (id: string, label: string) => void }) => void,
  t?: Translate
): FieldDef {
  if (template.kind === 'proxy') {
    if (field.id === 'auth_mode') {
      return {
        key: field.id,
        label: field.label,
        type: 'select',
        required: field.required,
        options: buildProxyAuthOptions(t),
        defaultValue: normalizeTemplateFieldDefault(field),
        onValueChange: (value, update) => {
          if (String(value ?? '') !== 'username_password') {
            update('username', '')
            update('credential', '')
            update(secretFieldUseSecretKey('credential'), false)
            update(secretFieldManualValueKey('credential'), '')
          }
        },
      }
    }

    if (field.id === 'username') {
      return {
        key: field.id,
        label: field.label,
        type: 'text',
        required: field.required,
        placeholder: field.placeholder,
        defaultValue: normalizeTemplateFieldDefault(field),
        showWhen: { field: 'auth_mode', values: ['username_password'] },
      }
    }
  }

  if (field.type === 'secret_ref') {
    return {
      key: field.id,
      label: field.label,
      type: 'relation',
      required: field.required,
      relationApiPath: buildUserVisibleSecretRelationApiPath('connector', field.secretTemplate),
      relationFormatLabel: raw => formatSecretLabel(raw),
      showWhen:
        template.kind === 'proxy' && field.id === 'credential'
          ? { field: 'auth_mode', values: ['username_password'] }
          : undefined,
      render: ({
        inputId,
        formData,
        editingItem,
        updateField,
        relationOptions,
        addRelationOption,
      }) => {
        const lockedForEdit =
          Boolean(editingItem) && !Boolean(formData[secretFieldEditModeKey(field.id)])
        const referenceValue = String(formData[field.id] ?? '')
        const selectedLabel =
          relationOptions.find(option => option.id === referenceValue)?.label ??
          referenceValue ??
          ''
        const useSecretValue = formData[secretFieldUseSecretKey(field.id)]
        const useSecret =
          typeof useSecretValue === 'boolean' ? useSecretValue : referenceValue.trim() !== ''

        if (lockedForEdit) {
          return createElement(
            'div',
            { className: 'flex flex-wrap items-center gap-3' },
            createElement(
              'div',
              { className: 'min-w-[220px] flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-foreground' },
              selectedLabel || translateOrFallback(t, 'connectors.secret.noneSelected', 'No secret selected')
            ),
            createElement(
              Button,
              {
                type: 'button',
                variant: 'outline',
                className: 'h-10',
                onClick: () => {
                  updateField(secretFieldEditModeKey(field.id), true)
                  updateField(secretFieldUseSecretKey(field.id), referenceValue.trim() !== '')
                },
                title: translateOrFallback(t, 'connectors.secret.editValue', 'Edit secret value'),
              },
              translateOrFallback(t, 'connectors.secret.edit', 'Edit Secret')
            )
          )
        }

        return createElement(SecretCredentialField, {
          inputId,
          manualValue: String(formData[secretFieldManualValueKey(field.id)] ?? ''),
          onManualValueChange: value => updateField(secretFieldManualValueKey(field.id), value),
          useReference: useSecret,
          onUseReferenceChange: checked => {
            updateField(secretFieldUseSecretKey(field.id), checked)
            updateField(secretFieldEditModeKey(field.id), true)
            if (!checked) {
              updateField(field.id, '')
            }
          },
          referenceValue,
          onReferenceValueChange: value => updateField(field.id, value),
          options: relationOptions,
          onCreateReference: () => {
            openSecretDialog({
              addOption: (id, label) => {
                addRelationOption(id, label)
                updateField(secretFieldEditModeKey(field.id), true)
                updateField(secretFieldUseSecretKey(field.id), true)
                updateField(field.id, id)
              },
            })
          },
          editMode: false,
          manualPlaceholder: translateOrFallback(
            t,
            'connectors.secret.directPlaceholder',
            `Enter ${field.label}`
          ),
          showLabel: translateOrFallback(t, 'connectors.secret.show', 'Show secret'),
          hideLabel: translateOrFallback(t, 'connectors.secret.hide', 'Hide secret'),
          allowGenerate: false,
          referenceToggleMode: 'icon',
          editReferenceMode: 'icon',
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
    helpText: field.helpText,
  }
}

async function createSecretForConnectorField(
  payload: Record<string, unknown>,
  template: ConnectorTemplate,
  field: ConnectorTemplateField,
  t?: Translate
) {
  const manualValue = String(payload[secretFieldManualValueKey(field.id)] ?? '').trim()
  const useReferenceValue = payload[secretFieldUseSecretKey(field.id)]
  const useReference =
    typeof useReferenceValue === 'boolean'
      ? useReferenceValue
      : String(payload[field.id] ?? '').trim() !== ''

  if (!useReference && manualValue) {
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

export async function buildConnectorPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, ConnectorTemplate>,
  t?: Translate
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
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
        translateOrFallback(
          t,
          'connectors.errors.fieldRequired',
          `${field.label} is required`,
          { field: field.label }
        )
      )
    }
  }

  const credentialId = String(body.credential ?? '').trim()
  let authScheme = 'none'
  if (template.kind === 'proxy') {
    authScheme = String(body.auth_mode ?? '').trim() === 'username_password' ? 'basic' : 'none'
  } else if (credentialId) {
    const defaultAuthScheme = String(template.defaultAuthScheme ?? 'none').trim() || 'none'
    authScheme = defaultAuthScheme !== 'none' ? defaultAuthScheme : 'bearer'
  }

  const extra =
    typeof body.advanced_config === 'string' ? body.advanced_config.trim() : body.advanced_config
  let config: Record<string, unknown> = {}
  if (!(extra === '' || extra == null)) {
    config = typeof extra === 'string' ? JSON.parse(extra) : (extra as Record<string, unknown>)
  }

  const normalizedEndpoint = normalizeEndpointValue(
    String(body.endpoint ?? template.defaultEndpoint ?? ''),
    template,
    body
  )

  for (const field of template.fields ?? []) {
    if (field.id === 'endpoint' || field.id === 'credential') {
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
    template_id: template.id,
    endpoint: normalizedEndpoint,
    auth_scheme: authScheme,
    credential: credentialId,
    config,
    description: String(body.description ?? ''),
  }
}

export function mapConnectorRow(
  item: ConnectorRecord,
  templatesById: Map<string, ConnectorTemplate>,
  t?: Translate
): Record<string, unknown> {
  const kind = String(item.kind ?? '') as (typeof SUPPORTED_KINDS)[number]
  const template = templatesById.get(String(item.template_id ?? ''))
  const flattenedConfig: Record<string, unknown> = {}
  const knownFieldIDs = new Set((template?.fields ?? []).map(field => field.id))

  for (const field of template?.fields ?? []) {
    if (field.id === 'endpoint' || field.id === 'credential') {
      continue
    }
    const value = item.config?.[field.id]
    if (value === undefined) {
      continue
    }
    flattenedConfig[field.id] = field.type === 'json' ? JSON.stringify(value, null, 2) : value
  }

  const advancedConfig = Object.fromEntries(
    Object.entries(item.config ?? {}).filter(([key]) => !knownFieldIDs.has(key))
  )

  return {
    id: item.id,
    name: String(item.name ?? ''),
    kind,
    is_default: Boolean(item.is_default),
    template_id: String(item.template_id ?? ''),
    kind_label: getConnectorKindLabel(kind, t),
    profile: template?.title ?? humanizeTemplateId(String(item.template_id ?? '')),
    endpoint: String(item.endpoint ?? ''),
    auth_type: String(item.auth_scheme ?? 'none'),
    credential: String(item.credential ?? ''),
    [secretFieldUseSecretKey('credential')]: true,
    [secretFieldManualValueKey('credential')]: '',
    description: String(item.description ?? ''),
    [secretFieldEditModeKey('credential')]: false,
    advanced_config:
      Object.keys(advancedConfig).length > 0 ? JSON.stringify(advancedConfig, null, 2) : '',
    ...flattenedConfig,
  }
}
