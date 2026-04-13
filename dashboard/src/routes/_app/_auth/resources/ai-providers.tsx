import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResourcePage,
  type Column,
  type FieldDef,
  type SelectOption,
} from '@/components/resources/ResourcePage'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { pb } from '@/lib/pb'

type AIProviderRecord = {
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

type AIProviderTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  secretTemplate?: string
  placeholder?: string
  helpText?: string
  default?: unknown
}

type AIProviderTemplate = {
  id: string
  kind: string
  title: string
  vendor?: string
  description?: string
  defaultEndpoint?: string
  defaultAuthScheme?: string
  capabilities?: string[]
  fields?: AIProviderTemplateField[]
}

const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Token / Single Value',
  api_key: 'API Key',
  basic_auth: 'Basic Auth',
}

const SECRET_TEMPLATE_IDS = new Set(Object.keys(SECRET_TEMPLATE_LABELS))

const SECRET_TEMPLATE_ALIASES: Record<string, string> = {
  bearer_token: 'single_value',
}

function formatSecretLabel(raw: Record<string, unknown>): string {
  const name = String(raw.name ?? raw.id)
  const templateId = String(raw.template_id ?? '')
  const suffix = SECRET_TEMPLATE_LABELS[templateId]
  return suffix ? `${name} (${suffix})` : name
}

function humanizeTemplateId(templateId: string) {
  return templateId
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function slugifyNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function productTitle(template: AIProviderTemplate) {
  return template.title.trim() || humanizeTemplateId(template.id)
}

function productMeta(template: AIProviderTemplate) {
  return [template.vendor, providerType(template)].filter(Boolean).join(' · ')
}

function productDescription(template: AIProviderTemplate) {
  return template.description || `${productTitle(template)} AI provider profile.`
}

function buildDefaultProviderName(template: AIProviderTemplate) {
  const base = slugifyNamePart(productTitle(template)) || 'ai-provider'
  return `${base}-${Date.now().toString().slice(-4)}`
}

function resolveSecretTemplateId(secretTemplate?: string) {
  const normalized = String(secretTemplate ?? '').trim()
  if (!normalized) {
    return ''
  }
  const aliased = SECRET_TEMPLATE_ALIASES[normalized] ?? normalized
  return SECRET_TEMPLATE_IDS.has(aliased) ? aliased : ''
}

function buildSecretRelationApiPath(secretTemplate?: string) {
  const explicit = resolveSecretTemplateId(secretTemplate)
  const templateIds = explicit ? [explicit] : Array.from(SECRET_TEMPLATE_IDS)
  const filter = templateIds.map(id => `template_id='${id}'`).join('||')
  return `/api/collections/secrets/records?filter=(status='active'%26%26(${filter}))&sort=name`
}

function normalizeTemplateFieldDefault(field: AIProviderTemplateField) {
  if (field.default === undefined) {
    if (field.type === 'boolean') return false
    return ''
  }
  if (field.type === 'json' && typeof field.default !== 'string') {
    return JSON.stringify(field.default, null, 2)
  }
  return field.default
}

function mapTemplateFieldToResourceField(
  field: AIProviderTemplateField,
  openSecretDialog: (callbacks: { addOption: (id: string, label: string) => void }) => void
): FieldDef {
  if (field.type === 'secret_ref') {
    return {
      key: field.id,
      label: field.label,
      type: 'relation',
      required: field.required,
      relationApiPath: buildSecretRelationApiPath(field.secretTemplate),
      relationFormatLabel: formatSecretLabel,
      relationCreateButton: {
        label: 'New Secret',
        onClick: openSecretDialog,
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
  }
}

function providerType(template: AIProviderTemplate | undefined) {
  return template?.capabilities?.includes('local') ? 'Local' : 'Hosted'
}

async function buildAIProviderPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, AIProviderTemplate>
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error('AI Provider profile is required')
  }

  const credentialId = String(body.credential ?? '')
  let authScheme = template.defaultAuthScheme ?? 'none'
  if (credentialId) {
    const secret = await pb.collection('secrets').getOne(credentialId)
    const secretTemplateId = String(secret.template_id ?? '')
    const authTypeByTemplate: Record<string, string> = {
      single_value: 'bearer',
      api_key: 'api_key',
      basic_auth: 'basic',
    }
    authScheme = authTypeByTemplate[secretTemplateId] ?? 'bearer'
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

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
    is_default: Boolean(body.is_default),
    template_id: template.id,
    endpoint: String(body.endpoint ?? template.defaultEndpoint ?? ''),
    auth_scheme: authScheme,
    credential: credentialId,
    config,
    description: String(body.description ?? ''),
  }
}

function mapAIProviderRow(
  item: AIProviderRecord,
  templatesById: Map<string, AIProviderTemplate>
): Record<string, unknown> {
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
    provider_type: providerType(template),
    template_id: String(item.template_id ?? ''),
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

const columns: Column[] = [
  { key: 'name', label: 'Name', searchable: true, sortable: true },
  {
    key: 'is_default',
    label: 'Default',
    render: value =>
      value ? <Badge>Default</Badge> : <span className="text-muted-foreground">—</span>,
  },
  {
    key: 'provider_type',
    label: 'Type',
    filterOptions: [
      { label: 'Hosted', value: 'Hosted' },
      { label: 'Local', value: 'Local' },
    ],
    render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
  },
  { key: 'profile', label: 'Profile', searchable: true, sortable: true },
  {
    key: 'endpoint',
    label: 'URL',
    searchable: true,
    sortable: true,
    render: value => (
      <span className="block max-w-[220px] truncate" title={String(value || '')}>
        {String(value || '—')}
      </span>
    ),
  },
  {
    key: 'auth_type',
    label: 'Auth',
    filterOptions: [
      { label: 'None', value: 'none' },
      { label: 'API Key', value: 'api_key' },
      { label: 'Bearer', value: 'bearer' },
      { label: 'Basic', value: 'basic' },
    ],
    render: value => <Badge variant="secondary">{String(value || 'none')}</Badge>,
  },
]

export function AIProvidersPage() {
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [providerTemplates, setProviderTemplates] = useState<AIProviderTemplate[]>([])
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)

  useEffect(() => {
    void (async () => {
      try {
        const data = await pb.send<AIProviderTemplate[]>('/api/ai-providers/templates', {
          method: 'GET',
        })
        setProviderTemplates(Array.isArray(data) ? data : [])
      } catch {
        setProviderTemplates([])
      }
    })()
  }, [])

  const providerTemplatesById = useMemo(
    () => new Map(providerTemplates.map(template => [template.id, template])),
    [providerTemplates]
  )

  const providerProfileOptions = useMemo<SelectOption[]>(
    () =>
      providerTemplates.map(template => ({
        label: template.title,
        value: template.id,
      })),
    [providerTemplates]
  )

  const productOptions = useMemo(
    () =>
      providerTemplates.map(template => ({
        id: template.id,
        title: productTitle(template),
        description: productDescription(template),
        meta: productMeta(template),
        searchText: [template.title, template.vendor, template.description, template.id].join(' '),
      })),
    [providerTemplates]
  )

  const openSecretDialog = useCallback(
    (callbacks: { addOption: (id: string, label: string) => void }) => {
      setSecretAddOption(() => callbacks.addOption)
      setSecretDialogOpen(true)
    },
    []
  )

  const baseProviderFields = useMemo<FieldDef[]>(
    () => [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        required: true,
        placeholder: 'my-ai-provider',
      },
      { key: 'is_default', label: 'Runtime Default', type: 'boolean', defaultValue: false },
      {
        key: 'template_id',
        label: 'Profile',
        type: 'select',
        required: true,
        options: providerProfileOptions,
        onValueChange: (value, update) => {
          const template = providerTemplatesById.get(String(value ?? ''))
          if (template?.defaultEndpoint) {
            update('endpoint', template.defaultEndpoint)
          }
          for (const field of template?.fields ?? []) {
            if (field.default !== undefined) {
              update(field.id, normalizeTemplateFieldDefault(field))
            }
          }
        },
      },
      { key: 'description', label: 'Description', type: 'textarea' },
      {
        key: 'selected_product',
        label: 'Selected Product',
        type: 'text',
        hidden: true,
      },
      {
        key: 'selected_product_meta',
        label: 'Selected Product Meta',
        type: 'text',
        hidden: true,
      },
      {
        key: 'selected_product_description',
        label: 'Selected Product Description',
        type: 'text',
        hidden: true,
      },
      {
        key: 'title_name_editing',
        label: 'Title Name Editing',
        type: 'boolean',
        hidden: true,
        defaultValue: false,
      },
      {
        key: 'advanced_config',
        label: 'Advanced Config (JSON)',
        type: 'textarea',
        placeholder: '{"temperature": 0.2}',
      },
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
    ],
    [providerProfileOptions, providerTemplatesById]
  )

  const resolveProviderFields = useCallback(
    ({ formData, editingItem }: { formData: Record<string, unknown>; editingItem: Record<string, unknown> | null }) => {
      const selectedTemplate = providerTemplatesById.get(String(formData.template_id ?? ''))
      const dynamicFields = (selectedTemplate?.fields ?? []).map(field =>
        mapTemplateFieldToResourceField(field, openSecretDialog)
      )

      if (editingItem) {
        return [
          baseProviderFields[0],
          baseProviderFields[1],
          baseProviderFields[2],
          ...dynamicFields,
          baseProviderFields[3],
          ...baseProviderFields.slice(7),
        ]
      }

      return [
        baseProviderFields[0],
        baseProviderFields[1],
        ...baseProviderFields.slice(3, 7),
        ...dynamicFields,
        ...baseProviderFields.slice(7),
      ]
    },
    [baseProviderFields, openSecretDialog, providerTemplatesById]
  )

  return (
    <>
      <ResourcePage
        config={{
          title: 'AI Providers',
          description:
            'Hosted and local AI provider definitions such as OpenAI, Anthropic, OpenRouter, and Ollama endpoints.',
          apiPath: '/api/ai-providers',
          columns,
          fields: baseProviderFields,
          searchPlaceholder: 'Search any AI providers',
          pageSize: 10,
          pageSizeOptions: [10, 20, 50],
          defaultSort: { key: 'name', dir: 'asc' },
          headerFilters: true,
          listControlsBorder: false,
          listControlsShowReset: false,
          pageSizeSelectorPlacement: 'footer',
          paginationSummary: false,
          createSelection: {
            title: 'Choose a Product',
            description: 'Choose a provider product, then enter connection details.',
            searchPlaceholder: 'Search products like OpenAI, Ollama, Anthropic, OpenRouter...',
            emptyMessage: 'No matching products found.',
            options: productOptions,
            onSelect: optionId => {
              const selectedTemplate = providerTemplatesById.get(optionId)
              if (!selectedTemplate) return {}

              const defaults: Record<string, unknown> = {
                kind: selectedTemplate.kind,
                template_id: selectedTemplate.id,
                name: buildDefaultProviderName(selectedTemplate),
                selected_product: productTitle(selectedTemplate),
                selected_product_meta: productMeta(selectedTemplate),
                selected_product_description: productDescription(selectedTemplate),
                endpoint: selectedTemplate.defaultEndpoint ?? '',
                is_default: false,
                title_name_editing: false,
              }

              for (const field of selectedTemplate.fields ?? []) {
                defaults[field.id] = normalizeTemplateFieldDefault(field)
              }

              return defaults
            },
          },
          dialogHeader: ({ formData, editingItem, updateField, title, description }) => {
            const selectedTemplate = providerTemplatesById.get(String(formData.template_id ?? ''))
            const providerName = String(formData.name ?? '').trim()
            const editingName = Boolean(formData.title_name_editing)

            if (!selectedTemplate) {
              return { title, description, hideSelectedProductSummary: true }
            }

            return {
              title: (
                <div className="flex flex-wrap items-center gap-2">
                  {editingName ? (
                    <div className="flex min-w-[280px] flex-1 items-center gap-2">
                      <Input
                        value={providerName}
                        aria-label="AI provider title"
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
                        title="Apply title"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => updateField('title_name_editing', false)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="max-w-full truncate text-xl font-semibold">
                        {providerName || 'New AI Provider'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Edit title"
                        onClick={() => updateField('title_name_editing', true)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ),
              description: `${editingItem ? 'Update' : 'Add'} ${productTitle(selectedTemplate)} AI Provider`,
              hideSelectedProductSummary: true,
            }
          },
          resolveFields: resolveProviderFields,
          resourceType: 'ai_provider',
          parentNav: { label: 'Resources', href: '/resources' },
          autoCreate,
          enableGroupAssign: true,
          createButtonLabel: 'Add AI Provider',
          createButtonShowIcon: false,
          showRefreshButton: true,
          refreshButtonLabel: 'Refresh',
          refreshButtonIconOnly: false,
          wrapTableInCard: false,
          listItems: async () => {
            const items = await pb.send<AIProviderRecord[]>('/api/ai-providers', {
              method: 'GET',
            })
            return Array.isArray(items)
              ? items.map(item => mapAIProviderRow(item, providerTemplatesById))
              : []
          },
          createItem: async payload => {
            const body = await buildAIProviderPayload(payload, providerTemplatesById)
            const created = await pb.send<AIProviderRecord>('/api/ai-providers', {
              method: 'POST',
              body,
            })
            return mapAIProviderRow(created, providerTemplatesById)
          },
          updateItem: async (id, payload) => {
            const body = await buildAIProviderPayload(payload, providerTemplatesById)
            await pb.send(`/api/ai-providers/${id}`, { method: 'PUT', body })
          },
          deleteItem: async id => {
            await pb.send(`/api/ai-providers/${id}`, { method: 'DELETE' })
          },
        }}
      />

      <SecretCreateDialog
        open={secretDialogOpen}
        onOpenChange={setSecretDialogOpen}
        title="New Secret"
        description="Create a reusable secret and attach it to this AI Provider."
        allowedTemplateIds={Array.from(SECRET_TEMPLATE_IDS)}
        templateLabels={SECRET_TEMPLATE_LABELS}
        defaultTemplateId="api_key"
        onCreated={({ id, name, templateId }) => {
          const suffix = SECRET_TEMPLATE_LABELS[templateId]
          secretAddOption?.(id, suffix ? `${name} (${suffix})` : name)
        }}
      />
    </>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/ai-providers')({
  component: AIProvidersPage,
})