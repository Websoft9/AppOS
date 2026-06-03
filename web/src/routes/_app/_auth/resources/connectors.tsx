import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import {
  ResourcePage,
  type Column,
  type FieldDef,
  type SelectOption,
} from '@/components/resources/ResourcePage'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { pb } from '@/lib/pb'
import {
  CONNECTOR_KIND_QUERY,
  SUPPORTED_KINDS,
  buildConnectorPayload,
  buildDefaultConnectorName,
  getConnectorAuthSchemeLabel,
  getConnectorKindLabel,
  getConnectorSecretTemplateLabel,
  mapConnectorRow,
  mapTemplateFieldToResourceField,
  normalizeTemplateFieldDefault,
  type Translate,
  type ConnectorRecord,
  type ConnectorTemplate,
} from '@/components/connectors/shared'

function buildColumns(t: Translate): Column[] {
  return [
    { key: 'name', label: t('connectors.columns.name'), searchable: true },
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
  const navigate = useNavigate()
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplate[]>([])
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)

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

  const connectorProfileOptions = useMemo<SelectOption[]>(
    () =>
      connectorTemplates.map(template => ({
        label: template.title,
        value: template.id,
        group: getConnectorKindLabel(template.kind, t),
      })),
    [connectorTemplates, t]
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

  const baseConnectorFields = useMemo<FieldDef[]>(
    () => [
      {
        key: 'name',
        label: t('connectors.fields.name'),
        type: 'text',
        required: true,
        placeholder: t('connectors.placeholders.name'),
      },
      {
        key: 'template_id',
        label: t('connectors.fields.profile'),
        type: 'select',
        required: true,
        options: connectorProfileOptions,
        onValueChange: (value, update) => {
          const template = connectorTemplatesById.get(String(value ?? ''))
          if (template?.defaultEndpoint) {
            update('endpoint', template.defaultEndpoint)
          }
          for (const field of template?.fields ?? []) {
            if (field.default !== undefined) {
              update(field.id, normalizeTemplateFieldDefault(field))
            }
          }
        },
      },
      { key: 'description', label: t('connectors.fields.description'), type: 'textarea' },
      {
        key: 'advanced_config',
        label: t('connectors.fields.advancedConfig'),
        type: 'textarea',
        placeholder: t('connectors.placeholders.advancedConfig'),
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
      },
    ],
    [connectorProfileOptions, connectorTemplatesById, t]
  )

  const resolveConnectorFields = useCallback(
    ({ formData }: { formData: Record<string, unknown> }) => {
      const selectedTemplate = connectorTemplatesById.get(String(formData.template_id ?? ''))
      const dynamicFields = selectedTemplate
        ? (selectedTemplate.fields ?? []).map(field =>
            mapTemplateFieldToResourceField(
              selectedTemplate,
              field,
              openSecretDialog,
              openSecretEditor,
              t
            )
          )
        : []
      return [
        baseConnectorFields[0],
        baseConnectorFields[1],
        ...dynamicFields,
        ...baseConnectorFields.slice(2),
      ]
    },
    [baseConnectorFields, connectorTemplatesById, openSecretDialog, openSecretEditor, t]
  )

  const columns = useMemo(() => buildColumns(t), [t])

  return (
    <>
      <ResourcePage
        config={{
          title: t('connectors.page.title'),
          description:
            t('connectors.page.description'),
          apiPath: `/api/connectors?kind=${CONNECTOR_KIND_QUERY}`,
          dialogContentClassName: 'max-w-2xl',
          createButtonLabel: t('connectors.page.addConnector'),
          compactHeaderActionsOnMobile: true,
          descriptionClassName: 'hidden sm:block',
          showRefreshButton: true,
          refreshButtonIconOnly: true,
          columns,
          fields: baseConnectorFields,
          resolveFields: resolveConnectorFields,
          resourceType: 'connector',
          parentNav: { label: t('hub.title'), href: '/resources' },
          autoCreate,
          defaultSort: { key: 'name', dir: 'asc' },
          searchPlaceholder: t('connectors.page.searchPlaceholder'),
          searchContainerClassName: 'w-full md:w-52',
          searchInputClassName:
            'border-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 sm:border-input sm:shadow-xs sm:focus-visible:border-ring sm:focus-visible:ring-[3px]',
          createButtonShowIcon: false,
          wrapTableInCard: false,
          listControlsBorder: false,
          listControlsShowReset: false,
          headerFilters: true,
          paginationPlacement: 'header',
          paginationVariant: 'minimal',
          paginationSummary: false,
          paginationTotalLabel: totalCount => t('connectors.page.totalItems', { count: totalCount }),
          pageSizeSelectorPlacement: 'none',
          actionsAlign: 'left',
          actionsMenuAlign: 'start',
          initialCreateData: () => ({
            name: buildDefaultConnectorName(),
          }),
          dialogHeader: ({ editingItem, title, description }) => ({
            title: editingItem ? title : t('connectors.page.addConnector'),
            description,
          }),
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
  }),
})
