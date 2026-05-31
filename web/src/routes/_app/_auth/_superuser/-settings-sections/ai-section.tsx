import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Plus } from 'lucide-react'
import { buildAIProviderPayload } from '@/routes/_app/_auth/resources/ai-providers'
import { pb } from '@/lib/pb'
import type { RelationOption } from '@/components/resources/resource-page-types'
import { SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { selectClass, Toggle } from './shared'

type AIProviderRecord = {
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

const SECRET_TEMPLATE_IDS = new Set(Object.keys(SECRET_TEMPLATE_LABELS))
const AI_PROVIDER_CREDENTIAL_TEMPLATE_ID = 'single_value'
const ADD_MODEL_OPTION_VALUE = '__add_model__'

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

function resolveSecretTemplateId(secretTemplate?: string) {
  const normalized = String(secretTemplate ?? '').trim()
  if (!normalized) return ''
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
  return (
    normalizedId === 'apiversion' ||
    normalizedId === 'api_version' ||
    normalizedLabel === 'api version'
  )
}

function buildProviderOptionLabel(
  provider: AIProviderRecord,
  templatesById: Map<string, AIProviderTemplate>
) {
  const template = templatesById.get(String(provider.template_id ?? ''))
  const model = String(provider.config?.defaultModel ?? provider.config?.model ?? '').trim()
  const providerName = template
    ? chooserTitle(template)
    : humanizeTemplateId(String(provider.template_id ?? ''))
  const recordName = String(provider.name ?? '').trim() || providerName
  const parts = [recordName]
  if (providerName && providerName !== recordName) {
    parts.push(providerName)
  }
  if (model) {
    parts.push(model)
  }
  return parts.join(' / ')
}

async function listSecretOptions(secretTemplate?: string): Promise<RelationOption[]> {
  const apiPath = buildSecretRelationApiPath(secretTemplate)
  const result = await pb.send<{ items?: Array<Record<string, unknown>> }>(apiPath, {
    method: 'GET',
  })
  const items = Array.isArray(result?.items) ? result.items : []
  return items.map(item => ({
    id: String(item.id ?? ''),
    label: formatSecretLabel(item),
    raw: item,
  }))
}

function AIProviderCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (provider: AIProviderRecord) => void
}) {
  const [templates, setTemplates] = useState<AIProviderTemplate[]>([])
  const [templateQuery, setTemplateQuery] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [secretOptions, setSecretOptions] = useState<RelationOption[]>([])
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setTemplateQuery('')
    setSelectedTemplateId('')
    setFormData({})
    setAdvancedOpen(false)
    setSecretOptions([])
    setError('')
    void pb
      .send<AIProviderTemplate[]>('/api/ai-providers/templates', { method: 'GET' })
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [open])

  const templatesById = useMemo(
    () => new Map(templates.map(template => [template.id, template])),
    [templates]
  )

  const selectedTemplate = templatesById.get(selectedTemplateId)

  useEffect(() => {
    const credentialField = selectedTemplate?.fields?.find(field => field.id === 'credential')
    if (!selectedTemplate || !credentialField) {
      setSecretOptions([])
      return
    }
    void listSecretOptions(credentialField.secretTemplate)
      .then(setSecretOptions)
      .catch(() => setSecretOptions([]))
  }, [selectedTemplate])

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = templateQuery.trim().toLowerCase()
    return [...templates]
      .sort((left, right) => chooserTitle(left).localeCompare(chooserTitle(right)))
      .filter(template => {
        if (!normalizedQuery) return true
        return [template.id, template.title, template.vendor, template.description]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      })
  }, [templateQuery, templates])

  const selectTemplate = (template: AIProviderTemplate) => {
    const defaults: Record<string, unknown> = {
      name: buildDefaultProviderName(template),
      template_id: template.id,
      endpoint: template.defaultEndpoint ?? '',
      description: '',
      credential_use_secret: false,
      credential: '',
      api_key_value: '',
      advanced_config: '',
    }
    for (const field of template.fields ?? []) {
      defaults[field.id] = normalizeTemplateFieldDefault(field)
    }
    setSelectedTemplateId(template.id)
    setFormData(defaults)
    setAdvancedOpen(false)
    setError('')
  }

  const updateField = (key: string, value: unknown) => {
    setFormData(current => ({ ...current, [key]: value }))
  }

  const handleCreate = async () => {
    if (!selectedTemplate) return
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
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const visibleFields = (selectedTemplate?.fields ?? []).filter(field => {
    if (field.id === 'credential') return true
    if (!advancedOpen && isAdvancedProviderField(field)) return false
    return true
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl">
          {!selectedTemplate ? (
            <>
              <DialogHeader>
                <DialogTitle>Choose a Product</DialogTitle>
                <DialogDescription>
                  Choose a provider product, then enter connection details.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Input
                  value={templateQuery}
                  onChange={event => setTemplateQuery(event.target.value)}
                  placeholder="Search products like OpenAI, Ollama, Anthropic, OpenRouter..."
                />
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading products...
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {filteredTemplates.map(template => (
                      <Button
                        key={template.id}
                        type="button"
                        variant="outline"
                        className="justify-start"
                        onClick={() => selectTemplate(template)}
                      >
                        {chooserTitle(template)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span>{String(formData.name ?? '') || 'New AI Provider'}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Edit title"
                    onClick={() => {
                      const input = document.getElementById(
                        'settings-ai-provider-name'
                      ) as HTMLInputElement | null
                      input?.focus()
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </DialogTitle>
                <DialogDescription>
                  Add {productTitle(selectedTemplate)} AI Provider
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="settings-ai-provider-name">Name</Label>
                    <Input
                      id="settings-ai-provider-name"
                      value={String(formData.name ?? '')}
                      onChange={event => updateField('name', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="settings-ai-provider-endpoint">Base URL</Label>
                    <Input
                      id="settings-ai-provider-endpoint"
                      value={String(formData.endpoint ?? '')}
                      onChange={event => updateField('endpoint', event.target.value)}
                    />
                  </div>
                </div>

                {visibleFields.map(field => {
                  if (field.id === 'endpoint') return null
                  if (field.id === 'credential') {
                    return (
                      <div key={field.id} className="space-y-1">
                        <Label>{field.label}</Label>
                        <SecretCredentialField
                          inputId="settings-ai-provider-credential"
                          manualValue={String(formData.api_key_value ?? '')}
                          onManualValueChange={value => updateField('api_key_value', value)}
                          useReference={Boolean(formData.credential_use_secret)}
                          onUseReferenceChange={checked => {
                            updateField('credential_use_secret', checked)
                            if (!checked) updateField('credential', '')
                          }}
                          referenceValue={String(formData.credential ?? '')}
                          onReferenceValueChange={value => updateField('credential', value)}
                          options={secretOptions}
                          onCreateReference={() => setSecretDialogOpen(true)}
                          manualPlaceholder={`Enter ${field.label}`}
                          showLabel={`Show ${field.label}`}
                          hideLabel={`Hide ${field.label}`}
                        />
                        {field.helpText && (
                          <p className="text-xs text-muted-foreground">{field.helpText}</p>
                        )}
                      </div>
                    )
                  }

                  if (field.type === 'boolean') {
                    return (
                      <div key={field.id} className="flex items-center gap-3">
                        <Toggle
                          id={`settings-ai-provider-${field.id}`}
                          checked={Boolean(formData[field.id])}
                          onChange={checked => updateField(field.id, checked)}
                        />
                        <Label htmlFor={`settings-ai-provider-${field.id}`}>{field.label}</Label>
                      </div>
                    )
                  }

                  if (field.type === 'json') {
                    return (
                      <div key={field.id} className="space-y-1">
                        <Label htmlFor={`settings-ai-provider-${field.id}`}>{field.label}</Label>
                        <textarea
                          id={`settings-ai-provider-${field.id}`}
                          className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          value={String(formData[field.id] ?? '')}
                          onChange={event => updateField(field.id, event.target.value)}
                          placeholder={field.placeholder}
                        />
                        {field.helpText && (
                          <p className="text-xs text-muted-foreground">{field.helpText}</p>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div key={field.id} className="space-y-1">
                      <Label htmlFor={`settings-ai-provider-${field.id}`}>{field.label}</Label>
                      <Input
                        id={`settings-ai-provider-${field.id}`}
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={String(formData[field.id] ?? '')}
                        onChange={event =>
                          updateField(
                            field.id,
                            field.type === 'number'
                              ? Number(event.target.value)
                              : event.target.value
                          )
                        }
                        placeholder={field.placeholder}
                      />
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground">{field.helpText}</p>
                      )}
                    </div>
                  )
                })}

                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAdvancedOpen(prev => !prev)}
                  >
                    {advancedOpen ? 'Hide Advanced' : 'Advanced'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    New providers created here are set as the platform default automatically.
                  </p>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSelectedTemplateId('')}>
                  Back
                </Button>
                <Button type="button" onClick={() => void handleCreate()} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Create Model
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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
          const label = suffix ? `${name} (${suffix})` : name
          setSecretOptions(current => [...current, { id, label }])
          updateField('credential_use_secret', true)
          updateField('credential', id)
        }}
      />
    </>
  )
}

export function AISettingsSection({
  title,
  description,
  showToast,
}: {
  title: string
  description: string
  showToast: (msg: string, ok?: boolean) => void
}) {
  const [providers, setProviders] = useState<AIProviderRecord[]>([])
  const [templates, setTemplates] = useState<AIProviderTemplate[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const templatesById = useMemo(
    () => new Map(templates.map(template => [template.id, template])),
    [templates]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [providerItems, templateItems] = await Promise.all([
        pb.send<AIProviderRecord[]>('/api/ai-providers', { method: 'GET' }),
        pb.send<AIProviderTemplate[]>('/api/ai-providers/templates', { method: 'GET' }),
      ])
      const normalizedProviders = Array.isArray(providerItems) ? providerItems : []
      const normalizedTemplates = Array.isArray(templateItems) ? templateItems : []
      setProviders(normalizedProviders)
      setTemplates(normalizedTemplates)
      const currentDefault = normalizedProviders.find(item => item.is_default)
      setSelectedProviderId(currentDefault?.id ?? normalizedProviders[0]?.id ?? '')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load AI providers', false)
      setProviders([])
      setTemplates([])
      setSelectedProviderId('')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const providerOptions = useMemo(
    () =>
      providers.map(provider => ({
        label: buildProviderOptionLabel(provider, templatesById),
        value: provider.id,
      })),
    [providers, templatesById]
  )

  const handleSave = async () => {
    const target = providers.find(provider => provider.id === selectedProviderId)
    if (!target) return
    setSaving(true)
    try {
      await pb.send(`/api/ai-providers/${target.id}`, {
        method: 'PUT',
        body: {
          name: target.name ?? '',
          kind: target.kind ?? 'llm',
          is_default: true,
          template_id: target.template_id ?? '',
          endpoint: target.endpoint ?? '',
          auth_scheme: target.auth_scheme ?? '',
          provider_account: target.provider_account ?? '',
          credential: target.credential ?? '',
          config: target.config ?? {},
          description: target.description ?? '',
        },
      })
      await loadData()
      showToast('Default AI model saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save default AI model', false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading AI providers...
            </div>
          ) : providers.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                No AI models available yet. Create one here and set it as the platform default.
              </p>
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Model
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="settings-default-ai-model">Default Model</Label>
                <select
                  id="settings-default-ai-model"
                  className={selectClass}
                  value={selectedProviderId}
                  onChange={event => {
                    const nextValue = event.target.value
                    if (nextValue === ADD_MODEL_OPTION_VALUE) {
                      setCreateOpen(true)
                      return
                    }
                    setSelectedProviderId(nextValue)
                  }}
                >
                  <optgroup label="Available models">
                    {providerOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Actions">
                    <option value={ADD_MODEL_OPTION_VALUE}>+ Add a new model...</option>
                  </optgroup>
                </select>
                <p className="text-xs text-muted-foreground">
                  Pick the AI Provider record that should be used as the platform default model. If
                  your preferred model is missing, use the last dropdown item to add it.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSave} disabled={saving || !selectedProviderId}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AIProviderCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={provider => {
          void loadData().then(() => {
            setSelectedProviderId(provider.id)
            showToast('AI model created and selected as default')
          })
        }}
      />
    </>
  )
}
