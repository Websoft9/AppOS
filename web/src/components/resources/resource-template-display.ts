export type ResourceTemplateDisplayShape = {
  id: string
  kind: string
  title: string
  category?: string
  vendor?: string
  description?: string
}

type Translate = (key: string, options?: Record<string, unknown>) => string

type ResourceTemplateDisplayOptions<T extends ResourceTemplateDisplayShape> = {
  namespace: string
  kindLabels: Record<string, string>
  categoryLabels: Record<string, string>
  isGenericTitle: (template: T, resolvedKindLabel: string) => boolean
}

function titleCaseFallback(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

export function buildResourceKindLabel<T extends ResourceTemplateDisplayShape>(
  kind: string,
  t: Translate,
  options: ResourceTemplateDisplayOptions<T>
) {
  const normalized = String(kind).trim().toLowerCase()
  if (options.kindLabels[normalized]) {
    return t(`${options.namespace}.kinds.${normalized}`)
  }
  return normalized ? titleCaseFallback(normalized) : t(`${options.namespace}.kinds.unknown`)
}

export function buildResourceCategoryLabel<T extends ResourceTemplateDisplayShape>(
  category: string | undefined,
  t: Translate,
  options: ResourceTemplateDisplayOptions<T>
) {
  const normalized = String(category ?? '')
    .trim()
    .toLowerCase()
  if (options.categoryLabels[normalized]) {
    return t(`${options.namespace}.categories.${normalized}`)
  }
  return t(`${options.namespace}.categories.other`)
}

export function isGenericResourceTemplate<T extends ResourceTemplateDisplayShape>(
  template: T,
  t: Translate,
  options: ResourceTemplateDisplayOptions<T>
) {
  const normalizedTitle = template.title.trim().toLowerCase()
  const resolvedKindLabel = buildResourceKindLabel(template.kind, t, options)
  return (
    template.id.startsWith('generic-') ||
    normalizedTitle.includes('generic') ||
    options.isGenericTitle(template, resolvedKindLabel)
  )
}

export function buildResourceProductTitle<T extends ResourceTemplateDisplayShape>(
  template: T,
  t: Translate,
  options: ResourceTemplateDisplayOptions<T>
) {
  return isGenericResourceTemplate(template, t, options)
    ? buildResourceKindLabel(template.kind, t, options)
    : template.title
}

export function buildResourceProductMeta<T extends ResourceTemplateDisplayShape>(
  template: T,
  t: Translate,
  options: ResourceTemplateDisplayOptions<T>
) {
  return [buildResourceCategoryLabel(template.category, t, options), template.vendor]
    .filter(Boolean)
    .join(' · ')
}

export function buildResourceProductDescription<T extends ResourceTemplateDisplayShape>(
  template: T,
  t: Translate,
  options: ResourceTemplateDisplayOptions<T>
) {
  if (isGenericResourceTemplate(template, t, options)) {
    return t(`${options.namespace}.product.standardTemplate`)
  }

  return (
    template.description ||
    t(`${options.namespace}.product.profileDescription`, {
      vendorPrefix: template.vendor ? `${template.vendor} ` : '',
      category: buildResourceCategoryLabel(template.category, t, options).toLowerCase(),
    })
  )
}