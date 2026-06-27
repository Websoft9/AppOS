import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Power, PowerOff } from 'lucide-react'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResourcePage,
  type Column,
  type FieldDef,
  type SelectOption,
} from '@/components/resources/ResourcePage'
import { ResourcesBreadcrumb } from '@/components/resources/ResourcesBreadcrumb'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { pb } from '@/lib/pb'
import {
  CONNECTOR_KIND_QUERY,
  SUPPORTED_KINDS,
  applyConnectorTemplateDefaults,
  buildConnectorKindSchema,
  buildConnectorPayload,
  buildDefaultConnectorName,
  getDefaultConnectorTemplate,
  getConnectorAuthSchemeLabel,
  getConnectorKindLabel,
  getConnectorSecretTemplateLabel,
  listConnectorTemplatesForKind,
  mapConnectorRow,
  mapTemplateFieldToResourceField,
  resolveConnectorEnabled,
  type Translate,
  type ConnectorRecord,
  type ConnectorTemplateField,
  type ConnectorTemplate,
} from '@/components/connectors/shared'

function buildColumns(t: Translate, onToggleEnabled: (item: Record<string, unknown>) => void): Column[] {
  return [
    { key: 'name', label: t('connectors.columns.name'), searchable: true },
    {
      key: 'enabled_status',
      label: t('connectors.columns.enabled'),
      sortable: true,
      filterOptions: [
        { label: t('connectors.enabled.yes'), value: 'Enabled' },
        { label: t('connectors.enabled.no'), value: 'Disabled' },
      ],
      filterValue: row => String(row.enabled_status ?? ''),
      render: (_value, row) => {
        const enabled = resolveConnectorEnabled(row.is_enabled)
        return (
          <button
            type="button"
            className={
              enabled
                ? 'inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
                : 'inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer'
            }
            onClick={event => {
              event.stopPropagation()
              void onToggleEnabled(row)
            }}
            title={enabled ? t('connectors.actions.disable') : t('connectors.actions.enable')}
          >
            {enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
            {enabled ? t('connectors.enabled.yes') : t('connectors.enabled.no')}
          </button>
        )
      },
    },
    {
      key: 'is_default',
      label: t('connectors.columns.default'),
      render: value =>
        value ? (
          <Badge>{t('connectors.badges.default')}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'kind_label',
      label: t('connectors.columns.kind'),
      render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
    },
    { key: 'profile', label: t('connectors.columns.profile') },
    {
      key: 'endpoint',
      label: t('connectors.columns.url'),
      render: value => (
        <span className="max-w-[200px] truncate block" title={String(value || '')}>
          {String(value || '—')}
        </span>
      ),
    },
    {
      key: 'auth_type',
      label: t('connectors.columns.auth'),
      render: value => (
        <Badge variant="secondary">{getConnectorAuthSchemeLabel(String(value ?? ''), t)}</Badge>
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
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplate[]>([])
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
      schemaFields: ConnectorTemplateField[]
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
          helpText: selectedField?.helpText || schemaField.helpText,
          secretTemplate: selectedField?.secretTemplate || schemaField.secretTemplate,
          default: selectedField?.default ?? schemaField.default,
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
        const forcePrimary =
          effectiveField.required ||
          effectiveField.id === 'endpoint' ||
          effectiveField.id === 'credential' ||
          effectiveField.id === 'auth_mode' ||
          (kind === 'proxy' && effectiveField.id === 'username')
        return {
          ...mapped,
          advanced: forcePrimary ? false : true,
        }
      })

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
        ...dynamicFields,
        {
          key: 'description',
          label: t('connectors.fields.description'),
          type: 'textarea',
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
      return buildConnectorFields(kind, selectedTemplate, schemaFields)
    },
    [buildConnectorFields, connectorTemplates, connectorTemplatesById, resolveFormKind]
  )

  const handleToggleEnabled = useCallback(
    async (item: Record<string, unknown>) => {
      const connectorId = String(item.id ?? '')
      if (!connectorId) return
      const body = await buildConnectorPayload(
        { ...item, is_enabled: !resolveConnectorEnabled(item.is_enabled) },
        connectorTemplatesById,
        t
      )
      await pb.send(`/api/connectors/${connectorId}`, { method: 'PUT', body })
      setRefreshKey(current => current + 1)
    },
    [connectorTemplatesById, t]
  )

  const columns = useMemo(() => buildColumns(t, handleToggleEnabled), [handleToggleEnabled, t])

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
          compactHeaderActionsOnMobile: true,
          descriptionClassName: 'hidden sm:block',
          showRefreshButton: true,
          refreshButtonIconOnly: true,
          columns,
          fields: baseConnectorFields,
          resolveFields: resolveConnectorFields,
          validateForm: validateConnectorForm,
          resourceType: 'connector',
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
            const items = await pb.send<ConnectorRecord[]>(
              `/api/connectors?kind=${CONNECTOR_KIND_QUERY}`,
              { method: 'GET' }
            )
            return Array.isArray(items)
              ? items.map(item => mapConnectorRow(item, connectorTemplatesById, t))
              : []
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
            const body = await buildConnectorPayload(payload, connectorTemplatesById, t)
            await pb.send(`/api/connectors/${id}`, { method: 'PUT', body })
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
