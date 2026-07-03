import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Pencil, Power, PowerOff, RotateCw } from 'lucide-react'
import { useOptionalLayout } from '@/contexts/LayoutContext'
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
import { ResourceListSettingsButton } from '@/components/resources/ResourceListSettingsButton'
import { ResourceStatusTimestamp } from '@/components/resources/ResourceStatusTimestamp'
import { ResourcesBreadcrumb } from '@/components/resources/ResourcesBreadcrumb'
import { formatResourceDateTime } from '@/components/resources/resource-formatters'
import {
  buildEnabledStatusColumn,
  renderEnabledChoiceField,
} from '@/components/resources/resource-status'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { pb } from '@/lib/pb'
import {
  CONNECTOR_KIND_QUERY,
  SUPPORTED_KINDS,
  applyConnectorTemplateDefaults,
  buildConnectorKindSchema,
  buildConnectorPayload,
  buildDefaultConnectorName,
  extractConnectorEndpointScheme,
  getDefaultConnectorTemplate,
  getConnectorAuthSchemeLabel,
  getConnectorKindLabel,
  getConnectorSecretTemplateLabel,
  inferDefaultConnectorEndpointScheme,
  listConnectorTemplatesForKind,
  mapConnectorRow,
  mapTemplateFieldToResourceField,
  normalizeConnectorEndpointValue,
  resolveConnectorTemplateId,
  resolveConnectorEnabled,
  saveEditedConnectorSecrets,
  type Translate,
  type ConnectorRecord,
  type ConnectorTemplateField,
  type ConnectorTemplate,
} from '@/components/connectors/shared'

function translateStatus(t: Translate, key: string, fallback: string) {
  const value = t(key)
  return value === key ? fallback : value
}

function translateConnectorCopy(
  t: Translate,
  key: string,
  fallback: string,
  options?: Record<string, unknown>
) {
  const value = t(key, options)
  return value === key ? fallback : value
}

function normalizeConnectorReachability(value: unknown, t: Translate) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'reachable') return translateStatus(t, 'connectors.status.reachable', 'Reachable')
  if (normalized === 'unreachable') return translateStatus(t, 'connectors.status.unreachable', 'Unreachable')
  return translateStatus(t, 'connectors.status.unknown', 'Unknown')
}

type MonitorLatestStatusRecord = {
  target_id?: string
  status?: string
  reason?: string | null
  last_checked_at?: string | null
}

function monitorStatusToReachability(monitorStatus: string, t: Translate): string {
  switch (monitorStatus.toLowerCase().trim()) {
    case 'healthy':
      return translateStatus(t, 'connectors.status.reachable', 'Reachable')
    case 'unreachable':
      return translateStatus(t, 'connectors.status.unreachable', 'Unreachable')
    default:
      return translateStatus(t, 'connectors.status.unknown', 'Unknown')
  }
}

function reachabilityVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'Reachable') return 'default'
  if (status === 'Unreachable') return 'destructive'
  return 'outline'
}

function buildColumns(
  t: Translate,
  onToggleEnabled: (item: Record<string, unknown>) => void,
  connectorKinds: string[],
  reachabilityOverrides: Map<string, { status: string; reason: string; checked_at?: string }>,
  reachabilityLoading: Set<string>
): Column[] {
  const resolveStatusMeta = (row: Record<string, unknown>) => {
    const override = reachabilityOverrides.get(String(row.id ?? ''))
    return {
      status: String(override?.status ?? row.reachability ?? '').trim(),
      reason: String(override?.reason ?? row.reachability_reason ?? '').trim(),
      checkedAt: String(override?.checked_at ?? '').trim(),
      sourceLabel: override ? t('connectors.lastCheckedSources.liveReachability') : '',
    }
  }

  const authFilterOptions: SelectOption[] = [
    { label: getConnectorAuthSchemeLabel('none', t), value: 'none' },
    { label: getConnectorAuthSchemeLabel('basic', t), value: 'basic' },
    { label: getConnectorAuthSchemeLabel('bearer', t), value: 'bearer' },
    { label: getConnectorAuthSchemeLabel('api_key', t), value: 'api_key' },
  ]
  return [
    { key: 'name', label: t('connectors.columns.name'), searchable: true, sortable: true },
    buildEnabledStatusColumn({
      label: t('connectors.columns.enabled'),
      enabledLabel: t('connectors.enabled.yes'),
      disabledLabel: t('connectors.enabled.no'),
      enableTitle: t('connectors.actions.enable'),
      disableTitle: t('connectors.actions.disable'),
      resolveEnabled: resolveConnectorEnabled,
      onToggle: onToggleEnabled,
    }),
    {
      key: 'kind_label',
      label: t('connectors.columns.kind'),
      sortable: true,
      filterOptions: connectorKinds.map(kind => ({
        label: getConnectorKindLabel(kind, t),
        value: getConnectorKindLabel(kind, t),
      })),
      filterValue: row => String(row.kind_label ?? ''),
      render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
    },
    {
      key: 'endpoint',
      label: t('connectors.columns.url'),
      searchable: true,
      sortable: true,
      render: (value, row) => {
        const endpointDisplay =
          String(row.kind ?? '') === 'smtp'
            ? `${Boolean(row.tls) ? 'smtps' : 'smtp'}://${String(value || '')}${row.port ? `:${String(row.port)}` : ''}`
            : String(value || '')
        return (
          <span className="max-w-[200px] truncate block" title={endpointDisplay}>
            {endpointDisplay || '—'}
          </span>
        )
      },
    },
    {
      key: 'port',
      label: t('connectors.columns.port'),
      sortable: true,
      render: value => {
        const portVal = Number(value)
        if (!portVal || portVal <= 0) return <span className="text-sm text-muted-foreground">—</span>
        return <span className="text-sm">{String(value)}</span>
      },
    },
    {
      key: 'auth_type',
      label: t('connectors.columns.auth'),
      sortable: true,
      filterOptions: authFilterOptions,
      filterValue: row => String(row.auth_type ?? ''),
      render: value => (
        <Badge variant="secondary">{getConnectorAuthSchemeLabel(String(value ?? ''), t)}</Badge>
      ),
    },
    {
      key: 'reachability',
      label: translateStatus(t, 'connectors.columns.reachability', 'Reachability'),
      sortable: true,
      filterOptions: [
        { label: normalizeConnectorReachability('reachable', t), value: normalizeConnectorReachability('reachable', t) },
        { label: normalizeConnectorReachability('unreachable', t), value: normalizeConnectorReachability('unreachable', t) },
        { label: normalizeConnectorReachability('unknown', t), value: normalizeConnectorReachability('unknown', t) },
      ],
      filterValue: row => resolveStatusMeta(row).status,
      render: (value, row) => {
        const meta = resolveStatusMeta(row)
        const status = meta.status || String(value ?? '').trim()
        const reason = meta.reason
        const hasStatus = status.length > 0 && status !== '—'
        const displayStatus = hasStatus ? status : normalizeConnectorReachability('unknown', t)
        return (
          <Badge
            variant={reachabilityVariant(displayStatus)}
            title={reason || undefined}
            className="gap-1"
          >
            {reachabilityLoading.has(String(row.id ?? '')) && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {displayStatus}
          </Badge>
        )
      },
    },
    {
      key: 'last_checked_at',
      label: t('connectors.columns.lastChecked'),
      sortable: true,
      sortValue: row => resolveStatusMeta(row).checkedAt,
      render: (_value, row) => {
        const meta = resolveStatusMeta(row)
        return (
          <ResourceStatusTimestamp
            checkedAt={meta.checkedAt}
            sourceLabel={meta.sourceLabel}
            detail={meta.reason}
          />
        )
      },
    },
    {
      key: 'created',
      label: translateStatus(t, 'connectors.columns.created', 'Created'),
      sortable: true,
      render: value => (
        <span className="text-sm text-muted-foreground">
          {formatResourceDateTime(value)}
        </span>
      ),
    },
    {
      key: 'updated',
      label: translateStatus(t, 'connectors.columns.updated', 'Updated'),
      sortable: true,
      render: value => (
        <span className="text-sm text-muted-foreground">
          {formatResourceDateTime(value)}
        </span>
      ),
    },
  ]
}

export function ConnectorsPage() {
  const { t } = useTranslation('resources')
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
  const searchParams = new URLSearchParams(window.location.search)
  const autoCreate = searchParams.get('create') === '1'
  const forcedKind = searchParams.get('kind') ?? ''
  const forcedTemplateID = searchParams.get('template') ?? ''
  const [refreshKey, setRefreshKey] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<Set<string>>(
    () =>
      new Set(['kind_label', 'port', 'endpoint', 'auth_type', 'reachability', 'last_checked_at'])
  )
  const [reachabilityOverrides, setReachabilityOverrides] = useState<
    Map<string, { status: string; reason: string; checked_at?: string }>
  >(new Map())
  const [reachabilityLoading, setReachabilityLoading] = useState<Set<string>>(new Set())
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplate[]>([])
  const [editingConnectorItem, setEditingConnectorItem] = useState<Record<string, unknown> | null>(
    null
  )
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <ResourcesBreadcrumb parentLabel={t('hub.title')} currentPage={t('connectors.page.title')} />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent, t])

  useEffect(() => {
    void (async () => {
      try {
        const data = await pb.send<ConnectorTemplate[]>('/api/connectors/templates', {
          method: 'GET',
        })
        setConnectorTemplates(
          (Array.isArray(data) ? data : []).filter(template =>
            SUPPORTED_KINDS.includes(template.kind as (typeof SUPPORTED_KINDS)[number])
          )
        )
      } catch {
        setConnectorTemplates([])
      }
    })()
  }, [])

  const connectorTemplatesById = useMemo(
    () => new Map(connectorTemplates.map(template => [template.id, template])),
    [connectorTemplates]
  )

  const connectorKinds = useMemo(
    () =>
      SUPPORTED_KINDS.filter(kind => connectorTemplates.some(template => template.kind === kind)),
    [connectorTemplates]
  )

  const openSecretDialog = useCallback(
    (callbacks: { addOption: (id: string, label: string) => void }) => {
      setSecretAddOption(() => callbacks.addOption)
      setSecretDialogOpen(true)
    },
    []
  )

  const resolveFormKind = useCallback(
    (formData: Record<string, unknown>, editingItem: Record<string, unknown> | null) => {
      const explicitKind = String(formData.kind ?? editingItem?.kind ?? '').trim()
      if (explicitKind) {
        return explicitKind
      }
      const templateId = String(formData.template_id ?? editingItem?.template_id ?? '').trim()
      return connectorTemplatesById.get(templateId)?.kind ?? ''
    },
    [connectorTemplatesById]
  )

  const buildConnectorFields = useCallback(
    (
      kind: string,
      selectedTemplate: ConnectorTemplate | null,
      schemaFields: ConnectorTemplateField[],
      profileReadOnly = false
    ): FieldDef[] => {
      const profileOptions: SelectOption[] = listConnectorTemplatesForKind(
        kind,
        connectorTemplates
      ).map(template => ({
        label: template.title,
        value: template.id,
      }))

      const templateFieldByID = new Map(
        (selectedTemplate?.fields ?? []).map(field => [field.id, field])
      )
      const dynamicFields = schemaFields.map(schemaField => {
        const selectedField = templateFieldByID.get(schemaField.id)
        const effectiveField: ConnectorTemplateField = {
          ...schemaField,
          required: Boolean(selectedField?.required),
          placeholder: selectedField?.placeholder || schemaField.placeholder,
          helpUrl: selectedField?.helpUrl || schemaField.helpUrl,
          helpText: selectedField?.helpText || schemaField.helpText,
          secretTemplate: selectedField?.secretTemplate || schemaField.secretTemplate,
          default: selectedField?.default ?? schemaField.default,
          options: selectedField?.options ?? schemaField.options,
          showWhen: selectedField?.showWhen ?? schemaField.showWhen,
        }
        const mapped = mapTemplateFieldToResourceField(
          selectedTemplate ?? {
            id: '',
            kind,
            title: getConnectorKindLabel(kind, t),
            fields: [],
          },
          effectiveField,
          openSecretDialog,
          t
        )
        const endpointTemplate =
          selectedTemplate ?? {
            id: '',
            kind,
            title: getConnectorKindLabel(kind, t),
            fields: [],
          }
        const mappedWithEndpointBehavior =
          mapped.key === 'endpoint' && endpointTemplate.endpointShape !== 'host_port_tls'
            ? {
                ...mapped,
                render: ({ inputId, value, updateField }: any) => {
                  const endpointValue = String(value ?? '')
                  const defaultScheme = inferDefaultConnectorEndpointScheme(endpointTemplate)
                  const enteredScheme = extractConnectorEndpointScheme(endpointValue)
                  const mismatch =
                    Boolean(defaultScheme) &&
                    Boolean(enteredScheme) &&
                    enteredScheme !== defaultScheme

                  return (
                    <div className="space-y-1.5">
                      <Input
                        id={inputId}
                        value={endpointValue}
                        onChange={event => updateField('endpoint', event.target.value)}
                        onBlur={event => {
                          const normalized = normalizeConnectorEndpointValue(
                            event.target.value,
                            endpointTemplate,
                            { endpoint: event.target.value }
                          )
                          if (normalized !== event.target.value) {
                            updateField('endpoint', normalized)
                          }
                        }}
                        placeholder={mapped.placeholder}
                      />
                      {mismatch ? (
                        <p className="text-xs text-amber-600">
                          {translateConnectorCopy(
                            t,
                            'connectors.endpoint.schemeMismatchWarning',
                            `The typed protocol ${enteredScheme} differs from the default ${defaultScheme}. You can still save this value.`,
                            { actual: enteredScheme, expected: defaultScheme }
                          )}
                        </p>
                      ) : defaultScheme ? (
                        <p className="text-xs text-muted-foreground">
                          {translateConnectorCopy(
                            t,
                            'connectors.endpoint.defaultSchemeHint',
                            `If no protocol is entered, ${defaultScheme} will be added automatically.`,
                            { scheme: defaultScheme }
                          )}
                        </p>
                      ) : null}
                    </div>
                  )
                },
              }
            : mapped
        const forcePrimary =
          effectiveField.required ||
          effectiveField.id === 'endpoint' ||
          effectiveField.id === 'credential' ||
          effectiveField.id === 'auth_mode' ||
          effectiveField.id === 'tls' ||
          Boolean(effectiveField.showWhen)
        return {
          ...mappedWithEndpointBehavior,
          render:
            mappedWithEndpointBehavior.key === 'is_enabled'
              ? ({ field, value, setValue }: any) =>
                  renderEnabledChoiceField({
                    inputId: field.key,
                    label: field.label,
                    value: resolveConnectorEnabled(value),
                    setValue,
                    enabledLabel: t('connectors.enabled.yes'),
                    disabledLabel: t('connectors.enabled.no'),
                  })
              : mappedWithEndpointBehavior.render,
          advanced: forcePrimary ? false : true,
        }
      })

      const orderedDynamicFields: FieldDef[] =
        selectedTemplate?.endpointShape === 'host_port_tls'
          ? (() => {
            const fieldByKey = new Map(dynamicFields.map(field => [field.key, field]))
            const preferredOrder = ['endpoint', 'tls', 'port']
            const prioritized: FieldDef[] = preferredOrder.flatMap(key => {
              const field = fieldByKey.get(key)
              return field ? [field] : []
            })
            const remainder = dynamicFields.filter(field => !preferredOrder.includes(field.key))
            return [...prioritized, ...remainder]
          })()
          : dynamicFields

      return [
        {
          key: 'name',
          label: t('connectors.fields.name'),
          type: 'text',
          required: true,
          placeholder: t('connectors.placeholders.name'),
          hidden: true,
        },
        {
          key: 'template_id',
          label: t('connectors.fields.profile'),
          type: 'select',
          required: true,
          hidden: profileReadOnly,
          options: profileOptions,
          onValueChange: (value, update) => {
            const template = connectorTemplatesById.get(String(value ?? ''))
            if (!template) {
              return
            }
            update('kind', template.kind)
            applyConnectorTemplateDefaults(template, update)
          },
        },
        ...orderedDynamicFields,
        {
          key: 'description',
          label: t('connectors.fields.description'),
          type: 'text',
          advanced: true,
        },
        {
          key: 'advanced_config',
          label: t('connectors.fields.advancedConfig'),
          type: 'textarea',
          placeholder: t('connectors.placeholders.advancedConfig'),
          advanced: true,
        },
        {
          key: 'groups',
          label: t('connectors.fields.groups'),
          type: 'relation',
          multiSelect: true,
          relationAutoSelectDefault: true,
          relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
          relationLabelKey: 'name',
          defaultValue: [],
          advanced: true,
        },
        {
          key: 'is_enabled',
          label:
            t('connectors.fields.enableIt') === 'connectors.fields.enableIt'
              ? 'Enable it'
              : t('connectors.fields.enableIt'),
          type: 'boolean',
          defaultValue: true,
          advanced: true,
          render: ({ field, inputId, value, setValue }: any) =>
            renderEnabledChoiceField({
              inputId,
              label: field.label,
              value: resolveConnectorEnabled(value),
              setValue,
              enabledLabel: t('connectors.enabled.yes'),
              disabledLabel: t('connectors.enabled.no'),
            }),
        },
      ]
    },
    [connectorTemplates, connectorTemplatesById, openSecretDialog, t]
  )

  const baseConnectorFields = useMemo<FieldDef[]>(
    () => buildConnectorFields('', null, []),
    [buildConnectorFields]
  )

  const resolveConnectorFields = useCallback(
    ({
      formData,
      editingItem,
    }: {
      formData: Record<string, unknown>
      editingItem: Record<string, unknown> | null
    }) => {
      const kind = resolveFormKind(formData, editingItem)
      const selectedTemplate =
        connectorTemplatesById.get(
          String(formData.template_id ?? editingItem?.template_id ?? '')
        ) ?? getDefaultConnectorTemplate(kind, connectorTemplates)
      const schemaFields = kind ? buildConnectorKindSchema(kind, connectorTemplates) : []
      return buildConnectorFields(kind, selectedTemplate, schemaFields, Boolean(editingItem))
    },
    [buildConnectorFields, connectorTemplates, connectorTemplatesById, resolveFormKind]
  )

  const handleToggleEnabled = useCallback(
    async (item: Record<string, unknown>) => {
      const connectorId = String(item.id ?? '')
      if (!connectorId) return
      const current = await pb.send<ConnectorRecord>(`/api/connectors/${connectorId}`, {
        method: 'GET',
      })
      const currentFormData = mapConnectorRow(current, connectorTemplatesById, t)
      const body = await buildConnectorPayload(
        {
          ...currentFormData,
          is_enabled: !resolveConnectorEnabled(current.is_enabled),
        },
        connectorTemplatesById,
        t
      )
      await pb.send(`/api/connectors/${connectorId}`, { method: 'PUT', body })
      setRefreshKey(current => current + 1)
    },
    [connectorTemplatesById, t]
  )

  const fetchReachabilityStatuses = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        setReachabilityOverrides(new Map())
        return
      }

      setReachabilityLoading(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      try {
        const params = new URLSearchParams({ ids: ids.join(',') })
        const reachability = await pb.send<{
          items?: Array<{ id: string; status: string; reason?: string; lastCheckedAt?: string }>
        }>(`/api/connectors/reachability?${params.toString()}`, { method: 'GET' })
        setReachabilityOverrides(prev => {
          const next = new Map(prev)
          for (const entry of reachability.items ?? []) {
            const id = String(entry.id ?? '').trim()
            if (!id) continue
            next.set(id, {
              status: normalizeConnectorReachability(entry.status, t),
              reason: String(entry.reason ?? ''),
              checked_at: entry.lastCheckedAt,
            })
          }
          return next
        })
      } catch {
        // keep previous overrides on error
      } finally {
        setReachabilityLoading(prev => {
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next
        })
      }
    },
    [t]
  )

  const columnsWithFilters = useMemo(
    () => buildColumns(t, handleToggleEnabled, connectorKinds, reachabilityOverrides, reachabilityLoading),
    [connectorKinds, handleToggleEnabled, reachabilityOverrides, reachabilityLoading, t]
  )
  const columns = useMemo(
    () =>
      columnsWithFilters.filter(column => {
        if (
          column.key === 'kind_label' ||
          column.key === 'port' ||
          column.key === 'endpoint' ||
          column.key === 'auth_type' ||
          column.key === 'reachability' ||
          column.key === 'last_checked_at' ||
          column.key === 'created' ||
          column.key === 'updated'
        ) {
          return visibleOptionalColumns.has(column.key)
        }
        return true
      }),
    [columnsWithFilters, visibleOptionalColumns]
  )
  const renderListSettings = useCallback(
    ({ pageSize, setPageSize }: { pageSize: number; setPageSize: (pageSize: number) => void }) => (
      <ResourceListSettingsButton
        title={t('servers.listSettings.title')}
        rowsPerPageLabel={t('servers.listSettings.rowsPerPage')}
        rowsPerPageOptionLabel={count => t('servers.listSettings.rowsPerPageOption', { count })}
        columnsLabel={t('servers.listSettings.columns')}
        pageSize={pageSize}
        setPageSize={setPageSize}
        pageSizeOptions={[10, 50, 100]}
        columnOptions={[
          { key: 'kind_label', label: t('connectors.columns.kind'), checked: visibleOptionalColumns.has('kind_label') },
          { key: 'port', label: t('connectors.columns.port'), checked: visibleOptionalColumns.has('port') },
          { key: 'endpoint', label: t('connectors.columns.url'), checked: visibleOptionalColumns.has('endpoint') },
          { key: 'auth_type', label: t('connectors.columns.auth'), checked: visibleOptionalColumns.has('auth_type') },
          { key: 'reachability', label: t('connectors.columns.reachability'), checked: visibleOptionalColumns.has('reachability') },
          { key: 'last_checked_at', label: t('connectors.columns.lastChecked'), checked: visibleOptionalColumns.has('last_checked_at') },
          { key: 'created', label: t('connectors.columns.created'), checked: visibleOptionalColumns.has('created') },
          { key: 'updated', label: t('connectors.columns.updated'), checked: visibleOptionalColumns.has('updated') },
        ]}
        onColumnToggle={(columnKey, checked) => {
          setVisibleOptionalColumns(prev => {
            const next = new Set(prev)
            if (checked) {
              next.add(columnKey)
            } else {
              next.delete(columnKey)
            }
            return next
          })
        }}
      />
    ),
    [t, visibleOptionalColumns]
  )

  const validateConnectorForm = useCallback(
    ({
      formData,
      activeFields,
    }: {
      formData: Record<string, unknown>
      activeFields: FieldDef[]
    }) => {
      const selectedTemplate = connectorTemplatesById.get(String(formData.template_id ?? ''))
      if (!selectedTemplate) {
        return t('connectors.errors.profileRequired')
      }
      for (const field of activeFields) {
        if (!field.required) {
          continue
        }
        const value = formData[field.key]
        if (field.multiSelect) {
          if (!Array.isArray(value) || value.length === 0) {
            return t('connectors.errors.fieldRequired', { field: field.label })
          }
          continue
        }
        if (typeof value === 'string') {
          if (!value.trim()) {
            return t('connectors.errors.fieldRequired', { field: field.label })
          }
          continue
        }
        if (value === undefined || value === null || value === '') {
          return t('connectors.errors.fieldRequired', { field: field.label })
        }
      }
      return null
    },
    [connectorTemplatesById, t]
  )

  const connectorSelectionOptions = useMemo(
    () =>
      connectorKinds.map(kind => {
        const defaultTemplate = getDefaultConnectorTemplate(kind, connectorTemplates)
        const relatedTemplates = listConnectorTemplatesForKind(kind, connectorTemplates)
        return {
          id: kind,
          title: getConnectorKindLabel(kind, t),
          description: defaultTemplate?.description || t('connectors.page.description'),
          meta: defaultTemplate?.category || undefined,
          searchText: [
            getConnectorKindLabel(kind, t),
            ...relatedTemplates.map(template => `${template.title} ${template.vendor ?? ''}`),
          ].join(' '),
        }
      }),
    [connectorKinds, connectorTemplates, t]
  )

  const buildInitialCreateData = useCallback(
    (kind: string, templateOverride?: string) => {
      const overrideTemplate = connectorTemplatesById.get(templateOverride ?? '')
      const defaultTemplate =
        overrideTemplate?.kind === kind
          ? overrideTemplate
          : getDefaultConnectorTemplate(kind, connectorTemplates)
      const initialData: Record<string, unknown> = {
        kind,
        name: buildDefaultConnectorName(kind),
        template_id: defaultTemplate?.id ?? '',
        title_name_editing: false,
      }
      if (defaultTemplate) {
        applyConnectorTemplateDefaults(defaultTemplate, (key, value) => {
          initialData[key] = value
        })
      }
      return initialData
    },
    [connectorTemplates, connectorTemplatesById]
  )

  return (
    <>
      <ResourcePage
        config={{
          title: t('connectors.page.title'),
          description: t('connectors.page.description'),
          apiPath: `/api/connectors?kind=${CONNECTOR_KIND_QUERY}`,
          dialogContentClassName: 'sm:max-w-4xl',
          createButtonLabel: t('connectors.page.addConnector'),
          onEditOpen: item => {
            setEditingConnectorItem(item)
          },
          compactHeaderActionsOnMobile: true,
          descriptionClassName: 'hidden sm:block',
          showRefreshButton: true,
          refreshButtonIconOnly: true,
          columns,
          fields: baseConnectorFields,
          resolveFields: resolveConnectorFields,
          validateForm: validateConnectorForm,
          resourceType: 'connector',
          enableGroupAssign: true,
          autoCreate,
          defaultSort: { key: 'name', dir: 'asc' },
          searchPlaceholder: t('connectors.page.searchPlaceholder'),
          searchContainerClassName: 'w-full md:w-52',
          searchInputClassName:
            'border-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 sm:border-input sm:shadow-xs sm:focus-visible:border-ring sm:focus-visible:ring-[3px]',
          createButtonShowIcon: false,
          wrapTableInCard: false,
          refreshKey,
          listControlsBorder: false,
          listControlsShowReset: false,
          headerFilters: true,
          paginationPlacement: 'header',
          paginationVariant: 'minimal',
          paginationSummary: false,
          paginationTotalLabel: totalCount =>
            t('connectors.page.totalItems', { count: totalCount }),
          pageSizeSelectorPlacement: 'none',
          pageSizeValue: pageSize,
          onPageSizeChange: setPageSize,
          pageSizeOptions: [10, 50, 100],
          headerTrailingControls: renderListSettings,
          actionsAlign: 'left',
          actionsMenuAlign: 'start',
          createSelection: forcedKind
            ? undefined
            : {
                title: t('connectors.selection.title'),
                description: t('connectors.selection.description'),
                searchPlaceholder: t('connectors.selection.searchPlaceholder'),
                emptyMessage: t('connectors.selection.emptyMessage'),
                options: connectorSelectionOptions,
                onSelect: optionId => buildInitialCreateData(String(optionId)),
              },
          initialCreateData: forcedKind
            ? () => buildInitialCreateData(forcedKind, forcedTemplateID)
            : undefined,
          dialogHeader: ({ editingItem, formData, updateField }) => {
            const kind = resolveFormKind(formData, editingItem)
            const selectedTemplate = connectorTemplatesById.get(
              String(formData.template_id ?? editingItem?.template_id ?? '')
            )
            const externalServiceName =
              String(formData.name ?? editingItem?.name ?? '').trim() ||
              t('connectors.dialog.newExternalService')
            const titleEditing = Boolean(formData.title_name_editing)
            return {
              title: (
                <div className="flex min-w-0 items-center gap-3">
                  {titleEditing ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Input
                        value={String(formData.name ?? '')}
                        onChange={event => updateField('name', event.target.value)}
                        aria-label={t('connectors.dialog.externalServiceTitle')}
                        className="h-9 max-w-xl"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title={t('connectors.dialog.applyTitle')}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => updateField('title_name_editing', false)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="max-w-full truncate text-xl font-semibold">
                        {externalServiceName}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={t('connectors.dialog.editTitle')}
                        onClick={() => updateField('title_name_editing', true)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ),
              description: t('connectors.dialog.createDescription', {
                kind: getConnectorKindLabel(kind, t),
                profile: selectedTemplate?.title ? ` - ${selectedTemplate.title}` : '',
              }),
            }
          },
          listItems: async () => {
            const [items, monitorResponse] = await Promise.all([
              pb.send<ConnectorRecord[]>(
                `/api/connectors?kind=${CONNECTOR_KIND_QUERY}`,
                { method: 'GET' }
              ),
              pb.send<{ items?: MonitorLatestStatusRecord[] }>(
                `/api/collections/monitor_latest_status/records?${new URLSearchParams({
                  perPage: '500',
                  sort: '-updated',
                  filter: `(target_type='connector')`,
                }).toString()}`,
                { method: 'GET' }
              ).catch(() => ({ items: [] })),
            ])
            if (!Array.isArray(items)) {
              return []
            }
            const rows = items.map(item => mapConnectorRow(item, connectorTemplatesById, t))
            const ids = rows.map(row => String(row.id ?? '')).filter(Boolean)

            // Seed reachability from monitor cache before live check
            const monitorByTargetId = new Map(
              Array.isArray(monitorResponse?.items)
                ? monitorResponse.items
                    .map(record => [String(record.target_id ?? '').trim(), record] as const)
                    .filter(([targetId]) => Boolean(targetId))
                : []
            )
            const cachedOverrides = new Map<string, { status: string; reason: string; checked_at?: string }>()
            for (const id of ids) {
              const monitor = monitorByTargetId.get(id)
              if (monitor?.status) {
                cachedOverrides.set(id, {
                  status: monitorStatusToReachability(String(monitor.status), t),
                  reason: String(monitor.reason ?? ''),
                  checked_at: String(monitor.last_checked_at ?? ''),
                })
              }
            }
            if (cachedOverrides.size > 0) {
              setReachabilityOverrides(prev => {
                const next = new Map(prev)
                for (const [key, value] of cachedOverrides) {
                  next.set(key, value)
                }
                return next
              })
            }

            void fetchReachabilityStatuses(ids)
            return rows.map(row => ({
              ...row,
              reachability: normalizeConnectorReachability('unknown', t),
              reachability_reason: '',
            }))
          },
          createItem: async payload => {
            const body = await buildConnectorPayload(payload, connectorTemplatesById, t)
            const created = await pb.send<ConnectorRecord>('/api/connectors', {
              method: 'POST',
              body,
            })
            return mapConnectorRow(created, connectorTemplatesById, t)
          },
          updateItem: async (id, payload) => {
            const templateId = resolveConnectorTemplateId(payload, editingConnectorItem)
            const template = connectorTemplatesById.get(templateId)
            if (!template) {
              throw new Error(t('connectors.errors.profileRequired'))
            }
            const nextPayload = { ...payload }
            await saveEditedConnectorSecrets(nextPayload, template)
            const body = await buildConnectorPayload(nextPayload, connectorTemplatesById, t)
            await pb.send(`/api/connectors/${id}`, { method: 'PUT', body })
          },
          extraActions: item => {
            const enabled = resolveConnectorEnabled(item.is_enabled)
            return [
              <DropdownMenuItem
                key="toggle-enabled"
                onClick={() => {
                  void handleToggleEnabled(item)
                }}
              >
                {enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                {enabled
                  ? translateStatus(t, 'connectors.actions.disable', 'Disable')
                  : translateStatus(t, 'connectors.actions.enable', 'Enable')}
              </DropdownMenuItem>,
              <DropdownMenuItem
                key="check"
                onClick={() => {
                  void fetchReachabilityStatuses([String(item.id ?? '')])
                }}
              >
                <RotateCw className="h-4 w-4" />
                {translateStatus(t, 'connectors.actions.check', 'Check it')}
              </DropdownMenuItem>,
            ]
          },
          deleteItem: async id => {
            await pb.send(`/api/connectors/${id}`, { method: 'DELETE' })
          },
        }}
      />

      <SecretCreateDialog
        open={secretDialogOpen}
        onOpenChange={setSecretDialogOpen}
        title={t('connectors.secret.newTitle')}
        description={t('connectors.secret.newDescription')}
        allowedTemplateIds={['single_value']}
        templateLabels={{ single_value: getConnectorSecretTemplateLabel('single_value', t) }}
        defaultTemplateId="single_value"
        defaultVisibleTo={['connector']}
        onCreated={({ id, name, templateId }) => {
          const suffix = getConnectorSecretTemplateLabel(templateId, t)
          secretAddOption?.(id, suffix ? `${name} (${suffix})` : name)
        }}
      />
    </>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/connectors')({
  component: ConnectorsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: typeof search.create === 'string' ? search.create : undefined,
    kind: typeof search.kind === 'string' ? search.kind : undefined,
    template: typeof search.template === 'string' ? search.template : undefined,
  }),
})
