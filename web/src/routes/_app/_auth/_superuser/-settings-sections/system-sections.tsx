import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { uploadMedia } from '@/lib/media-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton, Toggle, selectClass } from './shared'

export function BasicSection({
  appName,
  appURL,
  appSaving,
  setAppName,
  setAppURL,
  saveApp,
}: {
  appName: string
  appURL: string
  appSaving: boolean
  setAppName: (value: string) => void
  setAppURL: (value: string) => void
  saveApp: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic</CardTitle>
        <CardDescription>Platform basic information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="appName">Platform Title</Label>
          <Input
            id="appName"
            value={appName}
            onChange={e => setAppName(e.target.value)}
            placeholder="AppOS platform"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="appURL">Platform URL</Label>
          <Input
            id="appURL"
            type="url"
            value={appURL}
            onChange={e => setAppURL(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <SaveButton onClick={saveApp} saving={appSaving} />
      </CardContent>
    </Card>
  )
}

export function BrandingSection({
  logoUrl,
  wordmark,
  description,
  useLogoAsFavicon,
  faviconUrl,
  brandingSaving,
  setLogoMediaId,
  setLogoUrl,
  setWordmark,
  setDescription,
  setUseLogoAsFavicon,
  setFaviconMediaId,
  setFaviconUrl,
  saveBranding,
}: {
  logoUrl: string
  wordmark: string
  description: string
  useLogoAsFavicon: boolean
  faviconUrl: string
  brandingSaving: boolean
  setLogoMediaId: (value: string) => void
  setLogoUrl: (value: string) => void
  setWordmark: (value: string) => void
  setDescription: (value: string) => void
  setUseLogoAsFavicon: (value: boolean) => void
  setFaviconMediaId: (value: string) => void
  setFaviconUrl: (value: string) => void
  saveBranding: () => void
}) {
  const [uploadError, setUploadError] = useState('')
  const logoUploadRef = useRef<HTMLInputElement | null>(null)
  const faviconUploadRef = useRef<HTMLInputElement | null>(null)

  function handleImageUpload(
    event: React.ChangeEvent<HTMLInputElement>,
    setMediaId: (value: string) => void,
    setter: (value: string) => void
  ) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const allowedMimeTypes = new Set([
      'image/svg+xml',
      'image/png',
      'image/jpeg',
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/webp',
    ])
    const fileExtension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const allowedExtensions = new Set(['svg', 'png', 'jpg', 'jpeg', 'ico', 'webp'])
    if (!allowedMimeTypes.has(file.type) && !allowedExtensions.has(fileExtension)) {
      setUploadError('Supported formats: svg, png, jpg, jpeg, ico, webp.')
      return
    }

    void uploadMedia({
      file,
      category: 'branding',
      scope: 'public',
      ownerType: 'system',
    })
      .then(result => {
        setMediaId(result.id)
        setter(result.public_url || '')
        setUploadError('')
      })
      .catch(err => {
        setUploadError(err instanceof Error ? err.message : 'Failed to upload image file.')
      })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Configure your organization branding</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {uploadError ? <p className="text-sm text-destructive">{uploadError}</p> : null}
        <div className="space-y-1">
          <div className="space-y-1">
            <Label htmlFor="logoUrl">Logo</Label>
            <p className="text-sm text-muted-foreground">Enter an online URL, or upload an image</p>
          </div>
          <div className="flex gap-2">
            <Input
              id="logoUrl"
              type="text"
              value={logoUrl}
              onChange={e => {
                setLogoMediaId('')
                setLogoUrl(e.target.value)
              }}
              placeholder="https://example.com/logo.svg"
              className="flex-1"
            />
            <input
              ref={logoUploadRef}
              type="file"
              accept=".svg,.png,.jpg,.jpeg,.ico,.webp,image/svg+xml,image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,image/webp"
              className="hidden"
              onChange={event => handleImageUpload(event, setLogoMediaId, setLogoUrl)}
            />
            <Button type="button" variant="outline" onClick={() => logoUploadRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Upload
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="faviconUrl">Favicon</Label>
            <p className="text-sm text-muted-foreground">Enter an online URL, or upload an image, or use logo</p>
          </div>
          <div className="flex items-center gap-3">
            <Toggle
              id="useLogoAsFavicon"
              checked={useLogoAsFavicon}
              onChange={setUseLogoAsFavicon}
            />
            <Label htmlFor="useLogoAsFavicon">Use logo as favicon</Label>
          </div>
          {!useLogoAsFavicon ? (
            <div className="flex gap-2">
              <Input
                id="faviconUrl"
                type="text"
                value={faviconUrl}
                onChange={e => {
                  setFaviconMediaId('')
                  setFaviconUrl(e.target.value)
                }}
                placeholder="https://example.com/favicon.ico"
                className="flex-1"
              />
              <input
                ref={faviconUploadRef}
                type="file"
                accept=".svg,.png,.jpg,.jpeg,.ico,.webp,image/svg+xml,image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,image/webp"
                className="hidden"
                onChange={event => handleImageUpload(event, setFaviconMediaId, setFaviconUrl)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => faviconUploadRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" /> Upload
              </Button>
            </div>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="wordmark">Wordmark</Label>
          <Input
            id="wordmark"
            value={wordmark}
            onChange={e => setWordmark(e.target.value)}
            placeholder="appos"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Application Platform"
          />
        </div>
        <SaveButton onClick={saveBranding} saving={brandingSaving} />
      </CardContent>
    </Card>
  )
}

export function S3Section({
  s3Enabled,
  s3Bucket,
  s3Region,
  s3Endpoint,
  s3AccessKey,
  s3Secret,
  s3ForcePathStyle,
  s3Saving,
  s3Testing,
  setS3Enabled,
  setS3Bucket,
  setS3Region,
  setS3Endpoint,
  setS3AccessKey,
  setS3Secret,
  setS3ForcePathStyle,
  saveS3,
  testS3,
}: {
  s3Enabled: boolean
  s3Bucket: string
  s3Region: string
  s3Endpoint: string
  s3AccessKey: string
  s3Secret: string
  s3ForcePathStyle: boolean
  s3Saving: boolean
  s3Testing: boolean
  setS3Enabled: (value: boolean) => void
  setS3Bucket: (value: string) => void
  setS3Region: (value: string) => void
  setS3Endpoint: (value: string) => void
  setS3AccessKey: (value: string) => void
  setS3Secret: (value: string) => void
  setS3ForcePathStyle: (value: boolean) => void
  saveS3: () => void
  testS3: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>S3 Storage</CardTitle>
        <CardDescription>External S3-compatible storage configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle id="s3Enabled" checked={s3Enabled} onChange={setS3Enabled} />
          <Label htmlFor="s3Enabled">Enable S3</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="s3Bucket">Bucket</Label>
            <Input id="s3Bucket" value={s3Bucket} onChange={e => setS3Bucket(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3Region">Region</Label>
            <Input id="s3Region" value={s3Region} onChange={e => setS3Region(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="s3Endpoint">Endpoint</Label>
            <Input
              id="s3Endpoint"
              value={s3Endpoint}
              onChange={e => setS3Endpoint(e.target.value)}
              placeholder="https://s3.example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3AccessKey">Access Key</Label>
            <Input
              id="s3AccessKey"
              value={s3AccessKey}
              onChange={e => setS3AccessKey(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3Secret">Secret</Label>
            <Input
              id="s3Secret"
              type="password"
              value={s3Secret}
              onChange={e => setS3Secret(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="s3ForcePathStyle" checked={s3ForcePathStyle} onChange={setS3ForcePathStyle} />
          <Label htmlFor="s3ForcePathStyle">Force Path Style</Label>
        </div>
        <div className="flex gap-2">
          <SaveButton onClick={saveS3} saving={s3Saving} />
          <Button variant="outline" onClick={testS3} disabled={s3Testing}>
            {s3Testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing…
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function LogsSection({
  logsMaxDays,
  logsMinLevel,
  logsLogIP,
  logsLogAuthId,
  logsSaving,
  setLogsMaxDays,
  setLogsMinLevel,
  setLogsLogIP,
  setLogsLogAuthId,
  saveLogs,
}: {
  logsMaxDays: number
  logsMinLevel: number
  logsLogIP: boolean
  logsLogAuthId: boolean
  logsSaving: boolean
  setLogsMaxDays: (value: number) => void
  setLogsMinLevel: (value: number) => void
  setLogsLogIP: (value: boolean) => void
  setLogsLogAuthId: (value: boolean) => void
  saveLogs: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
        <CardDescription>Log retention and filtering options</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="logsMaxDays">Max Days</Label>
            <Input
              id="logsMaxDays"
              type="number"
              min={1}
              value={logsMaxDays}
              onChange={e => setLogsMaxDays(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="logsMinLevel">Min Level</Label>
            <select
              id="logsMinLevel"
              className={selectClass}
              value={logsMinLevel}
              onChange={e => setLogsMinLevel(Number(e.target.value))}
            >
              <option value={0}>DEBUG</option>
              <option value={5}>INFO</option>
              <option value={8}>WARN</option>
              <option value={9}>ERROR</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="logsLogIP" checked={logsLogIP} onChange={setLogsLogIP} />
          <Label htmlFor="logsLogIP">Log IP Address</Label>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="logsLogAuthId" checked={logsLogAuthId} onChange={setLogsLogAuthId} />
          <Label htmlFor="logsLogAuthId">Log Auth ID</Label>
        </div>
        <SaveButton onClick={saveLogs} saving={logsSaving} />
      </CardContent>
    </Card>
  )
}
