import { useCallback, useEffect, useState } from 'react'
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
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { SecretForm, type SecretTemplate } from '@/components/secrets/SecretForm'
import { pb } from '@/lib/pb'

const SECRET_TEMPLATE_LABELS: Record<string, string> = {
  single_value: 'Token / Single Value',
  api_key: 'API Key',
  basic_auth: 'Basic Auth',
}

const SECRET_TEMPLATE_IDS = new Set(Object.keys(SECRET_TEMPLATE_LABELS))

function formatSecretLabel(raw: Record<string, unknown>): string {
  const name = String(raw.name ?? raw.id)
  const templateId = String(raw.template_id ?? '')
  const suffix = SECRET_TEMPLATE_LABELS[templateId]
  return suffix ? `${name} (${suffix})` : name
}

async function buildEndpointPayload(payload: Record<string, unknown>) {
  const body = { ...payload }
  const credentialId = String(body.credential ?? '')

  if (!credentialId) {
    body.auth_type = 'none'
    body.credential = ''
  } else {
    const secret = await pb.collection('secrets').getOne(credentialId)
    const templateId = String(secret.template_id ?? '')
    const authTypeByTemplate: Record<string, string> = {
      single_value: 'bearer',
      api_key: 'api_key',
      basic_auth: 'basic',
    }
    body.auth_type = authTypeByTemplate[templateId] ?? 'bearer'
  }

  const extra = typeof body.extra === 'string' ? body.extra.trim() : body.extra
  if (extra === '' || extra == null) {
    delete body.extra
  } else if (typeof extra === 'string') {
    body.extra = JSON.parse(extra)
  }

  return body
}

const columns: Column[] = [
  { key: 'name', label: 'Name' },
  {
    key: 'type',
    label: 'Type',
    render: v => <Badge variant="outline">{String(v || '—').toUpperCase()}</Badge>,
  },
  {
    key: 'url',
    label: 'URL',
    render: v => (
      <span className="max-w-[200px] truncate block" title={String(v || '')}>
        {String(v || '—')}
      </span>
    ),
  },
  {
    key: 'auth_type',
    label: 'Auth',
    render: v => <Badge variant="secondary">{String(v || 'none')}</Badge>,
  },
]

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'my-webhook' },
  {
    key: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: [
      { label: 'REST API', value: 'rest' },
      { label: 'Webhook', value: 'webhook' },
      { label: 'MCP', value: 'mcp' },
    ],
  },
  {
    key: 'url',
    label: 'URL',
    type: 'text',
    required: true,
    placeholder: 'https://api.example.com/v1',
  },
  {
    key: 'auth_type',
    label: 'Auth Type',
    type: 'text',
    hidden: true,
    defaultValue: 'none',
  },
  {
    key: 'credential',
    label: 'Secret',
    type: 'relation',
    relationApiPath:
      "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='single_value'||template_id='api_key'||template_id='basic_auth'))&sort=name",
    relationFormatLabel: formatSecretLabel,
    relationCreateButton: {
      label: 'New Secret',
      onClick: () => {},
    },
  },
  {
    key: 'extra',
    label: 'Extra Config (JSON)',
    type: 'textarea',
    placeholder: '{"headers": {"X-Custom": "value"}}',
  },
  { key: 'description', label: 'Description', type: 'textarea' },
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
]

function EndpointsPage() {
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [secretName, setSecretName] = useState('')
  const [secretDescription, setSecretDescription] = useState('')
  const [secretTemplateId, setSecretTemplateId] = useState('single_value')
  const [secretPayload, setSecretPayload] = useState<Record<string, string>>({})
  const [secretTemplates, setSecretTemplates] = useState<SecretTemplate[]>([])
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
  }, [])

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

  const endpointFields = fields.map(field =>
    field.key === 'credential'
      ? {
          ...field,
          relationCreateButton: {
            label: 'New Secret',
            onClick: openSecretDialog,
          },
        }
      : field
  )

  return (
    <>
      <ResourcePage
        config={{
          title: 'Endpoints',
          description: 'External API endpoints, webhooks, and MCP servers',
          apiPath: '/api/endpoints',
          columns,
          fields: endpointFields,
          resourceType: 'endpoint',
          parentNav: { label: 'Resources', href: '/resources' },
          autoCreate,
          enableGroupAssign: true,
          createItem: async payload => {
            const body = await buildEndpointPayload(payload)
            return await pb.send('/api/endpoints', { method: 'POST', body })
          },
          updateItem: async (id, payload) => {
            const body = await buildEndpointPayload(payload)
            await pb.send(`/api/endpoints/${id}`, { method: 'PUT', body })
          },
        }}
      />

      <Dialog open={secretDialogOpen} onOpenChange={setSecretDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Secret</DialogTitle>
            <DialogDescription>Create a reusable secret and attach it to this endpoint.</DialogDescription>
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

export const Route = createFileRoute('/_app/_auth/resources/endpoints')({
  component: EndpointsPage,
})