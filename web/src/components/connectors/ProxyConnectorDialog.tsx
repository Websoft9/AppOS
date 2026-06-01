import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { ResourceDialogForm } from '@/components/resources/ResourceDialogForm'
import type { FieldDef, RelationOption, SelectOption } from '@/components/resources/ResourcePage'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { pb } from '@/lib/pb'
import {
  KIND_LABELS,
  SECRET_TEMPLATE_LABELS,
  buildConnectorPayload,
  mapTemplateFieldToResourceField,
  normalizeTemplateFieldDefault,
  type ConnectorRecord,
  type ConnectorTemplate,
} from './shared'

type ProxyConnectorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialProtocol?: 'http' | 'https'
  onCreated: (connector: ConnectorRecord) => void
}

function normalizeRelationOptions(
  raw: Record<string, unknown>[] | Record<string, unknown>,
  field: FieldDef
): RelationOption[] {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: Record<string, unknown>[] })?.items)
      ? ((raw as { items?: Record<string, unknown>[] }).items ?? [])
      : []

  return items.map(item => {
    const id = String(item.id ?? '')
    const label = field.relationFormatLabel
      ? field.relationFormatLabel(item)
      : String(item[field.relationLabelKey ?? 'name'] ?? item.id ?? '')
    return { id, label, raw: item }
  })
}

function defaultProxyFormData(
  templates: ConnectorTemplate[],
  initialProtocol: 'http' | 'https'
): Record<string, unknown> {
  const template = templates[0]
  const defaults: Record<string, unknown> = {
    name: '',
    template_id: template?.id ?? '',
    description: '',
    advanced_config: '',
  }
  if (!template) {
    return defaults
  }
  if (template.defaultEndpoint) {
    defaults.endpoint = template.defaultEndpoint
  }
  for (const field of template.fields ?? []) {
    defaults[field.id] = normalizeTemplateFieldDefault(field)
  }
  defaults.protocol = initialProtocol
  return defaults
}

export function ProxyConnectorDialog({
  open,
  onOpenChange,
  initialProtocol = 'http',
  onCreated,
}: ProxyConnectorDialogProps) {
  const [templates, setTemplates] = useState<ConnectorTemplate[]>([])
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [relationOptions, setRelationOptions] = useState<Record<string, RelationOption[]>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    if (!open) {
      return
    }
    void (async () => {
      try {
        const data = await pb.send<ConnectorTemplate[]>('/api/connectors/templates', {
          method: 'GET',
        })
        const proxyTemplates = (Array.isArray(data) ? data : []).filter(
          template => template.kind === 'proxy'
        )
        setTemplates(proxyTemplates)
        setFormData(defaultProxyFormData(proxyTemplates, initialProtocol))
      } catch {
        setTemplates([])
      }
    })()
  }, [initialProtocol, open])

  const templatesById = useMemo(
    () => new Map(templates.map(template => [template.id, template])),
    [templates]
  )

  const profileOptions = useMemo<SelectOption[]>(
    () =>
      templates.map(template => ({
        label: template.title,
        value: template.id,
        group: KIND_LABELS.proxy,
      })),
    [templates]
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
    window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer')
  }, [])

  const baseFields = useMemo<FieldDef[]>(
    () => [
      { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'my-proxy' },
      {
        key: 'template_id',
        label: 'Profile',
        type: 'select',
        required: true,
        options: profileOptions,
        onValueChange: (value, update) => {
          const template = templatesById.get(String(value ?? ''))
          if (template?.defaultEndpoint) {
            update('endpoint', template.defaultEndpoint)
          }
          for (const field of template?.fields ?? []) {
            update(field.id, normalizeTemplateFieldDefault(field))
          }
          update('protocol', initialProtocol)
        },
      },
      { key: 'description', label: 'Description', type: 'textarea' },
      {
        key: 'advanced_config',
        label: 'Advanced Config (JSON)',
        type: 'textarea',
        placeholder: '{"headers": {"X-Custom": "value"}}',
      },
    ],
    [initialProtocol, profileOptions, templatesById]
  )

  const activeFields = useMemo(() => {
    const selectedTemplate = templatesById.get(String(formData.template_id ?? ''))
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
    return [baseFields[0], baseFields[1], ...dynamicFields, ...baseFields.slice(2)]
  }, [baseFields, formData.template_id, openSecretDialog, openSecretEditor, templatesById])

  useEffect(() => {
    if (!open) {
      return
    }
    activeFields
      .filter(field => field.type === 'relation' && field.relationApiPath)
      .forEach(field => {
        void pb
          .send<Record<string, unknown>[] | Record<string, unknown>>(field.relationApiPath!, {
            method: 'GET',
          })
          .then(raw => {
            setRelationOptions(prev => ({
              ...prev,
              [field.key]: normalizeRelationOptions(raw, field),
            }))
          })
          .catch(() => {
            setRelationOptions(prev => ({ ...prev, [field.key]: [] }))
          })
      })
  }, [activeFields, open])

  const updateField = useCallback((key: string, value: unknown) => {
    setFormData(current => ({ ...current, [key]: value }))
  }, [])

  const handleChange = useCallback((field: FieldDef, raw: unknown) => {
    setFormData(current => {
      const next = { ...current, [field.key]: raw }
      if (field.onValueChange) {
        field.onValueChange(raw, (key, value) => {
          next[key] = value
        })
      }
      return next
    })
  }, [])

  const addRelationOption = useCallback(
    (fieldKey: string, id: string, label: string, raw?: Record<string, unknown>) => {
      setRelationOptions(prev => ({
        ...prev,
        [fieldKey]: [...(prev[fieldKey] ?? []), { id, label, raw }],
      }))
    },
    []
  )

  const handleFileUpload = useCallback(
    (_key: string, _event: ChangeEvent<HTMLInputElement>) => {},
    []
  )
  const fileInputRef = useCallback((key: string, element: HTMLInputElement | null) => {
    fileRefs.current[key] = element
  }, [])

  const handleSubmit = async () => {
    if (!String(formData.name ?? '').trim()) {
      setError('Name is required')
      return
    }
    if (!String(formData.template_id ?? '').trim()) {
      setError('Profile is required')
      return
    }

    setSaving(true)
    setError('')
    try {
      const body = await buildConnectorPayload(formData, templatesById)
      const created = await pb.send<ConnectorRecord>('/api/connectors', {
        method: 'POST',
        body,
      })
      onCreated(created)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create proxy connector')
    } finally {
      setSaving(false)
    }
  }

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void handleSubmit()
    },
    [handleSubmit]
  )

  return (
    <>
      <ResourceDialogForm
        open={open}
        onOpenChange={onOpenChange}
        className="max-w-2xl"
        title="Create Proxy Connector"
        description="Use the same proxy connector form as Resources."
        formData={formData}
        editingItem={null}
        headerFields={[]}
        primaryFields={activeFields
          .filter(field => !field.hidden)
          .filter(
            field =>
              !field.showWhen ||
              field.showWhen.values.includes(String(formData[field.showWhen.field] ?? ''))
          )}
        advancedFields={[]}
        relationOptions={relationOptions}
        updateField={updateField}
        handleChange={handleChange}
        addRelationOption={addRelationOption}
        openRelationCreate={() => {}}
        handleFileUpload={handleFileUpload}
        fileInputRef={fileInputRef}
        error={error}
        saving={saving}
        submitLabel={saving ? 'Creating...' : 'Create Proxy Connector'}
        onSubmit={handleFormSubmit}
      />

      <SecretCreateDialog
        open={secretDialogOpen}
        onOpenChange={setSecretDialogOpen}
        title="New Secret"
        description="Create a reusable secret and attach it to this connector."
        allowedTemplateIds={['single_value']}
        templateLabels={SECRET_TEMPLATE_LABELS}
        defaultTemplateId="single_value"
        defaultVisibleTo={['connector']}
        onCreated={({ id, name, templateId }) => {
          const suffix = SECRET_TEMPLATE_LABELS[templateId]
          secretAddOption?.(id, suffix ? `${name} (${suffix})` : name)
        }}
      />
    </>
  )
}
