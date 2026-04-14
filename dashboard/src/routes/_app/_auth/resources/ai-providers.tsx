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
import { buildApiKeyValue, SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { pb } from '@/lib/pb'

type AIProviderRecord = {
  id: string
  name?: string
  kind?: string
  template_id?: string
  endpoint?: string
  auth_scheme?: string
  credential?: string
  config?: Record<string, unknown>
  description?: string
  created?: string
  updated?: string
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
  contextSize?: number
  defaultEndpoint?: string
  defaultAuthScheme?: string
  capabilities?: string[]
  fields?: AIProviderTemplateField[]
}

const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Token / Single Value',
}

const SECRET_TEMPLATE_IDS = new Set(Object.keys(SECRET_TEMPLATE_LABELS))

const AI_PROVIDER_CREDENTIAL_TEMPLATE_ID = 'single_value'

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

function chooserTitle(template: AIProviderTemplate) {
  return String(template.vendor ?? '').trim() || productTitle(template)
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
  return SECRET_TEMPLATE_IDS.has(normalized) ? normalized : ''
}

function buildSecretRelationApiPath(secretTemplate?: string) {
  const explicit = resolveSecretTemplateId(secretTemplate)
  const templateIds = explicit ? [explicit] : Array.from(SECRET_TEMPLATE_IDS)
  const filter = templateIds.map(id => `template_id='${id}'`).join('||')
  return `/api/collections/secrets/records?filter=(status='active'%26%26(${filter}))&sort=name`
}

function isAdvancedProviderField(field: AIProviderTemplateField) {
  const normalizedId = field.id.trim().toLowerCase()
  const normalizedLabel = String(field.label ?? '')
    .trim()
    .toLowerCase()
  return normalizedId === 'apiversion' || normalizedId === 'api_version' || normalizedLabel === 'api version'
}

function resolveAuthScheme(template: AIProviderTemplate, secretTemplateId: string) {
  const defaultAuthScheme = String(template.defaultAuthScheme ?? 'none').trim() || 'none'
  if (secretTemplateId === AI_PROVIDER_CREDENTIAL_TEMPLATE_ID) {
    return defaultAuthScheme !== 'none' ? defaultAuthScheme : 'bearer'
  }
  return defaultAuthScheme
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

function formatDateTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function normalizeReachabilityStatus(value: unknown) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'reachable') return 'Reachable'
  if (normalized === 'unreachable') return 'Unreachable'
  return 'Unknown'
}

function resolveReachability(item: AIProviderRecord) {
  const config = item.config ?? {}
  const reachability = config.reachability
  if (reachability && typeof reachability === 'object') {
    return normalizeReachabilityStatus((reachability as Record<string, unknown>).status)
  }
  return normalizeReachabilityStatus(config.reachability_status)
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
    advanced: isAdvancedProviderField(field),
  }
}

export async function buildAIProviderPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, AIProviderTemplate>
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error('AI Provider profile is required')
  }

  const credentialField = (template.fields ?? []).find(field => field.id === 'credential')
  const useCredentialReference = Boolean(body.credential_use_secret)
  const manualCredentialValue = String(body.api_key_value ?? '').trim()

  if (!useCredentialReference && manualCredentialValue) {
    const providerName = String(body.name ?? '').trim()
    const createdSecret = await pb.collection('secrets').create({
      name: `${slugifyNamePart(providerName || productTitle(template)) || 'ai-provider'}-api-key`,
      description: `API key for ${providerName || productTitle(template)}`,
      template_id: AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
      scope: 'global',
      payload: { value: manualCredentialValue },
    })
    body.credential = String(createdSecret.id ?? '')
  }

  const credentialId = String(body.credential ?? '').trim()
  if (credentialField?.required && !credentialId) {
    throw new Error(`${credentialField.label || 'API Key'} is required`)
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

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
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
    template_id: String(item.template_id ?? ''),
    profile: template?.title ?? humanizeTemplateId(String(item.template_id ?? '')),
    reachability: resolveReachability(item),
    endpoint: String(item.endpoint ?? ''),
    credential: String(item.credential ?? ''),
    credential_use_secret: Boolean(String(item.credential ?? '').trim()),
    api_key_value: '',
    description: String(item.description ?? ''),
    created: String(item.created ?? ''),
    updated: String(item.updated ?? ''),
    advanced_config:
      Object.keys(advancedConfig).length > 0 ? JSON.stringify(advancedConfig, null, 2) : '',
    ...flattenedConfig,
  }
}

const columns: Column[] = [
  { key: 'name', label: 'Name', searchable: true, sortable: true },
  { key: 'profile', label: 'Profile', searchable: true, sortable: true },
  {
    key: 'reachability',
    label: 'Reachability',
    sortable: true,
    filterOptions: [
      { label: 'Reachable', value: 'Reachable' },
      { label: 'Unreachable', value: 'Unreachable' },
      { label: 'Unknown', value: 'Unknown' },
    ],
    render: value => {
      const status = normalizeReachabilityStatus(value)
      const variant =
        status === 'Reachable' ? 'default' : status === 'Unreachable' ? 'destructive' : 'secondary'
      return <Badge variant={variant}>{status}</Badge>
    },
  },
  {
    key: 'endpoint',
    label: 'Endpoint',
    searchable: true,
    sortable: true,
    render: value => (
      <span className="block max-w-[220px] truncate" title={String(value || '')}>
        {String(value || '—')}
      </span>
    ),
  },
  {
    key: 'created',
    label: 'Created',
    sortable: true,
    render: value => formatDateTime(value),
  },
  {
    key: 'updated',
    label: 'Updated',
    sortable: true,
    render: value => formatDateTime(value),
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
      [...providerTemplates]
        .sort((left, right) => {
          const leftIsOpenAICompatible = left.id === 'generic-llm'
          const rightIsOpenAICompatible = right.id === 'generic-llm'
          if (leftIsOpenAICompatible !== rightIsOpenAICompatible) {
            return leftIsOpenAICompatible ? 1 : -1
          }
          const leftInitial = chooserTitle(left).trim().charAt(0).toLowerCase()
          const rightInitial = chooserTitle(right).trim().charAt(0).toLowerCase()
          return leftInitial.localeCompare(rightInitial, undefined, { sensitivity: 'base' })
        })
        .map(template => ({
          id: template.id,
          title: chooserTitle(template),
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

  const openSecretEditor = useCallback((secretId: string) => {
    const targetUrl = new URL('/secrets', window.location.origin)
    targetUrl.searchParams.set('id', secretId)
    targetUrl.searchParams.set('edit', secretId)
    const opened = window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer')
    if (!opened) {
      window.location.assign(targetUrl.toString())
    }
  }, [])

  const renderCredentialField = useCallback(
    ({
      field,
      inputId,
      formData,
      editingItem,
      updateField,
      relationOptions,
      addRelationOption,
    }: Parameters<NonNullable<FieldDef['render']>>[0]) => {
      const editMode = Boolean(editingItem)
      const useSecret = editMode ? true : Boolean(formData.credential_use_secret)

      return (
        <SecretCredentialField
          inputId={inputId}
          manualValue={String(formData.api_key_value ?? '')}
          onManualValueChange={value => updateField('api_key_value', value)}
          useReference={useSecret}
          onUseReferenceChange={checked => {
            updateField('credential_use_secret', checked)
            if (!checked) {
              updateField('credential', '')
            }
          }}
          referenceValue={String(formData.credential ?? '')}
          onReferenceValueChange={value => updateField('credential', value)}
          options={relationOptions}
          onCreateReference={() => {
            openSecretDialog({
              addOption: (id, label) => {
                addRelationOption(id, label)
                updateField('credential_use_secret', true)
                updateField('credential', id)
              },
            })
          }}
          onEditReference={openSecretEditor}
          editMode={editMode}
          manualPlaceholder={`Enter ${String(field.label ?? 'API Key')}`}
          showLabel={`Show ${String(field.label ?? 'API Key')}`}
          hideLabel={`Hide ${String(field.label ?? 'API Key')}`}
          generateValue={buildApiKeyValue}
          generatorTitle="Generate API Key"
          generatorDescription="Choose the API key length before filling the field."
          generatorLengthLabel="API Key Length"
          generatorConfirmLabel="Fill API Key"
        />
      )
    },
    [openSecretDialog, openSecretEditor]
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
      { key: 'description', label: 'Description', type: 'textarea', advanced: true },
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
        key: 'credential_use_secret',
        label: 'Credential Use Secret',
        type: 'boolean',
        hidden: true,
        defaultValue: false,
      },
      {
        key: 'api_key_value',
        label: 'API Key Value',
        type: 'password',
        hidden: true,
        defaultValue: '',
      },
      {
        key: 'advanced_config',
        label: 'Advanced Config (JSON)',
        type: 'textarea',
        placeholder: '{"temperature": 0.2}',
        advanced: true,
      },
      {
        key: 'groups',
        label: 'Groups',
        type: 'relation',
        advanced: true,
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
      const dynamicFields = (selectedTemplate?.fields ?? []).map(field => {
        if (field.id === 'credential') {
          return {
            key: field.id,
            label: field.label,
            type: 'relation',
            required: field.required,
            relationApiPath: buildSecretRelationApiPath(AI_PROVIDER_CREDENTIAL_TEMPLATE_ID),
            relationFormatLabel: formatSecretLabel,
            relationCreateButton: {
              label: 'New Secret',
              onClick: openSecretDialog,
            },
            render: renderCredentialField,
          } satisfies FieldDef
        }

        return mapTemplateFieldToResourceField(field, openSecretDialog)
      })

      if (editingItem) {
        return [
          baseProviderFields[0],
          baseProviderFields[1],
          ...dynamicFields,
          baseProviderFields[2],
          ...baseProviderFields.slice(7),
        ]
      }

      return [
        baseProviderFields[0],
        ...baseProviderFields.slice(2, 9),
        ...dynamicFields,
        ...baseProviderFields.slice(9),
      ]
    },
    [baseProviderFields, openSecretDialog, providerTemplatesById, renderCredentialField]
  )

  return (
    <>
      <ResourcePage
        config={{
          title: 'AI Providers',
          description:
            'Hosted and local AI provider definitions such as OpenAI, Anthropic, OpenRouter, and Ollama endpoints.',
          emptyStateLabel: 'No AI Providers found',
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
                selected_product: chooserTitle(selectedTemplate),
                selected_product_meta: '',
                selected_product_description: '',
                endpoint: selectedTemplate.defaultEndpoint ?? '',
                credential_use_secret: false,
                api_key_value: '',
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
          dialogContentClassName: 'sm:max-w-4xl',
          showRefreshButton: true,
          refreshButtonLabel: 'Refresh',
          refreshButtonIconOnly: true,
          refreshButtonShowIcon: true,
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
        allowedTemplateIds={[AI_PROVIDER_CREDENTIAL_TEMPLATE_ID]}
        templateLabels={SECRET_TEMPLATE_LABELS}
        defaultTemplateId={AI_PROVIDER_CREDENTIAL_TEMPLATE_ID}
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
  validateSearch: (search: Record<string, unknown>) => ({
    create: typeof search.create === 'string' ? search.create : undefined,
  }),
})