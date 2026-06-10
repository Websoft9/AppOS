import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AIProviderCreateFlowDialog } from '@/components/ai/AIProviderCreateFlowDialog'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { Activity, Check, Loader2, Pencil, Power, PowerOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  ResourcePage,
  type Column,
  type FieldDef,
  type SelectOption,
} from '@/components/resources/ResourcePage'
import { ResourcesBreadcrumb } from '@/components/resources/ResourcesBreadcrumb'
import { buildApiKeyValue, SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { buildUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'
import {
  AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
  SECRET_TEMPLATE_LABELS,
  buildAIProviderPayload,
  formatSecretLabel,
  type AIProviderRecord,
  type AIProviderTemplate,
  type AIProviderTemplateField,
  isAdvancedProviderField,
  normalizeTemplateFieldDefault,
  normalizeEnabledModels,
  providerSelectionGroup,
  productTitle,
  resolveAIProviderEnabled,
} from '@/lib/ai-providers'
import { getLocale } from '@/lib/i18n'
import { pb } from '@/lib/pb'

type Translate = (key: string, options?: Record<string, unknown>) => string

type ConnectionSummaryState = {
  loading?: boolean
  error?: string
  models?: string[]
} | null

type ProviderModelOption = {
  id: string
  label?: string
  vendor?: string
  enabled_by_default?: boolean
}

type ProviderModelGroup = {
  vendor: string
  label: string
  models: ProviderModelOption[]
}

type ProviderModelsResponse = {
  models: ProviderModelOption[]
  groups?: ProviderModelGroup[]
}

function humanizeTemplateId(templateId: string) {
  return templateId
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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

function normalizeEnabledStatus(value: unknown) {
  return resolveAIProviderEnabled(value) ? 'Enabled' : 'Disabled'
}

function renderConnectionSummary(state: ConnectionSummaryState) {
  if (!state) return null
  if (state.loading) {
    return (
      <div className="rounded-lg border bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Testing connection...
        </div>
      </div>
    )
  }
  if (state.error) {
    return (
      <div className="rounded-lg border bg-destructive/10 px-4 py-3">
        <div className="text-sm text-destructive">{state.error}</div>
      </div>
    )
  }
  if (state.models && state.models.length > 0) {
    return (
      <div className="rounded-lg border bg-emerald-50/40 px-4 py-3 dark:bg-emerald-950/10">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-emerald-700 dark:text-emerald-300">
            {state.models.length} model{state.models.length === 1 ? '' : 's'} available
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {state.models.map(model => (
            <span
              key={model}
              className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium"
            >
              {model}
            </span>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-lg border bg-amber-50/40 px-4 py-3 dark:bg-amber-950/10">
      <div className="text-sm text-amber-700 dark:text-amber-300">No models returned</div>
    </div>
  )
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

export { buildAIProviderPayload }

function mapAIProviderRow(
  item: AIProviderRecord,
  templatesById: Map<string, AIProviderTemplate>,
  t: Translate,
  reachabilityOverrides?: Map<string, string>
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
    Object.entries(item.config ?? {}).filter(
      ([key]) => !knownFieldIDs.has(key) && key !== 'enabled_models'
    )
  )

  const enabledModels = normalizeEnabledModels(item.enabled_models ?? item.config?.enabled_models)

  return {
    id: item.id,
    name: String(item.name ?? ''),
    template_id: String(item.template_id ?? ''),
    provider: template?.title ?? humanizeTemplateId(String(item.template_id ?? '')),
    is_enabled: resolveAIProviderEnabled(item.is_enabled ?? item.config?.is_enabled),
    enabled_status: normalizeEnabledStatus(item.is_enabled ?? item.config?.is_enabled),
    reachability:
      reachabilityOverrides?.get(String(item.id ?? '')) ?? resolveReachability(item, t),
    endpoint: String(item.endpoint ?? ''),
    credential: String(item.credential ?? ''),
    credential_use_secret: Boolean(String(item.credential ?? '').trim()),
    api_key_value: '',
    enabled_models: enabledModels,
    description: String(item.description ?? ''),
    created: String(item.created ?? ''),
    updated: String(item.updated ?? ''),
    advanced_config:
      Object.keys(advancedConfig).length > 0 ? JSON.stringify(advancedConfig, null, 2) : '',
    ...flattenedConfig,
  }
}

function buildColumns(
  t: Translate,
  providerOptions: SelectOption[],
  onNameClick: (id: string) => void
): Column[] {
  return [
    {
      key: 'name',
      label: t('aiProviders.columns.name'),
      searchable: true,
      sortable: true,
      render: (value, row) => {
        const id = String(row.id ?? '')
        return (
          <button
            type="button"
            className="font-medium text-foreground transition-colors hover:text-primary"
            onClick={() => onNameClick(id)}
          >
            {String(value ?? '—')}
          </button>
        )
      },
    },
    {
      key: 'provider',
      label: 'Provider',
      searchable: true,
      sortable: true,
      filterOptions: providerOptions,
      filterValue: row => String(row.provider ?? ''),
    },
    {
      key: 'enabled_status',
      label: 'Status',
      sortable: true,
      filterOptions: [
        { label: 'Enabled', value: 'Enabled' },
        { label: 'Disabled', value: 'Disabled' },
      ],
      filterValue: row => String(row.enabled_status ?? ''),
      render: (_value, row) => {
        const status = normalizeEnabledStatus(row.is_enabled)
        return <Badge variant={status === 'Enabled' ? 'default' : 'secondary'}>{status}</Badge>
      },
    },
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
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
  const navigate = useNavigate()
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [createOpen, setCreateOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [providerTemplates, setProviderTemplates] = useState<AIProviderTemplate[]>([])
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)
  const [editTestResult, setEditTestResult] = useState<ConnectionSummaryState>(null)
  const [editModelGroups, setEditModelGroups] = useState<ProviderModelGroup[]>([])
  const [expandedEditVendor, setExpandedEditVendor] = useState<string | null>(null)
  const [editModelsValidated, setEditModelsValidated] = useState(false)
  const [listTestState, setListTestState] = useState<{
    providerId: string
    summary: ConnectionSummaryState
  } | null>(null)
  const [expandedListTestId, setExpandedListTestId] = useState<string | null>(null)
  const [pendingEditId, setPendingEditId] = useState<string | undefined>(undefined)

  const handleEditTestConnection = useCallback(async (editingItem: Record<string, unknown> | null) => {
    const providerId = String(editingItem?.id ?? '')
    if (!providerId) return
    setEditTestResult({ loading: true })
    setEditModelsValidated(false)
    try {
      const result = await pb.send<ProviderModelsResponse>(
        `/api/ai-providers/models/${providerId}`,
        { method: 'GET' }
      )
      const models = (result?.models ?? []).map(model => model.id).filter(Boolean)
      setEditModelGroups(Array.isArray(result?.groups) ? result.groups : [])
      setExpandedEditVendor(prev => prev ?? result?.groups?.[0]?.vendor ?? null)
      setEditModelsValidated(true)
      setEditTestResult({ models })
    } catch (err) {
      setEditModelGroups([])
      setExpandedEditVendor(null)
      setEditTestResult({ error: err instanceof Error ? err.message : 'Connection test failed' })
    }
  }, [])

  const handleListTestConnection = useCallback(async (item: Record<string, unknown>) => {
    const providerId = String(item.id ?? '')
    if (!providerId) return
    setExpandedListTestId(providerId)
    setListTestState({ providerId, summary: { loading: true } })
    try {
      const result = await pb.send<{ models: Array<{ id: string }> }>(
        `/api/ai-providers/models/${providerId}`,
        { method: 'GET' }
      )
      const models = (result?.models ?? []).map(model => model.id).filter(Boolean)
      setListTestState({ providerId, summary: { models } })
    } catch (err) {
      setListTestState({
        providerId,
        summary: { error: err instanceof Error ? err.message : 'Connection test failed' },
      })
    }
  }, [])

  const openEditor = useCallback((id: string) => {
    setPendingEditId(id)
  }, [])

  const handleNameClick = useCallback(
    (id: string) => {
      if (listTestState?.providerId === id) {
        setExpandedListTestId(current => (current === id ? null : id))
        return
      }
      openEditor(id)
    },
    [listTestState?.providerId, openEditor]
  )

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <ResourcesBreadcrumb
        parentLabel={t('hub.title')}
        currentPage={t('aiProviders.page.title')}
      />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent, t])

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
        group: providerSelectionGroup(template),
      })),
    [providerTemplates]
  )

  const providerFilterOptions = useMemo<SelectOption[]>(
    () =>
      providerTemplates.map(template => ({
        label: template.title,
        value: template.title,
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

  const renderEnabledModelsField = useCallback<NonNullable<FieldDef['render']>>(
    ({ formData, updateField }) => {
      const selectedModels = normalizeEnabledModels(formData.enabled_models)

      if (editModelGroups.length === 0) {
        return (
          <div className="space-y-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            <div>Run Test Connection to load the live gateway model inventory.</div>
            {selectedModels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedModels.map(model => (
                  <span
                    key={model}
                    className="inline-flex items-center rounded-full border bg-muted/30 px-2.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {model}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )
      }

      return (
        <div className="space-y-3 rounded-lg border px-3 py-3">
          <div className="flex flex-wrap gap-1.5">
            {editModelGroups.map(group => (
              <button
                key={group.vendor}
                type="button"
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${expandedEditVendor === group.vendor ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
                onClick={() => setExpandedEditVendor(current => current === group.vendor ? null : group.vendor)}
              >
                {group.label}
              </button>
            ))}
          </div>

          {editModelGroups
            .filter(group => group.vendor === expandedEditVendor)
            .map(group => (
              <div key={group.vendor} className="space-y-2 rounded-md border bg-muted/10 p-3">
                {group.models.map(model => {
                  const checked = selectedModels.includes(model.id)
                  return (
                    <label
                      key={model.id}
                      className="flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 text-sm hover:bg-background"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-input"
                        checked={checked}
                        onChange={() => {
                          updateField(
                            'enabled_models',
                            checked
                              ? selectedModels.filter(item => item !== model.id)
                              : [...selectedModels, model.id]
                          )
                        }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{model.id}</div>
                        {model.enabled_by_default ? (
                          <div className="text-xs text-muted-foreground">Default whitelist</div>
                        ) : null}
                      </div>
                    </label>
                  )
                })}
              </div>
            ))}

          <p className="text-xs text-muted-foreground">
            Only model selections from a successful Test Connection are written back. If the test
            fails, the existing saved enabled models stay unchanged.
          </p>
        </div>
      )
    },
    [editModelGroups, expandedEditVendor]
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
        label: 'Provider',
        type: 'select',
        required: true,
        options: providerProfileOptions,
        onValueChange: (value, update) => {
          const template = providerTemplatesById.get(String(value ?? ''))
          if (template?.defaultEndpoint) {
            update('endpoint', template.defaultEndpoint)
          }
          update('enabled_models', normalizeEnabledModels(template?.defaultEnabledModels ?? []))
          for (const field of template?.fields ?? []) {
            if (field.default !== undefined) {
              update(field.id, normalizeTemplateFieldDefault(field))
            }
          }
        },
      },
      {
        key: 'is_enabled',
        label: 'Enabled',
        type: 'boolean',
        defaultValue: true,
      },
      {
        key: 'description',
        label: t('aiProviders.fields.description'),
        type: 'textarea',
        advanced: true,
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

      const gatewayEnabledModelsField: FieldDef[] =
        editingItem && selectedTemplate?.providerMode === 'gateway'
          ? [
              {
                key: 'enabled_models',
                label: 'Enabled Models',
                type: 'textarea',
                render: renderEnabledModelsField,
              },
            ]
          : []

      if (editingItem) {
        return [
          { ...baseProviderFields[1], readOnly: true },
          baseProviderFields[2],
          ...dynamicFields,
          ...gatewayEnabledModelsField,
          baseProviderFields[3],
          ...baseProviderFields.slice(5),
        ]
      }

      return [
        baseProviderFields[0],
        ...baseProviderFields.slice(2, 5),
        ...dynamicFields,
        ...baseProviderFields.slice(5),
      ]
    },
    [
      baseProviderFields,
      openSecretDialog,
      openSecretEditor,
      providerTemplatesById,
      renderCredentialField,
      renderEnabledModelsField,
      t,
    ]
  )

  const columns = useMemo(
    () => buildColumns(t, providerFilterOptions, handleNameClick),
    [handleNameClick, providerFilterOptions, t]
  )

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
          expandedRowId: expandedListTestId,
          renderRowDetail: item => {
            const providerId = String(item.id ?? '')
            if (providerId === '' || listTestState?.providerId !== providerId) {
              return null
            }
            return renderConnectionSummary(listTestState.summary)
          },
          cancelLabel: 'Test Connection',
          selectedSummary: renderConnectionSummary(editTestResult),
          onCancel: editingItem => { void handleEditTestConnection(editingItem) },
          onEditOpen: () => {
            setEditTestResult(null)
            setEditModelGroups([])
            setExpandedEditVendor(null)
            setEditModelsValidated(false)
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
          autoCreate,
          initialEditId: pendingEditId,
          onInitialEditHandled: () => setPendingEditId(undefined),
          onCreateClick: () => {
            setEditTestResult(null)
            setListTestState(null)
            setExpandedListTestId(null)
            setCreateOpen(true)
          },
          enableGroupAssign: true,
          createButtonLabel: t('aiProviders.page.addProvider'),
          createButtonShowIcon: false,
          dialogContentClassName: 'sm:max-w-4xl',
          showRefreshButton: true,
          refreshButtonLabel: t('aiProviders.page.refresh'),
          refreshButtonIconOnly: true,
          refreshButtonShowIcon: true,
          wrapTableInCard: false,
          refreshKey,
          listItems: async () => {
            const items = await pb.send<AIProviderRecord[]>('/api/ai-providers', {
              method: 'GET',
            })
            const ids = Array.isArray(items)
              ? items.map(item => String(item.id ?? '')).filter(Boolean)
              : []
            let reachabilityById = new Map<string, string>()
            if (ids.length > 0) {
              try {
                const params = new URLSearchParams({ ids: ids.join(',') })
                const result = await pb.send<{ items?: Array<{ id: string; status: string }> }>(
                  `/api/ai-providers/reachability?${params.toString()}`,
                  { method: 'GET' }
                )
                reachabilityById = new Map(
                  (result.items ?? []).map(entry => [
                    String(entry.id ?? ''),
                    normalizeReachabilityStatus(entry.status, t),
                  ])
                )
              } catch {
                reachabilityById = new Map<string, string>()
              }
            }
            return Array.isArray(items)
              ? items.map(item => mapAIProviderRow(item, providerTemplatesById, t, reachabilityById))
              : []
          },
          updateItem: async (id, payload) => {
            const targetTemplate = providerTemplatesById.get(String(payload.template_id ?? ''))
            const nextPayload = { ...payload }
            if (targetTemplate?.providerMode === 'gateway' && !editModelsValidated) {
              delete nextPayload.enabled_models
            }
            const body = await buildAIProviderPayload(nextPayload, providerTemplatesById, t)
            await pb.send(`/api/ai-providers/${id}`, { method: 'PUT', body })
          },
          extraActions: (item, refreshList) => {
            const providerId = String(item.id ?? '')
            const enabled = resolveAIProviderEnabled(item.is_enabled)
            return (
              <>
                <DropdownMenuItem onClick={() => { void handleListTestConnection(item) }}>
                  <Activity className="h-4 w-4" />
                  Test Connection
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void (async () => {
                      const body = await buildAIProviderPayload(
                        { ...item, is_enabled: !enabled },
                        providerTemplatesById,
                        t
                      )
                      await pb.send(`/api/ai-providers/${providerId}`, {
                        method: 'PUT',
                        body,
                      })
                      await refreshList()
                    })()
                  }}
                >
                  {enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                  {enabled ? 'Disable' : 'Enable'}
                </DropdownMenuItem>
              </>
            )
          },
          deleteItem: async id => {
            await pb.send(`/api/ai-providers/${id}`, { method: 'DELETE' })
          },
        }}
      />

      <AIProviderCreateFlowDialog
        open={createOpen}
        onOpenChange={open => {
          if (open) {
            setEditTestResult(null)
            setListTestState(null)
            setExpandedListTestId(null)
            setEditModelGroups([])
            setExpandedEditVendor(null)
            setEditModelsValidated(false)
          }
          setCreateOpen(open)
        }}
        onCreated={() => {
          setRefreshKey(current => current + 1)
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
