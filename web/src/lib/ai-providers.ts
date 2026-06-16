import { pb } from '@/lib/pb'

export type AIProviderRecord = {
  id: string
  name?: string
  kind?: string
  is_enabled?: boolean
  is_default?: boolean
  template_id?: string
  endpoint?: string
  auth_scheme?: string
  provider_account?: string
  credential?: string
  enabled_models?: string[]
  config?: Record<string, unknown>
  description?: string
  created?: string
  updated?: string
}

export type AIProviderTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  secretTemplate?: string
  placeholder?: string
  helpUrl?: string
  helpText?: string
  default?: unknown
}

export type AIProviderTemplate = {
  id: string
  kind: string
  title: string
  vendor?: string
  providerMode?: string
  description?: string
  helpUrl?: string
  contextSize?: number
  modelsEndpoint?: string
  defaultEndpoint?: string
  defaultAuthScheme?: string
  defaultEnabledModels?: string[]
  capabilities?: string[]
  fields?: AIProviderTemplateField[]
}

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

export function formatSecretLabel(raw: Record<string, unknown>): string {
  return String(raw.name ?? raw.id)
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

export function isGatewayProviderTemplate(template: AIProviderTemplate | null | undefined) {
  return (
    String(template?.providerMode ?? '')
      .trim()
      .toLowerCase() === 'gateway'
  )
}

export function providerSelectionGroup(template: AIProviderTemplate) {
  return isGatewayProviderTemplate(template) ? 'LLM Gateway' : 'Provider'
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
  const endpointTemplate = String(template?.defaultEndpoint ?? '').trim()
  if (!endpointTemplate) return ''
  return endpointTemplate.replaceAll(/\{([^}]+)\}/g, (_match, key: string) => {
    const resolved = String(values[key] ?? '').trim()
    if (resolved) return resolved
    if (key === 'region') return 'us-east-1'
    return ''
  })
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
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'false') return false
    if (normalized === 'true') return true
  }
  if (typeof value === 'number') return value !== 0
  return true
}

function resolveAuthScheme(template: AIProviderTemplate, secretTemplateId: string) {
  const defaultAuthScheme = String(template.defaultAuthScheme ?? 'none').trim() || 'none'
  if (secretTemplateId === AI_PROVIDER_CREDENTIAL_TEMPLATE_ID) {
    return defaultAuthScheme !== 'none' ? defaultAuthScheme : 'bearer'
  }
  return defaultAuthScheme
}

export async function buildAIProviderPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, AIProviderTemplate>,
  t?: Translate
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error(t ? t('aiProviders.errors.profileRequired') : 'AI Provider profile is required')
  }

  const credentialField = (template.fields ?? []).find(field => field.id === 'credential')
  const useCredentialReference = Boolean(body.credential_use_secret)
  const manualCredentialValue = String(body.api_key_value ?? '').trim()

  if (!useCredentialReference && manualCredentialValue) {
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

  let authScheme = template.defaultAuthScheme ?? 'none'
  if (credentialId) {
    const secret = await pb.collection('secrets').getOne(credentialId)
    const secretTemplateId = String(secret.template_id ?? '')
    authScheme = resolveAuthScheme(template, secretTemplateId)
  }

  const extra =
    typeof body.advanced_config === 'string' ? body.advanced_config.trim() : body.advanced_config
  let config: Record<string, unknown> = {}
  if (!(extra === '' || extra == null)) {
    config = typeof extra === 'string' ? JSON.parse(extra) : (extra as Record<string, unknown>)
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

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
    ...(body.is_enabled !== undefined
      ? { is_enabled: resolveAIProviderEnabled(body.is_enabled) }
      : {}),
    template_id: template.id,
    endpoint: String(body.endpoint ?? template.defaultEndpoint ?? ''),
    auth_scheme: authScheme,
    credential: credentialId,
    enabled_models: enabledModels,
    config,
    description: String(body.description ?? ''),
  }
}
