import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
  KIND_LABELS,
  SECRET_TEMPLATE_LABELS,
  SUPPORTED_KINDS,
  buildConnectorPayload,
  buildDefaultConnectorName,
  mapConnectorRow,
  mapTemplateFieldToResourceField,
  normalizeTemplateFieldDefault,
  type ConnectorRecord,
  type ConnectorTemplate,
} from '@/components/connectors/shared'

const columns: Column[] = [
  { key: 'name', label: 'Name', searchable: true },
  {
    key: 'is_default',
    label: 'Default',
    render: value =>
      value ? <Badge>Default</Badge> : <span className="text-muted-foreground">—</span>,
  },
  {
    key: 'kind_label',
    label: 'Kind',
    render: value => <Badge variant="outline">{String(value || '—')}</Badge>,
  },
  { key: 'profile', label: 'Profile' },
  {
    key: 'endpoint',
    label: 'URL',
    render: value => (
      <span className="max-w-[200px] truncate block" title={String(value || '')}>
        {String(value || '—')}
      </span>
    ),
  },
  {
    key: 'auth_type',
    label: 'Auth',
    render: value => <Badge variant="secondary">{String(value || 'none')}</Badge>,
  },
]

export function ConnectorsPage() {
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
        group: KIND_LABELS[template.kind as (typeof SUPPORTED_KINDS)[number]] ?? template.kind,
      })),
    [connectorTemplates]
  )

  const openSecretDialog = useCallback(
    (callbacks: { addOption: (id: string, label: string) => void }) => {
      setSecretAddOption(() => callbacks.addOption)
      setSecretDialogOpen(true)
    },
    []
  )

  const openSecretEditor = useCallback((secretId: string) => {
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
  }, [navigate])

  const baseConnectorFields = useMemo<FieldDef[]>(
    () => [
      { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'my-connector' },
      {
        key: 'template_id',
        label: 'Profile',
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
      { key: 'description', label: 'Description', type: 'textarea' },
      {
        key: 'advanced_config',
        label: 'Advanced Config (JSON)',
        type: 'textarea',
        placeholder: '{"headers": {"X-Custom": "value"}}',
      },
      {
        key: 'groups',
        label: 'Groups',
        type: 'relation',
        multiSelect: true,
        relationAutoSelectDefault: true,
        relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
        relationLabelKey: 'name',
        defaultValue: [],
      },
    ],
    [connectorProfileOptions, connectorTemplatesById]
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
              openSecretEditor
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
    [baseConnectorFields, connectorTemplatesById, openSecretDialog, openSecretEditor]
  )

  return (
    <>
      <ResourcePage
        config={{
          title: 'Connectors',
          description:
            'Reusable API, webhook, MCP, proxy, SMTP, registry, and DNS connectors backed by grouped connector profiles',
          apiPath: `/api/connectors?kind=${CONNECTOR_KIND_QUERY}`,
          dialogContentClassName: 'max-w-2xl',
          createButtonLabel: 'Add Connector',
          compactHeaderActionsOnMobile: true,
          descriptionClassName: 'hidden sm:block',
          showRefreshButton: true,
          refreshButtonIconOnly: true,
          columns,
          fields: baseConnectorFields,
          resolveFields: resolveConnectorFields,
          resourceType: 'connector',
          parentNav: { label: 'Resources', href: '/resources' },
          autoCreate,
          defaultSort: { key: 'name', dir: 'asc' },
          searchPlaceholder: 'Search connectors',
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
          paginationTotalLabel: totalCount => `Total ${totalCount} items`,
          pageSizeSelectorPlacement: 'none',
          actionsAlign: 'left',
          actionsMenuAlign: 'start',
          initialCreateData: () => ({
            name: buildDefaultConnectorName(),
          }),
          dialogHeader: ({ editingItem, title, description }) => ({
            title: editingItem ? title : 'Add Connector',
            description,
          }),
          listItems: async () => {
            const items = await pb.send<ConnectorRecord[]>(
              `/api/connectors?kind=${CONNECTOR_KIND_QUERY}`,
              { method: 'GET' }
            )
            return Array.isArray(items)
              ? items.map(item => mapConnectorRow(item, connectorTemplatesById))
              : []
          },
          createItem: async payload => {
            const body = await buildConnectorPayload(payload, connectorTemplatesById)
            const created = await pb.send<ConnectorRecord>('/api/connectors', {
              method: 'POST',
              body,
            })
            return mapConnectorRow(created, connectorTemplatesById)
          },
          updateItem: async (id, payload) => {
            const body = await buildConnectorPayload(payload, connectorTemplatesById)
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
        title="New Secret"
        description="Create a reusable secret and attach it to this connector."
        allowedTemplateIds={['single_value']}
        templateLabels={SECRET_TEMPLATE_LABELS}
        defaultTemplateId="single_value"
        onCreated={({ id, name, templateId }) => {
          const suffix = SECRET_TEMPLATE_LABELS[templateId]
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
