import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, Loader2, Pencil } from 'lucide-react'
import { buildApiKeyValue, SecretCredentialField } from '@/components/secrets/SecretCredentialField'
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
import { pb } from '@/lib/pb'
import { buildAIProviderPayload } from '@/routes/_app/_auth/resources/ai-providers'

export type AIProviderRecord = {
  id: string
  name?: string
  kind?: string
  is_default?: boolean
  template_id?: string
  endpoint?: string
  auth_scheme?: string
  provider_account?: string
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
  fields?: AIProviderTemplateField[]
}

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

function productTitle(template: AIProviderTemplate) {
  return template.title.trim() || humanizeTemplateId(template.id)
}

function chooserTitle(template: AIProviderTemplate) {
  return String(template.vendor ?? '').trim() || productTitle(template)
}

function slugifyNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildDefaultProviderName(template: AIProviderTemplate) {
  const base = slugifyNamePart(productTitle(template)) || 'ai-provider'
  return `${base}-${Date.now().toString().slice(-4)}`
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

function mapTemplateFieldToResourceField(
  field: AIProviderTemplateField,
  openSecretDialog: (callbacks: { addOption: (id: string, label: string) => void }) => void,
  openSecretEditor: (secretId: string) => void,
  renderCredentialField: NonNullable<FieldDef['render']>
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

  useEffect(() => {
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
          generateValue={buildApiKeyValue}
          generatorTitle="Generate API Key"
          generatorDescription="Create a random API key value to store in a secret."
          generatorLengthLabel="Length"
          generatorConfirmLabel="Use Generated Value"
        />
      )
    },
    [openSecretEditor]
  )

  const baseProviderFields = useMemo<FieldDef[]>(
    () => [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        required: true,
        placeholder: 'e.g. openai-1234',
      },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        advanced: true,
      },
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
      mapTemplateFieldToResourceField(field, () => setSecretDialogOpen(true), openSecretEditor, renderCredentialField)
    )

    return [
      baseProviderFields[0],
      ...baseProviderFields.slice(2, 8),
      ...dynamicFields,
      ...baseProviderFields.slice(8),
    ]
  }, [baseProviderFields, openSecretEditor, renderCredentialField, selectedTemplate])

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
      selected_product: chooserTitle(template),
      selected_product_meta: '',
      selected_product_description: '',
      endpoint: template.defaultEndpoint ?? '',
      credential_use_secret: false,
      api_key_value: '',
      title_name_editing: false,
    }

    for (const field of template.fields ?? []) {
      defaults[field.id] = normalizeTemplateFieldDefault(field)
    }

    setFormData(defaults)
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
    try {
      const body = await buildAIProviderPayload(formData, templatesById)
      const created = await pb.send<AIProviderRecord>('/api/ai-providers', {
        method: 'POST',
        body: {
          ...body,
          is_default: true,
        },
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
                {productOptions.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    className="w-full rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted"
                    onClick={() => selectTemplate(option)}
                  >
                    <div className="text-sm font-medium text-foreground">{chooserTitle(option)}</div>
                  </button>
                ))}
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
        submitLabel="Create Model"
        resetAction={{
          label: 'Back',
          onClick: () => {
            setFormOpen(false)
            setSelectionOpen(true)
            setError('')
          },
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
