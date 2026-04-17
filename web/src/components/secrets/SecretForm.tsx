import { useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export interface SecretTemplateField {
  key: string
  label: string
  type: string
  required?: boolean
  upload?: boolean
}

export interface SecretTemplate {
  id: string
  label: string
  description?: string
  fields: SecretTemplateField[]
}

const BINARY_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'gz',
  'tar',
  'rar',
  '7z',
  'bz2',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'svg',
  'webp',
  'mp3',
  'mp4',
  'avi',
  'mov',
  'mkv',
  'wav',
  'flac',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'dmg',
  'iso',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'class',
  'jar',
  'pyc',
  'o',
  'obj',
])

function isTextFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (BINARY_EXTENSIONS.has(ext)) return false
  const mime = file.type
  if (
    !mime ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/x-pem-file' ||
    mime === 'application/pgp-keys' ||
    mime === 'application/x-x509-ca-cert' ||
    mime === 'application/pkcs8' ||
    mime === 'application/octet-stream'
  ) {
    return true
  }
  return false
}

interface SecretFormProps {
  templates: SecretTemplate[]
  templateId: string
  payload: Record<string, string>
  onTemplateChange: (templateId: string) => void
  onPayloadChange: (key: string, value: string) => void
  disableTemplateChange?: boolean
  renderFieldAccessory?: (field: SecretTemplateField) => ReactNode
}

export function SecretForm({
  templates,
  templateId,
  payload,
  onTemplateChange,
  onPayloadChange,
  disableTemplateChange = false,
  renderFieldAccessory,
}: SecretFormProps) {
  const selectedTemplate = templates.find(t => t.id === templateId)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [uploadError, setUploadError] = useState<string>('')

  function handleFileUpload(fieldKey: string, file: File) {
    setUploadError('')
    if (!isTextFile(file)) {
      setUploadError(
        `"${file.name}" is not a text file. Please upload a text-based file (e.g. .pem, .key, .pub, .txt).`
      )
      return
    }
    // Read a small slice first to check for null bytes (binary content)
    const slice = file.slice(0, 8192)
    const probeReader = new FileReader()
    probeReader.onload = () => {
      const text = probeReader.result as string
      if (text.includes('\0')) {
        setUploadError(`"${file.name}" appears to be a binary file.`)
        return
      }
      // File looks like text, read the full content
      const fullReader = new FileReader()
      fullReader.onload = () => {
        onPayloadChange(fieldKey, fullReader.result as string)
      }
      fullReader.readAsText(file)
    }
    probeReader.readAsText(slice)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Type</Label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          value={templateId}
          disabled={disableTemplateChange}
          onChange={e => onTemplateChange(e.target.value)}
        >
          <option value="">Select type</option>
          {templates.map(template => (
            <option key={template.id} value={template.id}>
              {template.label}
            </option>
          ))}
        </select>
        {selectedTemplate?.description && (
          <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
        )}
      </div>

      {selectedTemplate && (
        <div className="space-y-3">
          {selectedTemplate.fields.map(field => {
            const isPassword = field.type === 'password'
            const isTextarea = field.type === 'textarea'
            const inputId = `secret-form-${templateId}-${field.key}`
            const fieldAccessory = renderFieldAccessory?.(field)
            return (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={inputId}>
                  {field.label}
                  {field.required ? ' *' : ''}
                </Label>
                {isTextarea ? (
                  <Textarea
                    id={inputId}
                    required={field.required}
                    value={payload[field.key] ?? ''}
                    onChange={e => onPayloadChange(field.key, e.target.value)}
                    rows={6}
                    className="font-mono text-xs"
                    placeholder={field.upload ? 'Paste content or upload a file...' : ''}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      id={inputId}
                      type={isPassword ? 'password' : 'text'}
                      required={field.required}
                      value={payload[field.key] ?? ''}
                      onChange={e => onPayloadChange(field.key, e.target.value)}
                      className="flex-1"
                    />
                    {fieldAccessory ? <div className="shrink-0">{fieldAccessory}</div> : null}
                  </div>
                )}
                {field.upload && (
                  <div className="space-y-1">
                    <input
                      type="file"
                      className="hidden"
                      ref={el => {
                        fileInputRefs.current[field.key] = el
                      }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleFileUpload(field.key, file)
                        e.target.value = ''
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRefs.current[field.key]?.click()}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      Upload File
                    </Button>
                    {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!selectedTemplate && (
        <Button type="button" variant="outline" disabled>
          Select type to render fields
        </Button>
      )}
    </div>
  )
}
