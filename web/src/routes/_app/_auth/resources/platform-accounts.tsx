import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { pb } from '@/lib/pb'

type ProviderAccountRecord = {
  id: string
  name?: string
  kind?: string
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

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
}

function isGenericTemplate(template: ProviderAccountTemplate) {
  const normalizedTitle = template.title.trim().toLowerCase()
  const genericTitle = `${kindLabel(template.kind).toLowerCase()} account`
  return (
    template.id.startsWith('generic-') ||
    normalizedTitle.includes('generic') ||
    normalizedTitle === genericTitle
  )
}

function productTitle(template: ProviderAccountTemplate) {
  return isGenericTemplate(template) ? kindLabel(template.kind) : template.title
}

function categoryLabel(category?: string) {
  return CATEGORY_LABELS[String(category ?? '')] ?? 'Other'
}

function productMeta(template: ProviderAccountTemplate) {
  return [categoryLabel(template.category), template.vendor].filter(Boolean).join(' · ')
}

function productDescription(template: ProviderAccountTemplate) {
  if (isGenericTemplate(template)) {
    return 'Standard template'
  }
  return (
    template.description ||
    `${template.vendor ? `${template.vendor} ` : ''}${categoryLabel(template.category).toLowerCase()} profile.`
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
    template_id: template.id,
    identifier,
    credential: String(body.credential ?? ''),
    config,
    description: String(body.description ?? ''),
  }
}

function mapProviderAccountRow(
  item: ProviderAccountRecord,
  templatesById: Map<string, ProviderAccountTemplate>
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
    kind_label: kindLabel(String(item.kind ?? '')),
    template_id: String(item.template_id ?? ''),
    profile: template?.title ?? String(item.template_id ?? ''),
    identifier: String(item.identifier ?? ''),
    credential: String(item.credential ?? ''),
    description: String(item.description ?? ''),
    ...flattenedConfig,
  }
}

const columns: Column[] = [
  { key: 'name', label: 'Name' },
  {
    key: 'kind_label',
    label: 'Platform',
    render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
  },
  { key: 'profile', label: 'Profile' },
  { key: 'identifier', label: 'Identifier' },
]

export function PlatformAccountsPage() {
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [providerAccountTemplates, setProviderAccountTemplates] = useState<
    ProviderAccountTemplate[]
  >([])

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
          label: 'Platform',
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.kind ?? '',
        },
        {
          key: 'template_id',
          label: 'Template',
          type: 'text',
          hidden: true,
          defaultValue: selectedTemplate?.id ?? '',
        },
        {
          key: 'selected_product',
          label: 'Selected Product',
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productTitle(selectedTemplate) : '',
        },
        {
          key: 'selected_product_meta',
          label: 'Selected Product Meta',
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productMeta(selectedTemplate) : '',
        },
        {
          key: 'selected_product_description',
          label: 'Selected Product Description',
          type: 'text',
          hidden: true,
          readOnly: true,
          defaultValue: selectedTemplate ? productDescription(selectedTemplate) : '',
        },
        { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'aws-prod' },
        {
          key: 'credential',
          label: 'Credential',
          type: 'relation',
          relationApiPath: '/api/collections/secrets/records?perPage=500&sort=name',
          relationLabelKey: 'name',
        },
        { key: 'description', label: 'Description', type: 'textarea' },
        {
          key: 'groups',
          label: 'Groups',
          type: 'relation',
          multiSelect: true,
          relationAutoSelectDefault: true,
          relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
          relationLabelKey: 'name',
          defaultValue: [],
        },
      ] satisfies FieldDef[],
    []
  )

  const productOptions = useMemo(
    () =>
      [...providerAccountTemplates]
        .sort((left, right) => {
          const genericCompare = Number(isGenericTemplate(right)) - Number(isGenericTemplate(left))
          if (genericCompare !== 0) return genericCompare
          return productTitle(left).localeCompare(productTitle(right))
        })
        .map(template => ({
          id: template.id,
          title: productTitle(template),
          description: productDescription(template),
          meta: productMeta(template),
          searchText: [
            template.title,
            template.vendor,
            template.kind,
            categoryLabel(template.category),
          ].join(' '),
        })),
    [providerAccountTemplates]
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

  return (
    <ResourcePage
      config={{
        title: 'Platform Accounts',
        description:
          'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platform identities with profile-based templates.',
        apiPath: '/api/provider-accounts',
        columns,
        fields: bootstrapFields,
        createSelection: {
          title: 'Choose a Product',
          description: 'Choose a product, then enter account details.',
          searchPlaceholder: 'Search products like AWS, GitHub, Azure, Cloudflare...',
          emptyMessage: 'No matching products found.',
          options: productOptions,
          onSelect: optionId => {
            const selectedTemplate = templatesById.get(optionId)
            if (!selectedTemplate) return {}

            const defaults: Record<string, unknown> = {
              kind: selectedTemplate.kind,
              template_id: selectedTemplate.id,
              selected_product: productTitle(selectedTemplate),
              selected_product_meta: productMeta(selectedTemplate),
              selected_product_description: productDescription(selectedTemplate),
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
        parentNav: { label: 'Resources', href: '/resources' },
        autoCreate,
        enableGroupAssign: true,
        listItems: async () => {
          const items = await pb.send<ProviderAccountRecord[]>('/api/provider-accounts', {
            method: 'GET',
          })
          return Array.isArray(items)
            ? items.map(item => mapProviderAccountRow(item, templatesById))
            : []
        },
        createItem: async payload => {
          const body = await buildProviderAccountPayload(payload, templatesById)
          const created = await pb.send<ProviderAccountRecord>('/api/provider-accounts', {
            method: 'POST',
            body,
          })
          return mapProviderAccountRow(created, templatesById)
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
