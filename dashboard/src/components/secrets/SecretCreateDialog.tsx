import { useEffect, useState } from 'react'
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
import { pb } from '@/lib/pb'
import { PasswordGeneratorDialog } from './PasswordGeneratorDialog'
import { SecretForm, type SecretTemplate } from './SecretForm'

function buildRandomPassword(length: number) {
  const normalizedLength = Math.min(Math.max(length, 12), 64)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+'
  const cryptoObject = globalThis.crypto
  if (cryptoObject?.getRandomValues) {
    const bytes = new Uint32Array(normalizedLength)
    cryptoObject.getRandomValues(bytes)
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join('')
  }
  return Array.from(
    { length: normalizedLength },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join('')
}

interface SecretCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  allowedTemplateIds: string[]
  templateLabels: Record<string, string>
  defaultTemplateId: string
  onCreated: (secret: { id: string; label: string; name: string; templateId: string }) => void
}

export function SecretCreateDialog({
  open,
  onOpenChange,
  title,
  description,
  allowedTemplateIds,
  templateLabels,
  defaultTemplateId,
  onCreated,
}: SecretCreateDialogProps) {
  const [name, setName] = useState('')
  const [secretDescription, setSecretDescription] = useState('')
  const [templateId, setTemplateId] = useState(defaultTemplateId)
  const [payload, setPayload] = useState<Record<string, string>>({})
  const [templates, setTemplates] = useState<SecretTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [generatedLength, setGeneratedLength] = useState(24)

  useEffect(() => {
    if (!open) {
      return
    }
    void (async () => {
      try {
        const data = await pb.send<SecretTemplate[]>('/api/secrets/templates', { method: 'GET' })
        const filtered = (Array.isArray(data) ? data : [])
          .filter(template => allowedTemplateIds.includes(template.id))
          .map(template => ({
            ...template,
            label: templateLabels[template.id] ?? template.label,
          }))
        setTemplates(filtered)
      } catch {
        setTemplates([])
      }
    })()
  }, [allowedTemplateIds, open, templateLabels])

  useEffect(() => {
    if (!open) {
      setName('')
      setSecretDescription('')
      setTemplateId(defaultTemplateId)
      setPayload({})
      setError('')
      setGeneratedLength(24)
    }
  }, [defaultTemplateId, open])

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!templateId.trim()) {
      setError('Type is required')
      return
    }

    setSaving(true)
    setError('')
    try {
      const created = await pb.collection('secrets').create({
        name: name.trim(),
        description: secretDescription.trim(),
        template_id: templateId,
        scope: 'global',
        payload,
      })
      onCreated({
        id: String(created.id),
        label: name.trim(),
        name: name.trim(),
        templateId,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shared-secret-name">Name</Label>
              <Input
                id="shared-secret-name"
                value={name}
                onChange={event => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shared-secret-description">Description</Label>
              <Input
                id="shared-secret-description"
                value={secretDescription}
                onChange={event => setSecretDescription(event.target.value)}
              />
            </div>

            {templateId === 'single_value' && (
              <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setGeneratorOpen(true)}
                >
                  Generate Password
                </Button>
              </div>
            )}

            <SecretForm
              templates={templates}
              templateId={templateId}
              payload={payload}
              onTemplateChange={nextTemplateId => {
                setTemplateId(nextTemplateId)
                setPayload({})
              }}
              onPayloadChange={(key, value) => {
                setPayload(prev => ({ ...prev, [key]: value }))
              }}
              disableTemplateChange={allowedTemplateIds.length === 1}
            />

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleCreate()} disabled={saving}>
              Create Secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasswordGeneratorDialog
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        length={generatedLength}
        onLengthChange={setGeneratedLength}
        onConfirm={() => {
          setPayload(prev => ({ ...prev, value: buildRandomPassword(generatedLength) }))
        }}
      />
    </>
  )
}
