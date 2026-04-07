import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResourcePage,
  type Column,
  type FieldDef,
  type SelectOption,
} from '@/components/resources/ResourcePage'
import { SecretForm, type SecretTemplate } from '@/components/secrets/SecretForm'
import { pb } from '@/lib/pb'

type ConnectorRecord = {
  id: string
  name?: string
  kind?: string
  is_default?: boolean
  template_id?: string
  endpoint?: string
  auth_scheme?: string
  credential?: string
  config?: Record<string, unknown>
  description?: string
}

type ConnectorTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  secretTemplate?: string
  placeholder?: string
  helpText?: string
  default?: unknown
}

type ConnectorTemplate = {
  id: string
  kind: string
  title: string
  description?: string
  defaultEndpoint?: string
  defaultAuthScheme?: string
  fields?: ConnectorTemplateField[]
}

const SUPPORTED_KINDS = ['rest_api', 'webhook', 'mcp', 'smtp', 'registry', 'dns'] as const

const KIND_LABELS: Record<(typeof SUPPORTED_KINDS)[number], string> = {
  rest_api: 'REST API',
  webhook: 'Webhook',
  mcp: 'MCP',
  smtp: 'SMTP',
  registry: 'Registry',
  dns: 'DNS',
}

const CONNECTOR_KIND_QUERY = SUPPORTED_KINDS.join(',')

const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Token / Single Value',
  api_key: 'API Key',
  basic_auth: 'Basic Auth',
}

const SECRET_TEMPLATE_IDS = new Set(Object.keys(SECRET_TEMPLATE_LABELS))

const SECRET_TEMPLATE_ALIASES: Record<string, string> = {
  bearer_token: 'single_value',
}

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

function resolveSecretTemplateId(secretTemplate?: string) {
  const normalized = String(secretTemplate ?? '').trim()
  if (!normalized) {
    return ''
  }
  const aliased = SECRET_TEMPLATE_ALIASES[normalized] ?? normalized
  return SECRET_TEMPLATE_IDS.has(aliased) ? aliased : ''
}

function buildSecretRelationApiPath(secretTemplate?: string) {
  const explicit = resolveSecretTemplateId(secretTemplate)
  const templateIds = explicit ? [explicit] : Array.from(SECRET_TEMPLATE_IDS)
  const filter = templateIds.map(id => `template_id='${id}'`).join('||')
  return `/api/collections/secrets/records?filter=(status='active'%26%26(${filter}))&sort=name`
}

function normalizeTemplateFieldDefault(field: ConnectorTemplateField) {
  if (field.default === undefined) {
    if (field.type === 'boolean') return false
    return ''
  }
  if (field.type === 'json' && typeof field.default !== 'string') {
    return JSON.stringify(field.default, null, 2)
  }
  return field.default
}

function mapTemplateFieldToResourceField(
  field: ConnectorTemplateField,
  openSecretDialog: (callbacks: { addOption: (id: string, label: string) => void }) => void
): FieldDef {
  if (field.type === 'secret_ref') {
    return {
      key: field.id,
      label: field.label,
      type: 'relation',
      required: field.required,
      relationApiPath: buildSecretRelationApiPath(field.secretTemplate),
      relationFormatLabel: formatSecretLabel,
      relationCreateButton: {
        label: 'New Secret',
        onClick: openSecretDialog,
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
  }
}

async function buildConnectorPayload(
  payload: Record<string, unknown>,
  templatesById: Map<string, ConnectorTemplate>
) {
  const body = { ...payload }
  const templateId = String(body.template_id ?? '')
  const template = templatesById.get(templateId)
  if (!template) {
    throw new Error('Connector profile is required')
  }

  const credentialId = String(body.credential ?? '')
  let authScheme = 'none'
  if (credentialId) {
    const secret = await pb.collection('secrets').getOne(credentialId)
    const secretTemplateId = String(secret.template_id ?? '')
    const authTypeByTemplate: Record<string, string> = {
      single_value: 'bearer',
      api_key: 'api_key',
      basic_auth: 'basic',
    }
    authScheme = authTypeByTemplate[secretTemplateId] ?? 'bearer'
  }

  const extra =
    typeof body.advanced_config === 'string' ? body.advanced_config.trim() : body.advanced_config
  let config: Record<string, unknown> = {}
  if (!(extra === '' || extra == null)) {
    config = typeof extra === 'string' ? JSON.parse(extra) : (extra as Record<string, unknown>)
  }

  for (const field of template.fields ?? []) {
    if (field.id === 'endpoint' || field.id === 'credential') {
      continue
    }
    const value = body[field.id]
    if (value === undefined || value === '') {
      continue
    }
    if (field.type === 'json' && typeof value === 'string') {
      config[field.id] = JSON.parse(value)
      continue
    }
    if (field.type === 'number') {
      config[field.id] = Number(value)
      continue
    }
    if (field.type === 'boolean') {
      config[field.id] = Boolean(value)
      continue
    }
    config[field.id] = value
  }

  return {
    name: String(body.name ?? ''),
    kind: template.kind,
    is_default: Boolean(body.is_default),
    template_id: template.id,
    endpoint: String(body.endpoint ?? template.defaultEndpoint ?? ''),
    auth_scheme: authScheme,
    credential: credentialId,
    config,
    description: String(body.description ?? ''),
  }
}

function mapConnectorRow(
  item: ConnectorRecord,
  templatesById: Map<string, ConnectorTemplate>
): Record<string, unknown> {
  const kind = String(item.kind ?? '') as (typeof SUPPORTED_KINDS)[number]
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
    Object.entries(item.config ?? {}).filter(([key]) => !knownFieldIDs.has(key))
  )

  return {
    id: item.id,
    name: String(item.name ?? ''),
    is_default: Boolean(item.is_default),
    template_id: String(item.template_id ?? ''),
    kind_label: KIND_LABELS[kind] ?? String(item.kind ?? 'Unknown'),
    profile: template?.title ?? humanizeTemplateId(String(item.template_id ?? '')),
    endpoint: String(item.endpoint ?? ''),
    auth_type: String(item.auth_scheme ?? 'none'),
    credential: String(item.credential ?? ''),
    description: String(item.description ?? ''),
    advanced_config:
      Object.keys(advancedConfig).length > 0 ? JSON.stringify(advancedConfig, null, 2) : '',
    ...flattenedConfig,
  }
}

const columns: Column[] = [
  { key: 'name', label: 'Name' },
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
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [secretName, setSecretName] = useState('')
  const [secretDescription, setSecretDescription] = useState('')
  const [secretTemplateId, setSecretTemplateId] = useState('single_value')
  const [secretPayload, setSecretPayload] = useState<Record<string, string>>({})
  const [secretTemplates, setSecretTemplates] = useState<SecretTemplate[]>([])
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplate[]>([])
  const [secretSaving, setSecretSaving] = useState(false)
  const [secretError, setSecretError] = useState('')
  const [secretAddOption, setSecretAddOption] = useState<((id: string, label: string) => void) | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const data = await pb.send<SecretTemplate[]>('/api/secrets/templates', { method: 'GET' })
        const templates = (Array.isArray(data) ? data : [])
          .filter(template => SECRET_TEMPLATE_IDS.has(template.id))
          .map(template => ({
            ...template,
            label: SECRET_TEMPLATE_LABELS[template.id] ?? template.label,
          }))
        setSecretTemplates(templates)
      } catch {
        setSecretTemplates([])
      }
    })()

    void (async () => {
      try {
        const data = await pb.send<ConnectorTemplate[]>('/api/connectors/templates', { method: 'GET' })
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

  const openSecretDialog = useCallback((callbacks: { addOption: (id: string, label: string) => void }) => {
    setSecretName('')
    setSecretDescription('')
    setSecretTemplateId('single_value')
    setSecretPayload({})
    setSecretError('')
    setSecretAddOption(() => callbacks.addOption)
    setSecretDialogOpen(true)
  }, [])

  const handleSecretCreate = useCallback(async () => {
    if (!secretName.trim()) {
      setSecretError('Name is required')
      return
    }
    if (!secretTemplateId) {
      setSecretError('Type is required')
      return
    }

    setSecretSaving(true)
    setSecretError('')
    try {
      const created = await pb.collection('secrets').create({
        name: secretName.trim(),
        description: secretDescription.trim(),
        template_id: secretTemplateId,
        scope: 'global',
        payload: secretPayload,
      })
      secretAddOption?.(String(created.id), secretName.trim())
      setSecretDialogOpen(false)
    } catch (err) {
      setSecretError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSecretSaving(false)
    }
  }, [secretAddOption, secretDescription, secretName, secretPayload, secretTemplateId])

  const baseConnectorFields = useMemo<FieldDef[]>(
    () => [
      { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'my-connector' },
      { key: 'is_default', label: 'Runtime Default', type: 'boolean', defaultValue: false },
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
      const dynamicFields = (selectedTemplate?.fields ?? []).map(field =>
        mapTemplateFieldToResourceField(field, openSecretDialog)
      )
      return [
        baseConnectorFields[0],
        baseConnectorFields[1],
        baseConnectorFields[2],
        ...dynamicFields,
        ...baseConnectorFields.slice(3),
      ]
    },
    [baseConnectorFields, connectorTemplatesById, openSecretDialog]
  )

  return (
    <>
      <ResourcePage
        config={{
          title: 'Connectors',
          description:
            'Reusable API, webhook, MCP, SMTP, registry, and DNS connectors backed by grouped connector profiles',
          apiPath: `/api/connectors?kind=${CONNECTOR_KIND_QUERY}`,
          columns,
          fields: baseConnectorFields,
          resolveFields: resolveConnectorFields,
          resourceType: 'connector',
          parentNav: { label: 'Resources', href: '/resources' },
          autoCreate,
          enableGroupAssign: true,
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
            const created = await pb.send<ConnectorRecord>('/api/connectors', { method: 'POST', body })
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

      <Dialog open={secretDialogOpen} onOpenChange={setSecretDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Secret</DialogTitle>
            <DialogDescription>Create a reusable secret and attach it to this connector.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={secretName} onChange={e => setSecretName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={secretDescription} onChange={e => setSecretDescription(e.target.value)} />
            </div>
            <SecretForm
              templates={secretTemplates}
              templateId={secretTemplateId}
              payload={secretPayload}
              onTemplateChange={templateId => {
                setSecretTemplateId(templateId)
                setSecretPayload({})
              }}
              onPayloadChange={(key, value) => {
                setSecretPayload(prev => ({ ...prev, [key]: value }))
              }}
            />
            {secretError && <p className="text-sm text-destructive">{secretError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSecretDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSecretCreate()} disabled={secretSaving}>
              Create Secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/connectors')({
  component: ConnectorsPage,
})