import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, ExternalLink, Loader2, Pencil } from 'lucide-react'
import {
  AIProviderModelSelector,
  type AIProviderModelGroup,
  type AIProviderModelOption,
} from '@/components/ai/AIProviderModelSelector'
import { SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { ResourceDialogForm } from '@/components/resources/ResourceDialogForm'
import type { FieldDef, RelationOption } from '@/components/resources/resource-page-types'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
  aiProviderSecretFieldInlineValueKey,
  aiProviderSecretFieldManualValueKey,
  SECRET_TEMPLATE_LABELS,
  buildAIProviderPayload,
  buildProtocolFieldDefaults,
  buildDefaultProviderName,
  chooserTitle,
  defaultTemplateProtocol,
  type AIProviderRecord,
  type AIProviderSelectionGroupKey,
  type AIProviderTemplate,
  type AIProviderTemplateField,
  isGatewayProviderTemplate,
  reconcileProviderModelSelection,
  normalizeTemplateFieldDefault,
  providerSelectionGroupKey,
  protocolEndpointFieldKey,
  productTitle,
  regenerateTemplateEndpoint,
  resolveCurrentProtocolEndpoint,
  resolveTemplateEndpoint,
  shouldAssignDefaultReplica,
  templateChooserSearchText,
  shouldPromoteEndpointField,
  sanitizeProviderModelGroups,
  sanitizeProviderModelOptions,
} from '@/lib/ai-providers'
import { pb } from '@/lib/pb'

const AUTH_SCHEME_OPTIONS = [
  { label: 'Bearer token', value: 'bearer' },
  { label: 'API key header', value: 'api_key' },
  { label: 'No auth', value: 'none' },
]

type Translate = (key: string, options?: Record<string, unknown>) => string

function providerSelectionGroupLabel(t: Translate, group: AIProviderSelectionGroupKey) {
  return t(`aiProviders.selection.groups.${group}`)
}

function resolveEndpointFieldTitle(t: Translate, template: AIProviderTemplate | null | undefined) {
  return defaultTemplateProtocol(template) === 'anthropic'
    ? t('aiProviders.fields.apiEndpoint')
    : t('aiProviders.fields.openaiCompatibleUrl')
}

function mapTemplateFieldToResourceField(
  field: AIProviderTemplateField,
  t: Translate,
  renderCredentialField: NonNullable<FieldDef['render']>,
  renderEndpointField: NonNullable<FieldDef['render']>
): FieldDef {
  if (field.id === 'credential') {
    return {
      key: field.id,
      label: field.label,
      type: 'text',
      required: field.required,
      render: renderCredentialField,
    }
  }

  if (field.id === 'endpoint') {
    return {
      key: field.id,
      label: resolveEndpointFieldTitle(t, null),
      type: 'text',
      required: field.required,
      placeholder: field.placeholder,
      defaultValue: normalizeTemplateFieldDefault(field),
      hideLabel: true,
      render: renderEndpointField,
    }
  }

  if (field.type === 'secret_ref') {
    return {
      key: field.id,
      label: field.label,
      type: 'text',
      required: field.required,
      render: ({ inputId, formData, updateField }) => (
        <SecretCredentialField
          inputId={inputId}
          manualValue={String(
            formData[aiProviderSecretFieldInlineValueKey(field.id)] ??
              formData[aiProviderSecretFieldManualValueKey(field.id)] ??
              ''
          )}
          onManualValueChange={value => {
            updateField(aiProviderSecretFieldInlineValueKey(field.id), value)
            updateField(aiProviderSecretFieldManualValueKey(field.id), value)
          }}
          useReference={false}
          onUseReferenceChange={() => {}}
          referenceValue=""
          onReferenceValueChange={() => {}}
          options={[]}
          manualPlaceholder={t('aiProviders.credential.enterField', {
            field: String(field.label ?? t('aiProviders.fields.apiKey')),
          })}
          showLabel={t('aiProviders.credential.showField', {
            field: String(field.label ?? t('aiProviders.fields.apiKey')),
          })}
          hideLabel={t('aiProviders.credential.hideField', {
            field: String(field.label ?? t('aiProviders.fields.apiKey')),
          })}
          allowGenerate={false}
          allowReference={false}
        />
      ),
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
    advanced: Boolean(field.advanced),
    helpUrl: field.helpUrl,
    helpText: field.helpText,
  }
}

async function fetchRelationOptions(field: FieldDef): Promise<RelationOption[]> {
  if (!field.relationApiPath) return []
  const response = await pb.send<{ items?: Array<Record<string, unknown>> }>(
    field.relationApiPath,
    {
      method: 'GET',
    }
  )
  const items = Array.isArray(response?.items) ? response.items : []
  return items.map(item => ({
    id: String(item.id ?? ''),
    label: field.relationFormatLabel
      ? field.relationFormatLabel(item)
      : String(item[field.relationLabelKey ?? 'name'] ?? item.name ?? item.id ?? ''),
    raw: item,
  }))
}

function describeProviderModelsError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const normalized = message.toLowerCase()
  if (
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden')
  ) {
    return 'Authentication failed while loading models. Check the API key or secret and try again.'
  }
  if (normalized.includes('404')) {
    return 'The model list endpoint was not found. Check the API endpoint and make sure this provider exposes a compatible models API.'
  }
  if (normalized.includes('timeout') || normalized.includes('deadline exceeded')) {
    return 'Loading models timed out. Check network connectivity and confirm the provider endpoint is reachable.'
  }
  if (
    normalized.includes('x509') ||
    normalized.includes('tls') ||
    normalized.includes('certificate')
  ) {
    return 'TLS verification failed while loading models. Check the provider certificate or endpoint URL.'
  }
  if (
    normalized.includes('no such host') ||
    normalized.includes('dial tcp') ||
    normalized.includes('connection refused')
  ) {
    return 'Could not reach the provider endpoint. Check the API endpoint, DNS, proxy, or firewall settings.'
  }
  if (message.trim()) {
    return message
  }
  return 'Could not load models. Verify the API endpoint, secret, and network connectivity, then try again.'
}

function filterVisibleFields(fields: FieldDef[], formData: Record<string, unknown>) {
  return fields.filter(field => {
    if (field.hidden) return false
    if (!field.showWhen) return true
    return field.showWhen.values.includes(String(formData[field.showWhen.field] ?? ''))
  })
}

function moveFieldBefore(fields: FieldDef[], fieldKey: string, beforeKey: string) {
  const nextFields = [...fields]
  const fieldIndex = nextFields.findIndex(field => field.key === fieldKey)
  const beforeIndex = nextFields.findIndex(field => field.key === beforeKey)
  if (fieldIndex === -1 || beforeIndex === -1 || fieldIndex < beforeIndex) {
    return nextFields
  }
  const [field] = nextFields.splice(fieldIndex, 1)
  nextFields.splice(beforeIndex, 0, field)
  return nextFields
}

/**
 * Pure decision helper for the auto‑List‑Models behaviour inside
 * handleSubmit.  Returns true when the submit should proceed to the
 * save step; false when it was blocked (with an optional error message).
 */
export function shouldAutoListModels(params: {
  lastFetchSucceeded: boolean
  runFetchModels: () => Promise<{ success: boolean; selected: string[]; error?: string }>
  setError: (message: string) => void
  setSaving: (saving: boolean) => void
}): Promise<{ canSave: boolean; selected: string[]; failedToLoad: boolean; error?: string }> {
  return (async () => {
    if (params.lastFetchSucceeded) {
      return { canSave: true, selected: [], failedToLoad: false }
    }
    const result = await params.runFetchModels()
    if (!result.success) {
      params.setSaving(false)
      return {
        canSave: false,
        selected: [],
        failedToLoad: true,
        error: result.error,
      }
    }
    return { canSave: true, selected: result.selected, failedToLoad: false }
  })()
}

export function AIProviderCreateFlowDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (provider: AIProviderRecord) => void
}) {
  const navigate = useNavigate()
  const { t } = useTranslation('resources')
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [templates, setTemplates] = useState<AIProviderTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [selectionQuery, setSelectionQuery] = useState('')
  const [selectionOpen, setSelectionOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [relationOptions, setRelationOptions] = useState<Record<string, RelationOption[]>>({})
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [existingProviderNames, setExistingProviderNames] = useState<string[]>([])
  const [existingProviders, setExistingProviders] = useState<AIProviderRecord[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [lastFetchSucceeded, setLastFetchSucceeded] = useState(false)
  const [modelLoadConfirmOpen, setModelLoadConfirmOpen] = useState(false)
  const [modelLoadConfirmMessage, setModelLoadConfirmMessage] = useState('')
  const modelSelectorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setFetchModelsError('')
    setFetchedModels([])
    setFetchingModels(false)
    setFetchedGroups([])
    setSelectedModels([])
    setLastFetchSucceeded(false)
    setModelLoadConfirmOpen(false)
    setModelLoadConfirmMessage('')

    if (!open) {
      setSelectionOpen(false)
      setFormOpen(false)
      setSelectionQuery('')
      setFormData({})
      setExistingProviders([])
      setRelationOptions({})
      setError('')
      return
    }

    setSelectionOpen(true)
    setFormOpen(false)
    setSelectionQuery('')
    setFormData({})
    setRelationOptions({})
    setError('')
    setLoadingTemplates(true)
    void pb
      .send<AIProviderTemplate[]>('/api/ai-providers/templates', { method: 'GET' })
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false))

    void pb
      .send<AIProviderRecord[]>('/api/ai-providers', { method: 'GET' })
      .then(items => {
        const normalizedItems = Array.isArray(items) ? items : []
        const names = normalizedItems
          .map(item =>
            String(item.name ?? '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
        setExistingProviders(normalizedItems)
        setExistingProviderNames(names)
      })
      .catch(() => {
        setExistingProviders([])
        setExistingProviderNames([])
      })
  }, [open])

  const templatesById = useMemo(
    () => new Map(templates.map(template => [template.id, template])),
    [templates]
  )

  const selectedTemplate = templatesById.get(String(formData.template_id ?? ''))

  const productOptions = useMemo(
    () =>
      [...templates]
        .filter(template => !template.hideInChooser)
        .sort((left, right) => {
          const leftIsGateway = isGatewayProviderTemplate(left)
          const rightIsGateway = isGatewayProviderTemplate(right)
          if (leftIsGateway !== rightIsGateway) {
            return leftIsGateway ? -1 : 1
          }
          const leftIsOpenAICompatible = left.id === 'generic-llm'
          const rightIsOpenAICompatible = right.id === 'generic-llm'
          const leftGroup = providerSelectionGroupKey(left)
          const rightGroup = providerSelectionGroupKey(right)
          if (
            leftGroup === 'selfHosted' &&
            rightGroup === 'selfHosted' &&
            leftIsOpenAICompatible !== rightIsOpenAICompatible
          ) {
            return leftIsOpenAICompatible ? -1 : 1
          }
          const leftInitial = chooserTitle(left).trim().charAt(0).toLowerCase()
          const rightInitial = chooserTitle(right).trim().charAt(0).toLowerCase()
          return leftInitial.localeCompare(rightInitial, undefined, { sensitivity: 'base' })
        })
        .filter(template => {
          const query = selectionQuery.trim().toLowerCase()
          if (!query) return true
          return templateChooserSearchText(template).includes(query)
        }),
    [selectionQuery, templates]
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

  const renderCredentialField = useCallback<NonNullable<FieldDef['render']>>(
    ({
      field,
      inputId,
      formData: currentFormData,
      editingItem,
      updateField,
    }) => {
      const editMode = Boolean(editingItem)

      return (
        <SecretCredentialField
          inputId={inputId}
          manualValue={String(currentFormData.api_key_value ?? '')}
          onManualValueChange={value => updateField('api_key_value', value)}
          useReference={false}
          onUseReferenceChange={() => {}}
          referenceValue=""
          onReferenceValueChange={() => {}}
          options={[]}
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
          allowGenerate={false}
          allowReference={false}
        />
      )
    },
    [openSecretEditor, t]
  )

  const renderEndpointField = useCallback<NonNullable<FieldDef['render']>>(
    ({ inputId, formData: currentFormData, updateField }) => {
      const endpointField = selectedTemplate?.fields?.find(field => field.id === 'endpoint')
      const defaultProtocol = defaultTemplateProtocol(
        selectedTemplate,
        currentFormData.default_protocol
      )
      const endpointEditing = Boolean(currentFormData.endpoint_editing)
      const endpointLabel = resolveEndpointFieldTitle(t, selectedTemplate)
      const endpointValue = String(
        currentFormData.endpoint ??
          currentFormData[protocolEndpointFieldKey(defaultProtocol)] ??
          resolveTemplateEndpoint(selectedTemplate, currentFormData)
      )
      const endpointPlaceholder = String(
        selectedTemplate?.fields?.find(field => field.id === 'endpoint')?.placeholder ??
          resolveTemplateEndpoint(selectedTemplate, currentFormData)
      )
      return (
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
            <span>{endpointLabel}</span>
            {endpointField?.required ? (
              <span aria-hidden="true" className="ml-1 text-destructive">
                *
              </span>
            ) : null}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              type="text"
              className={`border-input h-10 w-full rounded-md border px-3 text-sm ${endpointEditing ? 'bg-background' : 'bg-muted/40 text-muted-foreground'}`}
              value={endpointValue}
              placeholder={endpointPlaceholder}
              readOnly={!endpointEditing}
              onChange={event => {
                updateField('default_protocol', defaultProtocol)
                updateField(protocolEndpointFieldKey(defaultProtocol), event.target.value)
                updateField('endpoint', event.target.value)
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title={
                endpointEditing
                  ? t('aiProviders.actions.finishEditingEndpoint')
                  : t('aiProviders.actions.editEndpoint')
              }
              onClick={() => updateField('endpoint_editing', !endpointEditing)}
            >
              {endpointEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )
    },
    [selectedTemplate, t]
  )

  const [fetchModelsError, setFetchModelsError] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<AIProviderModelOption[]>([])
  const [fetchedGroups, setFetchedGroups] = useState<AIProviderModelGroup[]>([])

  const runFetchModels = useCallback(async (): Promise<{
    success: boolean
    selected: string[]
    error?: string
  }> => {
    const endpoint = resolveCurrentProtocolEndpoint(selectedTemplate, formData)
    const apiKey = String(formData.api_key_value ?? '').trim()
    if (!endpoint || !apiKey) {
      const message =
        'Load all available models requires an API endpoint and API key before testing this provider.'
      setFetchModelsError(message)
      return { success: false, selected: [], error: message }
    }

    setFetchingModels(true)
    setFetchModelsError('')
    setFetchedModels([])
    setFetchedGroups([])
    setLastFetchSucceeded(false)
    try {
      const result = await pb.send<{
        models: Array<{ id: string; enabled_by_default?: boolean }>
        groups?: Array<{ vendor: string; label?: string; models: Array<{ id: string }> }>
      }>('/api/ai-providers/fetch-models', {
        method: 'POST',
        body: {
          endpoint,
          api_key: apiKey,
          auth_scheme: String(formData.auth_scheme ?? selectedTemplate?.defaultAuthScheme ?? ''),
          template_id: String(formData.template_id ?? ''),
          protocol: defaultTemplateProtocol(selectedTemplate, formData.default_protocol),
        },
      })
      const models = sanitizeProviderModelOptions(result?.models ?? [])
      const groups = sanitizeProviderModelGroups(result?.groups ?? [])
      setFetchedModels(models)
      setFetchedGroups(groups)
      setLastFetchSucceeded(true)
      const available = new Set(models.map(model => model.id))
      const preferred =
        selectedModels.length > 0
          ? selectedModels
          : models.filter(model => model.enabled_by_default).map(model => model.id)
      const nextSelected = reconcileProviderModelSelection(preferred, available)
      setSelectedModels(nextSelected)
      return {
        success: true,
        selected: nextSelected,
      }
    } catch (err) {
      const msg = describeProviderModelsError(err)
      setFetchModelsError(msg)
      return { success: false, selected: [], error: msg }
    } finally {
      setFetchingModels(false)
    }
  }, [formData, selectedModels, selectedTemplate])

  const handleTestConnection = useCallback(() => {
    void runFetchModels()
  }, [runFetchModels])

  const toggleSelectedModel = useCallback((modelID: string) => {
    setSelectedModels(current =>
      current.includes(modelID) ? current.filter(item => item !== modelID) : [...current, modelID]
    )
  }, [])

  const baseProviderFields = useMemo<FieldDef[]>(
    () => [
      {
        key: 'is_enabled',
        label: t('aiProviders.fields.enableIt'),
        type: 'text',
        hideLabel: true,
        defaultValue: true,
        advanced: true,
        render: ({ formData: currentFormData, updateField }) => {
          const enabled = Boolean(currentFormData.is_enabled ?? true)
          return (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {t('aiProviders.fields.enableIt')}
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="create-provider-enabled"
                    checked={enabled}
                    onChange={() => updateField('is_enabled', true)}
                  />
                  <span>Yes</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="create-provider-enabled"
                    checked={!enabled}
                    onChange={() => updateField('is_enabled', false)}
                  />
                  <span>No</span>
                </label>
              </div>
            </div>
          )
        },
      },
      {
        key: 'auth_scheme',
        label: t('aiProviders.fields.authScheme'),
        type: 'select',
        options: AUTH_SCHEME_OPTIONS.map(option => ({
          ...option,
          label: t(`aiProviders.authSchemes.${option.value}`),
        })),
        defaultValue: '',
        advanced: true,
      },
      {
        key: 'endpoint_editing',
        label: 'Endpoint Editing',
        type: 'boolean',
        hidden: true,
        defaultValue: false,
      },
      {
        key: 'description',
        label: t('aiProviders.fields.description'),
        type: 'text',
        advanced: true,
      },
      {
        key: 'title_name_editing',
        label: 'Title Name Editing',
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
        label: t('aiProviders.fields.advancedConfig'),
        type: 'textarea',
        rows: 5,
        textareaClassName: 'max-h-[8.5rem] overflow-y-auto',
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
        placeholder: t('aiProviders.placeholders.groups'),
        relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
        relationLabelKey: 'name',
        defaultValue: [],
      },
    ],
    [t]
  )

  const resolvedFields = useMemo(() => {
    let dynamicFields = (selectedTemplate?.fields ?? []).flatMap(field => {
      const mapped = mapTemplateFieldToResourceField(
        field,
        t,
        renderCredentialField,
        renderEndpointField
      )

      if (selectedTemplate?.id === 'aws-bedrock' && field.id === 'region') {
        return [
          {
            ...mapped,
            onValueChange: (value: unknown, update: (key: string, value: unknown) => void) => {
              const protocol = defaultTemplateProtocol(selectedTemplate, formData.default_protocol)
              const nextEndpoint = regenerateTemplateEndpoint(selectedTemplate, {
                ...formData,
                region: value,
              })
              update(protocolEndpointFieldKey(protocol), nextEndpoint)
              update('endpoint', nextEndpoint)
            },
          },
        ]
      }

      if (
        selectedTemplate?.id === 'vertex-ai' &&
        (field.id === 'location' || field.id === 'project_id')
      ) {
        return [
          {
            ...mapped,
            onValueChange: (value: unknown, update: (key: string, value: unknown) => void) => {
              const protocol = defaultTemplateProtocol(selectedTemplate, formData.default_protocol)
              const nextEndpoint = regenerateTemplateEndpoint(selectedTemplate, {
                ...formData,
                [field.id]: value,
              })
              update(protocolEndpointFieldKey(protocol), nextEndpoint)
              update('endpoint', nextEndpoint)
            },
          },
        ]
      }

      if (field.id !== 'credential') {
        return [mapped]
      }

      return [
        mapped,
        {
          key: 'select_models',
          label: t('aiProviders.fields.enabledModels'),
          type: 'text',
          hideLabel: true,
          render: () => (
            <AIProviderModelSelector
              ref={modelSelectorRef}
              selectedModels={selectedModels}
              models={fetchedModels}
              groups={fetchedGroups}
              loading={fetchingModels}
              error={fetchModelsError || undefined}
              loaded={lastFetchSucceeded}
              canLoad={Boolean(
                resolveCurrentProtocolEndpoint(selectedTemplate, formData) &&
                String(formData.api_key_value ?? '').trim()
              )}
              loadActionLabel="Load all available models"
              onListModels={handleTestConnection}
              onToggleModel={toggleSelectedModel}
            />
          ),
        } satisfies FieldDef,
      ]
    })

    const promoteEndpoint = shouldPromoteEndpointField(selectedTemplate)

    dynamicFields = dynamicFields.map(field => {
      if (field.key !== 'endpoint') return field
      return {
        ...field,
        label: resolveEndpointFieldTitle(t, selectedTemplate),
        advanced: !promoteEndpoint,
      }
    })

    if (selectedTemplate?.id === 'aws-bedrock') {
      dynamicFields = moveFieldBefore(dynamicFields, 'region', 'endpoint')
    }

    const authSchemeField = {
      ...baseProviderFields[1],
      hidden: true,
      advanced: true,
    }

    let resolved = [
      ...dynamicFields,
      authSchemeField,
      baseProviderFields[2],
      ...baseProviderFields.slice(3),
      baseProviderFields[0],
    ]

    return resolved
  }, [
    baseProviderFields,
    fetchModelsError,
    fetchedGroups,
    fetchedModels,
    fetchingModels,
    handleTestConnection,
    lastFetchSucceeded,
    openSecretEditor,
    renderCredentialField,
    renderEndpointField,
    selectedModels,
    selectedTemplate,
    formData,
    t,
    toggleSelectedModel,
  ])

  const activeFields = useMemo(
    () => filterVisibleFields(resolvedFields, formData),
    [resolvedFields, formData]
  )
  const headerFields = activeFields.filter(field => field.header)
  const primaryFields = activeFields.filter(field => !field.header && !field.advanced)
  const advancedFields = activeFields.filter(field => field.advanced)

  useEffect(() => {
    if (!formOpen) return
    const relationFields = activeFields.filter(
      field => field.type === 'relation' && field.relationApiPath
    )
    if (relationFields.length === 0) {
      setRelationOptions({})
      return
    }

    let cancelled = false
    void Promise.all(
      relationFields.map(async field => {
        try {
          const options = await fetchRelationOptions(field)
          return [field.key, options] as const
        } catch {
          return [field.key, []] as const
        }
      })
    ).then(entries => {
      if (cancelled) return
      setRelationOptions(current => ({
        ...current,
        ...Object.fromEntries(entries),
      }))
    })

    return () => {
      cancelled = true
    }
  }, [activeFields, formOpen])

  const selectTemplate = (template: AIProviderTemplate) => {
    const defaults: Record<string, unknown> = {
      kind: template.kind,
      template_id: template.id,
      name: buildDefaultProviderName(template),
      auth_scheme: String(template.defaultAuthScheme ?? ''),
      api_key_value: '',
      is_enabled: true,
      title_name_editing: false,
      endpoint_editing: false,
    }

    for (const field of template.fields ?? []) {
      defaults[field.id] = normalizeTemplateFieldDefault(field)
    }

    Object.assign(defaults, buildProtocolFieldDefaults(template, defaults))

    defaults.endpoint = resolveTemplateEndpoint(template, defaults)
    if (!defaults.endpoint) {
      defaults.endpoint_editing = true
    }

    setFormData(defaults)
    setSelectedModels(
      Array.isArray(template.defaultEnabledModels) ? [...template.defaultEnabledModels] : []
    )
    setFetchedModels([])
    setFetchedGroups([])
    setLastFetchSucceeded(false)
    setRelationOptions({})
    setError('')
    setSelectionOpen(false)
    setFormOpen(true)
  }

  const updateField = (key: string, value: unknown) => {
    setFormData(current => ({ ...current, [key]: value }))
  }

  const nameConflictMessage = useMemo(() => {
    const normalized = String(formData.name ?? '')
      .trim()
      .toLowerCase()
    if (!normalized) return ''
    if (!existingProviderNames.includes(normalized)) return ''
    return 'This AI Provider name already exists. Choose a different name.'
  }, [existingProviderNames, formData.name])

  const handleChange = (field: FieldDef, raw: unknown) => {
    const value = field.type === 'number' ? Number(raw) : raw
    updateField(field.key, value)
    field.onValueChange?.(value, updateField)
  }

  const addRelationOption = (
    fieldKey: string,
    id: string,
    label: string,
    raw?: Record<string, unknown>
  ) => {
    setRelationOptions(current => ({
      ...current,
      [fieldKey]: [...(current[fieldKey] ?? []), { id, label, raw }],
    }))
  }

  const handleFileUpload = (key: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => updateField(key, String(ev.target?.result ?? ''))
    reader.readAsText(file)
    e.target.value = ''
  }

  const fileInputRef = (key: string, element: HTMLInputElement | null) => {
    fileInputRefs.current[key] = element
  }

  const submitProvider = async ({
    event,
    skipAutoModelLoad = false,
  }: {
    event?: FormEvent<HTMLFormElement>
    skipAutoModelLoad?: boolean
  } = {}) => {
    event?.preventDefault()
    setSaving(true)
    setError('')

    if (!String(formData.name ?? '').trim()) {
      setSaving(false)
      setError('Name is required')
      return
    }
    if (nameConflictMessage) {
      setSaving(false)
      setError(nameConflictMessage)
      return
    }

    try {
      let modelsForSave = selectedModels
      if (!skipAutoModelLoad) {
        const decision = await shouldAutoListModels({
          lastFetchSucceeded,
          runFetchModels,
          setError,
          setSaving,
        })
        if (!decision.canSave) {
          if (decision.failedToLoad) {
            setModelLoadConfirmMessage(
              decision.error ||
                'Could not load available models. You can still continue saving this provider.'
            )
            setModelLoadConfirmOpen(true)
            return
          }
          modelSelectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return
        }
        if (!lastFetchSucceeded) {
          modelsForSave = decision.selected
        }
      }

      const body = await buildAIProviderPayload(
        {
          ...formData,
          enabled_models: modelsForSave,
        },
        templatesById
      )
      const created = await pb.send<AIProviderRecord>('/api/ai-providers', {
        method: 'POST',
        body: {
          ...body,
          is_default: shouldAssignDefaultReplica(body.template_id, existingProviders),
        },
      })
      onCreated(created)
      setFormOpen(false)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create AI provider'
      setError(
        message.toLowerCase().includes('already exists')
          ? 'This AI Provider name already exists. Choose a different name.'
          : message
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    await submitProvider({ event })
  }

  const providerName = String(formData.name ?? '').trim()
  const editingName = Boolean(formData.title_name_editing)
  const dialogTitle = selectedTemplate ? (
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
  ) : (
    t('aiProviders.dialog.newProvider')
  )

  const dialogDescription = selectedTemplate ? (
    <span className="inline-flex items-center gap-2">
      <span>{`${t('aiProviders.dialog.add')} ${productTitle(selectedTemplate)} ${t('aiProviders.dialog.suffix')}`}</span>
      {selectedTemplate.helpUrl ? (
        <a
          href={selectedTemplate.helpUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Open official API endpoint help"
          title="Open official API endpoint help"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </span>
  ) : (
    t('aiProviders.selection.description')
  )

  return (
    <>
      <Dialog
        open={selectionOpen}
        onOpenChange={nextOpen => {
          setSelectionOpen(nextOpen)
          if (!nextOpen) {
            onOpenChange(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('aiProviders.selection.title')}</DialogTitle>
            <DialogDescription>{t('aiProviders.selection.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              type="text"
              placeholder={t('aiProviders.selection.searchPlaceholder')}
              value={selectionQuery}
              onChange={event => setSelectionQuery(event.target.value)}
              autoFocus
            />

            {loadingTemplates ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('aiProviders.selection.loading')}
              </div>
            ) : productOptions.length === 0 ? (
              <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {t('aiProviders.selection.emptyMessage')}
              </div>
            ) : (
              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {(
                  ['singleProvider', 'cloudGateway', 'selfHosted'] as AIProviderSelectionGroupKey[]
                ).map(group => {
                  const groupOptions = productOptions.filter(
                    option => providerSelectionGroupKey(option) === group
                  )
                  if (groupOptions.length === 0) return null
                  return (
                    <div key={group} className="space-y-2">
                      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {providerSelectionGroupLabel(t, group)}
                      </div>
                      {groupOptions.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          className="w-full rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted"
                          title={option.description?.trim() || chooserTitle(option)}
                          onClick={() => selectTemplate(option)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">
                                {chooserTitle(option)}
                              </div>
                            </div>
                            {option.helpUrl ? (
                              <a
                                href={option.helpUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-xs text-primary hover:underline"
                                onClick={event => event.stopPropagation()}
                              >
                                {t('aiProviders.selection.help')}
                              </a>
                            ) : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ResourceDialogForm
        open={formOpen}
        onOpenChange={nextOpen => {
          setFormOpen(nextOpen)
          if (!nextOpen) {
            onOpenChange(false)
          }
        }}
        className="sm:max-w-4xl"
        title={dialogTitle}
        description={dialogDescription}
        formData={formData}
        editingItem={null}
        headerFields={headerFields}
        primaryFields={primaryFields}
        advancedFields={advancedFields}
        relationOptions={relationOptions}
        updateField={updateField}
        handleChange={handleChange}
        addRelationOption={addRelationOption}
        openRelationCreate={() => undefined}
        handleFileUpload={handleFileUpload}
        fileInputRef={fileInputRef}
        error={error}
        saving={saving}
        dialogExtra={
          nameConflictMessage && !error ? (
            <p className="text-sm text-destructive">{nameConflictMessage}</p>
          ) : null
        }
        selectedSummary={null}
        submitLabel={t('aiProviders.dialog.add')}
        cancelLabel={t('aiProviders.dialog.cancel')}
        resetAction={{
          label: t('aiProviders.actions.testConnection'),
          onClick: handleTestConnection,
        }}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={modelLoadConfirmOpen} onOpenChange={setModelLoadConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load models before saving?</AlertDialogTitle>
            <AlertDialogDescription>{modelLoadConfirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={event => {
                event.preventDefault()
                setModelLoadConfirmOpen(false)
                void submitProvider({ skipAutoModelLoad: true })
              }}
            >
              Continue Saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SecretCreateDialog
        open={secretDialogOpen}
        onOpenChange={setSecretDialogOpen}
        title={t('aiProviders.secret.newTitle')}
        description={t('aiProviders.secret.newDescription')}
        allowedTemplateIds={[AI_PROVIDER_CREDENTIAL_TEMPLATE_ID]}
        templateLabels={SECRET_TEMPLATE_LABELS}
        defaultTemplateId={AI_PROVIDER_CREDENTIAL_TEMPLATE_ID}
        defaultVisibleTo={['ai_provider']}
        onCreated={({ id, name }) => {
          addRelationOption('credential', id, name)
          updateField('credential_use_secret', true)
          updateField('credential', id)
        }}
      />
    </>
  )
}
