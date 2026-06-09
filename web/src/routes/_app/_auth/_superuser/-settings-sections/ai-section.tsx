import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { pb } from '@/lib/pb'
import { AIProviderCreateFlowDialog as SharedAIProviderCreateFlowDialog } from '@/components/ai/AIProviderCreateFlowDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { selectClass } from './shared'

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

type AIProviderTemplate = {
  id: string
  kind: string
  title: string
  vendor?: string
  description?: string
}

const ADD_MODEL_OPTION_VALUE = '__add_model__'

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

      <SharedAIProviderCreateFlowDialog
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
