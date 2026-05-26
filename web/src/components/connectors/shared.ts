import type { FieldDef, SelectOption } from '@/components/resources/ResourcePage'

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
  description?: string
  defaultEndpoint?: string
  defaultAuthScheme?: string
  fields?: ConnectorTemplateField[]
}

export const PROXY_AUTH_OPTIONS: SelectOption[] = [
  { label: 'No authentication', value: 'none' },
  { label: 'Username + Password', value: 'username_password' },
]

export const SUPPORTED_KINDS = ['rest_api', 'webhook', 'mcp', 'proxy', 'smtp', 'registry', 'dns'] as const

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

export function buildDefaultConnectorName() {
  return `connector-${Date.now().toString().slice(-6)}`
}

const SECRET_TEMPLATE_IDS = new Set(Object.keys(SECRET_TEMPLATE_LABELS))

export function formatSecretLabel(raw: Record<string, unknown>): string {
  const name = String(raw.name ?? raw.id)
  const templateId = String(raw.template_id ?? '')
  const suffix = SECRET_TEMPLATE_LABELS[templateId]
  return suffix ? `${name} (${suffix})` : name
}

export function humanizeTemplateId(templateId: string) {
  return templateId
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function resolveSecretTemplateId(secretTemplate?: string) {
  const normalized = String(secretTemplate ?? '').trim()
  if (!normalized) {
    return ''
  }
  return SECRET_TEMPLATE_IDS.has(normalized) ? normalized : ''
}

export function buildUserVisibleSecretRelationApiPath(secretTemplate?: string) {
  const explicit = resolveSecretTemplateId(secretTemplate)
  const templateIds = explicit ? [explicit] : Array.from(SECRET_TEMPLATE_IDS)
  const filter = templateIds.map(id => `template_id='${id}'`).join('||')
  return `/api/collections/secrets/records?filter=((created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(${filter}))&sort=name`
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
  const explicitProtocol = String(payload.protocol ?? '').trim().toLowerCase()
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
  openSecretEditor: (secretId: string) => void
): FieldDef {
  if (template.kind === 'proxy') {
    if (field.id === 'auth_mode') {
      return {
        key: field.id,
        label: field.label,
        type: 'select',
        required: field.required,
        options: PROXY_AUTH_OPTIONS,
        defaultValue: normalizeTemplateFieldDefault(field),
        onValueChange: (value, update) => {
          if (String(value ?? '') !== 'username_password') {
            update('username', '')
            update('credential', '')
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
      relationApiPath: buildUserVisibleSecretRelationApiPath(field.secretTemplate),
      relationFormatLabel: formatSecretLabel,
      relationCreateButton: {
        label: 'New Secret',
        onClick: openSecretDialog,
      },
      relationEditButton: {
        label: 'Edit Secret',
        onClick: openSecretEditor,
      },
      showWhen:
        template.kind === 'proxy' && field.id === 'credential'
          ? { field: 'auth_mode', values: ['username_password'] }
          : undefined,
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

export async function buildConnectorPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, ConnectorTemplate>
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error('Connector profile is required')
  }

  const credentialId = String(body.credential ?? '')
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
  templatesById: Map<string, ConnectorTemplate>
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
    is_default: Boolean(item.is_default),
    template_id: String(item.template_id ?? ''),
    kind_label: KIND_LABELS[kind] ?? String(item.kind ?? 'Unknown'),
    profile: template?.title ?? humanizeTemplateId(String(item.template_id ?? '')),
    endpoint: String(item.endpoint ?? ''),
    auth_type: String(item.auth_scheme ?? 'none'),
    credential: String(item.credential ?? ''),
    description: String(item.description ?? ''),
    advanced_config:
      Object.keys(advancedConfig).length > 0 ? JSON.stringify(advancedConfig, null, 2) : '',
    ...flattenedConfig,
  }
}