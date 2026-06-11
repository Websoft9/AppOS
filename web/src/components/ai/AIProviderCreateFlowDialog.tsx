import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { buildUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'
import { Button } from '@/components/ui/button'
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
  SECRET_TEMPLATE_LABELS,
  buildAIProviderPayload,
  buildDefaultProviderName,
  chooserTitle,
  formatSecretLabel,
  type AIProviderRecord,
  type AIProviderTemplate,
  type AIProviderTemplateField,
  isGatewayProviderTemplate,
  isAdvancedProviderField,
  normalizeTemplateFieldDefault,
  providerSelectionGroup,
  productTitle,
} from '@/lib/ai-providers'
import { pb } from '@/lib/pb'

function mapTemplateFieldToResourceField(
  field: AIProviderTemplateField,
  openSecretDialog: (callbacks: { addOption: (id: string, label: string) => void }) => void,
  openSecretEditor: (secretId: string) => void,
  renderCredentialField: NonNullable<FieldDef['render']>,
  renderEndpointField: NonNullable<FieldDef['render']>,
): FieldDef {
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
      relationEditButton: {
        label: 'Edit Secret',
        onClick: openSecretEditor,
      },
      render: renderCredentialField,
    }
  }

  if (field.id === 'endpoint') {
    return {
      key: field.id,
      label: 'API Endpoint',
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
      type: 'relation',
      required: field.required,
      relationApiPath: buildUserVisibleSecretRelationApiPath('ai_provider', {
        secretTemplate: field.secretTemplate,
      }),
      relationFormatLabel: formatSecretLabel,
      relationCreateButton: {
        label: 'New Secret',
        onClick: openSecretDialog,
      },
      relationEditButton: {
        label: 'Edit Secret',
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
    helpText: field.helpText,
  }
}

async function fetchRelationOptions(field: FieldDef): Promise<RelationOption[]> {
  if (!field.relationApiPath) return []
  const response = await pb.send<{ items?: Array<Record<string, unknown>> }>(field.relationApiPath, {
    method: 'GET',
  })
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
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
    return 'Authentication failed while loading models. Check the API key or secret and try again.'
  }
  if (normalized.includes('404')) {
    return 'The model list endpoint was not found. Check the API endpoint and make sure this provider exposes a compatible models API.'
  }
  if (normalized.includes('timeout') || normalized.includes('deadline exceeded')) {
    return 'Loading models timed out. Check network connectivity and confirm the provider endpoint is reachable.'
  }
  if (normalized.includes('x509') || normalized.includes('tls') || normalized.includes('certificate')) {
    return 'TLS verification failed while loading models. Check the provider certificate or endpoint URL.'
  }
  if (normalized.includes('no such host') || normalized.includes('dial tcp') || normalized.includes('connection refused')) {
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

/**
 * Pure decision helper for the auto‑List‑Models behaviour inside
 * handleSubmit.  Returns true when the submit should proceed to the
 * save step; false when it was blocked (with an optional error message).
 */
export function shouldAutoListModels(params: {
  lastFetchSucceeded: boolean
  runFetchModels: () => Promise<{ success: boolean; selected: string[] }>
  setError: (message: string) => void
  setSaving: (saving: boolean) => void
}): Promise<boolean> {
  return (async () => {
    if (params.lastFetchSucceeded) {
      return true
    }
    const result = await params.runFetchModels()
    if (!result.success || result.selected.length === 0) {
      if (result.success) {
        params.setError('Select at least one model after listing models.')
      }
      params.setSaving(false)
      return false
    }
    return true
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
  const [endpointEditing, setEndpointEditing] = useState(false)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [lastFetchSucceeded, setLastFetchSucceeded] = useState(false)
  const modelSelectorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setFetchModelsError('')
    setFetchedModels([])
    setFetchingModels(false)
    setFetchedGroups([])
    setSelectedModels([])
    setLastFetchSucceeded(false)
    setEndpointEditing(false)

    if (!open) {
      setSelectionOpen(false)
      setFormOpen(false)
      setSelectionQuery('')
      setFormData({})
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
        const names = Array.isArray(items)
          ? items.map(item => String(item.name ?? '').trim().toLowerCase()).filter(Boolean)
          : []
        setExistingProviderNames(names)
      })
      .catch(() => setExistingProviderNames([]))
  }, [open])

  const templatesById = useMemo(
    () => new Map(templates.map(template => [template.id, template])),
    [templates]
  )

  const selectedTemplate = templatesById.get(String(formData.template_id ?? ''))

  const productOptions = useMemo(
    () =>
      [...templates]
        .sort((left, right) => {
          const leftIsGateway = isGatewayProviderTemplate(left)
          const rightIsGateway = isGatewayProviderTemplate(right)
          if (leftIsGateway !== rightIsGateway) {
            return leftIsGateway ? -1 : 1
          }
          const leftIsOpenAICompatible = left.id === 'generic-llm'
          const rightIsOpenAICompatible = right.id === 'generic-llm'
          if (leftIsOpenAICompatible !== rightIsOpenAICompatible) {
            return leftIsOpenAICompatible ? 1 : -1
          }
          const leftInitial = chooserTitle(left).trim().charAt(0).toLowerCase()
          const rightInitial = chooserTitle(right).trim().charAt(0).toLowerCase()
          return leftInitial.localeCompare(rightInitial, undefined, { sensitivity: 'base' })
        })
        .filter(template => {
          const query = selectionQuery.trim().toLowerCase()
          if (!query) return true
          return [template.title, template.vendor, template.description, template.id]
            .join(' ')
            .toLowerCase()
            .includes(query)
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
    ({ field, inputId, formData: currentFormData, editingItem, updateField, relationOptions: options }) => {
      const editMode = Boolean(editingItem)
      const useSecret = editMode ? true : Boolean(currentFormData.credential_use_secret)

      return (
        <SecretCredentialField
          inputId={inputId}
          manualValue={String(currentFormData.api_key_value ?? '')}
          onManualValueChange={value => updateField('api_key_value', value)}
          useReference={useSecret}
          onUseReferenceChange={checked => {
            updateField('credential_use_secret', checked)
            if (!checked) {
              updateField('credential', '')
            }
          }}
          referenceValue={String(currentFormData.credential ?? '')}
          onReferenceValueChange={value => updateField('credential', value)}
          options={options}
          onCreateReference={() => setSecretDialogOpen(true)}
          onEditReference={openSecretEditor}
          editMode={editMode}
          manualPlaceholder={`Enter ${String(field.label ?? 'API Key')}`}
          showLabel={`Show ${String(field.label ?? 'API Key')}`}
          hideLabel={`Hide ${String(field.label ?? 'API Key')}`}
          allowGenerate={false}
          referenceToggleMode="icon"
        />
      )
    },
    [openSecretEditor]
  )

  const renderEndpointField = useCallback<NonNullable<FieldDef['render']>>(
    ({ inputId, formData: currentFormData, updateField }) => {
      const current = String(currentFormData.endpoint ?? '')
      const editing = endpointEditing
      const helpUrl = String(selectedTemplate?.helpUrl ?? '').trim()
      if (!editing) {
        return (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label htmlFor={inputId} className="text-sm font-medium text-foreground">
                API Endpoint
              </label>
              {helpUrl ? (
                <a
                  href={helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Open official API endpoint help"
                  title="Open official API endpoint help"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <input
                id={inputId}
                type="text"
                className="border-input bg-muted/40 text-muted-foreground h-10 w-full rounded-md border px-3 text-sm"
                value={current}
                readOnly
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0"
                title="Edit endpoint"
                onClick={() => setEndpointEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )
      }
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor={inputId} className="text-sm font-medium text-foreground">
              API Endpoint
            </label>
            {helpUrl ? (
              <a
                href={helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Open official API endpoint help"
                title="Open official API endpoint help"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              type="text"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={current}
              onChange={e => updateField('endpoint', e.target.value)}
              autoFocus
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              title="Done"
              onClick={() => setEndpointEditing(false)}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )
    },
    [endpointEditing, selectedTemplate]
  )

  const [fetchModelsError, setFetchModelsError] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<AIProviderModelOption[]>([])
  const [fetchedGroups, setFetchedGroups] = useState<AIProviderModelGroup[]>([])

  const runFetchModels = useCallback(async (): Promise<{ success: boolean; selected: string[] }> => {
    const endpoint = String(formData.endpoint ?? '').trim()
    const apiKey = String(formData.api_key_value ?? '').trim()
    if (!endpoint || !apiKey) return { success: false, selected: [] }

    setFetchingModels(true)
    setFetchModelsError('')
    setFetchedModels([])
    setFetchedGroups([])
    setLastFetchSucceeded(false)
    try {
      const result = await pb.send<{ models: Array<{ id: string; enabled_by_default?: boolean }>; groups?: Array<{ vendor: string; models: Array<{ id: string }> }> }>('/api/ai-providers/fetch-models', {
        method: 'POST',
        body: { endpoint, api_key: apiKey, template_id: String(formData.template_id ?? '') },
      })
      const models = (result?.models ?? []).filter(model => Boolean(model.id))
      const groups = Array.isArray(result?.groups)
        ? result.groups.map(group => ({
            vendor: group.vendor,
            label: group.vendor,
            models: group.models.filter(model => Boolean(model.id)),
          }))
        : []
      setFetchedModels(models)
      setFetchedGroups(groups)
      setLastFetchSucceeded(true)
      const available = new Set(models.map(model => model.id))
      const preferred =
        selectedModels.length > 0
          ? selectedModels
          : models.filter(model => model.enabled_by_default).map(model => model.id)
      const nextSelected = preferred.filter(model => available.has(model))
      setSelectedModels(current => {
        if (current.length > 0) {
          const currentFiltered = current.filter(model => available.has(model))
          return currentFiltered.length > 0 ? currentFiltered : nextSelected
        }
        return nextSelected
      })
      return {
        success: true,
        selected:
          selectedModels.length > 0
            ? selectedModels.filter(model => available.has(model))
            : nextSelected,
      }
    } catch (err) {
      const msg = describeProviderModelsError(err)
      setFetchModelsError(msg)
      return { success: false, selected: [] }
    } finally {
      setFetchingModels(false)
    }
  }, [formData.endpoint, formData.api_key_value, formData.template_id, selectedModels])

  const handleTestConnection = useCallback(() => {
    void runFetchModels()
  }, [runFetchModels])

  const toggleSelectedModel = useCallback((modelID: string) => {
    setSelectedModels(current =>
      current.includes(modelID)
        ? current.filter(item => item !== modelID)
        : [...current, modelID]
    )
  }, [])

  const baseProviderFields = useMemo<FieldDef[]>(
    () => [
      {
        key: 'is_enabled',
        label: 'Enable it',
        type: 'text',
        hideLabel: true,
        defaultValue: true,
        advanced: true,
        render: ({ formData: currentFormData, updateField }) => {
          const enabled = Boolean(currentFormData.is_enabled ?? true)
          return (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Enable it</div>
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
        key: 'description',
        label: 'Description',
        type: 'textarea',
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
        label: 'Advanced Config',
        type: 'textarea',
        placeholder: '{\n  "key": "value"\n}',
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
    []
  )

  const resolvedFields = useMemo(() => {
    const dynamicFields = (selectedTemplate?.fields ?? []).flatMap(field => {
      const mapped = mapTemplateFieldToResourceField(
        field,
        () => setSecretDialogOpen(true),
        openSecretEditor,
        renderCredentialField,
        renderEndpointField
      )

      if (field.id !== 'credential') {
        return [mapped]
      }

      return [
        mapped,
        {
          key: 'select_models',
          label: 'Select Models',
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
              canLoad={Boolean(String(formData.endpoint ?? '').trim() && String(formData.api_key_value ?? '').trim())}
              onListModels={handleTestConnection}
              onToggleModel={toggleSelectedModel}
            />
          ),
        } satisfies FieldDef,
      ]
    })

    return [
      baseProviderFields[1],
      ...baseProviderFields.slice(2, 5),
      ...dynamicFields,
      ...baseProviderFields.slice(5),
      baseProviderFields[0],
    ]
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
    toggleSelectedModel,
  ])

  const activeFields = useMemo(() => filterVisibleFields(resolvedFields, formData), [resolvedFields, formData])
  const headerFields = activeFields.filter(field => field.header)
  const primaryFields = activeFields.filter(field => !field.header && !field.advanced)
  const advancedFields = activeFields.filter(field => field.advanced)

  useEffect(() => {
    if (!formOpen) return
    const relationFields = activeFields.filter(field => field.type === 'relation' && field.relationApiPath)
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
      endpoint: template.defaultEndpoint ?? '',
      credential_use_secret: false,
      api_key_value: '',
      is_enabled: true,
      title_name_editing: false,
    }

    for (const field of template.fields ?? []) {
      defaults[field.id] = normalizeTemplateFieldDefault(field)
    }

    setFormData(defaults)
    setSelectedModels(Array.isArray(template.defaultEnabledModels) ? [...template.defaultEnabledModels] : [])
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
    const normalized = String(formData.name ?? '').trim().toLowerCase()
    if (!normalized) return ''
    if (!existingProviderNames.includes(normalized)) return ''
    return 'This AI Provider name already exists. Choose a different name.'
  }, [existingProviderNames, formData.name])

  const handleChange = (field: FieldDef, raw: unknown) => {
    const value = field.type === 'number' ? Number(raw) : raw
    updateField(field.key, value)
    field.onValueChange?.(value, updateField)
  }

  const addRelationOption = (fieldKey: string, id: string, label: string, raw?: Record<string, unknown>) => {
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
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
      const canSave = await shouldAutoListModels({
        lastFetchSucceeded,
        runFetchModels,
        setError,
        setSaving,
      })
      if (!canSave) {
        modelSelectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }

      const body = await buildAIProviderPayload(
        {
          ...formData,
          enabled_models: lastFetchSucceeded ? selectedModels : undefined,
        },
        templatesById
      )
      const created = await pb.send<AIProviderRecord>('/api/ai-providers', {
        method: 'POST',
        body: { ...body, is_default: true },
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
  ) : 'New AI Provider'

  const dialogDescription = selectedTemplate
    ? `Add ${productTitle(selectedTemplate)} AI Provider`
    : 'Choose a product, then enter connection details.'

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
            <DialogTitle>Choose a Product</DialogTitle>
            <DialogDescription>
              Choose a provider product, then enter connection details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              type="text"
              placeholder="Search products like OpenAI, Ollama, Anthropic, OpenRouter..."
              value={selectionQuery}
              onChange={event => setSelectionQuery(event.target.value)}
              autoFocus
            />

            {loadingTemplates ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading products...
              </div>
            ) : productOptions.length === 0 ? (
              <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                No matching options found.
              </div>
            ) : (
              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {['Provider', 'LLM Gateway'].map(group => {
                  const groupOptions = productOptions.filter(option => providerSelectionGroup(option) === group)
                  if (groupOptions.length === 0) return null
                  return (
                    <div key={group} className="space-y-2">
                      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
                      {groupOptions.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          className="w-full rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted"
                          onClick={() => selectTemplate(option)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">{chooserTitle(option)}</div>
                            </div>
                            {option.helpUrl ? (
                              <a
                                href={option.helpUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-xs text-primary hover:underline"
                                onClick={event => event.stopPropagation()}
                              >
                                Help
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
        submitLabel="Create Model"
        cancelLabel="Cancel"
        resetAction={{
          label: 'Test it',
          onClick: handleTestConnection,
        }}
        onSubmit={handleSubmit}
      />

      <SecretCreateDialog
        open={secretDialogOpen}
        onOpenChange={setSecretDialogOpen}
        title="New Secret"
        description="Create a reusable secret and attach it to this AI Provider."
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
