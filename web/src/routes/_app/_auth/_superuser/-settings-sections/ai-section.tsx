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

type AIProviderDefaultSelection = {
  endpoint: string
  provider_id: string
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
  const [defaultSelections, setDefaultSelections] = useState<Record<string, string>>({})
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
      const [providerItems, templateItems, defaultsResponse] = await Promise.all([
        pb.send<AIProviderRecord[]>('/api/ai-providers', { method: 'GET' }),
        pb.send<AIProviderTemplate[]>('/api/ai-providers/templates', { method: 'GET' }),
        pb.send<{ items?: AIProviderDefaultSelection[] }>('/api/ai-providers/defaults', {
          method: 'GET',
        }),
      ])
      const normalizedProviders = Array.isArray(providerItems) ? providerItems : []
      const normalizedTemplates = Array.isArray(templateItems) ? templateItems : []
      const normalizedDefaults = Array.isArray(defaultsResponse?.items)
        ? defaultsResponse.items
        : []
      setProviders(normalizedProviders)
      setTemplates(normalizedTemplates)
      setDefaultSelections(
        normalizedDefaults.reduce<Record<string, string>>((accumulator, item) => {
          const endpoint = String(item.endpoint ?? '').trim()
          const providerID = String(item.provider_id ?? '').trim()
          if (endpoint && providerID) {
            accumulator[endpoint] = providerID
          }
          return accumulator
        }, {})
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load AI providers', false)
      setProviders([])
      setTemplates([])
      setDefaultSelections({})
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const endpointGroups = useMemo(() => {
    const groups = new Map<string, AIProviderRecord[]>()
    for (const provider of providers) {
      const endpoint = String(provider.endpoint ?? '').trim()
      if (!endpoint) continue
      const current = groups.get(endpoint) ?? []
      current.push(provider)
      groups.set(endpoint, current)
    }
    return Array.from(groups.entries())
      .map(([endpoint, items]) => ({
        endpoint,
        items: [...items].sort((left, right) => {
          const leftPreferred = left.is_default ? 1 : 0
          const rightPreferred = right.is_default ? 1 : 0
          if (leftPreferred !== rightPreferred) {
            return rightPreferred - leftPreferred
          }
          return String(left.name ?? '').localeCompare(String(right.name ?? ''))
        }),
      }))
      .sort((left, right) => left.endpoint.localeCompare(right.endpoint))
  }, [providers])

  const resolvedSelections = useMemo(
    () =>
      endpointGroups.reduce<Record<string, string>>((accumulator, group) => {
        const configured = defaultSelections[group.endpoint]
        const existing = group.items.find(item => item.id === configured)
        accumulator[group.endpoint] =
          existing?.id ?? group.items.find(item => item.is_default)?.id ?? group.items[0]?.id ?? ''
        return accumulator
      }, {}),
    [defaultSelections, endpointGroups]
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      await pb.send('/api/ai-providers/defaults', {
        method: 'PUT',
        body: {
          items: endpointGroups
            .map(group => ({
              endpoint: group.endpoint,
              provider_id: resolvedSelections[group.endpoint] ?? '',
            }))
            .filter(item => item.endpoint && item.provider_id),
        },
      })
      await loadData()
      showToast('AI provider defaults saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save AI provider defaults', false)
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
              <div className="space-y-4">
                {endpointGroups.map(group => (
                  <div key={group.endpoint} className="space-y-1 rounded-lg border p-3">
                    <Label htmlFor={`settings-ai-provider-${group.endpoint}`}>
                      Preferred provider for endpoint
                    </Label>
                    <div className="text-xs text-muted-foreground">{group.endpoint}</div>
                    <select
                      id={`settings-ai-provider-${group.endpoint}`}
                      className={selectClass}
                      value={resolvedSelections[group.endpoint] ?? ''}
                      onChange={event => {
                        const nextValue = event.target.value
                        if (nextValue === ADD_MODEL_OPTION_VALUE) {
                          setCreateOpen(true)
                          return
                        }
                        setDefaultSelections(current => ({
                          ...current,
                          [group.endpoint]: nextValue,
                        }))
                      }}
                    >
                      <optgroup label="Available providers">
                        {group.items.map(provider => (
                          <option key={provider.id} value={provider.id}>
                            {buildProviderOptionLabel(provider, templatesById)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Actions">
                        <option value={ADD_MODEL_OPTION_VALUE}>+ Add a new model...</option>
                      </optgroup>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      When multiple AI Provider records share this endpoint, chat uses this
                      preferred record first. If no preference is saved, the earliest matching
                      provider remains the fallback.
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSave} disabled={saving || endpointGroups.length === 0}>
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
        onCreated={() => {
          void loadData().then(() => {
            showToast('AI model created')
          })
        }}
      />
    </>
  )
}
