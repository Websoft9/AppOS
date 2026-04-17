import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { pb } from '@/lib/pb'

interface CertificateTemplateField {
  key: string
  label: string
  type: string
  required?: boolean
}

interface CertificateTemplate {
  id: string
  label: string
  kind: string
  description?: string
  fields: CertificateTemplateField[]
}

interface SecretOption {
  id: string
  name?: string
}

interface CertificateCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  allowedTemplateIds: string[]
  defaultTemplateId: string
  onCreated: (certificate: { id: string; label: string; name: string; templateId: string }) => void
}

const DEFAULT_VALIDITY_DAYS = 365

export function CertificateCreateDialog({
  open,
  onOpenChange,
  title,
  description,
  allowedTemplateIds,
  defaultTemplateId,
  onCreated,
}: CertificateCreateDialogProps) {
  const [templates, setTemplates] = useState<CertificateTemplate[]>([])
  const [tlsSecrets, setTlsSecrets] = useState<SecretOption[]>([])
  const [templateId, setTemplateId] = useState(defaultTemplateId)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [validityDays, setValidityDays] = useState(DEFAULT_VALIDITY_DAYS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    void (async () => {
      try {
        const [templateData, secretData] = await Promise.all([
          pb.send<CertificateTemplate[]>('/api/certificates/templates', { method: 'GET' }),
          pb.send<{ items?: SecretOption[] }>(
            "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='tls_private_key'))&sort=name",
            { method: 'GET' }
          ),
        ])
        setTemplates(
          (Array.isArray(templateData) ? templateData : []).filter(template =>
            allowedTemplateIds.includes(template.id)
          )
        )
        setTlsSecrets(Array.isArray(secretData.items) ? secretData.items : [])
      } catch {
        setTemplates([])
        setTlsSecrets([])
      }
    })()
  }, [allowedTemplateIds, open])

  useEffect(() => {
    if (!open) {
      setTemplateId(defaultTemplateId)
      setFields({})
      setValidityDays(DEFAULT_VALIDITY_DAYS)
      setError('')
    }
  }, [defaultTemplateId, open])

  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === templateId),
    [templateId, templates]
  )

  const handleCreate = async () => {
    if (!selectedTemplate) {
      setError('Certificate template is required')
      return
    }

    const name = String(fields.name ?? '').trim()
    if (!name) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        template_id: selectedTemplate.id,
        kind: selectedTemplate.kind,
        status: 'active',
        auto_renew: false,
      }

      for (const field of selectedTemplate.fields) {
        const value = String(fields[field.key] ?? '').trim()
        if (value) {
          payload[field.key] = value
        }
      }

      const created = await pb.collection('certificates').create(payload)
      if (selectedTemplate.kind === 'self_signed') {
        await pb.send(`/api/certificates/${created.id}/generate-self-signed`, {
          method: 'POST',
          body: { validity_days: validityDays },
        })
      }
      onCreated({
        id: String(created.id),
        label: name,
        name,
        templateId: selectedTemplate.id,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {allowedTemplateIds.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="shared-certificate-template">Template</Label>
              <select
                id="shared-certificate-template"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={templateId}
                onChange={event => {
                  setTemplateId(event.target.value)
                  setFields({})
                  setValidityDays(DEFAULT_VALIDITY_DAYS)
                }}
              >
                <option value="">Select template</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              {selectedTemplate?.description && (
                <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
              )}
            </div>
          )}

          {selectedTemplate?.fields.map(field => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`shared-certificate-${field.key}`}>
                {field.label}
                {field.required ? ' *' : ''}
              </Label>
              {field.type === 'textarea' ? (
                <Textarea
                  id={`shared-certificate-${field.key}`}
                  value={fields[field.key] ?? ''}
                  onChange={event => setFields(prev => ({ ...prev, [field.key]: event.target.value }))}
                  rows={field.key === 'cert_pem' ? 8 : 4}
                  className={field.key === 'cert_pem' ? 'font-mono text-xs' : undefined}
                />
              ) : field.type === 'relation' ? (
                <>
                <select
                  id={`shared-certificate-${field.key}`}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={fields[field.key] ?? ''}
                  onChange={event => setFields(prev => ({ ...prev, [field.key]: event.target.value }))}
                >
                  <option value="">Select a TLS private key secret</option>
                  {tlsSecrets.map(secret => (
                    <option key={secret.id} value={secret.id}>
                      {secret.name ?? secret.id}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  The certificate object keeps the certificate chain here and references the private key through a secret.
                </p>
                </>
              ) : (
                <Input
                  id={`shared-certificate-${field.key}`}
                  value={fields[field.key] ?? ''}
                  onChange={event => setFields(prev => ({ ...prev, [field.key]: event.target.value }))}
                />
              )}
            </div>
          ))}

          {selectedTemplate?.kind === 'self_signed' && (
            <div className="space-y-2">
              <Label htmlFor="shared-certificate-validity">Validity (days)</Label>
              <Input
                id="shared-certificate-validity"
                type="number"
                min={1}
                max={3650}
                value={validityDays}
                onChange={event => setValidityDays(parseInt(event.target.value, 10) || DEFAULT_VALIDITY_DAYS)}
              />
              <p className="text-xs text-muted-foreground">
                Saving will create the certificate object first, then generate the certificate chain and a referenced TLS private key secret.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={saving}>
            Create Certificate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
