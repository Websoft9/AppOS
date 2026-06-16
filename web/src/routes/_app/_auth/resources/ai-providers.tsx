import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AIProviderCreateFlowDialog } from '@/components/ai/AIProviderCreateFlowDialog'
import {
  AIProviderModelSelector,
  type AIProviderModelGroup as ProviderModelGroup,
  type AIProviderModelOption as ProviderModelOption,
} from '@/components/ai/AIProviderModelSelector'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pencil,
  Power,
  PowerOff,
  X,
} from 'lucide-react'
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
import { ReferenceSelect } from '@/components/resources/ReferenceSelect'
import type { RelationOption } from '@/components/resources/resource-page-types'
import { ResourcesBreadcrumb } from '@/components/resources/ResourcesBreadcrumb'
import { buildApiKeyValue, SecretCredentialField } from '@/components/secrets/SecretCredentialField'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { buildUserVisibleSecretRelationApiPath } from '@/components/secrets/resource-secret-relations'
import {
  AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
  buildAIProviderPayload,
  formatSecretLabel,
  inferAWSRegionFromEndpoint,
  type AIProviderRecord,
  type AIProviderTemplate,
  type AIProviderTemplateField,
  isAdvancedProviderField,
  reconcileProviderModelSelection,
  normalizeTemplateFieldDefault,
  normalizeEnabledModels,
  providerSelectionGroup,
  productTitle,
  resolveTemplateEndpoint,
  resolveAIProviderEnabled,
  sanitizeProviderModelGroups,
  sanitizeProviderModelOptions,
} from '@/lib/ai-providers'
import { getLocale } from '@/lib/i18n'
import { pb } from '@/lib/pb'

type Translate = (key: string, options?: Record<string, unknown>) => string

type ConnectionSummaryState = {
  loading?: boolean
  error?: string
  models?: string[]
  modelGroups?: { label: string; models: string[] }[]
} | null

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

function renderEndpointFieldLabel(helpUrl: string) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-foreground">API Endpoint</label>
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
  )
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

function InlineSecretEditorField({
  inputId,
  referenceValue,
  referenceOptions,
  inlineEditing,
  inlineValue,
  onReferenceValueChange,
  onStartInlineEdit,
  onInlineValueChange,
  onCancelInlineEdit,
}: {
  inputId: string
  referenceValue: string
  referenceOptions: RelationOption[]
  inlineEditing: boolean
  inlineValue: string
  onReferenceValueChange: (value: string) => void
  onStartInlineEdit: () => void
  onInlineValueChange: (value: string) => void
  onCancelInlineEdit: () => void
}) {
  const [referencePickerOpen, setReferencePickerOpen] = useState(false)

  if (inlineEditing) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="password"
            value={inlineValue}
            onChange={event => onInlineValueChange(event.target.value)}
            placeholder="Enter a new API key to update the current secret"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            title="Cancel secret edit"
            onClick={onCancelInlineEdit}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Saving this provider will update the current secret value in place.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-[220px] flex-1">
        <ReferenceSelect
          id={`${inputId}-reference`}
          value={referenceValue}
          options={referenceOptions}
          onSelect={value => {
            onReferenceValueChange(value)
            onCancelInlineEdit()
          }}
          placeholder="Select a Secret"
          searchPlaceholder="Search secrets..."
          emptyMessage="No matching secrets."
          showNoneOption={false}
          borderlessMenu
          onOpenChange={setReferencePickerOpen}
        />
      </div>
      {referenceValue ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-10 w-10 shrink-0 ${referencePickerOpen ? 'self-start' : 'self-center'}`}
          title="Edit secret value"
          onClick={onStartInlineEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
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

function inferModelGroupLabel(modelId: string): string {
  const trimmed = modelId.trim()
  if (!trimmed) return 'Other'

  // / prefix is always the vendor (e.g. openai/gpt-4o → Openai, kimi/kimi-k2.6 → Kimi)
  if (trimmed.includes('/')) {
    const vendor = trimmed.split('/')[0]
    return vendor.charAt(0).toUpperCase() + vendor.slice(1)
  }

  // Split by -, extract first segment
  const firstDash = trimmed.indexOf('-')
  if (firstDash === -1) return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)

  const prefix = trimmed.substring(0, firstDash)
  const rest = trimmed.substring(firstDash + 1)
  const secondDash = rest.indexOf('-')
  const secondSeg = secondDash === -1 ? rest : rest.substring(0, secondDash)

  // Include second segment if it looks like a version: v4, r1, 3.5, 5.1, etc.
  if (/^(v\d+|r\d+|\d+(\.\d+)?)$/i.test(secondSeg)) {
    const combined = `${prefix}-${secondSeg}`
    return combined.charAt(0).toUpperCase() + combined.slice(1)
  }

  return prefix.charAt(0).toUpperCase() + prefix.slice(1)
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
    hour12: false,
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
    helpUrl: field.helpUrl,
    helpText: field.helpText,
  }
}

export { buildAIProviderPayload }

function mapAIProviderRow(
  item: AIProviderRecord,
  templatesById: Map<string, AIProviderTemplate>,
  secretNamesById: Map<string, string>,
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
  const inferredRegion =
    String(item.template_id ?? '') === 'aws-bedrock'
      ? String(item.config?.region ?? '').trim() ||
        inferAWSRegionFromEndpoint(String(item.endpoint ?? ''))
      : ''

  return {
    id: item.id,
    name: String(item.name ?? ''),
    template_id: String(item.template_id ?? ''),
    provider: template?.title ?? humanizeTemplateId(String(item.template_id ?? '')),
    is_enabled: resolveAIProviderEnabled(item.is_enabled),
    enabled_status: normalizeEnabledStatus(item.is_enabled),
    reachability: reachabilityOverrides?.get(String(item.id ?? '')) ?? resolveReachability(item, t),
    endpoint: String(item.endpoint ?? ''),
    credential: String(item.credential ?? ''),
    credential_name:
      secretNamesById.get(String(item.credential ?? '').trim()) ??
      String(item.credential ?? '').trim(),
    credential_use_secret: Boolean(String(item.credential ?? '').trim()),
    api_key_value: '',
    endpoint_editing: false,
    enabled_models: enabledModels,
    credential_secret_editing: false,
    credential_secret_value: '',
    region: inferredRegion || String(item.config?.region ?? ''),
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
  onNameClick: (id: string, row: Record<string, unknown>) => void,
  onToggleEnabled: (item: Record<string, unknown>) => void,
  onShowModels: (id: string, row: Record<string, unknown>) => void,
  reachabilityOverrides: Record<string, string>,
  enabledModelsCount: Record<string, number>
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
            onClick={() => onNameClick(id, row)}
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
      label: t('aiProviders.columns.enabled'),
      sortable: true,
      filterOptions: [
        { label: t('aiProviders.enabled.yes'), value: 'Enabled' },
        { label: t('aiProviders.enabled.no'), value: 'Disabled' },
      ],
      filterValue: row => String(row.enabled_status ?? ''),
      render: (_value, row) => {
        const enabled = resolveAIProviderEnabled(row.is_enabled)
        return (
          <button
            type="button"
            className={
              enabled
                ? 'inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
                : 'inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer'
            }
            onClick={() => onToggleEnabled(row)}
            title={enabled ? t('aiProviders.actions.disable') : t('aiProviders.actions.enable')}
          >
            {enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
            {enabled ? t('aiProviders.enabled.yes') : t('aiProviders.enabled.no')}
          </button>
        )
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
      render: (value, row) => {
        const status = normalizeReachabilityStatus(
          reachabilityOverrides[String(row.id ?? '')] ?? value,
          t
        )
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
      key: 'enabled_models_count',
      label: 'Enabled Model(s)',
      render: (_value, row) => {
        const id = String(row.id ?? '')
        const count = enabledModelsCount[id]
        if (count === undefined) return <span className="text-muted-foreground">—</span>
        if (count === 0)
          return <span className="text-left tabular-nums text-muted-foreground">0 models</span>
        return (
          <button
            type="button"
            className="block w-full text-left tabular-nums font-medium text-primary transition-colors hover:text-primary/80"
            onClick={() => onShowModels(id, row)}
          >
            {count} model{count === 1 ? '' : 's'}
          </button>
        )
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
  const [editModelOptions, setEditModelOptions] = useState<ProviderModelOption[]>([])
  const [editModelGroups, setEditModelGroups] = useState<ProviderModelGroup[]>([])
  const [editModelsValidated, setEditModelsValidated] = useState(false)
  const [listTestState, setListTestState] = useState<{
    providerId: string
    summary: ConnectionSummaryState
  } | null>(null)
  const [reachabilityOverrides, setReachabilityOverrides] = useState<Record<string, string>>({})
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null)
  const [expandedModelsId, setExpandedModelsId] = useState<string | null>(null)
  const [enabledModelsCount, setEnabledModelsCount] = useState<Record<string, number>>({})
  const [editingDetailName, setEditingDetailName] = useState<string | null>(null)
  const [detailNameDraft, setDetailNameDraft] = useState('')
  const editingTemplateIdRef = useRef('')
  const enabledModelsCountRef = useRef<Record<string, number>>({})
  const reachabilityRequestVersionRef = useRef(0)

  function groupModelsByPrefix(modelIds: string[]): { label: string; models: string[] }[] {
    const groups: Record<string, string[]> = {}
    const order: string[] = []
    for (const id of modelIds) {
      const label = inferModelGroupLabel(id)
      if (!groups[label]) {
        groups[label] = []
        order.push(label)
      }
      groups[label].push(id)
    }
    if (order.length <= 1) return []
    return order.map(label => ({ label, models: groups[label] }))
  }

  const handleEditTestConnection = useCallback(
    async (
      editingItem: Record<string, unknown> | null,
      onPruneSelection?: (models: string[]) => void,
      currentSelection?: unknown,
      fetchInput?: { endpoint: string; apiKey: string; templateID: string }
    ) => {
      setEditTestResult({ loading: true })
      setEditModelsValidated(false)
      try {
        const providerId = String(editingItem?.id ?? '')
        let result: ProviderModelsResponse
        if (fetchInput) {
          result = await pb.send<ProviderModelsResponse>('/api/ai-providers/fetch-models', {
            method: 'POST',
            body: {
              endpoint: fetchInput.endpoint,
              api_key: fetchInput.apiKey,
              template_id: fetchInput.templateID,
            },
          })
        } else {
          if (!providerId) return
          result = await pb.send<ProviderModelsResponse>(`/api/ai-providers/models/${providerId}`, {
            method: 'GET',
          })
        }
        const models = sanitizeProviderModelOptions(result?.models ?? [])
        setEditModelOptions(models)
        setEditModelGroups(sanitizeProviderModelGroups(result?.groups ?? []))
        if (onPruneSelection) {
          onPruneSelection(
            reconcileProviderModelSelection(
              currentSelection,
              models.map(model => model.id)
            )
          )
        }
        setEditModelsValidated(true)
        setEditTestResult({ models: models.map(model => model.id) })
      } catch (err) {
        setEditModelOptions([])
        setEditModelGroups([])
        setEditTestResult({ error: describeProviderModelsError(err) })
      }
    },
    []
  )

  const handleListTestConnection = useCallback(async (item: Record<string, unknown>) => {
    const providerId = String(item.id ?? '')
    if (!providerId) return
    setExpandedDetailId(providerId)
    setListTestState({ providerId, summary: { loading: true } })
    try {
      const result = await pb.send<ProviderModelsResponse>(
        `/api/ai-providers/models/${providerId}`,
        { method: 'GET' }
      )
      const rawModels = sanitizeProviderModelOptions(result?.models ?? [])
      const modelIds = rawModels.map(model => model.id)
      const apiGroups = sanitizeProviderModelGroups(result?.groups ?? [])
      const modelGroups =
        apiGroups.length > 1
          ? apiGroups.map(group => ({
              label: group.label,
              models: (group.models ?? []).map(m => m.id).filter(Boolean),
            }))
          : groupModelsByPrefix(modelIds)
      setListTestState({ providerId, summary: { models: modelIds, modelGroups } })
    } catch (err) {
      setListTestState({
        providerId,
        summary: { error: err instanceof Error ? err.message : 'Connection test failed' },
      })
    }
  }, [])

  const handleShowModels = useCallback(
    (id: string, row: Record<string, unknown>) => {
      if (expandedDetailId === id) {
        setExpandedDetailId(null)
        setExpandedModelsId(null)
        return
      }
      setExpandedDetailId(id)
      setExpandedModelsId(null)
      if (listTestState?.providerId !== id) {
        void handleListTestConnection(row)
      }
    },
    [expandedDetailId, listTestState?.providerId, handleListTestConnection]
  )

  const fetchEnabledModelCounts = useCallback((items: Record<string, unknown>[]) => {
    const counts: Record<string, number> = {}
    for (const item of items) {
      const id = String(item.id ?? '')
      if (!id) continue
      const models = normalizeEnabledModels(item.enabled_models)
      counts[id] = models.length
    }
    enabledModelsCountRef.current = counts
    setEnabledModelsCount({ ...counts })
  }, [])

  const fetchReachabilityStatuses = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        setReachabilityOverrides({})
        return
      }
      const requestVersion = reachabilityRequestVersionRef.current + 1
      reachabilityRequestVersionRef.current = requestVersion
      try {
        const params = new URLSearchParams({ ids: ids.join(',') })
        const result = await pb.send<{ items?: Array<{ id: string; status: string }> }>(
          `/api/ai-providers/reachability?${params.toString()}`,
          { method: 'GET' }
        )
        if (reachabilityRequestVersionRef.current !== requestVersion) {
          return
        }
        setReachabilityOverrides(
          Object.fromEntries(
            (result.items ?? []).map(entry => [
              String(entry.id ?? ''),
              normalizeReachabilityStatus(entry.status, t),
            ])
          )
        )
      } catch {
        if (reachabilityRequestVersionRef.current !== requestVersion) {
          return
        }
        setReachabilityOverrides({})
      }
    },
    [t]
  )

  const handleNameClick = useCallback(
    (id: string, row: Record<string, unknown>) => {
      if (expandedDetailId === id) {
        setExpandedDetailId(null)
        setExpandedModelsId(null)
        setEditingDetailName(null)
        return
      }
      setExpandedDetailId(id)
      setExpandedModelsId(null)
      if (listTestState?.providerId !== id) {
        void handleListTestConnection(row)
      }
    },
    [expandedDetailId, listTestState?.providerId, handleListTestConnection]
  )

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <ResourcesBreadcrumb parentLabel={t('hub.title')} currentPage={t('aiProviders.page.title')} />
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

  const handleToggleEnabled = useCallback(
    async (item: Record<string, unknown>) => {
      const providerId = String(item.id ?? '')
      if (!providerId) return
      const enabled = resolveAIProviderEnabled(item.is_enabled)
      const body = await buildAIProviderPayload(
        { ...item, is_enabled: !enabled },
        providerTemplatesById,
        t
      )
      await pb.send(`/api/ai-providers/${providerId}`, { method: 'PUT', body })
      setRefreshKey(key => key + 1)
    },
    [providerTemplatesById, t]
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

      if (editMode) {
        return (
          <InlineSecretEditorField
            inputId={inputId}
            referenceValue={String(formData.credential ?? '')}
            referenceOptions={relationOptions}
            inlineEditing={Boolean(formData.credential_secret_editing)}
            inlineValue={String(formData.credential_secret_value ?? '')}
            onReferenceValueChange={value => updateField('credential', value)}
            onStartInlineEdit={() => {
              updateField('credential_secret_editing', true)
              updateField('credential_secret_value', '')
            }}
            onInlineValueChange={value => updateField('credential_secret_value', value)}
            onCancelInlineEdit={() => {
              updateField('credential_secret_editing', false)
              updateField('credential_secret_value', '')
            }}
          />
        )
      }

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
          referenceToggleMode="icon"
          editReferenceMode="icon"
        />
      )
    },
    [openSecretDialog, openSecretEditor, t]
  )

  const renderEndpointField = useCallback<NonNullable<FieldDef['render']>>(
    ({ inputId, formData, updateField }) => {
      const current = String(formData.endpoint ?? '')
      const editing = Boolean(formData.endpoint_editing)
      const selectedTemplate = providerTemplatesById.get(String(formData.template_id ?? ''))
      const helpUrl = String(selectedTemplate?.helpUrl ?? '').trim()

      return (
        <div className="space-y-1.5">
          {renderEndpointFieldLabel(helpUrl)}
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              type="text"
              className={`border-input h-10 w-full rounded-md border px-3 text-sm ${editing ? 'bg-background' : 'bg-muted/40 text-muted-foreground'}`}
              value={current}
              onChange={event => updateField('endpoint', event.target.value)}
              readOnly={!editing}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              title={editing ? 'Done' : 'Edit endpoint'}
              onClick={() => updateField('endpoint_editing', !editing)}
            >
              {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )
    },
    [providerTemplatesById]
  )

  const renderEnabledModelsField = useCallback<NonNullable<FieldDef['render']>>(
    ({ formData, updateField, editingItem }) => {
      const selectedModels = normalizeEnabledModels(formData.enabled_models)
      const inlineSecretValue = String(formData.credential_secret_value ?? '').trim()
      const shouldUseInlineSecret =
        Boolean(formData.credential_secret_editing) && inlineSecretValue.length > 0
      return (
        <AIProviderModelSelector
          selectedModels={selectedModels}
          models={editModelOptions}
          groups={editModelGroups}
          loading={Boolean(editTestResult?.loading)}
          error={editTestResult?.error}
          loaded={editModelsValidated}
          canLoad={true}
          onListModels={() => {
            void handleEditTestConnection(
              editingItem,
              models => updateField('enabled_models', models),
              selectedModels,
              shouldUseInlineSecret
                ? {
                    endpoint: String(formData.endpoint ?? '').trim(),
                    apiKey: inlineSecretValue,
                    templateID: String(formData.template_id ?? '').trim(),
                  }
                : undefined
            )
          }}
          onToggleModel={modelId => {
            updateField(
              'enabled_models',
              selectedModels.includes(modelId)
                ? selectedModels.filter(item => item !== modelId)
                : [...selectedModels, modelId]
            )
          }}
        />
      )
    },
    [
      editModelGroups,
      editModelOptions,
      editModelsValidated,
      editTestResult,
      handleEditTestConnection,
    ]
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
          const nextDefaults: Record<string, unknown> = {}
          for (const field of template?.fields ?? []) {
            if (field.default !== undefined) {
              const normalized = normalizeTemplateFieldDefault(field)
              nextDefaults[field.id] = normalized
              update(field.id, normalized)
            }
          }
          update('endpoint', resolveTemplateEndpoint(template, nextDefaults))
          update('enabled_models', normalizeEnabledModels(template?.defaultEnabledModels ?? []))
        },
      },
      {
        key: 'is_enabled',
        label: 'Enable it',
        type: 'text',
        hideLabel: true,
        defaultValue: true,
        advanced: true,
        render: ({ formData, updateField }) => {
          const enabled = Boolean(formData.is_enabled ?? true)
          return (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Enable it</div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="edit-provider-enabled"
                    checked={enabled}
                    onChange={() => updateField('is_enabled', true)}
                  />
                  <span>Yes</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="edit-provider-enabled"
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
        key: 'credential_secret_editing',
        label: 'Credential Secret Editing',
        type: 'boolean',
        hidden: true,
        defaultValue: false,
      },
      {
        key: 'credential_secret_value',
        label: 'Credential Secret Value',
        type: 'password',
        hidden: true,
        defaultValue: '',
      },
      {
        key: 'enabled_models',
        label: 'Enabled Models',
        type: 'text',
        hidden: true,
        defaultValue: [],
      },
      {
        key: 'endpoint_editing',
        label: 'Endpoint Editing',
        type: 'boolean',
        hidden: true,
        defaultValue: false,
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
      const dynamicFields = (selectedTemplate?.fields ?? []).flatMap(field => {
        if (field.id === 'credential') {
          const credentialField: FieldDef = {
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
          }

          return [
            credentialField,
            {
              key: 'select_models',
              label: 'Select Models',
              type: 'text',
              hideLabel: true,
              render: renderEnabledModelsField,
            } satisfies FieldDef,
          ]
        }

        const mappedField = mapTemplateFieldToResourceField(
          field,
          openSecretDialog,
          openSecretEditor,
          t
        )
        if (selectedTemplate?.id === 'aws-bedrock' && field.id === 'region') {
          return [
            {
              ...mappedField,
              onValueChange: (value: unknown, update: (key: string, value: unknown) => void) => {
                update(
                  'endpoint',
                  resolveTemplateEndpoint(selectedTemplate, { ...formData, region: value })
                )
              },
            },
          ]
        }
        return [mappedField]
      })

      let normalizedDynamicFields = dynamicFields.map(field => {
        if (field.key !== 'endpoint') return field
        return {
          ...field,
          label: 'API Endpoint',
          hideLabel: true,
          render: renderEndpointField,
        }
      })

      if (selectedTemplate?.id === 'aws-bedrock') {
        normalizedDynamicFields = moveFieldBefore(normalizedDynamicFields, 'region', 'endpoint')
      }

      if (editingItem) {
        return [
          { ...baseProviderFields[0], hidden: true },
          { ...baseProviderFields[1], readOnly: true },
          ...normalizedDynamicFields,
          baseProviderFields[3],
          ...baseProviderFields.slice(5),
          baseProviderFields[2],
        ]
      }

      return [
        baseProviderFields[0],
        ...baseProviderFields.slice(2, 5),
        ...normalizedDynamicFields,
        ...baseProviderFields.slice(5),
      ]
    },
    [
      baseProviderFields,
      openSecretDialog,
      openSecretEditor,
      providerTemplatesById,
      renderCredentialField,
      renderEndpointField,
      renderEnabledModelsField,
      t,
    ]
  )

  const columns = useMemo(
    () =>
      buildColumns(
        t,
        providerFilterOptions,
        handleNameClick,
        handleToggleEnabled,
        handleShowModels,
        reachabilityOverrides,
        enabledModelsCount
      ),
    [
      handleNameClick,
      handleToggleEnabled,
      providerFilterOptions,
      t,
      handleShowModels,
      reachabilityOverrides,
      enabledModelsCount,
    ]
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
          expandedRowId: expandedDetailId,
          renderRowDetail: item => {
            const providerId = String(item.id ?? '')
            if (providerId === '' || expandedDetailId !== providerId) {
              return null
            }
            const template = providerTemplatesById.get(String(item.template_id ?? ''))
            const endpointHelpUrl =
              template?.fields?.find(field => field.id === 'endpoint')?.helpUrl?.trim() ?? ''
            const enabled = resolveAIProviderEnabled(item.is_enabled)
            const reachability =
              reachabilityOverrides[providerId] ?? String(item.reachability ?? '')
            const reachVariant =
              reachability === t('aiProviders.status.reachable')
                ? 'default'
                : reachability === t('aiProviders.status.unreachable')
                  ? 'destructive'
                  : 'secondary'
            const enabledModels = normalizeEnabledModels(item.enabled_models)
            const modelsState =
              listTestState?.providerId === providerId ? listTestState.summary : null
            const modelsLoaded = modelsState?.models != null
            const modelsFetching = modelsState?.loading === true
            const modelsError = modelsState?.error
            const modelsCount = modelsLoaded ? (modelsState.models?.length ?? 0) : 0
            const modelsExpanded = expandedModelsId === providerId

            const fields: { label: string; value: string | React.ReactNode }[] = [
              { label: 'ID', value: providerId },
              {
                label: t('aiProviders.columns.name'),
                value:
                  editingDetailName === providerId ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        className="h-7 w-full max-w-[200px] rounded border border-input bg-background px-2 text-sm"
                        value={detailNameDraft}
                        onChange={e => setDetailNameDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            const newName = detailNameDraft.trim()
                            if (newName) {
                              const updated = { ...item, name: newName }
                              void buildAIProviderPayload(updated, providerTemplatesById, t)
                                .then(body =>
                                  pb.send(`/api/ai-providers/${providerId}`, {
                                    method: 'PUT',
                                    body,
                                  })
                                )
                                .then(() => {
                                  setEditingDetailName(null)
                                  setRefreshKey(k => k + 1)
                                })
                                .catch(() => {})
                            }
                          }
                          if (e.key === 'Escape') {
                            setEditingDetailName(null)
                          }
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditingDetailName(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-left transition-colors hover:text-primary"
                      onClick={() => {
                        setDetailNameDraft(String(item.name ?? ''))
                        setEditingDetailName(providerId)
                      }}
                    >
                      {String(item.name ?? '—')}
                    </button>
                  ),
              },
              {
                label: 'Provider',
                value: (
                  <span className="inline-flex items-center gap-2">
                    <span>{String(item.provider ?? '—')}</span>
                    {String(template?.helpUrl ?? '').trim() ? (
                      <a
                        href={String(template?.helpUrl ?? '').trim()}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Open provider documentation"
                        title="Open provider documentation"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </span>
                ),
              },
              {
                label: t('aiProviders.columns.enabled'),
                value: (
                  <span
                    className={
                      enabled ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
                    }
                  >
                    {enabled ? t('aiProviders.enabled.yes') : t('aiProviders.enabled.no')}
                  </span>
                ),
              },
              {
                label: t('aiProviders.columns.reachability'),
                value: <Badge variant={reachVariant}>{reachability}</Badge>,
              },
              {
                label: 'Secret',
                value: String(item.credential ?? '').trim() ? (
                  <span className="inline-flex items-center gap-2">
                    <a
                      href={`/secrets?id=${encodeURIComponent(String(item.credential ?? ''))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="transition-colors hover:text-primary"
                    >
                      {String(item.credential_name ?? item.credential ?? '—')}
                    </a>
                    <a
                      href={`/secrets?id=${encodeURIComponent(String(item.credential ?? ''))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Open secret"
                      title="Open secret"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </span>
                ) : (
                  '—'
                ),
              },
              {
                label: t('aiProviders.columns.endpoint'),
                value: String(item.endpoint ?? '').trim() ? (
                  <span className="inline-flex items-center gap-2">
                    <span>{String(item.endpoint ?? '—')}</span>
                    {endpointHelpUrl ? (
                      <a
                        href={endpointHelpUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Open official API endpoint help"
                        title="Open official API endpoint help"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </span>
                ) : (
                  '—'
                ),
              },
            ]
            if (String(item.description ?? '').trim()) {
              fields.push({ label: 'Description', value: String(item.description ?? '') })
            }
            fields.push(
              { label: t('aiProviders.columns.created'), value: formatDateTime(item.created) },
              { label: t('aiProviders.columns.updated'), value: formatDateTime(item.updated) }
            )

            return (
              <div className="space-y-4 rounded-lg border bg-muted/10 px-4 py-3">
                <div className="grid grid-cols-[100px_1fr] gap-x-4 gap-y-2 text-sm">
                  {fields.map(field => (
                    <Fragment key={field.label}>
                      <span className="text-muted-foreground">{field.label}</span>
                      <span className="min-w-0 break-all">{field.value}</span>
                    </Fragment>
                  ))}
                </div>

                <div className="border-t pt-3">
                  <span className="text-sm font-medium">Models</span>

                  {enabledModels.length > 0 ? (
                    <div className="mt-2">
                      <div className="mb-1.5 text-xs text-muted-foreground">
                        Enabled models ({enabledModels.length}):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {enabledModels.map(model => (
                          <span
                            key={model}
                            className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium"
                          >
                            {model}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">No enabled models.</div>
                  )}

                  {modelsFetching ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading models...
                    </div>
                  ) : modelsError ? (
                    <div className="mt-2 rounded-md border bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {modelsError}
                    </div>
                  ) : modelsLoaded ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded-md border bg-emerald-50/40 px-3 py-2 text-left text-sm transition-colors hover:bg-emerald-100/60 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/30"
                        onClick={() => setExpandedModelsId(modelsExpanded ? null : providerId)}
                      >
                        {modelsExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <span className="font-medium text-emerald-700 dark:text-emerald-300">
                          {modelsCount} model{modelsCount === 1 ? '' : 's'} available
                        </span>
                      </button>
                      {modelsExpanded ? (
                        <div className="mt-2 space-y-2">
                          {modelsState.modelGroups && modelsState.modelGroups.length > 0 ? (
                            modelsState.modelGroups.map(group => (
                              <div
                                key={group.label}
                                className="space-y-1.5 rounded-md border bg-background p-2.5"
                              >
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  {group.label}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {group.models.map(model => (
                                    <span
                                      key={model}
                                      className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium"
                                    >
                                      {model}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {modelsState.models?.map(model => (
                                <span
                                  key={model}
                                  className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium"
                                >
                                  {model}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          },
          cancelLabel: 'Test it',
          selectedSummary: null,
          onCancel: editingItem => {
            void handleEditTestConnection(editingItem)
          },
          onEditOpen: editingItem => {
            editingTemplateIdRef.current = String(editingItem?.template_id ?? '')
            setEditTestResult(null)
            setEditModelOptions([])
            setEditModelGroups([])
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
          onCreateClick: () => {
            setEditTestResult(null)
            setEditModelOptions([])
            setEditModelGroups([])
            setEditModelsValidated(false)
            setListTestState(null)
            setExpandedDetailId(null)
            setExpandedModelsId(null)
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
            void fetchReachabilityStatuses(ids)
            const secretResponse = await pb
              .send<{ items?: Array<Record<string, unknown>> }>(
                buildUserVisibleSecretRelationApiPath('ai_provider', {
                  secretTemplate: AI_PROVIDER_CREDENTIAL_TEMPLATE_ID,
                }),
                { method: 'GET' }
              )
              .catch(() => ({ items: [] }))
            const secretNamesById = new Map(
              (secretResponse.items ?? []).map(secret => [
                String(secret.id ?? '').trim(),
                String(secret.name ?? secret.id ?? '').trim(),
              ])
            )
            const rows = Array.isArray(items)
              ? items.map(item => mapAIProviderRow(item, providerTemplatesById, secretNamesById, t))
              : []
            fetchEnabledModelCounts(rows)
            return rows
          },
          updateItem: async (id, payload) => {
            const nextPayload = { ...payload }
            if (!nextPayload.template_id) {
              nextPayload.template_id = editingTemplateIdRef.current
            }
            const credentialID = String(nextPayload.credential ?? '').trim()
            if (Boolean(nextPayload.credential_secret_editing)) {
              const secretValue = String(nextPayload.credential_secret_value ?? '').trim()
              if (!credentialID) {
                throw new Error('Select an API key secret before editing it.')
              }
              if (!secretValue) {
                throw new Error('API Key is required when editing the current secret.')
              }
              await pb.send(`/api/secrets/${credentialID}/payload`, {
                method: 'PUT',
                body: { payload: { value: secretValue } },
              })
              nextPayload.credential_secret_editing = false
              nextPayload.credential_secret_value = ''
            }
            if (!editModelsValidated) {
              delete nextPayload.enabled_models
            }
            const body = await buildAIProviderPayload(nextPayload, providerTemplatesById, t)
            await pb.send(`/api/ai-providers/${id}`, { method: 'PUT', body })
          },
          extraActions: (item, refreshList) => {
            const providerId = String(item.id ?? '')
            const enabled = resolveAIProviderEnabled(item.is_enabled)
            return [
              <DropdownMenuItem
                key="test"
                onClick={() => {
                  void handleListTestConnection(item)
                }}
              >
                <Activity className="h-4 w-4" />
                Test it
              </DropdownMenuItem>,
              <DropdownMenuItem
                key="toggle-enabled"
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
              </DropdownMenuItem>,
            ]
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
            setEditModelOptions([])
            setListTestState(null)
            setExpandedDetailId(null)
            setExpandedModelsId(null)
            setEditModelGroups([])
            setEditModelsValidated(false)
          }
          setCreateOpen(open)
        }}
        onCreated={() => {
          setReachabilityOverrides({})
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
        onCreated={({ id, name }) => {
          secretAddOption?.(id, name)
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
