import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Power, PowerOff } from 'lucide-react'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { Badge } from '@/components/ui/badge'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { ResourcesBreadcrumb } from '@/components/resources/ResourcesBreadcrumb'
import { buildUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'
import { pb } from '@/lib/pb'

type ProviderAccountRecord = {
  id: string
  name?: string
  kind?: string
  is_enabled?: boolean
  template_id?: string
  identifier?: string
  credential?: string
  config?: Record<string, unknown>
  description?: string
}

type ProviderAccountTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  placeholder?: string
  helpText?: string
  default?: unknown
}

type ProviderAccountTemplate = {
  id: string
  category?: string
  kind: string
  title: string
  vendor?: string
  description?: string
  fields?: ProviderAccountTemplateField[]
}

type Translate = (key: string, options?: Record<string, unknown>) => string

const CATEGORY_LABELS: Record<string, string> = {
  cloud: 'Cloud Platforms',
  'developer-platform': 'Developer Platforms',
  edge: 'Edge Platforms',
}

const KIND_LABELS: Record<string, string> = {
  aws: 'AWS',
  aliyun: 'Aliyun',
  azure: 'Azure',
  gcp: 'Google Cloud',
  github: 'GitHub',
  cloudflare: 'Cloudflare',
}

function normalizeTemplateFieldDefault(field: ProviderAccountTemplateField) {
  if (field.default === undefined) {
    return ''
  }
  return field.default
}

function resolveProviderAccountEnabled(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  }
  if (typeof value === 'number') return value !== 0
  return true
}

function kindLabel(kind: string, t: Translate) {
  const normalized = String(kind).trim().toLowerCase()
  if (KIND_LABELS[normalized]) {
    return t(`platformAccounts.kinds.${normalized}`)
  }
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : t('platformAccounts.kinds.unknown')
}

function isGenericTemplate(template: ProviderAccountTemplate, t: Translate) {
  const normalizedTitle = template.title.trim().toLowerCase()
  const genericTitle = `${kindLabel(template.kind, t).toLowerCase()} account`
  return (
    template.id.startsWith('generic-') ||
    normalizedTitle.includes('generic') ||
    normalizedTitle === genericTitle
  )
}

function productTitle(template: ProviderAccountTemplate, t: Translate) {
  return isGenericTemplate(template, t) ? kindLabel(template.kind, t) : template.title
}

function categoryLabel(category: string | undefined, t: Translate) {
  const normalized = String(category ?? '')
    .trim()
    .toLowerCase()
  if (CATEGORY_LABELS[normalized]) {
    return t(`platformAccounts.categories.${normalized}`)
  }
  return t('platformAccounts.categories.other')
}

function productMeta(template: ProviderAccountTemplate, t: Translate) {
  return [categoryLabel(template.category, t), template.vendor].filter(Boolean).join(' · ')
}

function productDescription(template: ProviderAccountTemplate, t: Translate) {
  if (isGenericTemplate(template, t)) {
    return t('platformAccounts.product.standardTemplate')
  }
  return (
    template.description ||
    t('platformAccounts.product.profileDescription', {
      vendorPrefix: template.vendor ? `${template.vendor} ` : '',
      category: categoryLabel(template.category, t).toLowerCase(),
    })
  )
}

function mapTemplateFieldToResourceField(field: ProviderAccountTemplateField): FieldDef {
  return {
    key: field.id,
    label: field.label,
    type: 'text',
    required: field.required,
    placeholder: field.placeholder,
    defaultValue: normalizeTemplateFieldDefault(field),
  }
}

async function buildProviderAccountPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, ProviderAccountTemplate>
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error('Platform account profile is required')
  }

  const config: Record<string, unknown> = {}
  let identifier = ''
  for (const field of template.fields ?? []) {
    const value = body[field.id]
    if (value === undefined || value === '') {
      continue
    }
    if (field.id === 'identifier') {
      identifier = String(value)
      continue
    }
    config[field.id] = value
  }

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
    ...(body.is_enabled !== undefined
      ? { is_enabled: resolveProviderAccountEnabled(body.is_enabled) }
      : {}),
    template_id: template.id,
    identifier,
    credential: String(body.credential ?? ''),
    config,
    description: String(body.description ?? ''),
  }
}

function mapProviderAccountRow(
  item: ProviderAccountRecord,
  templatesById: Map<string, ProviderAccountTemplate>,
  t: Translate
): Record<string, unknown> {
  const template = templatesById.get(String(item.template_id ?? ''))
  const flattenedConfig: Record<string, unknown> = {}

  for (const field of template?.fields ?? []) {
    if (field.id === 'identifier') {
      continue
    }
    const value = item.config?.[field.id]
    if (value === undefined) {
      continue
    }
    flattenedConfig[field.id] = value
  }

  return {
    id: item.id,
    name: String(item.name ?? ''),
    kind: String(item.kind ?? ''),
    is_enabled: resolveProviderAccountEnabled(item.is_enabled),
    enabled_status: resolveProviderAccountEnabled(item.is_enabled) ? 'Enabled' : 'Disabled',
    kind_label: kindLabel(String(item.kind ?? ''), t),
    template_id: String(item.template_id ?? ''),
    profile: template?.title ?? String(item.template_id ?? ''),
    identifier: String(item.identifier ?? ''),
    credential: String(item.credential ?? ''),
    description: String(item.description ?? ''),
    ...flattenedConfig,
  }
}

function buildColumns(t: Translate, onToggleEnabled: (item: Record<string, unknown>) => void): Column[] {
  return [
    { key: 'name', label: t('platformAccounts.columns.name') },
    {
      key: 'enabled_status',
      label: t('platformAccounts.columns.enabled'),
      sortable: true,
      filterOptions: [
        { label: t('platformAccounts.enabled.yes'), value: 'Enabled' },
        { label: t('platformAccounts.enabled.no'), value: 'Disabled' },
      ],
      filterValue: row => String(row.enabled_status ?? ''),
      render: (_value, row) => {
        const enabled = resolveProviderAccountEnabled(row.is_enabled)
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
            title={enabled ? t('platformAccounts.actions.disable') : t('platformAccounts.actions.enable')}
          >
            {enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
            {enabled ? t('platformAccounts.enabled.yes') : t('platformAccounts.enabled.no')}
          </button>
        )
      },
    },
    {
      key: 'kind_label',
      label: t('platformAccounts.columns.platform'),
      render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
    },
    { key: 'profile', label: t('platformAccounts.columns.profile') },
    { key: 'identifier', label: t('platformAccounts.columns.identifier') },
  ]
}

export function PlatformAccountsPage() {
  const { t } = useTranslation('resources')
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [providerAccountTemplates, setProviderAccountTemplates] = useState<
    ProviderAccountTemplate[]
  >([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <ResourcesBreadcrumb
        parentLabel={t('hub.title')}
        currentPage={t('platformAccounts.page.title')}
      />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent, t])

  useEffect(() => {
    void (async () => {
      try {
        const data = await pb.send<ProviderAccountTemplate[]>('/api/provider-accounts/templates', {
          method: 'GET',
        })
        setProviderAccountTemplates(Array.isArray(data) ? data : [])
      } catch {
        setProviderAccountTemplates([])
      }
    })()
  }, [])

  const templatesById = useMemo(
    () => new Map(providerAccountTemplates.map(template => [template.id, template])),
    [providerAccountTemplates]
  )

  const buildBaseFields = useCallback(
    (selectedTemplate: ProviderAccountTemplate | null) =>
      [
        {
          key: 'kind',
          label: t('platformAccounts.fields.platform'),
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.kind ?? '',
        },
        {
          key: 'template_id',
          label: t('platformAccounts.fields.template'),
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.id ?? '',
        },
        {
          key: 'selected_product',
          label: t('platformAccounts.fields.selectedProduct'),
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productTitle(selectedTemplate, t) : '',
        },
        {
          key: 'selected_product_meta',
          label: t('platformAccounts.fields.selectedProductMeta'),
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productMeta(selectedTemplate, t) : '',
        },
        {
          key: 'selected_product_description',
          label: t('platformAccounts.fields.selectedProductDescription'),
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productDescription(selectedTemplate, t) : '',
        },
        {
          key: 'name',
          label: t('platformAccounts.fields.name'),
          type: 'text',
          required: true,
          placeholder: t('platformAccounts.placeholders.name'),
        },
        {
          key: 'credential',
          label: t('platformAccounts.fields.credential'),
          type: 'relation',
          relationApiPath: buildUserVisibleSecretRelationApiPath('provider_account'),
          relationLabelKey: 'name',
        },
        {
          key: 'description',
          label: t('platformAccounts.fields.description'),
          type: 'textarea',
        },
        {
          key: 'groups',
          label: t('platformAccounts.fields.groups'),
          type: 'relation',
          multiSelect: true,
          relationAutoSelectDefault: true,
          relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
          relationLabelKey: 'name',
          defaultValue: [],
        },
      ] satisfies FieldDef[],
    [t]
  )

  const productOptions = useMemo(
    () =>
      [...providerAccountTemplates]
        .sort((left, right) => {
          const genericCompare =
            Number(isGenericTemplate(right, t)) - Number(isGenericTemplate(left, t))
          if (genericCompare !== 0) return genericCompare
          return productTitle(left, t).localeCompare(productTitle(right, t))
        })
        .map(template => ({
          id: template.id,
          title: productTitle(template, t),
          description: productDescription(template, t),
          meta: productMeta(template, t),
          searchText: [
            template.title,
            template.vendor,
            template.kind,
            categoryLabel(template.category, t),
          ].join(' '),
        })),
    [providerAccountTemplates, t]
  )

  const resolveProviderAccountFields = useCallback(
    ({ formData }: { formData: Record<string, unknown> }) => {
      const selectedTemplateId = String(formData.template_id ?? '')
      const selectedTemplate = templatesById.get(selectedTemplateId)
      const baseFields = buildBaseFields(selectedTemplate ?? null)
      const dynamicFields = (selectedTemplate?.fields ?? []).map(mapTemplateFieldToResourceField)

      return [
        baseFields[0],
        baseFields[1],
        baseFields[2],
        baseFields[3],
        baseFields[4],
        baseFields[5],
        ...dynamicFields,
        ...baseFields.slice(6),
      ]
    },
    [buildBaseFields, templatesById]
  )

  const bootstrapFields = useMemo(() => buildBaseFields(null), [buildBaseFields])
  const handleToggleEnabled = useCallback(
    async (item: Record<string, unknown>) => {
      const accountId = String(item.id ?? '')
      if (!accountId) return
      const body = await buildProviderAccountPayload(
        { ...item, is_enabled: !resolveProviderAccountEnabled(item.is_enabled) },
        templatesById
      )
      await pb.send(`/api/provider-accounts/${accountId}`, { method: 'PUT', body })
      setRefreshKey(current => current + 1)
    },
    [templatesById]
  )
  const columns = useMemo(() => buildColumns(t, handleToggleEnabled), [handleToggleEnabled, t])

  return (
    <ResourcePage
      config={{
        title: t('platformAccounts.page.title'),
        description: t('platformAccounts.page.description'),
        apiPath: '/api/provider-accounts',
        columns,
        fields: bootstrapFields,
        createSelection: {
          title: t('platformAccounts.selection.title'),
          description: t('platformAccounts.selection.description'),
          searchPlaceholder: t('platformAccounts.selection.searchPlaceholder'),
          emptyMessage: t('platformAccounts.selection.emptyMessage'),
          options: productOptions,
          onSelect: optionId => {
            const selectedTemplate = templatesById.get(optionId)
            if (!selectedTemplate) return {}

            const defaults: Record<string, unknown> = {
              kind: selectedTemplate.kind,
              template_id: selectedTemplate.id,
              selected_product: productTitle(selectedTemplate, t),
              selected_product_meta: productMeta(selectedTemplate, t),
              selected_product_description: productDescription(selectedTemplate, t),
            }

            for (const field of selectedTemplate.fields ?? []) {
              defaults[field.id] = normalizeTemplateFieldDefault(field)
            }

            return defaults
          },
        },
        dialogContentClassName: 'sm:max-w-4xl',
        resolveFields: resolveProviderAccountFields,
        resourceType: 'provider_account',
        autoCreate,
        enableGroupAssign: true,
        refreshKey,
        listItems: async () => {
          const items = await pb.send<ProviderAccountRecord[]>('/api/provider-accounts', {
            method: 'GET',
          })
          return Array.isArray(items)
            ? items.map(item => mapProviderAccountRow(item, templatesById, t))
            : []
        },
        createItem: async payload => {
          const body = await buildProviderAccountPayload(payload, templatesById)
          const created = await pb.send<ProviderAccountRecord>('/api/provider-accounts', {
            method: 'POST',
            body,
          })
          return mapProviderAccountRow(created, templatesById, t)
        },
        updateItem: async (id, payload) => {
          const body = await buildProviderAccountPayload(payload, templatesById)
          await pb.send(`/api/provider-accounts/${id}`, { method: 'PUT', body })
        },
        deleteItem: async id => {
          await pb.send(`/api/provider-accounts/${id}`, { method: 'DELETE' })
        },
      }}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/resources/platform-accounts')({
  component: PlatformAccountsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: typeof search.create === 'string' ? search.create : undefined,
  }),
})
