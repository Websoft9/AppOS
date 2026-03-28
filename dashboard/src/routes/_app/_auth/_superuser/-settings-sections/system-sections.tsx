import { Loader2 } from 'lucide-react'
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
        <CardDescription>Application name and public URL</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="appName">App Name</Label>
          <Input
            id="appName"
            value={appName}
            onChange={e => setAppName(e.target.value)}
            placeholder="AppOS"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="appURL">App URL</Label>
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

export function SmtpSection({
  smtpEnabled,
  smtpHost,
  smtpPort,
  smtpUsername,
  smtpPassword,
  smtpAuthMethod,
  smtpTls,
  smtpLocalName,
  smtpSaving,
  testEmailRecipient,
  testEmailSending,
  setSmtpEnabled,
  setSmtpHost,
  setSmtpPort,
  setSmtpUsername,
  setSmtpPassword,
  setSmtpAuthMethod,
  setSmtpTls,
  setSmtpLocalName,
  setTestEmailRecipient,
  saveSmtp,
  sendTestEmail,
}: {
  smtpEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUsername: string
  smtpPassword: string
  smtpAuthMethod: string
  smtpTls: boolean
  smtpLocalName: string
  smtpSaving: boolean
  testEmailRecipient: string
  testEmailSending: boolean
  setSmtpEnabled: (value: boolean) => void
  setSmtpHost: (value: string) => void
  setSmtpPort: (value: number) => void
  setSmtpUsername: (value: string) => void
  setSmtpPassword: (value: string) => void
  setSmtpAuthMethod: (value: string) => void
  setSmtpTls: (value: boolean) => void
  setSmtpLocalName: (value: string) => void
  setTestEmailRecipient: (value: string) => void
  saveSmtp: () => void
  sendTestEmail: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SMTP</CardTitle>
        <CardDescription>Outgoing email configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle id="smtpEnabled" checked={smtpEnabled} onChange={setSmtpEnabled} />
          <Label htmlFor="smtpEnabled">Enable SMTP</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="smtpHost">Host</Label>
            <Input
              id="smtpHost"
              value={smtpHost}
              onChange={e => setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpPort">Port</Label>
            <Input
              id="smtpPort"
              type="number"
              value={smtpPort}
              onChange={e => setSmtpPort(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpUsername">Username</Label>
            <Input
              id="smtpUsername"
              value={smtpUsername}
              onChange={e => setSmtpUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpPassword">Password</Label>
            <Input
              id="smtpPassword"
              type="password"
              value={smtpPassword}
              onChange={e => setSmtpPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="smtpAuthMethod">Auth Method</Label>
          <select
            id="smtpAuthMethod"
            className={selectClass}
            value={smtpAuthMethod}
            onChange={e => setSmtpAuthMethod(e.target.value)}
          >
            <option value="">— None —</option>
            <option value="PLAIN">PLAIN</option>
            <option value="LOGIN">LOGIN</option>
            <option value="CRAM-MD5">CRAM-MD5</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="smtpTls" checked={smtpTls} onChange={setSmtpTls} />
          <Label htmlFor="smtpTls">Use TLS</Label>
        </div>
        <div className="space-y-1">
          <Label htmlFor="smtpLocalName">Local Name</Label>
          <Input
            id="smtpLocalName"
            value={smtpLocalName}
            onChange={e => setSmtpLocalName(e.target.value)}
            placeholder="localhost"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={saveSmtp} saving={smtpSaving} />
          <Input
            placeholder="recipient@example.com"
            value={testEmailRecipient}
            onChange={e => setTestEmailRecipient(e.target.value)}
            className="w-56"
          />
          <Button variant="outline" onClick={sendTestEmail} disabled={testEmailSending}>
            {testEmailSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Send Test Email'
            )}
          </Button>
        </div>
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
