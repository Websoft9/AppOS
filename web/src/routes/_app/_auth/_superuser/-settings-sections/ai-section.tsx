import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleHelp, Loader2 } from 'lucide-react'
import { pb } from '@/lib/pb'
import type { AIProviderRecord, AIProviderTemplate } from '@/lib/ai-providers'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { selectClass } from './shared'

type AIProviderDefaultSelection = {
  endpoint: string
  provider_id: string
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

function buildProviderOptionLabel(
  provider: AIProviderRecord,
  templatesById: Map<string, AIProviderTemplate>
) {
  const template = templatesById.get(String(provider.template_id ?? ''))
  const recordName = String(provider.name ?? '').trim()
  const model = String(provider.config?.defaultModel ?? provider.config?.model ?? '').trim()
  const providerName = template
    ? chooserTitle(template)
    : humanizeTemplateId(String(provider.template_id ?? ''))
  if (recordName && model) return `${recordName} · ${model}`
  if (recordName) return recordName
  if (model) return `${providerName} · ${model}`
  return providerName || 'Unnamed AI Provider'
}

function InlineTooltip({ label, content }: { label: string; content: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-5">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  const [defaultSelections, setDefaultSelections] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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

  const providerGroups = useMemo(() => {
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
        providerName: (() => {
          const template = templatesById.get(String(items[0]?.template_id ?? ''))
          return template
            ? chooserTitle(template)
            : humanizeTemplateId(String(items[0]?.template_id ?? ''))
        })(),
        items: [...items].sort((left, right) => {
          const leftCreated = String(left.created ?? '')
          const rightCreated = String(right.created ?? '')
          if (leftCreated && rightCreated && leftCreated !== rightCreated) {
            return leftCreated.localeCompare(rightCreated)
          }
          return String(left.name ?? '').localeCompare(String(right.name ?? ''))
        }),
      }))
      .filter(group => group.items.length > 1)
      .sort(
        (left, right) =>
          left.providerName.localeCompare(right.providerName) ||
          left.endpoint.localeCompare(right.endpoint)
      )
  }, [providers, templatesById])

  const resolvedSelections = useMemo(
    () =>
      providerGroups.reduce<Record<string, string>>((accumulator, group) => {
        const configured = defaultSelections[group.endpoint]
        const existing = group.items.find(item => item.id === configured)
        accumulator[group.endpoint] = existing?.id ?? group.items[0]?.id ?? ''
        return accumulator
      }, {}),
    [defaultSelections, providerGroups]
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      await pb.send('/api/ai-providers/defaults', {
        method: 'PUT',
        body: {
          items: providerGroups
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
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-lg border border-border/40 bg-background p-4">
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading AI providers...
            </div>
          ) : providerGroups.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed border-border/60 bg-muted/10 p-4">
              <p className="text-sm text-muted-foreground">
                {providers.length === 0
                  ? 'No AI Provider accounts yet. Add one in Resources.'
                  : `Currently ${providers.length} AI provider account${providers.length === 1 ? '' : 's'}. Add more to choose a default.`}
              </p>
              <div>
                <Button type="button" variant="outline" asChild>
                  <a href="/resources/ai-providers">Open AI Providers</a>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-3 px-1 text-sm font-medium text-muted-foreground md:grid">
                <div>Provider Name</div>
                <div className="flex items-center gap-1.5">
                  <span>Default Account</span>
                  <InlineTooltip
                    label="Default Account help"
                    content="AppOS uses the earliest created account by default until you choose a different account for this provider."
                  />
                </div>
              </div>
              <div className="space-y-3">
                {providerGroups.map(group => (
                  <div
                    key={group.endpoint}
                    className="grid gap-3 rounded-lg border border-border/60 p-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-foreground">{group.providerName}</p>
                      <p className="text-xs text-muted-foreground">{group.endpoint}</p>
                    </div>
                    <div className="space-y-2">
                      <Label
                        className="md:sr-only"
                        htmlFor={`settings-ai-provider-${group.endpoint}`}
                      >
                        Default Account
                      </Label>
                      <select
                        id={`settings-ai-provider-${group.endpoint}`}
                        className={selectClass}
                        value={resolvedSelections[group.endpoint] ?? ''}
                        onChange={event => {
                          const nextValue = event.target.value
                          setDefaultSelections(current => ({
                            ...current,
                            [group.endpoint]: nextValue,
                          }))
                        }}
                      >
                        {group.items.map(provider => (
                          <option key={provider.id} value={provider.id}>
                            {buildProviderOptionLabel(provider, templatesById)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || providerGroups.length === 0}
                >
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

              <p className="text-sm text-muted-foreground">
                Need to add or manage accounts first?{' '}
                <a
                  className="font-medium text-foreground underline underline-offset-4"
                  href="/resources/ai-providers"
                >
                  Open AI Providers
                </a>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
