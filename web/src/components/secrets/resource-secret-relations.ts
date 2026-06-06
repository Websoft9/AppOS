import {
  buildResourceSecretRelationApiPath,
  type ResourceSecretVisibleTo,
} from './SecretVisibilityField'

const USER_VISIBLE_SECRET_TEMPLATE_IDS = ['single_value'] as const
const USER_VISIBLE_SECRET_TEMPLATE_ID_SET = new Set<string>(USER_VISIBLE_SECRET_TEMPLATE_IDS)

function resolveSecretTemplateId(secretTemplate?: string) {
  const normalized = String(secretTemplate ?? '').trim()
  if (!normalized) {
    return ''
  }
  return USER_VISIBLE_SECRET_TEMPLATE_ID_SET.has(normalized) ? normalized : ''
}

export function buildUserVisibleSecretRelationApiPath(
  visibleTo: ResourceSecretVisibleTo,
  options?: {
    secretTemplate?: string
    fallbackTemplateIds?: string[]
  }
) {
  const explicit = resolveSecretTemplateId(options?.secretTemplate)
  const templateIds = explicit
    ? [explicit]
    : options?.fallbackTemplateIds?.length
      ? options.fallbackTemplateIds
      : [...USER_VISIBLE_SECRET_TEMPLATE_IDS]

  return buildResourceSecretRelationApiPath({ visibleTo, templateIds })
}

export const DEFAULT_USER_VISIBLE_SECRET_TEMPLATE_IDS = [...USER_VISIBLE_SECRET_TEMPLATE_IDS]