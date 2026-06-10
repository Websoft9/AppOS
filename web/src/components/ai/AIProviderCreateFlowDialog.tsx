import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, Loader2, Pencil } from 'lucide-react'
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
      label: field.label,
      type: 'text',
      required: field.required,
      placeholder: field.placeholder,
      defaultValue: normalizeTemplateFieldDefault(field),
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

function filterVisibleFields(fields: FieldDef[], formData: Record<string, unknown>) {
  return fields.filter(field => {
    if (field.hidden) return false
    if (!field.showWhen) return true
    return field.showWhen.values.includes(String(formData[field.showWhen.field] ?? ''))
  })
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
  const [endpointEditing, setEndpointEditing] = useState(false)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [expandedVendor, setExpandedVendor] = useState('')
  const [lastFetchSucceeded, setLastFetchSucceeded] = useState(false)

  useEffect(() => {
    setFetchModelsError('')
    setFetchedModels([])
    setFetchingModels(false)
    setFetchedGroups([])
    setSelectedModels([])
    setExpandedVendor('')
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
        />
      )
    },
    [openSecretEditor]
  )

  const renderEndpointField = useCallback<NonNullable<FieldDef['render']>>(
    ({ inputId, formData: currentFormData, updateField }) => {
      const current = String(currentFormData.endpoint ?? '')
      const editing = endpointEditing
      if (!editing) {
        return (
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              type="text"
              className="border-input bg-muted/40 text-muted-foreground h-9 w-full rounded-md border px-3 text-sm"
              value={current}
              readOnly
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Edit endpoint"
              onClick={() => setEndpointEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      }
      return (
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="text"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            value={current}
            onChange={e => updateField('endpoint', e.target.value)}
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Done"
            onClick={() => setEndpointEditing(false)}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        </div>
      )
    },
    [endpointEditing]
  )

  const [fetchModelsError, setFetchModelsError] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchedGroups, setFetchedGroups] = useState<Array<{ vendor: string; models: Array<{ id: string }> }>>([])

  const runFetchModels = useCallback(async (): Promise<boolean> => {
    const endpoint = String(formData.endpoint ?? '').trim()
    const apiKey = String(formData.api_key_value ?? '').trim()
    if (!endpoint || !apiKey) return false

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
      const models = (result?.models ?? []).map(m => m.id).filter(Boolean)
      setFetchedModels(models)
      setFetchedGroups(Array.isArray(result?.groups) ? result.groups : [])
      setLastFetchSucceeded(true)
      setSelectedModels(current => {
        const available = new Set(models)
        const preferred = current.length > 0 ? current : (result?.models ?? []).filter(model => model.enabled_by_default).map(model => model.id)
        const filtered = preferred.filter(model => available.has(model))
        return filtered.length > 0 ? filtered : current
      })
      return models.length > 0
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch models'
      setFetchModelsError(msg)
      return false
    } finally {
      setFetchingModels(false)
    }
  }, [formData.endpoint, formData.api_key_value, formData.template_id])

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

  const isGateway = isGatewayProviderTemplate(selectedTemplate)

  const gatewayModelSelector = isGateway && (selectedTemplate?.defaultEnabledModels?.length || fetchedGroups.length > 0) ? (
    <div className="space-y-3 rounded-lg border bg-muted/10 px-4 py-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Enabled models</div>
        <div className="text-xs text-muted-foreground">
          Save is allowed without a successful test, but only validated selections will be stored as enabled models.
        </div>
      </div>

      {selectedTemplate?.defaultEnabledModels?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedTemplate.defaultEnabledModels.map(model => {
            const checked = selectedModels.includes(model)
            return (
              <button
                key={model}
                type="button"
                onClick={() => toggleSelectedModel(model)}
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${checked ? 'border-primary bg-primary/10 text-primary' : 'bg-background text-foreground/80'}`}
              >
                {model}
              </button>
            )
          })}
        </div>
      ) : null}

      {fetchedGroups.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {fetchedGroups.map(group => (
              <button
                key={group.vendor}
                type="button"
                onClick={() => setExpandedVendor(current => (current === group.vendor ? '' : group.vendor))}
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${expandedVendor === group.vendor ? 'border-primary bg-primary/10 text-primary' : 'bg-background text-foreground/80'}`}
              >
                {group.vendor}
              </button>
            ))}
          </div>
          {expandedVendor ? (
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border bg-background p-3 sm:grid-cols-2">
              {(fetchedGroups.find(group => group.vendor === expandedVendor)?.models ?? []).map(model => {
                const checked = selectedModels.includes(model.id)
                return (
                  <label key={model.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleSelectedModel(model.id)}
                    />
                    <span className="min-w-0 break-all">{model.id}</span>
                  </label>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null

  const testSummary = fetchingModels ? (
    <div className="rounded-lg border bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Testing connection...
      </div>
    </div>
  ) : fetchModelsError ? (
    <div className="rounded-lg border bg-destructive/10 px-4 py-3">
      <div className="text-sm text-destructive">{fetchModelsError}</div>
    </div>
  ) : fetchedModels.length > 0 ? (
    <div className="rounded-lg border bg-emerald-50/40 px-4 py-3 dark:bg-emerald-950/10">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-emerald-700 dark:text-emerald-300">
          {fetchedModels.length} model{fetchedModels.length === 1 ? '' : 's'} available
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {fetchedModels.map(model => (
          <span key={model} className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium">
            {model}
          </span>
        ))}
      </div>
    </div>
  ) : null

  const baseProviderFields = useMemo<FieldDef[]>(
    () => [
      {
        key: 'is_enabled',
        label: 'Enabled',
        type: 'boolean',
        defaultValue: true,
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
    const dynamicFields = (selectedTemplate?.fields ?? []).map(field =>
      mapTemplateFieldToResourceField(field, () => setSecretDialogOpen(true), openSecretEditor, renderCredentialField, renderEndpointField)
    )

    return [
      baseProviderFields[1],
      ...baseProviderFields.slice(2, 5),
      ...dynamicFields,
      baseProviderFields[0],
      ...baseProviderFields.slice(5),
    ]
  }, [baseProviderFields, openSecretEditor, renderCredentialField, renderEndpointField, selectedTemplate])

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
    setExpandedVendor('')
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

    try {
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
      setError(err instanceof Error ? err.message : 'Failed to create AI provider')
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
                {['LLM Gateway', 'Provider'].map(group => {
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
                              {option.description ? (
                                <div className="mt-1 text-xs text-muted-foreground">{option.description}</div>
                              ) : null}
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
        selectedSummary={
          <div className="space-y-3">
            {testSummary}
            {gatewayModelSelector}
          </div>
        }
        submitLabel="Create Model"
        cancelLabel="Test Connection"
        resetAction={{
          label: 'Test Connection',
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
        onCreated={({ id, name, templateId }) => {
          const suffix = SECRET_TEMPLATE_LABELS[templateId]
          const label = suffix ? `${name} (${suffix})` : name
          addRelationOption('credential', id, label)
          updateField('credential_use_secret', true)
          updateField('credential', id)
        }}
      />
    </>
  )
}
