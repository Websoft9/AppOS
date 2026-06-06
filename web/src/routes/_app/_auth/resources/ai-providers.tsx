import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
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
import { buildUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'
import { getLocale } from '@/lib/i18n'
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

type Translate = (key: string, options?: Record<string, unknown>) => string

const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Token / Single Value',
}

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

function isAdvancedProviderField(field: AIProviderTemplateField) {
  const normalizedId = field.id.trim().toLowerCase()
  const normalizedLabel = String(field.label ?? '')
    .trim()
    .toLowerCase()
  return (
    normalizedId === 'apiversion' ||
    normalizedId === 'api_version' ||
    normalizedLabel === 'api version'
  )
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
  const locale = getLocale()
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function normalizeReachabilityStatus(value: unknown, t: Translate) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'reachable') return t('aiProviders.status.reachable')
  if (normalized === 'unreachable') return t('aiProviders.status.unreachable')
  return t('aiProviders.status.unknown')
}

function resolveReachability(item: AIProviderRecord, t: Translate) {
  const config = item.config ?? {}
  const reachability = config.reachability
  if (reachability && typeof reachability === 'object') {
    return normalizeReachabilityStatus((reachability as Record<string, unknown>).status, t)
  }
  return normalizeReachabilityStatus(config.reachability_status, t)
}

function mapTemplateFieldToResourceField(
  field: AIProviderTemplateField,
  openSecretDialog: (callbacks: { addOption: (id: string, label: string) => void }) => void,
  openSecretEditor: (secretId: string) => void,
  t: Translate
): FieldDef {
  if (field.type === 'secret_ref') {
    return {
      key: field.id,
      label: field.label,
      type: 'relation',
      required: field.required,
      relationApiPath: buildUserVisibleSecretRelationApiPath('ai_provider', {
        secretTemplate: field.secretTemplate,
      }),
      relationFormatLabel: formatSecretLabel,
      relationCreateButton: {
        label: t('aiProviders.secret.new'),
        onClick: openSecretDialog,
      },
      relationEditButton: {
        label: t('aiProviders.secret.edit'),
        onClick: openSecretEditor,
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
  templatesById: Map<string, AIProviderTemplate>,
  t: Translate
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
    reachability: resolveReachability(item, t),
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

function buildColumns(t: Translate): Column[] {
  return [
    { key: 'name', label: t('aiProviders.columns.name'), searchable: true, sortable: true },
    { key: 'profile', label: t('aiProviders.columns.profile'), searchable: true, sortable: true },
    {
      key: 'reachability',
      label: t('aiProviders.columns.reachability'),
      sortable: true,
      filterOptions: [
        { label: t('aiProviders.status.reachable'), value: t('aiProviders.status.reachable') },
        { label: t('aiProviders.status.unreachable'), value: t('aiProviders.status.unreachable') },
        { label: t('aiProviders.status.unknown'), value: t('aiProviders.status.unknown') },
      ],
      render: value => {
        const status = normalizeReachabilityStatus(value, t)
        const variant =
          status === t('aiProviders.status.reachable')
            ? 'default'
            : status === t('aiProviders.status.unreachable')
              ? 'destructive'
              : 'secondary'
        return <Badge variant={variant}>{status}</Badge>
      },
    },
    {
      key: 'endpoint',
      label: t('aiProviders.columns.endpoint'),
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
      label: t('aiProviders.columns.created'),
      sortable: true,
      render: value => formatDateTime(value),
    },
    {
      key: 'updated',
      label: t('aiProviders.columns.updated'),
      sortable: true,
      render: value => formatDateTime(value),
    },
  ]
}

export function AIProvidersPage() {
  const { t } = useTranslation('resources')
  const navigate = useNavigate()
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
          searchText: [template.title, template.vendor, template.description, template.id].join(
            ' '
          ),
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

  const openSecretEditor = useCallback(
    (secretId: string) => {
      const targetUrl = new URL('/secrets', window.location.origin)
      targetUrl.searchParams.set('id', secretId)
      targetUrl.searchParams.set('edit', secretId)
      const opened = window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer')
      if (!opened) {
        void navigate({
          to: '/secrets' as never,
          search: { id: secretId, edit: secretId } as never,
        })
      }
    },
    [navigate]
  )

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
          manualPlaceholder={t('aiProviders.credential.enterField', {
            field: String(field.label ?? t('aiProviders.fields.apiKey')),
          })}
          showLabel={t('aiProviders.credential.showField', {
            field: String(field.label ?? t('aiProviders.fields.apiKey')),
          })}
          hideLabel={t('aiProviders.credential.hideField', {
            field: String(field.label ?? t('aiProviders.fields.apiKey')),
          })}
          generateValue={buildApiKeyValue}
          generatorTitle={t('aiProviders.credential.generateTitle')}
          generatorDescription={t('aiProviders.credential.generateDescription')}
          generatorLengthLabel={t('aiProviders.credential.generateLengthLabel')}
          generatorConfirmLabel={t('aiProviders.credential.generateConfirmLabel')}
        />
      )
    },
    [openSecretDialog, openSecretEditor, t]
  )

  const baseProviderFields = useMemo<FieldDef[]>(
    () => [
      {
        key: 'name',
        label: t('aiProviders.fields.name'),
        type: 'text',
        required: true,
        placeholder: t('aiProviders.placeholders.name'),
      },
      {
        key: 'template_id',
        label: t('aiProviders.fields.profile'),
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
      {
        key: 'description',
        label: t('aiProviders.fields.description'),
        type: 'textarea',
        advanced: true,
      },
      {
        key: 'selected_product',
        label: t('aiProviders.fields.selectedProduct'),
        type: 'text',
        hidden: true,
      },
      {
        key: 'selected_product_meta',
        label: t('aiProviders.fields.selectedProductMeta'),
        type: 'text',
        hidden: true,
      },
      {
        key: 'selected_product_description',
        label: t('aiProviders.fields.selectedProductDescription'),
        type: 'text',
        hidden: true,
      },
      {
        key: 'title_name_editing',
        label: t('aiProviders.fields.titleNameEditing'),
        type: 'boolean',
        hidden: true,
        defaultValue: false,
      },
      {
        key: 'credential_use_secret',
        label: t('aiProviders.fields.credentialUseSecret'),
        type: 'boolean',
        hidden: true,
        defaultValue: false,
      },
      {
        key: 'api_key_value',
        label: t('aiProviders.fields.apiKeyValue'),
        type: 'password',
        hidden: true,
        defaultValue: '',
      },
      {
        key: 'advanced_config',
        label: t('aiProviders.fields.advancedConfig'),
        type: 'textarea',
        placeholder: t('aiProviders.placeholders.advancedConfig'),
        advanced: true,
      },
      {
        key: 'groups',
        label: t('aiProviders.fields.groups'),
        type: 'relation',
        advanced: true,
        multiSelect: true,
        relationAutoSelectDefault: true,
        relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
        relationLabelKey: 'name',
        defaultValue: [],
      },
    ],
    [providerProfileOptions, providerTemplatesById, t]
  )

  const resolveProviderFields = useCallback(
    ({
      formData,
      editingItem,
    }: {
      formData: Record<string, unknown>
      editingItem: Record<string, unknown> | null
    }) => {
      const selectedTemplate = providerTemplatesById.get(String(formData.template_id ?? ''))
      const dynamicFields = (selectedTemplate?.fields ?? []).map(field => {
        if (field.id === 'credential') {
          return {
            key: field.id,
            label: field.label,
            type: 'relation',
            required: field.required,
            relationApiPath: buildUserVisibleSecretRelationApiPath('ai_provider', {
              secretTemplate: AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
            }),
            relationFormatLabel: formatSecretLabel,
            relationCreateButton: {
              label: 'New Secret',
              onClick: openSecretDialog,
            },
            render: renderCredentialField,
          } satisfies FieldDef
        }

        return mapTemplateFieldToResourceField(field, openSecretDialog, openSecretEditor, t)
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
    [
      baseProviderFields,
      openSecretDialog,
      openSecretEditor,
      providerTemplatesById,
      renderCredentialField,
      t,
    ]
  )

  const columns = useMemo(() => buildColumns(t), [t])

  return (
    <>
      <ResourcePage
        config={{
          title: t('aiProviders.page.title'),
          description: t('aiProviders.page.description'),
          emptyStateLabel: t('aiProviders.page.emptyState'),
          apiPath: '/api/ai-providers',
          columns,
          fields: baseProviderFields,
          searchPlaceholder: t('aiProviders.page.searchPlaceholder'),
          pageSize: 10,
          pageSizeOptions: [10, 20, 50],
          defaultSort: { key: 'name', dir: 'asc' },
          headerFilters: true,
          listControlsBorder: false,
          listControlsShowReset: false,
          pageSizeSelectorPlacement: 'footer',
          paginationSummary: false,
          createSelection: {
            title: t('aiProviders.selection.title'),
            description: t('aiProviders.selection.description'),
            searchPlaceholder: t('aiProviders.selection.searchPlaceholder'),
            emptyMessage: t('aiProviders.selection.emptyMessage'),
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
                        aria-label={t('aiProviders.dialog.providerTitle')}
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
                        title={t('aiProviders.dialog.applyTitle')}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => updateField('title_name_editing', false)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="max-w-full truncate text-xl font-semibold">
                        {providerName || t('aiProviders.dialog.newProvider')}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={t('aiProviders.dialog.editTitle')}
                        onClick={() => updateField('title_name_editing', true)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ),
              description: `${editingItem ? t('aiProviders.dialog.update') : t('aiProviders.dialog.add')} ${productTitle(selectedTemplate)} ${t('aiProviders.dialog.suffix')}`,
              hideSelectedProductSummary: true,
            }
          },
          resolveFields: resolveProviderFields,
          resourceType: 'ai_provider',
          parentNav: { label: t('hub.title'), href: '/resources' },
          autoCreate,
          enableGroupAssign: true,
          createButtonLabel: t('aiProviders.page.addProvider'),
          createButtonShowIcon: false,
          dialogContentClassName: 'sm:max-w-4xl',
          showRefreshButton: true,
          refreshButtonLabel: t('aiProviders.page.refresh'),
          refreshButtonIconOnly: true,
          refreshButtonShowIcon: true,
          wrapTableInCard: false,
          listItems: async () => {
            const items = await pb.send<AIProviderRecord[]>('/api/ai-providers', {
              method: 'GET',
            })
            return Array.isArray(items)
              ? items.map(item => mapAIProviderRow(item, providerTemplatesById, t))
              : []
          },
          createItem: async payload => {
            const body = await buildAIProviderPayload(payload, providerTemplatesById, t)
            const created = await pb.send<AIProviderRecord>('/api/ai-providers', {
              method: 'POST',
              body,
            })
            return mapAIProviderRow(created, providerTemplatesById, t)
          },
          updateItem: async (id, payload) => {
            const body = await buildAIProviderPayload(payload, providerTemplatesById, t)
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
        title={t('aiProviders.secret.newTitle')}
        description={t('aiProviders.secret.newDescription')}
        allowedTemplateIds={[AI_PROVIDER_CREDENTIAL_TEMPLATE_ID]}
        templateLabels={{ single_value: t('aiProviders.secret.singleValueTemplate') }}
        defaultTemplateId={AI_PROVIDER_CREDENTIAL_TEMPLATE_ID}
        defaultVisibleTo={['ai_provider']}
        onCreated={({ id, name, templateId }) => {
          const suffix =
            templateId === AI_PROVIDER_CREDENTIAL_TEMPLATE_ID
              ? t('aiProviders.secret.singleValueTemplate')
              : SECRET_TEMPLATE_LABELS[templateId]
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
