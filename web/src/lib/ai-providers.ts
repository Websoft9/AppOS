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

export type AIProviderRecord = AccessResourceRecord & {
  is_default?: boolean
  enabled_models?: string[]
}

export type AIProviderTemplateField = ResourceTemplateField

export type AIProviderTemplateProtocol = {
  id: string
  label: string
  default?: boolean
  defaultEndpoint?: string
  modelsEndpoint?: string
}

export type AIProviderTemplate = ResourceTemplateBase<AIProviderTemplateField> & {
  uiGroup?: string
  hostingMode?: string
  serviceMode?: string
  endpointMode?: string
  providerMode?: string
  contextSize?: number
  modelsEndpoint?: string
  defaultEnabledModels?: string[]
  capabilities?: string[]
  aliases?: string[]
  supportsClosedModels?: boolean
  supportsMultiVendorModels?: boolean
  protocols?: AIProviderTemplateProtocol[]
  hideInChooser?: boolean
}

export type AIProviderSelectionGroupKey = 'singleProvider' | 'cloudGateway' | 'selfHosted'

type ProviderModelLike = {
  id?: unknown
  label?: unknown
  vendor?: unknown
  enabled_by_default?: boolean
}

type ProviderModelGroupLike<TModel extends ProviderModelLike = ProviderModelLike> = {
  label?: unknown
  vendor?: unknown
  models?: TModel[] | null
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Token / Single Value',
}

export const AI_PROVIDER_CREDENTIAL_TEMPLATE_ID = 'single_value'

export function aiProviderSecretFieldManualValueKey(fieldId: string) {
  return `${fieldId}__manual_value`
}

export function aiProviderSecretFieldInlineValueKey(fieldId: string) {
  return `${fieldId}__inline_value`
}

export function formatSecretLabel(raw: Record<string, unknown>): string {
  return formatResourceSecretLabel(raw)
}

function humanizeTemplateId(templateId: string) {
  return templateId
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function productTitle(template: AIProviderTemplate) {
  return template.title.trim() || humanizeTemplateId(template.id)
}

export function chooserTitle(template: AIProviderTemplate) {
  return productTitle(template)
}

export function templateChooserSearchText(template: AIProviderTemplate) {
  return [
    template.title,
    template.vendor,
    template.description,
    ...(Array.isArray(template.aliases) ? template.aliases : []),
    template.id,
  ]
    .join(' ')
    .toLowerCase()
}

export function normalizeProtocolId(value: string) {
  return value.trim().toLowerCase()
}

function fallbackTemplateProtocols(template: AIProviderTemplate): AIProviderTemplateProtocol[] {
  if (template.id === 'anthropic') {
    return [
      {
        id: 'anthropic',
        label: 'Anthropic',
        default: true,
        defaultEndpoint: template.defaultEndpoint,
      },
    ]
  }
  if (template.id === 'ollama') {
    return [
      {
        id: 'ollama',
        label: 'Ollama',
        default: true,
        defaultEndpoint: 'http://localhost:11434',
        modelsEndpoint: '/api/tags',
      },
    ]
  }
  return [
    {
      id: 'openai',
      label: 'OpenAI',
      default: true,
      defaultEndpoint: template.defaultEndpoint,
    },
  ]
}

export function normalizeTemplateProtocols(
  template: AIProviderTemplate | null | undefined
): AIProviderTemplateProtocol[] {
  if (!template) return []
  const protocols =
    Array.isArray(template.protocols) && template.protocols.length > 0
      ? template.protocols
      : fallbackTemplateProtocols(template)
  return protocols
    .map(protocol => ({
      ...protocol,
      id: normalizeProtocolId(String(protocol.id ?? '')),
      label: String(protocol.label ?? protocol.id ?? '').trim() || String(protocol.id ?? ''),
      defaultEndpoint: String(protocol.defaultEndpoint ?? '').trim(),
      modelsEndpoint: String(protocol.modelsEndpoint ?? '').trim(),
    }))
    .filter(protocol => protocol.id)
}

export function defaultTemplateProtocol(
  template: AIProviderTemplate | null | undefined,
  preferred?: unknown
) {
  const preferredId = normalizeProtocolId(String(preferred ?? ''))
  const protocols = normalizeTemplateProtocols(template)
  if (preferredId && protocols.some(protocol => protocol.id === preferredId)) {
    return preferredId
  }
  const marked = protocols.find(protocol => protocol.default)
  if (marked) return marked.id
  return protocols[0]?.id ?? 'openai'
}

export function protocolEndpointFieldKey(protocolId: string) {
  return `protocol_endpoint_${normalizeProtocolId(protocolId)}`
}

export function resolveTemplateProtocolEndpoint(
  protocol: AIProviderTemplateProtocol,
  values: Record<string, unknown> = {}
) {
  const endpointTemplate = String(protocol.defaultEndpoint ?? '').trim()
  if (!endpointTemplate) return ''
  return endpointTemplate.replaceAll(/\{([^}]+)\}/g, (_match, key: string) => {
    const resolved = String(values[key] ?? '').trim()
    if (resolved) return resolved
    if (key === 'region') return 'us-east-1'
    return ''
  })
}

function resolveTemplateEndpointString(
  endpointTemplate: string,
  values: Record<string, unknown> = {}
) {
  const trimmedTemplate = String(endpointTemplate ?? '').trim()
  if (!trimmedTemplate) return ''
  return trimmedTemplate.replaceAll(/\{([^}]+)\}/g, (_match, key: string) => {
    const resolved = String(values[key] ?? '').trim()
    if (resolved) return resolved
    if (key === 'region') return 'us-east-1'
    return ''
  })
}

export function buildProtocolFieldDefaults(
  template: AIProviderTemplate | null | undefined,
  values: Record<string, unknown> = {}
) {
  const protocols = normalizeTemplateProtocols(template)
  const defaultProtocol = defaultTemplateProtocol(template)
  const defaults: Record<string, unknown> = {
    default_protocol: defaultProtocol,
  }
  for (const protocol of protocols) {
    const resolvedProtocolEndpoint = resolveTemplateProtocolEndpoint(protocol, values)
    defaults[protocolEndpointFieldKey(protocol.id)] =
      resolvedProtocolEndpoint ||
      (protocol.id === defaultProtocol
        ? resolveTemplateEndpointString(String(template?.defaultEndpoint ?? ''), values)
        : '')
  }
  return defaults
}

export function resolveCurrentProtocolEndpoint(
  template: AIProviderTemplate | null | undefined,
  values: Record<string, unknown>
) {
  const defaultProtocol = defaultTemplateProtocol(template, values.default_protocol)
  return String(values[protocolEndpointFieldKey(defaultProtocol)] ?? values.endpoint ?? '').trim()
}

export function resolveProviderDefaultProtocol(
  item: AIProviderRecord,
  template?: AIProviderTemplate | null
) {
  const configured = normalizeProtocolId(String(item.config?.default_protocol ?? ''))
  return defaultTemplateProtocol(template ?? null, configured)
}

export function resolveProviderProtocolEndpoints(
  item: AIProviderRecord,
  template?: AIProviderTemplate | null
) {
  const defaultProtocol = resolveProviderDefaultProtocol(item, template)
  const result: Record<string, string> = {}
  const raw = item.config?.protocol_endpoints
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const normalizedKey = normalizeProtocolId(key)
      const trimmedValue = String(value ?? '').trim()
      if (normalizedKey && trimmedValue) {
        result[normalizedKey] = trimmedValue
      }
    }
  }
  const activeEndpoint = String(item.endpoint ?? '').trim()
  if (defaultProtocol && activeEndpoint && !result[defaultProtocol]) {
    result[defaultProtocol] = activeEndpoint
  }
  return result
}

export function isGatewayProviderTemplate(template: AIProviderTemplate | null | undefined) {
  return (
    String(template?.providerMode ?? '')
      .trim()
      .toLowerCase() === 'gateway'
  )
}

export function isGenericOpenAICompatibleTemplate(template: AIProviderTemplate | null | undefined) {
  return String(template?.id ?? '').trim() === 'generic-llm'
}

export function isUserSuppliedEndpointTemplate(template: AIProviderTemplate | null | undefined) {
  return (
    String(template?.endpointMode ?? '')
      .trim()
      .toLowerCase() === 'user_supplied'
  )
}

export function shouldPromoteEndpointField(template: AIProviderTemplate | null | undefined) {
  return (
    isGenericOpenAICompatibleTemplate(template) ||
    providerSelectionGroupKey(template) === 'selfHosted' ||
    isUserSuppliedEndpointTemplate(template)
  )
}

export function providerSelectionGroupKey(
  template: AIProviderTemplate | null | undefined
): AIProviderSelectionGroupKey {
  const group = String(template?.uiGroup ?? '')
    .trim()
    .toLowerCase()
  if (group === 'cloud_gateway') return 'cloudGateway'
  if (group === 'self_hosted') return 'selfHosted'
  if (group === 'single_provider') return 'singleProvider'
  if (isGatewayProviderTemplate(template)) return 'cloudGateway'
  return 'singleProvider'
}

export function providerSelectionGroup(template: AIProviderTemplate) {
  const group = providerSelectionGroupKey(template)
  if (group === 'cloudGateway') return 'LLM Gateway'
  if (group === 'selfHosted') return 'Self-Hosted LLM Gateway'
  return 'Single Provider'
}

export function normalizeEnabledModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .filter((item, index, input) => input.indexOf(item) === index)
}

export function sanitizeProviderModelOptions<TModel extends ProviderModelLike>(
  value: TModel[] | null | undefined
): Array<TModel & { id: string }> {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const models: Array<TModel & { id: string }> = []
  for (const item of value) {
    const id = String(item?.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ ...item, id })
  }
  return models
}

export function sanitizeProviderModelGroups<TModel extends ProviderModelLike>(
  value: Array<ProviderModelGroupLike<TModel>> | null | undefined
): Array<{ label: string; vendor: string; models: Array<TModel & { id: string }> }> {
  if (!Array.isArray(value)) return []
  return value
    .map(group => {
      const label = String(group?.label ?? group?.vendor ?? 'Other').trim() || 'Other'
      const vendor = String(group?.vendor ?? group?.label ?? 'Other').trim() || 'Other'
      const models = sanitizeProviderModelOptions(group?.models ?? [])
      return { label, vendor, models }
    })
    .filter(group => group.models.length > 0)
}

export function reconcileProviderModelSelection(
  selected: unknown,
  availableModelIDs: Iterable<string>
): string[] {
  const available = new Set(
    Array.from(availableModelIDs, value => String(value ?? '').trim()).filter(Boolean)
  )
  return normalizeEnabledModels(selected).filter(model => available.has(model))
}

export function resolveTemplateEndpoint(
  template: AIProviderTemplate | null | undefined,
  values: Record<string, unknown> = {}
) {
  const protocol = defaultTemplateProtocol(template, values.default_protocol)
  const configured = String(values[protocolEndpointFieldKey(protocol)] ?? '').trim()
  if (configured) return configured
  const protocolConfig = normalizeTemplateProtocols(template).find(item => item.id === protocol)
  if (protocolConfig) {
    const resolvedProtocolEndpoint = resolveTemplateProtocolEndpoint(protocolConfig, values)
    if (resolvedProtocolEndpoint) {
      return resolvedProtocolEndpoint
    }
  }
  return resolveTemplateEndpointString(String(template?.defaultEndpoint ?? ''), values)
}

export function regenerateTemplateEndpoint(
  template: AIProviderTemplate | null | undefined,
  values: Record<string, unknown> = {}
) {
  const protocol = defaultTemplateProtocol(template, values.default_protocol)
  const nextValues = { ...values }

  delete nextValues.endpoint
  delete nextValues[protocolEndpointFieldKey(protocol)]

  return resolveTemplateEndpoint(template, nextValues)
}

export function inferAWSRegionFromEndpoint(endpoint: string) {
  const raw = endpoint.trim().toLowerCase()
  if (!raw) return ''
  const match = raw.match(/bedrock(?:-mantle|-runtime)?\.([a-z0-9-]+)\./)
  return match?.[1] ?? ''
}

export function slugifyNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildDefaultProviderName(template: AIProviderTemplate) {
  const base = slugifyNamePart(productTitle(template)) || 'ai-provider'
  return `${base}-${Date.now().toString().slice(-4)}`
}

export function isAdvancedProviderField(field: AIProviderTemplateField) {
  const normalizedId = field.id.trim().toLowerCase()
  const normalizedLabel = String(field.label ?? '')
    .trim()
    .toLowerCase()
  return (
    normalizedId === 'apiversion' ||
    normalizedId === 'api_version' ||
    normalizedId === 'max_completion_tokens' ||
    normalizedId === 'maxcompletiontokens' ||
    normalizedLabel === 'api version'
  )
}

export function normalizeTemplateFieldDefault(field: AIProviderTemplateField) {
  if (field.default === undefined) {
    if (field.type === 'boolean') return false
    return ''
  }
  if (field.type === 'json' && typeof field.default !== 'string') {
    return JSON.stringify(field.default, null, 2)
  }
  return field.default
}

export function resolveAIProviderEnabled(value: unknown) {
  return resolveEnabledFlag(value)
}

export function shouldAssignDefaultReplica(
  templateId: unknown,
  providers: AIProviderRecord[]
): boolean {
  const normalizedTemplateId = normalizeTemplateID(templateId)
  if (!normalizedTemplateId) return false
  const siblings = providers.filter(
    provider => normalizeTemplateID(provider.template_id) === normalizedTemplateId
  )
  if (siblings.length === 0) return true
  return !siblings.some(provider => provider.is_default === true)
}

export async function buildAIProviderPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, AIProviderTemplate>,
  t?: Translate
): Promise<ResourceSaveInput & { enabled_models?: string[]; is_default?: boolean }> {
  const body = { ...payload }
  const templateId = normalizeTemplateID(body.template_id)
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error(t ? t('aiProviders.errors.profileRequired') : 'AI Provider profile is required')
  }

  const credentialField = (template.fields ?? []).find(field => field.id === 'credential')
  const manualCredentialValue = String(body.api_key_value ?? '').trim()
  const existingCredentialId = String(body.credential ?? '').trim()

  if (!existingCredentialId && manualCredentialValue) {
    const providerName = String(body.name ?? '').trim()
    const createdSecret = await pb.collection('secrets').create({
      name: `${slugifyNamePart(providerName || productTitle(template)) || 'ai-provider'}-api-key`,
      description: t
        ? t('aiProviders.secret.generatedDescription', {
            name: providerName || productTitle(template),
          })
        : `API key for ${providerName || productTitle(template)}`,
      template_id: AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
      scope: 'global',
      visible_to: ['ai_provider'],
      payload: { value: manualCredentialValue },
    })
    body.credential = String(createdSecret.id ?? '')
  }

  for (const field of template.fields ?? []) {
    if (field.type !== 'secret_ref' || field.id === 'credential') {
      continue
    }
    const secretId = String(body[field.id] ?? '').trim()
    const manualValue = String(
      body[aiProviderSecretFieldManualValueKey(field.id)] ??
        body[aiProviderSecretFieldInlineValueKey(field.id)] ??
        ''
    ).trim()
    if (secretId || !manualValue) {
      continue
    }
    const providerName = String(body.name ?? '').trim()
    const createdSecret = await pb.collection('secrets').create({
      name: `${slugifyNamePart(providerName || productTitle(template)) || 'ai-provider'}-${slugifyNamePart(field.id) || 'secret'}`,
      description: t
        ? t('aiProviders.secret.generatedDescription', {
            name: providerName || productTitle(template),
          })
        : `${field.label || field.id} for ${providerName || productTitle(template)}`,
      template_id: field.secretTemplate || AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
      scope: 'global',
      visible_to: ['ai_provider'],
      payload: { value: manualValue },
    })
    body[field.id] = String(createdSecret.id ?? '')
  }

  const credentialId = String(body.credential ?? '').trim()
  if (credentialField?.required && !credentialId) {
    throw new Error(
      t
        ? t('aiProviders.errors.fieldRequired', {
            field: credentialField.label || t('aiProviders.fields.apiKey'),
          })
        : `${credentialField.label || 'API Key'} is required`
    )
  }

  const authScheme = String(template.defaultAuthScheme ?? 'none').trim() || 'none'

  const extra =
    typeof body.advanced_config === 'string' ? body.advanced_config.trim() : body.advanced_config
  let config: Record<string, unknown> = {}
  if (!(extra === '' || extra == null)) {
    config =
      typeof extra === 'string' ? JSON.parse(extra) : cloneConfig(extra as Record<string, unknown>)
  }

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

  const enabledModels = normalizeEnabledModels(body.enabled_models)
  if (enabledModels.length > 0) {
    config.enabled_models = enabledModels
  } else {
    delete config.enabled_models
  }

  const defaultProtocol = defaultTemplateProtocol(template, body.default_protocol)
  const protocolEndpoints: Record<string, string> = {}
  for (const protocol of normalizeTemplateProtocols(template)) {
    const endpoint = String(body[protocolEndpointFieldKey(protocol.id)] ?? '').trim()
    if (endpoint) {
      protocolEndpoints[protocol.id] = endpoint
    }
  }
  const activeEndpoint =
    protocolEndpoints[defaultProtocol] ||
    String(body.endpoint ?? template.defaultEndpoint ?? '').trim()
  config.default_protocol = defaultProtocol
  if (Object.keys(protocolEndpoints).length > 0) {
    config.protocol_endpoints = protocolEndpoints
  } else {
    delete config.protocol_endpoints
  }

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
    ...(body.is_enabled !== undefined
      ? { is_enabled: resolveAIProviderEnabled(body.is_enabled) }
      : {}),
    ...(body.is_default !== undefined ? { is_default: body.is_default === true } : {}),
    template_id: template.id,
    endpoint: activeEndpoint,
    auth_scheme: authScheme,
    credential: credentialId,
    enabled_models: enabledModels,
    config,
    description: String(body.description ?? ''),
  }
}
